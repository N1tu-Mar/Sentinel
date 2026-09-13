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
      await redis.hset("eval:results", { [r.scenario]: r });
    },
    async getEvalResults() {
      const all = await redis.hgetall<Record<string, EvalResult>>("eval:results");
      return Object.values(all ?? {});
    },
  };
}

// ponytail: in-memory store is per-process; on Vercel without Upstash, state does not survive across function instances.
function memoryStore(): Store {
  const g = globalThis as unknown as {
    __sentinel?: { cases: Map<string, DisputeCase>; events: Map<string, TimelineEvent[]>; evals: Map<string, EvalResult> };
  };
  const m = (g.__sentinel ??= { cases: new Map(), events: new Map(), evals: new Map() });
  const clone = <T>(x: T): T => structuredClone(x);
  return {
    getCase: async (id) => (m.cases.has(id) ? clone(m.cases.get(id)!) : null),
    putCase: async (c) => void m.cases.set(c.id, clone(c)),
    listCases: async () => [...m.cases.values()].map(clone),
    appendEvent: async (id, e) => void (m.events.get(id) ?? m.events.set(id, []).get(id)!).push(clone(e)),
    getEvents: async (id) => clone(m.events.get(id) ?? []),
    clearEvents: async (id) => void m.events.delete(id),
    putEvalResult: async (r) => void m.evals.set(r.scenario, clone(r)),
    getEvalResults: async () => [...m.evals.values()].map(clone),
  };
}

let store: Store | undefined;
export function getStore(): Store {
  const { UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: token } = process.env;
  return (store ??= url && token ? redisStore(new Redis({ url, token })) : memoryStore());
}
