import { HttpError, jsonOrThrow, loggedFetch, requireEnv } from "./logged-fetch";

export interface RawPart {
  mimeType?: string;
  body?: { data?: string; size?: number };
  parts?: RawPart[];
  headers?: { name: string; value: string }[];
}
export interface RawMessage {
  id: string;
  threadId: string;
  internalDate?: string; // epoch ms as a string
  snippet?: string;
  payload: RawPart;
}
export interface GmailMessage {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  date: string; // ISO
  text: string;
}

function base(): string {
  const b = requireEnv("GMAIL_API_BASE_URL").replace(/\/$/, "");
  return b.includes("/gmail/v1") ? b : `${b}/gmail/v1`;
}

async function gmail<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await loggedFetch("gmail", `${base()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${requireEnv("GMAIL_ACCESS_TOKEN", "GOOGLE_ACCESS_TOKEN")}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  return jsonOrThrow<T>("gmail", res);
}

const b64url = (s: string) => Buffer.from(s, "base64url").toString("utf8"); // tolerates missing padding

function textOf(p: RawPart): string {
  if (p.mimeType === "text/plain" && p.body?.data) return b64url(p.body.data);
  for (const child of p.parts ?? []) {
    const t = textOf(child);
    if (t) return t;
  }
  if (p.mimeType === "text/html" && p.body?.data) return b64url(p.body.data).replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ");
  return !p.parts && p.body?.data ? b64url(p.body.data) : "";
}

/** Drop quoted replies ("> …" lines and everything from "On … wrote:") so evidence quotes only the sender. */
export function stripQuoted(text: string): string {
  const lines = text.split(/\r?\n/);
  const cut = lines.findIndex((l) => /^On .+wrote:$/.test(l.trim()));
  return (cut >= 0 ? lines.slice(0, cut) : lines).filter((l) => !l.startsWith(">")).join("\n").trim();
}

export function decodeMessage(m: RawMessage): GmailMessage {
  const h = (name: string) => m.payload.headers?.find((x) => x.name.toLowerCase() === name)?.value ?? "";
  const ms = Number(m.internalDate);
  const headerDate = new Date(h("date"));
  const date = ms > 0 ? new Date(ms).toISOString() : Number.isNaN(headerDate.getTime()) ? "" : headerDate.toISOString();
  return { id: m.id, threadId: m.threadId, from: h("from"), to: h("to"), subject: h("subject"), date, text: stripQuoted(textOf(m.payload) || m.snippet || "") };
}

/** after: YYYY/MM/DD. An empty result has no `threads` key. */
export async function searchThreads(email: string, after?: string): Promise<{ id: string; snippet?: string }[]> {
  const query = `from:${email} OR to:${email}${after ? ` after:${after}` : ""}`;
  const res = await gmail<{ threads?: { id: string; snippet?: string }[] }>(`/users/me/threads?q=${encodeURIComponent(query)}&maxResults=20`);
  return res.threads ?? [];
}

export async function getThread(id: string): Promise<GmailMessage[]> {
  const t = await gmail<{ id: string; messages?: RawMessage[] }>(`/users/me/threads/${id}?format=full`);
  return (t.messages ?? []).map(decodeMessage);
}

/** Seeding only: insert an RFC 822 message with its original Date header. Falls back to send. */
export async function insertMessage(m: { from: string; to: string; subject: string; date: Date; body: string; threadId?: string }) {
  const raw = Buffer.from(
    [`From: ${m.from}`, `To: ${m.to}`, `Subject: ${m.subject}`, `Date: ${m.date.toUTCString()}`, "Content-Type: text/plain; charset=utf-8", "", m.body].join("\r\n"),
  ).toString("base64url");
  const body = JSON.stringify({ raw, labelIds: ["INBOX"], ...(m.threadId ? { threadId: m.threadId } : {}) });
  try {
    return await gmail<{ id: string; threadId: string }>(`/users/me/messages?internalDateSource=dateHeader`, { method: "POST", body });
  } catch (e) {
    if (!(e instanceof HttpError) || e.status >= 500) throw e;
    return gmail<{ id: string; threadId: string }>(`/users/me/messages/send`, { method: "POST", body });
  }
}

export const getProfile = () => gmail<{ emailAddress: string }>(`/users/me/profile`);
