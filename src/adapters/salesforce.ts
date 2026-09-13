import { env, jsonOrThrow, loggedFetch, requireEnv } from "./logged-fetch";

export interface SfContact {
  Id: string;
  Name: string;
  Email: string;
  Description: string | null;
  CreatedDate: string;
}
export interface SfCase {
  Id: string;
  Subject: string;
  Description: string | null;
  Status: string;
  CreatedDate: string;
}

function base(): string {
  const version = env("SALESFORCE_API_VERSION") ?? "v60.0";
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
  return jsonOrThrow<T>("salesforce", res);
}

const q = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

export async function query<T>(soql: string): Promise<T[]> {
  const res = await sf<{ records: T[] }>(`/query?q=${encodeURIComponent(soql)}`);
  return res.records;
}

export async function findContactByEmail(email: string): Promise<SfContact | null> {
  const rows = await query<SfContact>(
    `SELECT Id, Name, Email, Description, CreatedDate FROM Contact WHERE Email = ${q(email)} LIMIT 1`,
  );
  return rows[0] ?? null;
}

export const getContact = (id: string) => sf<SfContact>(`/sobjects/Contact/${id}`);

export const listCasesForContact = (contactId: string) =>
  query<SfCase>(
    `SELECT Id, Subject, Description, Status, CreatedDate FROM Case WHERE ContactId = ${q(contactId)} ORDER BY CreatedDate DESC`,
  );

export const findCases = (contactId: string, subject: string) =>
  query<SfCase>(
    `SELECT Id, Subject, Description, Status, CreatedDate FROM Case WHERE ContactId = ${q(contactId)} AND Subject = ${q(subject)}`,
  );

export const createCase = (c: { contactId: string; subject: string; description: string; priority?: string }) =>
  sf<{ id: string }>(`/sobjects/Case`, {
    method: "POST",
    body: JSON.stringify({
      ContactId: c.contactId,
      Subject: c.subject,
      Description: c.description,
      Priority: c.priority ?? "Medium",
      Origin: "Web",
      Status: "New",
    }),
  });

export const updateContact = (id: string, fields: Record<string, unknown>) =>
  sf<null>(`/sobjects/Contact/${id}`, { method: "PATCH", body: JSON.stringify(fields) });

export const createContact = (c: { firstName: string; lastName: string; email: string; description?: string }) =>
  sf<{ id: string }>(`/sobjects/Contact`, {
    method: "POST",
    body: JSON.stringify({ FirstName: c.firstName, LastName: c.lastName, Email: c.email, Description: c.description }),
  });

export const listVersions = () => loggedFetch("salesforce", `${base().split("/services/data")[0]}/services/data`, {
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
