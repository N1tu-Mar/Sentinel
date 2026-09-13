import { createServer, type IncomingMessage } from "node:http";

// Stateful sandbox for Salesforce, Gmail and Slack, used while Arga twin runs are unavailable.
// It serves the subset of each REST API that Sentinel's adapters call (shapes match the live twins probed in
// fixtures/live) and resets on POST /_sandbox/reset. The same handler runs as a local Node server (npm run sandbox)
// and inside the deployed app at /api/sandbox/* with state in Redis. Results against it are labeled as sandbox;
// Stripe is never sandboxed (real Stripe test mode).

type SfRecord = Record<string, string>;
interface Mail {
  id: string;
  threadId: string;
  labelIds: string[];
  internalDate: number;
  headers: { name: string; value: string }[];
  body: string;
}
interface SlackMsg {
  ts: string;
  text: string;
  user: string;
  type: "message";
}

export interface SandboxState {
  salesforce: { contacts: SfRecord[]; cases: SfRecord[]; seq: number };
  gmail: { mail: Mail[] };
  slack: { channels: { id: string; name: string; messages: SlackMsg[] }[]; seq: number; ts: number };
}
export type SandboxSystem = keyof SandboxState;

export const freshState: { [K in SandboxSystem]: () => SandboxState[K] } = {
  salesforce: () => ({ contacts: [], cases: [], seq: 0 }),
  gmail: () => ({ mail: [] }),
  slack: () => ({ channels: [], seq: 0, ts: Math.floor(Date.now() / 1000) }),
};

export interface SandboxStore {
  load<K extends SandboxSystem>(system: K): Promise<SandboxState[K]>;
  save<K extends SandboxSystem>(system: K, state: SandboxState[K]): Promise<void>;
  reset(): Promise<void>;
}

export interface SandboxRequest {
  method: string;
  pathname: string; // relative to the sandbox root, e.g. /salesforce/services/data/v60.0/query
  url: URL;
  authorization: string | null;
  contentType: string;
  body: string;
}
export interface SandboxResult {
  status: number;
  body?: unknown; // undefined ⇒ empty body (e.g. 204)
  mutated?: boolean;
}

const result = (status: number, body?: unknown, mutated = false): SandboxResult => ({ status, body, mutated });

function salesforce(s: SandboxState["salesforce"], req: SandboxRequest, path: string): SandboxResult {
  if (path === "/services/data") return result(200, [{ label: "Sandbox", url: "/services/data/v60.0", version: "60.0" }]);
  const rest = path.match(/^\/services\/data\/v[\d.]+(\/.*)$/)?.[1];
  const notFound = result(404, [{ message: "The requested resource does not exist", errorCode: "NOT_FOUND" }]);
  if (!rest) return notFound;
  const table = (obj: string) => (obj === "Contact" ? s.contacts : obj === "Case" ? s.cases : null);
  const withAttrs = (obj: string, r: SfRecord) => ({ attributes: { type: obj, url: `/services/data/v60.0/sobjects/${obj}/${r.Id}` }, ...r });

  if (rest === "/query") {
    // ponytail: supports the SOQL Sentinel issues (FROM x WHERE a = '…' AND b = '…' [ORDER BY …] [LIMIT n]), nothing more.
    const soql = req.url.searchParams.get("q") ?? "";
    const m = soql.match(/\bFROM\s+(\w+)(?:\s+WHERE\s+(.+?))?(?:\s+ORDER\s+BY\s+.+?)?(?:\s+LIMIT\s+(\d+))?\s*$/i);
    const rows = m && table(m[1]);
    if (!m || !rows) return result(400, [{ message: `unsupported query: ${soql}`, errorCode: "MALFORMED_QUERY" }]);
    const conds = [...(m[2] ?? "").matchAll(/(\w+)\s*=\s*'((?:\\.|[^'\\])*)'/g)].map(([, field, value]) => [field, value.replace(/\\(.)/g, "$1")]);
    const found = rows.filter((r) => conds.every(([f, v]) => r[f] === v)).slice(0, m[3] ? Number(m[3]) : undefined);
    return result(200, { totalSize: found.length, done: true, records: found.map((r) => withAttrs(m[1], r)) });
  }

  const so = rest.match(/^\/sobjects\/(\w+)(?:\/(\w+))?$/);
  const rows = so && table(so[1]);
  if (!so || !rows) return notFound;
  const [, obj, recordId] = so;
  const setName = (r: SfRecord) => {
    if (obj === "Contact") r.Name = [r.FirstName, r.LastName].filter(Boolean).join(" ");
  };
  if (req.method === "POST" && !recordId) {
    const r: SfRecord = {
      ...(JSON.parse(req.body || "{}") as SfRecord),
      Id: `${obj === "Contact" ? "003" : "500"}${String(++s.seq).padStart(12, "0")}SBX`,
      CreatedDate: new Date().toISOString().replace("Z", "+0000"),
    };
    setName(r);
    if (obj === "Case") {
      r.CaseNumber = String(s.cases.length + 1).padStart(8, "0");
      r.Status ??= "New";
    }
    rows.push(r);
    return result(201, { id: r.Id, success: true, errors: [] }, true);
  }
  const r = rows.find((x) => x.Id === recordId);
  if (!r) return notFound;
  if (req.method === "PATCH") {
    Object.assign(r, JSON.parse(req.body || "{}"));
    setName(r);
    return result(204, undefined, true);
  }
  return result(200, withAttrs(obj, r));
}

