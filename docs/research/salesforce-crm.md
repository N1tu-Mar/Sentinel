# Salesforce CRM (Contact + Case)

Source: REST API dev guide https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/ (K = standard behavior, not re-opened). Twin coverage V: arga-twins.md. Fixtures: `fixtures/salesforce/`.

## Auth / base
`Authorization: Bearer $SALESFORCE_ACCESS_TOKEN`, base `$SALESFORCE_INSTANCE_URL/services/data/v$SALESFORCE_API_VERSION`. Discover version: `GET /services/data` (twin V). Datetimes ISO-8601 (`2026-08-25T12:00:00.000+0000`); IDs 15/18-char (Contact `003…`, Case `500…`). SOQL datetime literals unquoted: `CreatedDate >= 2026-03-17T00:00:00Z` or `LAST_N_DAYS:180`.

## Calls
| op | request | response |
|---|---|---|
| find contact | `GET /query?q=SELECT+Id,Name,Email,Description+FROM+Contact+WHERE+Email='riley.tanaka@example.com'+LIMIT+1` | `{totalSize, done, records:[{attributes{type,url}, Id,...}]}` → query.contacts.json |
| cases | `GET /query?q=SELECT+Id,CaseNumber,Subject,Description,Status,Type,CreatedDate+FROM+Case+WHERE+ContactId='003…'+AND+CreatedDate=LAST_N_DAYS:180+ORDER+BY+CreatedDate+DESC` | query.cases.json |
| retrieve | `GET /sobjects/Contact/{Id}` | record without wrapper (contact.json) |
| update | `PATCH /sobjects/Contact/{Id}` JSON body (patch.contact.request.json) | **204 No Content, empty body** ⇒ readback required |
| create | `POST /sobjects/Case` (create.case.request.json) | `201 {id, success:true, errors:[]}` |
| error | any | `[{message, errorCode, fields?}]` array (error.response.json). Common: `INVALID_FIELD`, `MALFORMED_QUERY`, `INVALID_SESSION_ID` (401), `NOT_FOUND`, `REQUIRED_FIELD_MISSING`, `INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST` |

Escape `'` in SOQL strings as `\'`; URL-encode `q`.

## Field decisions (standard fields only — custom `__c` creation on twin is U)
| data | where | format |
|---|---|---|
| order/delivery notes + tracking | **Case** `Subject` "Order {id} delivered", `Description` key-lines | `ORDER: JP-10401\nCARRIER: UPS\nTRACKING: 1Z…\nSHIPPED: YYYY-MM-DD\nDELIVERED: YYYY-MM-DD\nSIGNATURE: …` |
| cancellation record | Case Subject "Subscription cancellation request" | free text with dates |
| LTV | Contact `Description` line | `LTV_CENTS: 48200` |
| prior-dispute count | Contact `Description` line | `PRIOR_DISPUTES_90D: 2` (informational; Stripe is source of truth) |
| friendly-fraud flag | Contact `Description` line | `RISK_FLAG: none` → `RISK_FLAG: friendly_fraud` |
| risk case | Case | Subject `Chargeback risk: repeat disputer`, Priority High |
| ask-human case | Case | Subject `Evidence needed: <dispute id>`, Description lists gaps + due_by |
| accept follow-up | Case | Subject `Dispute accepted: <dispute id>` |

**PATCH gotcha:** `Description` is replaced whole. Read current value, rewrite only the `RISK_FLAG:` line, PATCH, then re-GET and check. Parse lines with `/^RISK_FLAG:\s*(\S+)/m`.
Picklists (`Status` New/Working/Escalated/Closed, `Origin` Phone/Email/Web, `Type`/`Reason` "Other") are default-org values — **U on twin**; run `GET /sobjects/Case/describe` once and adjust.
If twin supports seeded custom fields, optional upgrade: `Risk_Flag__c` (checkbox), `Lifetime_Value__c` (currency). Not required.
