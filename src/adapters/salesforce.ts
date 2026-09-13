import { env, jsonOrThrow, loggedFetch, requireEnv } from "./logged-fetch";

export interface SfContact {
  Id: string;
  Name: string;
  Email: string;
  Description: string | null;
  CreatedDate?: string;
}
export interface SfCase {
  Id: string;
  CaseNumber?: string;
  Subject: string | null;
  Description: string | null;
  Status?: string;
  Type?: string;
  CreatedDate?: string;
}

function base(): string {
  const version = env("SALESFORCE_API_VERSION") ?? "v60.0"; // the twin lists v60.0+ at GET /services/data
  const b = requireEnv("SALESFORCE_API_BASE_URL", "SALESFORCE_INSTANCE_URL").replace(/\/$/, "");
  return b.includes("/services/data") ? b : `${b}/services/data/${version}`;
}

async function sf<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await loggedFetch("salesforce", `${base()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${requireEnv("SALESFORCE_ACCESS_TOKEN")}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  return jsonOrThrow<T>("salesforce", res); // PATCH returns 204 with an empty body → null
}

const q = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

export async function query<T>(soql: string): Promise<T[]> {
  const res = await sf<{ records: T[] }>(`/query?q=${encodeURIComponent(soql)}`);
  return res.records;
}

/** The twin's SOQL rejects Contact.Description (not in describe) but stores and returns it on the record, so read it by id. */
export async function findContactByEmail(email: string): Promise<SfContact | null> {
  const rows = await query<{ Id: string }>(`SELECT Id, Name, Email FROM Contact WHERE Email = ${q(email)} LIMIT 1`);
  return rows[0] ? getContact(rows[0].Id) : null;
}

export const getContact = (id: string) => sf<SfContact>(`/sobjects/Contact/${id}`);
export const getCase = (id: string) => sf<SfCase>(`/sobjects/Case/${id}`);

// Case on the twin has no Type field; the 180-day window is applied here rather than with LAST_N_DAYS.
export async function listCasesForContact(contactId: string, days = 180): Promise<SfCase[]> {
  const rows = await query<SfCase>(`SELECT Id, CaseNumber, Subject, Description, Status, CreatedDate FROM Case WHERE ContactId = ${q(contactId)}`);
  const since = Date.now() - days * 86400_000;
  return rows
    .filter((r) => !r.CreatedDate || Date.parse(r.CreatedDate) >= since)
    .sort((a, b) => Date.parse(b.CreatedDate ?? "") - Date.parse(a.CreatedDate ?? ""));
}

export const findCases = (contactId: string, subject: string) =>
  query<SfCase>(`SELECT Id, Subject, Description FROM Case WHERE ContactId = ${q(contactId)} AND Subject = ${q(subject)}`);

// Status/Origin picklists are unverified on the twin, so only standard free fields + Priority are sent.
// (The twin's describe says Case.Description is textarea:255, but it stores longer text; verified in fixtures/live.)
export const createCase = (c: { contactId: string; subject: string; description: string; priority?: string }) =>
  sf<{ id: string }>(`/sobjects/Case`, {
    method: "POST",
    body: JSON.stringify({ ContactId: c.contactId, Subject: c.subject, Description: c.description, Priority: c.priority ?? "Medium" }),
  });

/** PATCH replaces each field whole: read first, rewrite, then read back. */
export const updateContact = (id: string, fields: Record<string, unknown>) =>
  sf<null>(`/sobjects/Contact/${id}`, { method: "PATCH", body: JSON.stringify(fields) });

export const createContact = (c: { firstName: string; lastName: string; email: string; description?: string | null }) =>
  sf<{ id: string }>(`/sobjects/Contact`, {
    method: "POST",
    body: JSON.stringify({ FirstName: c.firstName, LastName: c.lastName, Email: c.email, Description: c.description ?? undefined }),
  });

export const listVersions = () =>
  loggedFetch("salesforce", `${base().split("/services/data")[0]}/services/data`, {
    headers: { Authorization: `Bearer ${requireEnv("SALESFORCE_ACCESS_TOKEN")}` },
  });

/** Twin-only admin route: wipe all records. */
export async function adminReset() {
  const origin = new URL(requireEnv("SALESFORCE_INSTANCE_URL", "SALESFORCE_API_BASE_URL")).origin;
  const res = await loggedFetch("salesforce", `${origin}/admin/reset`, {
    method: "POST",
    headers: { Authorization: `Bearer ${requireEnv("SALESFORCE_ACCESS_TOKEN")}` },
  });
  return jsonOrThrow<unknown>("salesforce", res);
}

// Standard fields only: flags and facts live as `KEY: value` lines in Description.
export const descriptionLine = (text: string | null | undefined, key: string): string | null =>
  text?.match(new RegExp(`^${key}:[ \\t]*(.*)$`, "m"))?.[1]?.trim() ?? null;

export function setDescriptionLine(text: string | null | undefined, key: string, value: string): string {
  const line = `${key}: ${value}`;
  const re = new RegExp(`^${key}:.*$`, "m");
  return text && re.test(text) ? text.replace(re, line) : [text, line].filter(Boolean).join("\n");
}

/** A delivery record is a Case whose Description has TRACKING: and DELIVERED: lines. */
export const isDeliveryRecord = (text: string | null | undefined) =>
  !!descriptionLine(text, "TRACKING") && !!descriptionLine(text, "DELIVERED");