function gmail(s: SandboxState["gmail"], req: SandboxRequest, path: string): SandboxResult {
  const p = path.replace(/^\/gmail\/v1\/users\/me/, "");
  const notFound = result(404, { error: { code: 404, message: "Requested entity was not found." } });
  const header = (m: Mail, name: string) => m.headers.find((h) => h.name.toLowerCase() === name)?.value ?? "";
  const toApi = (m: Mail) => ({
    id: m.id,
    threadId: m.threadId,
    labelIds: m.labelIds,
    snippet: m.body.slice(0, 100),
    historyId: "1",
    internalDate: String(m.internalDate),
    payload: { partId: "", mimeType: "text/plain", headers: m.headers, body: { size: m.body.length, data: Buffer.from(m.body).toString("base64url") } },
  });

  if (p === "/profile")
    return result(200, { emailAddress: "support@juniperpine.example", messagesTotal: s.mail.length, threadsTotal: new Set(s.mail.map((m) => m.threadId)).size });

  if (req.method === "POST" && ["/messages", "/messages/send", "/messages/import"].includes(p)) {
    const body = JSON.parse(req.body || "{}") as { raw?: string; threadId?: string; labelIds?: string[] };
    const text = Buffer.from(body.raw ?? "", "base64url").toString("utf8");
    const split = text.search(/\r?\n\r?\n/);
    const headers = (split >= 0 ? text.slice(0, split) : text)
      .split(/\r?\n/)
      .map((line) => ({ name: line.slice(0, line.indexOf(":")).trim(), value: line.slice(line.indexOf(":") + 1).trim() }))
      .filter((h) => h.name);
    const id = crypto.randomUUID().replaceAll("-", "").slice(0, 16);
    const dated = Date.parse(headers.find((h) => h.name.toLowerCase() === "date")?.value ?? "");
    const m: Mail = {
      id,
      threadId: body.threadId ?? id,
      labelIds: body.labelIds ?? (p.endsWith("send") ? ["SENT"] : ["INBOX"]),
      internalDate: req.url.searchParams.get("internalDateSource") === "dateHeader" && !Number.isNaN(dated) ? dated : Date.now(),
      headers,
      body: split >= 0 ? text.slice(split).replace(/^\r?\n\r?\n/, "") : "",
    };
    s.mail.push(m);
    return result(200, toApi(m), true);
  }

  if (p === "/threads" || p === "/messages") {
    // ponytail: from:/to: match either address header; after:YYYY/MM/DD; other operators are ignored.
    const q = req.url.searchParams.get("q") ?? "";
    const emails = [...q.matchAll(/(?:from|to):(\S+)/g)].map((x) => x[1].toLowerCase());
    const after = q.match(/after:(\d{4})\/(\d{2})\/(\d{2})/);
    const afterMs = after ? Date.UTC(Number(after[1]), Number(after[2]) - 1, Number(after[3])) : 0;
    const hits = s.mail.filter(
      (m) => m.internalDate >= afterMs && (!emails.length || emails.some((e) => `${header(m, "from")} ${header(m, "to")}`.toLowerCase().includes(e))),
    );
    if (p === "/messages")
      return result(200, hits.length ? { messages: hits.map((m) => ({ id: m.id, threadId: m.threadId })), resultSizeEstimate: hits.length } : { resultSizeEstimate: 0 });
    const threads = [...new Map(hits.map((m) => [m.threadId, m])).values()].map((m) => ({ id: m.threadId, snippet: m.body.slice(0, 100), historyId: "1" }));
    return result(200, threads.length ? { threads, resultSizeEstimate: threads.length } : { resultSizeEstimate: 0 }); // empty ⇒ key absent, like Gmail
  }

  const thread = p.match(/^\/threads\/(\w+)$/)?.[1];
  if (thread) {
    const msgs = s.mail.filter((m) => m.threadId === thread).sort((a, b) => a.internalDate - b.internalDate);
    return msgs.length ? result(200, { id: thread, historyId: "1", messages: msgs.map(toApi) }) : notFound;
  }
  const message = s.mail.find((m) => m.id === p.match(/^\/messages\/(\w+)$/)?.[1]);
  return message ? result(200, toApi(message)) : notFound;
}

