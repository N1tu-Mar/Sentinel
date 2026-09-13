import { env, HttpError, loggedFetch, requireEnv } from "./logged-fetch";

// Raw Web API over loggedFetch (not @slack/web-api) so every Slack call lands in the provider-call log.

interface SlackMessage {
  ts: string;
  text: string;
}

const base = () => (env("SLACK_API_URL", "SLACK_TWIN_BASE_URL") ?? "https://slack.com/api").replace(/\/$/, "");

export async function call<T>(
  method: string,
  params: Record<string, string | number | boolean>,
  opts: { signal?: AbortSignal } = {},
): Promise<T> {
  const res = await loggedFetch("slack", `${base()}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireEnv("SLACK_BOT_TOKEN", "SLACK_TOKEN")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
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
    types: "public_channel",
    limit: 1000,
    exclude_archived: true,
  });
  for (const c of res.channels) ids.set(c.name, c.id);
  return ids.get(name);
}

export async function ensureChannel(name: string): Promise<string> {
  const existing = await channelId(name);
  if (existing) return existing;
  const res = await call<{ channel: { id: string } }>("conversations.create", { name });
  ids.set(name, res.channel.id);
  return res.channel.id;
}

export async function post(channel: string, text: string, opts: { signal?: AbortSignal } = {}): Promise<string> {
  const res = await call<{ ts: string }>("chat.postMessage", { channel: await ensureChannel(channel), text }, opts);
  return res.ts;
}

export async function findMessages(channel: string, containing: string): Promise<SlackMessage[]> {
  const id = await channelId(channel);
  if (!id) return [];
  const res = await call<{ messages: SlackMessage[] }>("conversations.history", { channel: id, limit: 200 });
  return res.messages.filter((m) => m.text?.includes(containing));
}

export const authTest = () => call<{ team: string; user: string }>("auth.test", {});

/** Test-only: forget cached channel ids after a twin reset. */
export const clearChannelCache = () => ids.clear();
