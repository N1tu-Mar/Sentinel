import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

// Local stateful sandbox for Salesforce, Gmail and Slack, used while Arga twin runs are unavailable.
// It serves the subset of each REST API that Sentinel's adapters call (shapes match the live twins probed in
// fixtures/live), keeps state in memory, and resets on POST /_sandbox/reset. Results produced against it are
// labeled "local-sandbox"; Stripe is never sandboxed (real Stripe test mode).

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
interface State {
  contacts: SfRecord[];
  cases: SfRecord[];
  mail: Mail[];
  channels: { id: string; name: string; messages: SlackMsg[] }[];
  seq: number;
  ts: number;
}

const fresh = (): State => ({ contacts: [], cases: [], mail: [], channels: [], seq: 0, ts: Math.floor(Date.now() / 1000) });

const json = (res: ServerResponse, status: number, body?: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body === undefined ? "" : JSON.stringify(body));
};
const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
  });

export function createSandbox() {
  let s = fresh();
  const nextId = (prefix: string) => `${prefix}${String(++s.seq).padStart(12, "0")}SBX`;

  async function salesforce(req: IncomingMessage, res: ServerResponse, path: string, url: URL) {
    if (!req.headers.authorization) return json(res, 401, [{ message: "Session expired or invalid", errorCode: "INVALID_SESSION_ID" }]);
    if (path === "/services/data") return json(res, 200, [{ label: "Sandbox", url: "/services/data/v60.0", version: "60.0" }]);
    const rest = path.match(/^\/services\/data\/v[\d.]+(\/.*)$/)?.[1];
    const notFound = () => json(res, 404, [{ message: "The requested resource does not exist", errorCode: "NOT_FOUND" }]);
    if (!rest) return notFound();
    const table = (obj: string) => (obj === "Contact" ? s.contacts : obj === "Case" ? s.cases : null);
    const withAttrs = (obj: string, r: SfRecord) => ({ attributes: { type: obj, url: `/services/data/v60.0/sobjects/${obj}/${r.Id}` }, ...r });

    if (rest === "/query") {
      // ponytail: supports the SOQL Sentinel issues (FROM x WHERE a = '…' AND b = '…' [ORDER BY …] [LIMIT n]), nothing more.
      const soql = url.searchParams.get("q") ?? "";
      const m = soql.match(/\bFROM\s+(\w+)(?:\s+WHERE\s+(.+?))?(?:\s+ORDER\s+BY\s+.+?)?(?:\s+LIMIT\s+(\d+))?\s*$/i);
      const rows = m && table(m[1]);
      if (!m || !rows) return json(res, 400, [{ message: `unsupported query: ${soql}`, errorCode: "MALFORMED_QUERY" }]);
      const conds = [...(m[2] ?? "").matchAll(/(\w+)\s*=\s*'((?:\\.|[^'\\])*)'/g)].map(([, field, value]) => [field, value.replace(/\\(.)/g, "$1")]);
      const found = rows.filter((r) => conds.every(([f, v]) => r[f] === v)).slice(0, m[3] ? Number(m[3]) : undefined);
      return json(res, 200, { totalSize: found.length, done: true, records: found.map((r) => withAttrs(m[1], r)) });
    }

    const so = rest.match(/^\/sobjects\/(\w+)(?:\/(\w+))?$/);
    const rows = so && table(so[1]);
    if (!so || !rows) return notFound();
    const [, obj, recordId] = so;
    const setName = (r: SfRecord) => {
      if (obj === "Contact") r.Name = [r.FirstName, r.LastName].filter(Boolean).join(" ");
    };
    if (req.method === "POST" && !recordId) {
      const body = JSON.parse((await readBody(req)) || "{}") as SfRecord;
      const r: SfRecord = { ...body, Id: nextId(obj === "Contact" ? "003" : "500"), CreatedDate: new Date().toISOString().replace("Z", "+0000") };
      setName(r);
      if (obj === "Case") {
        r.CaseNumber = String(s.cases.length + 1).padStart(8, "0");
        r.Status ??= "New";
      }
      rows.push(r);
      return json(res, 201, { id: r.Id, success: true, errors: [] });
    }
    const r = rows.find((x) => x.Id === recordId);
    if (!r) return notFound();
    if (req.method === "PATCH") {
      Object.assign(r, JSON.parse((await readBody(req)) || "{}"));
      setName(r);
      res.writeHead(204);
      return res.end();
    }
    return json(res, 200, withAttrs(obj, r));
  }

  const header = (m: Mail, name: string) => m.headers.find((h) => h.name.toLowerCase() === name)?.value ?? "";
  const toApi = (m: Mail) => ({
    id: m.id,
    threadId: m.threadId,
    labelIds: m.labelIds,
    snippet: m.body.slice(0, 100),
    historyId: String(1000 + s.seq),
    internalDate: String(m.internalDate),
    payload: { partId: "", mimeType: "text/plain", headers: m.headers, body: { size: m.body.length, data: Buffer.from(m.body).toString("base64url") } },
  });

  async function gmail(req: IncomingMessage, res: ServerResponse, path: string, url: URL) {
    if (!req.headers.authorization) return json(res, 401, { error: { code: 401, message: "Request had invalid authentication credentials." } });
    const p = path.replace(/^\/gmail\/v1\/users\/me/, "");
    const notFound = () => json(res, 404, { error: { code: 404, message: "Requested entity was not found." } });
    if (p === "/profile")
      return json(res, 200, { emailAddress: "support@juniperpine.example", messagesTotal: s.mail.length, threadsTotal: new Set(s.mail.map((m) => m.threadId)).size });

    if (req.method === "POST" && ["/messages", "/messages/send", "/messages/import"].includes(p)) {
      const body = JSON.parse((await readBody(req)) || "{}") as { raw?: string; threadId?: string; labelIds?: string[] };
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
        internalDate: url.searchParams.get("internalDateSource") === "dateHeader" && !Number.isNaN(dated) ? dated : Date.now(),
        headers,
        body: split >= 0 ? text.slice(split).replace(/^\r?\n\r?\n/, "") : "",
      };
      s.mail.push(m);
      return json(res, 200, toApi(m));
    }

    if (p === "/threads" || p === "/messages") {
      // ponytail: from:/to: match either address header; after:YYYY/MM/DD; other operators are ignored.
      const q = url.searchParams.get("q") ?? "";
      const emails = [...q.matchAll(/(?:from|to):(\S+)/g)].map((x) => x[1].toLowerCase());
      const after = q.match(/after:(\d{4})\/(\d{2})\/(\d{2})/);
      const afterMs = after ? Date.UTC(Number(after[1]), Number(after[2]) - 1, Number(after[3])) : 0;
      const hits = s.mail.filter(
        (m) => m.internalDate >= afterMs && (!emails.length || emails.some((e) => `${header(m, "from")} ${header(m, "to")}`.toLowerCase().includes(e))),
      );
      if (p === "/messages")
        return json(res, 200, hits.length ? { messages: hits.map((m) => ({ id: m.id, threadId: m.threadId })), resultSizeEstimate: hits.length } : { resultSizeEstimate: 0 });
      const threads = [...new Map(hits.map((m) => [m.threadId, m])).values()].map((m) => ({ id: m.threadId, snippet: m.body.slice(0, 100), historyId: "1" }));
      return json(res, 200, threads.length ? { threads, resultSizeEstimate: threads.length } : { resultSizeEstimate: 0 }); // empty ⇒ key absent, like Gmail
    }

    const thread = p.match(/^\/threads\/(\w+)$/)?.[1];
    if (thread) {
      const msgs = s.mail.filter((m) => m.threadId === thread).sort((a, b) => a.internalDate - b.internalDate);
      return msgs.length ? json(res, 200, { id: thread, historyId: "1", messages: msgs.map(toApi) }) : notFound();
    }
    const message = s.mail.find((m) => m.id === p.match(/^\/messages\/(\w+)$/)?.[1]);
    return message ? json(res, 200, toApi(message)) : notFound();
  }

  async function slack(req: IncomingMessage, res: ServerResponse, method: string) {
    const raw = await readBody(req);
    const params: Record<string, string> = (req.headers["content-type"] ?? "").includes("json") ? JSON.parse(raw || "{}") : Object.fromEntries(new URLSearchParams(raw));
    const ok = (body: object = {}) => json(res, 200, { ok: true, ...body });
    const fail = (error: string) => json(res, 200, { ok: false, error }); // Slack answers 200 even on errors
    if (!req.headers.authorization) return fail("not_authed");
    const channel = (idOrName?: string) => s.channels.find((c) => c.id === idOrName || c.name === idOrName);
    const view = (c: State["channels"][number]) => ({ id: c.id, name: c.name, name_normalized: c.name, is_channel: true, is_member: true });

    switch (method) {
      case "auth.test":
        return ok({ url: "http://localhost/", team: "Juniper & Pine (sandbox)", team_id: "TSANDBOX", user: "sentinel", user_id: "USENTINEL" });
      case "conversations.list":
        return ok({ channels: s.channels.map(view), response_metadata: { next_cursor: "" } });
      case "conversations.create": {
        const name = (params.name ?? "").toLowerCase();
        if (!name) return fail("invalid_name_required");
        if (channel(name)) return fail("name_taken");
        const c = { id: `C${String(++s.seq).padStart(9, "0")}`, name, messages: [] };
        s.channels.push(c);
        return ok({ channel: view(c) });
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
        return ok({ channel: c.id, ts: message.ts, message });
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

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://sandbox");
      const path = url.pathname;
      if (req.method === "POST" && ["/_sandbox/reset", "/admin/reset", "/salesforce/admin/reset"].includes(path)) {
        s = fresh();
        return json(res, 200, { ok: true, reset: true });
      }
      if (path === "/_sandbox/state")
        return json(res, 200, {
          contacts: s.contacts.length,
          cases: s.cases.map((c) => c.Subject),
          mail: s.mail.length,
          channels: s.channels.map((c) => ({ name: c.name, messages: c.messages.length })),
        });
      if (path.startsWith("/salesforce/")) return await salesforce(req, res, path.slice("/salesforce".length), url);
      if (path.startsWith("/gmail/")) return await gmail(req, res, path.slice("/gmail".length), url);
      const slackMethod = path.match(/^\/slack\/api\/([\w.]+)$/)?.[1];
      if (slackMethod) return await slack(req, res, slackMethod);
      json(res, 404, { error: "not found" });
    } catch (e) {
      json(res, 500, { error: String(e) });
    }
  });

  return { server, reset: () => (s = fresh()) };
}

/** Env that points Sentinel's Salesforce, Gmail and Slack adapters at a sandbox. */
export const sandboxEnv = (base: string): Record<string, string> => ({
  SANDBOX_URL: base,
  SALESFORCE_INSTANCE_URL: `${base}/salesforce`,
  SALESFORCE_API_BASE_URL: `${base}/salesforce`,
  SALESFORCE_ACCESS_TOKEN: "sandbox-token",
  GMAIL_API_BASE_URL: `${base}/gmail`,
  GMAIL_ACCESS_TOKEN: "sandbox-token",
  SLACK_API_URL: `${base}/slack/api`,
  SLACK_BOT_TOKEN: "xoxb-sandbox",
});