function slack(s: SandboxState["slack"], req: SandboxRequest, method: string): SandboxResult {
  const params: Record<string, string> = req.contentType.includes("json") ? JSON.parse(req.body || "{}") : Object.fromEntries(new URLSearchParams(req.body));
  const ok = (body: object = {}, mutated = false) => result(200, { ok: true, ...body }, mutated);
  const fail = (error: string) => result(200, { ok: false, error }); // Slack answers 200 even on errors
  const channel = (idOrName?: string) => s.channels.find((c) => c.id === idOrName || c.name === idOrName);
  const view = (c: SandboxState["slack"]["channels"][number]) => ({ id: c.id, name: c.name, name_normalized: c.name, is_channel: true, is_member: true });

  switch (method) {
    case "auth.test":
      return ok({ url: "https://sandbox.local/", team: "Juniper & Pine (sandbox)", team_id: "TSANDBOX", user: "sentinel", user_id: "USENTINEL" });
    case "conversations.list":
      return ok({ channels: s.channels.map(view), response_metadata: { next_cursor: "" } });
    case "conversations.create": {
      const name = (params.name ?? "").toLowerCase();
      if (!name) return fail("invalid_name_required");
      if (channel(name)) return fail("name_taken");
      const c = { id: `C${String(++s.seq).padStart(9, "0")}`, name, messages: [] };
      s.channels.push(c);
      return ok({ channel: view(c) }, true);
    }
    case "conversations.join": {
      const c = channel(params.channel);
      return c ? ok({ channel: view(c) }) : fail("channel_not_found");
    }
    case "chat.postMessage": {
      const c = channel(params.channel);
      if (!c) return fail("channel_not_found");
      if (!params.text && !params.blocks) return fail("no_text");
      const message: SlackMsg = { ts: `${++s.ts}.${String(++s.seq).padStart(6, "0")}`, text: params.text ?? "", user: "USENTINEL", type: "message" };
      c.messages.unshift(message); // history is newest first
      return ok({ channel: c.id, ts: message.ts, message }, true);
    }
    case "conversations.history": {
      const c = channel(params.channel);
      if (!c) return fail("channel_not_found");
      const oldest = Number(params.oldest ?? 0);
      const inclusive = params.inclusive === "true";
      const messages = c.messages.filter((m) => (inclusive ? Number(m.ts) >= oldest : Number(m.ts) > oldest));
      return ok({ messages: params.limit ? messages.slice(0, Number(params.limit)) : messages, has_more: false });
    }
    default:
      return fail("unknown_method");
  }
}

