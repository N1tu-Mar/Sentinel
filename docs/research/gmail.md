# Gmail API

Source: https://developers.google.com/gmail/api/reference/rest (K, not re-opened). Twin: threads/messages/search/send V; operator coverage + base64url U. Fixtures: `fixtures/gmail/`.

Base `$GMAIL_API_BASE_URL/gmail/v1/users/me` (path prefix on twin U), `Authorization: Bearer $GMAIL_ACCESS_TOKEN`.

| op | request | response |
|---|---|---|
| search threads | `GET /threads?q=from:riley.tanaka@example.com OR to:riley.tanaka@example.com after:2026/06/15&maxResults=20` | `{threads:[{id,snippet,historyId}], resultSizeEstimate, nextPageToken?}` (threads.list.json) |
| search messages | `GET /messages?q=...` | `{messages:[{id,threadId}], resultSizeEstimate}`; **empty ⇒ `messages` key absent** (messages.list.empty.json) |
| get thread | `GET /threads/{id}?format=full` | `{id, historyId, messages[]}` |
| get message | `GET /messages/{id}?format=full` | message |
| send | `POST /messages/send {raw: base64url(RFC822)}` | not needed by Sentinel |

Query operators: `from:`, `to:`, `subject:`, `after:YYYY/MM/DD` (or epoch seconds), `before:`, `OR`, `{a b}`, `"exact phrase"`. Search both directions: `from:x OR to:x`.

Message shape: `id, threadId, labelIds[], snippet, historyId, internalDate` (**epoch ms as string**), `sizeEstimate, payload{partId, mimeType, filename, headers[{name,value}], body{size, data?}, parts[]}`.

Plain-text extraction (recursive):
```ts
function textOf(p): string {
  if (p.mimeType === "text/plain" && p.body?.data) return b64url(p.body.data);
  for (const c of p.parts ?? []) { const t = textOf(c); if (t) return t; }
  if (p.mimeType === "text/html" && p.body?.data) return b64url(p.body.data).replace(/<[^>]+>/g, " ");
  return "";
}
const b64url = (s: string) => Buffer.from(s, "base64url").toString("utf8"); // handles missing padding
```
Header lookup case-insensitive: `headers.find(h => h.name.toLowerCase()==="from")`. Quoted replies include prior text — strip lines starting with `>` / "On … wrote:" before quoting as evidence. Single-part messages have `payload.body.data` and no `parts`. Attachments: `body.attachmentId` instead of `data`.
