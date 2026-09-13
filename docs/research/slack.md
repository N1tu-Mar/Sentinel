# Slack Web API

Sources: https://api.slack.com/methods/chat.postMessage , /methods/conversations.history , /block-kit , /reference/interaction-payloads/block-actions-payload (K, not re-opened). Twin V: Block Kit, scopes enforced, channels start empty. Fixtures: `fixtures/slack/`.

Base `$SLACK_API_URL` (twin `/api/`), `Authorization: Bearer $SLACK_BOT_TOKEN`, `Content-Type: application/json; charset=utf-8`. **Always HTTP 200; check `ok`.** Error `{ok:false, error:"channel_not_found"|"not_in_channel"|"missing_scope"|"invalid_auth"|"invalid_blocks"|"ratelimited"}`.

| method | params | returns |
|---|---|---|
| `chat.postMessage` | `channel` (ID `C…` preferred), `text` (fallback, always send), `blocks?`, `thread_ts?`, `unfurl_links?` | `{ok, channel, ts, message}` — `ts` string is the message ID |
| `conversations.history` | `channel`, `oldest?` (ts), `limit?`, `inclusive?` | `{ok, messages[], has_more, response_metadata.next_cursor}` newest first |
| `conversations.list` | `types=public_channel,private_channel`, `limit` | `{ok, channels[{id,name}]}` — resolve name→ID once, cache |
| `conversations.create` | `name` (lowercase, no #) | `{ok, channel{id,name}}`; `name_taken` if exists |
| `conversations.join` | `channel` | needed if bot not member (`not_in_channel`) |

Scopes: `chat:write`, `channels:read`, `channels:history`, `channels:manage`, `channels:join`.

Readback: `conversations.history?channel=C…&oldest=<ts>&inclusive=true&limit=1` and match `messages[0].ts === postedTs` (or text contains dispute id).

Approval message: `section` (mrkdwn) + `actions` with two `button`s (`action_id`, `value`=dispute id, `style` primary/danger). See postMessage.approval.request.json. Interactive callbacks POST `application/x-www-form-urlencoded` `payload=<json>` to app's Request URL; shape in block_actions.payload.json; verify `X-Slack-Signature` (`v0=` HMAC-SHA256 of `v0:{X-Slack-Request-Timestamp}:{rawBody}` with signing secret). **Twin support for interactivity U ⇒ approvals in Sentinel UI; Slack notify-only.**
