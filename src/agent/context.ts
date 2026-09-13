import type { TraceContext } from "@uselemma/tracing";
import type { DisputeCase, TimelineEvent } from "@/domain/types";
import type { Store } from "@/store";
import type { Chaos } from "./chaos";

export type NewEvent = TimelineEvent extends infer E ? (E extends TimelineEvent ? Omit<E, "t"> : never) : never;

export interface RunContext {
  c: DisputeCase;
  store: Store;
  chaos: Chaos;
  /** Raw records returned by read tools, keyed by id, so record_evidence can attach the real record. */
  seen: Map<string, unknown>;
  /** Set by request_approval: the loop must end. */
  halted: boolean;
  timing: { readbackDelayMs: number; readbackIntervalMs: number };
  /** Lemma trace for this run: verification results and recoveries are recorded as explicit spans. */
  trace?: Pick<TraceContext, "recordSpan">;
  emit(e: NewEvent): Promise<void>;
  save(): Promise<void>;
}

export function createContext(
  c: DisputeCase,
  store: Store,
  chaos: Chaos,
  timing = { readbackDelayMs: 400, readbackIntervalMs: 1000 },
): RunContext {
  let queue: Promise<void> = Promise.resolve(); // keeps timeline appends in order
  return {
    c,
    store,
    chaos,
    seen: new Map(),
    halted: false,
    timing,
    emit(e) {
      const ev = { ...e, t: Date.now() } as TimelineEvent;
      if (ev.type === "provider_call") {
        c.providerCalls++;
        if (ev.forbidden) c.forbiddenEffects++;
      }
      queue = queue.then(() => store.appendEvent(c.id, ev));
      return queue;
    },
    async save() {
      c.updatedAt = Date.now();
      await queue;
      await store.putCase(c);
    },
  };
}
