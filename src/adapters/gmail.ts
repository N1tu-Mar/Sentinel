import { HttpError, jsonOrThrow, loggedFetch, requireEnv } from "./logged-fetch";

export interface GmailMessage {
  id: string;
  threadId: string;
  from: string;
  to: string;
  date: string;
  subject: string;
  text: string;
}

interface Part {
  mimeType?: string;
  body?: { data?: string };
  parts?: Part[];
  headers?: { name: string; value: string }[];
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

const b64 = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

function textOf(p: Part): string {
  if (p.mimeType === "text/plain" && p.body?.data) return b64(p.body.data);
  for (const child of p.parts ?? []) {
    const t = textOf(child);
    if (t) return t;
  }
  return p.body?.data && !p.parts ? b64(p.body.data) : "";
}

export async function getMessage(id: string): Promise<GmailMessage> {
  const m = await gmail<{ id: string; threadId: string; snippet?: string; payload: Part }>(
    `/users/me/messages/${id}?format=full`,
  );
  const h = (name: string) => m.payload.headers?.find((x) => x.name.toLowerCase() === name)?.value ?? "";
  return {
    id: m.id,
    threadId: m.threadId,
    from: h("from"),
    to: h("to"),
    date: h("date"),
    subject: h("subject"),
    text: textOf(m.payload) || m.snippet || "",
  };
}

export async function searchMessages(query: string, maxResults = 10): Promise<GmailMessage[]> {
  const list = await gmail<{ messages?: { id: string }[] }>(
    `/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${Math.min(maxResults, 10)}`,
  );
  return Promise.all((list.messages ?? []).slice(0, 10).map((m) => getMessage(m.id)));
}

/** Seeding only: insert an RFC 822 message with a backdated Date header. Falls back to send. */
export async function insertMessage(m: { from: string; to: string; subject: string; date: Date; body: string }) {
  const raw = Buffer.from(
    [
      `From: ${m.from}`,
      `To: ${m.to}`,
      `Subject: ${m.subject}`,
      `Date: ${m.date.toUTCString()}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      m.body,
    ].join("\r\n"),
  ).toString("base64url");
  try {
    return await gmail<{ id: string }>(`/users/me/messages?internalDateSource=dateHeader`, {
      method: "POST",
      body: JSON.stringify({ raw, labelIds: ["INBOX"] }),
    });
  } catch (e) {
    if (!(e instanceof HttpError) || e.status >= 500) throw e;
    return gmail<{ id: string }>(`/users/me/messages/send`, { method: "POST", body: JSON.stringify({ raw }) });
  }
}

export const getProfile = () => gmail<{ emailAddress: string }>(`/users/me/profile`);