/** Routes one request to the right system, loading and (only if it changed) saving that system's state. */
export async function handleSandbox(store: SandboxStore, req: SandboxRequest, requiredToken?: string): Promise<SandboxResult> {
  const path = req.pathname;
  if (req.method === "POST" && ["/_sandbox/reset", "/admin/reset", "/salesforce/admin/reset"].includes(path)) {
    await store.reset();
    return result(200, { ok: true, reset: true });
  }
  const authorized = requiredToken ? req.authorization === `Bearer ${requiredToken}` : !!req.authorization;
  if (path === "/_sandbox/state") {
    const [sf, gm, sl] = await Promise.all([store.load("salesforce"), store.load("gmail"), store.load("slack")]);
    if (req.url.searchParams.get("full") === "1") {
      const h = (m: Mail, name: string) => m.headers.find((x) => x.name.toLowerCase() === name)?.value ?? "";
      return result(200, {
        salesforce: { contacts: sf.contacts, cases: sf.cases },
        gmail: {
          messages: gm.mail.map((m) => ({ id: m.id, threadId: m.threadId, date: new Date(m.internalDate).toISOString(), from: h(m, "from"), to: h(m, "to"), subject: h(m, "subject"), body: m.body })),
        },
        slack: { channels: sl.channels },
      });
    }
    return result(200, {
      contacts: sf.contacts.length,
      cases: sf.cases.map((c) => c.Subject),
      mail: gm.mail.length,
      channels: sl.channels.map((c) => ({ name: c.name, messages: c.messages.length })),
    });
  }
  // ponytail: each system's state is one Redis value (last write wins); fine for one agent run at a time.
  if (path.startsWith("/salesforce/")) {
    if (!authorized) return result(401, [{ message: "Session expired or invalid", errorCode: "INVALID_SESSION_ID" }]);
    const st = await store.load("salesforce");
    const r = salesforce(st, req, path.slice("/salesforce".length));
    if (r.mutated) await store.save("salesforce", st);
    return r;
  }
  if (path.startsWith("/gmail/")) {
    if (!authorized) return result(401, { error: { code: 401, message: "Request had invalid authentication credentials." } });
    const st = await store.load("gmail");
    const r = gmail(st, req, path.slice("/gmail".length));
    if (r.mutated) await store.save("gmail", st);
    return r;
  }
  const slackMethod = path.match(/^\/slack\/api\/([\w.]+)$/)?.[1];
  if (slackMethod) {
    if (!authorized) return result(200, { ok: false, error: "invalid_auth" });
    const st = await store.load("slack");
    const r = slack(st, req, slackMethod);
    if (r.mutated) await store.save("slack", st);
    return r;
  }
  return result(404, { error: "not found" });
}

export function memoryStore(): SandboxStore {
  const fresh = (): SandboxState => ({ salesforce: freshState.salesforce(), gmail: freshState.gmail(), slack: freshState.slack() });
  let s = fresh();
  return {
    load: async (system) => s[system],
    save: async (system, state) => {
      (s as Record<SandboxSystem, unknown>)[system] = state;
    },
    reset: async () => {
      s = fresh();
    },
  };
}

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
  });

/** Standalone Node server over an in-memory store (npm run sandbox, tests). */
export function createSandbox(requiredToken = process.env.SANDBOX_TOKEN) {
  const store = memoryStore();
  const server = createServer(async (req, response) => {
    try {
      const url = new URL(req.url ?? "/", "http://sandbox");
      const r = await handleSandbox(
        store,
        { method: req.method ?? "GET", pathname: url.pathname, url, authorization: req.headers.authorization ?? null, contentType: req.headers["content-type"] ?? "", body: await readBody(req) },
        requiredToken,
      );
      response.writeHead(r.status, r.body === undefined ? {} : { "content-type": "application/json" });
      response.end(r.body === undefined ? "" : JSON.stringify(r.body));
    } catch (e) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: String(e) }));
    }
  });
  return { server, store };
}

/** Env that points Sentinel's Salesforce, Gmail and Slack adapters at a sandbox root. */
export const sandboxEnv = (base: string, token = "sandbox-token"): Record<string, string> => ({
  SANDBOX_URL: base,
  SALESFORCE_INSTANCE_URL: `${base}/salesforce`,
  SALESFORCE_API_BASE_URL: `${base}/salesforce`,
  SALESFORCE_ACCESS_TOKEN: token,
  GMAIL_API_BASE_URL: `${base}/gmail`,
  GMAIL_ACCESS_TOKEN: token,
  SLACK_API_URL: `${base}/slack/api`,
  SLACK_BOT_TOKEN: token,
});
