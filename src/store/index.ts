import { Redis } from "@upstash/redis";
import type { DisputeCase, EvalResult, TimelineEvent } from "@/domain/types";

export interface Store {
  getCase(id: string): Promise<DisputeCase | null>;
  putCase(c: DisputeCase): Promise<void>;
  listCases(): Promise<DisputeCase[]>;
  appendEvent(id: string, e: TimelineEvent): Promise<void>;
  getEvents(id: string): Promise<TimelineEvent[]>;
  clearEvents(id: string): Promise<void>;
  putEvalResult(r: EvalResult): Promise<void>;
  getEvalResults(): Promise<EvalResult[]>;
  /** Webhook dedupe: true the first time an event id is seen. */
  markEvent(id: string): Promise<boolean>;
}

function redisStore(redis: Redis): Store {
  return {
    getCase: (id) => redis.get<DisputeCase>(`case:${id}`),
    async putCase(c) {
      await Promise.all([redis.set(`case:${c.id}`, c), redis.sadd("cases:index", c.id)]);
    },
    async listCases() {
      const ids = await redis.smembers("cases:index");
      if (!ids.length) return [];
      const rows = await redis.mget<(DisputeCase | null)[]>(...ids.map((id) => `case:${id}`));
      return rows.filter((c): c is DisputeCase => !!c);
    },
    async appendEvent(id, e) {
      await redis.rpush(`case:${id}:events`, e);
    },
    getEvents: (id) => redis.lrange<TimelineEvent>(`case:${id}:events`, 0, -1),
    async clearEvents(id) {
      await redis.del(`case:${id}:events`);
    },
    async putEvalResult(r) {
      // Keyed per environment so sandbox runs never replace Arga twin results.
      await redis.hset("eval:results", { [`${r.environment ?? "arga-twins"}:${r.scenario}`]: r });
    },
    async getEvalResults() {
      const all = await redis.hgetall<Record<string, EvalResult>>("eval:results");
      return Object.values(all ?? {});
    },
    markEvent: async (id) => (await redis.set(`event:${id}`, 1, { nx: true, ex: 7 * 86400 })) === "OK",
  };
}

// ponytail: in-memory store is per-process; on Vercel without Upstash, state does not survive across function instances.
function memoryStore(): Store {
  const g = globalThis as unknown as {
    __sentinel?: { cases: Map<string, DisputeCase>; events: Map<string, TimelineEvent[]>; evals: Map<string, EvalResult>; seen: Set<string> };
  };
  const m = (g.__sentinel ??= { cases: new Map(), events: new Map(), evals: new Map(), seen: new Set() });
  const clone = <T>(x: T): T => structuredClone(x);
  return {
    getCase: async (id) => (m.cases.has(id) ? clone(m.cases.get(id)!) : null),
    putCase: async (c) => void m.cases.set(c.id, clone(c)),
    listCases: async () => [...m.cases.values()].map(clone),
    appendEvent: async (id, e) => void (m.events.get(id) ?? m.events.set(id, []).get(id)!).push(clone(e)),
    getEvents: async (id) => clone(m.events.get(id) ?? []),
    clearEvents: async (id) => void m.events.delete(id),
    putEvalResult: async (r) => void m.evals.set(`${r.environment ?? "arga-twins"}:${r.scenario}`, clone(r)),
    getEvalResults: async () => [...m.evals.values()].map(clone),
    markEvent: async (id) => !m.seen.has(id) && !!m.seen.add(id),
  };
}

let redis: Redis | null | undefined;
export function redisClient(): Redis | null {
  if (redis !== undefined) return redis;
  // Vercel Marketplace Upstash exposes KV_REST_API_URL / KV_REST_API_TOKEN.
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  return (redis = url && token ? new Redis({ url, token }) : null);
}

let store: Store | undefined;
export function getStore(): Store {
  const client = redisClient();
  return (store ??= client ? redisStore(client) : memoryStore());
}
