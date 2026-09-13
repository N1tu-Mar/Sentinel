import { env, HttpError, loggedFetch, requireEnv } from "./logged-fetch";

// Raw Web API over loggedFetch (not @slack/web-api) so every Slack call lands in the provider-call log.
// Slack answers HTTP 200 even on errors, so `ok` is always checked.

interface SlackMessage {
  ts: string;
  text: string;
}

const base = () => (env("SLACK_API_URL", "SLACK_TWIN_BASE_URL") ?? "https://slack.com/api").replace(/\/$/, "");

export async function call<T>(method: string, params: Record<string, string | number | boolean>, opts: { signal?: AbortSignal } = {}): Promise<T> {
  const res = await loggedFetch("slack", `${base()}/${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${requireEnv("SLACK_BOT_TOKEN", "SLACK_TOKEN")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])),
    signal: opts.signal,
  });
  const body = (await res.json()) as { ok: boolean; error?: string } & T;
  if (!body.ok) throw new HttpError(res.status, `slack ${method}: ${body.error}`, body);
  return body;
}

export const channelName = (kind: "disputes" | "approvals" | "risk") =>
  ({
    disputes: env("SLACK_CHANNEL_DISPUTES") ?? "disputes",
    approvals: env("SLACK_CHANNEL_APPROVALS") ?? "dispute-approvals",
    risk: env("SLACK_CHANNEL_RISK") ?? "risk",
  })[kind];

const ids = new Map<string, string>();

async function channelId(name: string): Promise<string | undefined> {
  if (ids.has(name)) return ids.get(name);
  const res = await call<{ channels: { id: string; name: string }[] }>("conversations.list", {
    types: "public_channel,private_channel",
    limit: 1000,
    exclude_archived: true,
  });
  for (const c of res.channels) ids.set(c.name, c.id);
  return ids.get(name);
}

/** The twin starts with no channels: resolve by name, create if missing. */
export async function ensureChannel(name: string): Promise<string> {
  const existing = await channelId(name);
  if (existing) return existing;
  try {
    const res = await call<{ channel: { id: string } }>("conversations.create", { name });
    ids.set(name, res.channel.id);
    return res.channel.id;
  } catch (e) {
    if (!(e instanceof HttpError && e.message.endsWith("name_taken"))) throw e;
    ids.clear();
    const id = await channelId(name);
    if (!id) throw e;
    return id;
  }
}

export async function post(channel: string, text: string, opts: { signal?: AbortSignal } = {}): Promise<{ channel: string; ts: string }> {
  const id = await ensureChannel(channel);
  const send = () => call<{ ts: string; channel?: string }>("chat.postMessage", { channel: id, text }, opts);
  let res;
  try {
    res = await send();
  } catch (e) {
    if (!(e instanceof HttpError && e.message.endsWith("not_in_channel"))) throw e;
    await call("conversations.join", { channel: id });
    res = await send();
  }
  return { channel: res.channel ?? id, ts: res.ts };
}

/** Proof a specific post exists: history from its ts, inclusive, one message, ts must match. */
export async function readback(channelIdValue: string, ts: string): Promise<{ found: boolean; text: string }> {
  const res = await call<{ messages?: SlackMessage[] }>("conversations.history", { channel: channelIdValue, oldest: ts, inclusive: true, limit: 1 });
  const m = res.messages?.[0];
  return { found: m?.ts === ts, text: m?.text ?? "" };
}

export async function findMessages(channel: string, containing: string): Promise<SlackMessage[]> {
  const id = await channelId(channel);
  if (!id) return [];
  const res = await call<{ messages: SlackMessage[] }>("conversations.history", { channel: id, limit: 200 });
  return res.messages.filter((m) => m.text?.includes(containing));
}

export const authTest = () => call<{ team: string; user: string }>("auth.test", {});

/** Forget cached channel ids after a twin reset. */
export const clearChannelCache = () => ids.clear();
