import { AsyncLocalStorage } from "node:async_hooks";
import type { ProviderCall } from "@/domain/types";

/** Per-run sink: every outbound provider call inside `callSink.run(fn, ...)` is reported here. */
export const callSink = new AsyncLocalStorage<(call: ProviderCall) => void>();

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function env(...names: string[]): string | undefined {
  for (const n of names) if (process.env[n]) return process.env[n];
  return undefined;
}

export function requireEnv(...names: string[]): string {
  const v = env(...names);
  if (!v) throw new Error(`Missing env: ${names.join(" or ")}`);
  return v;
}

const BACKOFF_MS = [300, 900, 2700];

/**
 * fetch wrapper for every provider call: records a provider_call event and
 * retries 5xx / network errors up to 3 times (300/900/2700 ms). 4xx never retries.
 */
export async function loggedFetch(
  system: string,
  input: string | URL | Request,
  init: RequestInit = {},
): Promise<Response> {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  const method = (init.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  for (let attempt = 0; ; attempt++) {
    const start = Date.now();
    try {
      const res = await fetch(input, init);
      callSink.getStore()?.({ system, method, path: url.pathname, status: res.status, ms: Date.now() - start });
      if (res.status >= 500 && attempt < BACKOFF_MS.length) {
        await sleep(BACKOFF_MS[attempt]);
        continue;
      }
      return res;
    } catch (err) {
      callSink.getStore()?.({ system, method, path: url.pathname, status: 0, ms: Date.now() - start });
      const aborted = err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
      if (aborted || attempt >= BACKOFF_MS.length) throw err;
      await sleep(BACKOFF_MS[attempt]);
    }
  }
}

export async function jsonOrThrow<T>(system: string, res: Response): Promise<T> {
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new HttpError(res.status, `${system} ${res.status}: ${text.slice(0, 300)}`, body);
  return body as T;
}
