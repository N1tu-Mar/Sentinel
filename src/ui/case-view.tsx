"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChaosMode, DisputeCase, EvidenceItem, TimelineEvent } from "@/domain/types";
import { BRANCH_TEXT, CHAOS_OPTIONS, deadline, money, reasonText, StatusPill } from "./format";

type Data = { case: DisputeCase; events: TimelineEvent[] };
type ProviderCallEvent = Extract<TimelineEvent, { type: "provider_call" }>;

/** Polls every 1 s while running (or a request is in flight), every 5 s otherwise, stops once resolved/failed. */
function useCase(id: string) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const refresh = useCallback(async (): Promise<Data | null> => {
    const res = await fetch(`/api/cases/${id}`, { cache: "no-store" });
    const body = await res.json();
    if (!res.ok) {
      setError(body.error === "not found" ? "This dispute isn't in Sentinel. Sync from Stripe first." : body.error);
      return null;
    }
    setData(body);
    return body;
  }, [id]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const d = await refresh().catch(() => null);
      if (stopped) return;
      const s = d?.case.status;
      if (!pending && (s === "resolved" || s === "failed")) return;
      timer = setTimeout(tick, pending || s === "running" ? 1000 : 5000);
    };
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [refresh, pending]);

  const post = async (path: string, body: unknown) => {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) setError(out.error ?? `Request failed with ${res.status}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      await refresh().catch(() => null);
      setPending(false);
    }
  };

  return { data, error, pending, post };
}

const SYSTEM_OF = (tool: string) =>
  tool.startsWith("stripe") ? "Stripe" : tool.startsWith("salesforce") ? "Salesforce" : tool.startsWith("gmail") ? "Gmail" : tool.startsWith("slack") ? "Slack" : "Sentinel";

const toolText = (tool: string) => tool.replace(/^(stripe|salesforce|gmail|slack)_/, "").replaceAll("_", " ");

export function CaseView({ id }: { id: string }) {
  const { data, error, pending, post } = useCase(id);
  const [chaos, setChaos] = useState<ChaosMode>("none");
  const [approver, setApprover] = useState("");
  // Anything already present on first load renders still; only new arrivals animate.
  const seenEvents = useRef<number | null>(null);
  const seenEvidence = useRef<Set<string> | null>(null);

  if (!data)
    return <main className="mx-auto max-w-[1400px] px-4 py-10 text-sm text-muted sm:px-6">{error ?? "Loading dispute…"}</main>;

  const c = data.case;
  seenEvents.current ??= data.events.length;
  seenEvidence.current ??= new Set(c.evidence.map((e) => e.id));
  const running = c.status === "running" || pending;
  const d = deadline(c.dispute.dueBy);
  const chaosLabel = CHAOS_OPTIONS.find((o) => o.value === c.chaosMode)?.label;

  return (
    <>
      <header className="border-b border-rule bg-sheet">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-start justify-between gap-4 px-4 py-5 sm:px-6">
          <div className="min-w-0">
            <Link href="/" className="text-sm text-indigo hover:underline">
              All disputes
            </Link>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              {c.customer?.name || c.dispute.customerId} <span className="num text-muted">{money(c.dispute.amount, c.dispute.currency)}</span>
            </h1>
            <p className="mt-0.5 text-sm text-muted">
              {reasonText(c.dispute.reason)} · <span className={`num ${d.late ? "text-red" : ""}`}>{d.label}</span> ·{" "}
              <span className="font-mono text-xs">{c.id}</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={c.status} />
            {c.chaosMode !== "none" && (
              <span className="rounded-full border border-red px-2.5 py-0.5 text-xs font-medium text-red">Test failure: {chaosLabel}</span>
            )}
            <label className="flex items-center gap-2 text-sm text-muted">
              Inject failure
              <select
                value={chaos}
                onChange={(e) => setChaos(e.target.value as ChaosMode)}
                disabled={running}
                className="rounded-md border border-rule bg-sheet px-2 py-1.5 text-ink"
              >
                {CHAOS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={() => post(`/api/cases/${id}/run`, { chaosMode: chaos })}
              disabled={running}
              className="rounded-md bg-ink px-3.5 py-1.5 text-sm font-medium text-sheet hover:bg-ink/85 disabled:opacity-50"
            >
              {running ? "Agent running…" : c.status === "new" ? "Run agent" : "Run agent again"}
            </button>
          </div>
        </div>
        {error && (
          <p role="alert" className="mx-auto max-w-[1400px] px-4 pb-4 text-sm text-red sm:px-6">
            {error}
          </p>
        )}
      </header>

      <main className="mx-auto grid max-w-[1400px] gap-8 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1fr)]">
        <section aria-labelledby="evidence-h">
          <h2 id="evidence-h" className="text-sm font-semibold">
            Evidence <span className="num font-normal text-muted">{c.evidence.length}</span>
          </h2>
          {c.evidence.length === 0 && (
            <p className="mt-3 text-sm text-muted">{running ? "Nothing yet. The agent is still reading." : "No evidence recorded."}</p>
          )}
          <ul className="mt-3 space-y-3">
            {c.evidence.map((e) => (
              <EvidenceCard key={e.id} item={e} animate={!seenEvidence.current!.has(e.id)} cited={!!c.decision?.evidenceIds.includes(e.id)} />
            ))}
          </ul>
        </section>

        <section aria-labelledby="timeline-h">
          <h2 id="timeline-h" className="text-sm font-semibold">
            What the agent did
          </h2>
          {data.events.length === 0 && <p className="mt-3 text-sm text-muted">The agent hasn&apos;t run on this dispute yet.</p>}
          <Timeline events={data.events} animateFrom={seenEvents.current} />
          {c.finalSummary && c.status !== "running" && (
            <p className="mt-4 border-t border-rule pt-4 text-sm">{c.finalSummary}</p>
          )}
        </section>

        <aside aria-labelledby="state-h" className="space-y-6">
          {c.status === "awaiting_approval" && (
            <div className="rounded-md border-2 border-ink bg-sheet p-4">
              <h2 className="font-semibold">Needs your approval — {money(c.dispute.amount, c.dispute.currency)} accept</h2>
              <p className="mt-1 text-sm text-muted">{c.decision?.rationale}</p>
              <label className="mt-3 block text-sm">
                Your name
                <input
                  value={approver}
                  onChange={(e) => setApprover(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-rule bg-paper px-2 py-1.5"
                />
              </label>
              <div className="mt-3 flex gap-2">
                <button
                  disabled={pending || !approver.trim()}
                  onClick={() => post(`/api/cases/${id}/approve`, { outcome: "approved", by: approver.trim() })}
                  className="rounded-md bg-ink px-3 py-1.5 text-sm font-medium text-sheet disabled:opacity-50"
                >
                  Approve and accept
                </button>
                <button
                  disabled={pending || !approver.trim()}
                  onClick={() => post(`/api/cases/${id}/approve`, { outcome: "rejected", by: approver.trim() })}
                  className="rounded-md border border-rule px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            </div>
          )}

          <div>
            <h2 id="state-h" className="text-sm font-semibold">
              End state in each system
            </h2>
            {!c.verification ? (
              <p className="mt-3 text-sm text-muted">Checked after the agent finishes, by reading Stripe, Salesforce and Slack directly.</p>
            ) : (
              <ul className="mt-3 divide-y divide-rule rounded-md border border-rule bg-sheet text-sm">
                {c.verification.checks.map((x) => (
                  <li key={x.system + x.check} className={`state-flip px-3 py-2 ${x.passed ? "" : "bg-red-wash"}`}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span>
                        <span className="text-xs text-muted">{x.system === "sentinel" ? "Sentinel" : x.system[0].toUpperCase() + x.system.slice(1)}</span>{" "}
                        {x.check}
                      </span>
                      <span className={`text-xs font-medium ${x.passed ? "text-green" : "text-red"}`}>{x.passed ? "Verified" : "Failed"}</span>
                    </div>
                    {!x.passed && (
                      <p className="num mt-0.5 font-mono text-xs text-red">
                        expected {x.expected}, observed {x.observed}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {c.actions.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold">Actions taken</h2>
              <ul className="mt-3 space-y-2 text-sm">
                {c.actions.map((a) => (
                  <li
                    key={a.key}
                    className={`state-flip rounded-md border px-3 py-2 ${
                      a.state === "succeeded_verified" ? "border-green bg-green-wash" : a.state === "failed" ? "border-red bg-red-wash" : "border-rule bg-sheet"
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-xs">{a.key.slice(c.id.length + 1)}</span>
                      <span className={`text-xs font-medium ${a.state === "succeeded_verified" ? "text-green" : a.state === "failed" ? "text-red" : "text-muted"}`}>
                        {a.state === "succeeded_verified" ? "Confirmed" : a.state === "failed" ? "Not confirmed" : "Unconfirmed"}
                      </span>
                    </div>
                    <p className="num mt-0.5 text-xs text-muted">
                      {a.attempts.length} {a.attempts.length === 1 ? "attempt" : "attempts"}
                      {a.observed ? ` · ${a.observed}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="space-y-1 border-t border-rule pt-4 text-sm">
            <p className="num">
              {c.providerCalls} provider calls · <span className={c.forbiddenEffects ? "text-red" : ""}>{c.forbiddenEffects} forbidden effects</span>
            </p>
            {c.lemmaTraceId && (
              <p>
                Trace <span className="font-mono text-xs">{c.lemmaTraceId.slice(0, 8)}</span>{" "}
                {process.env.NEXT_PUBLIC_LEMMA_TRACE_URL ? (
                  <a className="text-indigo hover:underline" href={process.env.NEXT_PUBLIC_LEMMA_TRACE_URL.replace("{id}", c.lemmaTraceId)}>
                    open in Lemma
                  </a>
                ) : (
                  <span className="text-muted">sent to Lemma</span>
                )}
              </p>
            )}
          </div>
        </aside>
      </main>
    </>
  );
}

function EvidenceCard({ item, animate, cited }: { item: EvidenceItem; animate: boolean; cited: boolean }) {
  const email = item.source === "gmail" ? (item.raw as { text?: string; from?: string; date?: string }) : null;
  return (
    <li id={item.id} className={`scroll-mt-4 rounded-md border border-rule bg-sheet px-3 py-2.5 ${animate ? "anim-evidence" : ""}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className="rounded bg-ink px-1.5 py-0.5 font-medium text-sheet">{item.source === "gmail" ? "Gmail" : item.source === "salesforce" ? "Salesforce" : "Stripe"}</span>
        <span className="text-muted">{item.kind.replaceAll("_", " ")}</span>
        <Strength value={item.strength} />
        {cited && <span className="font-medium">Cited</span>}
        <span className="ml-auto font-mono text-muted">{item.id}</span>
      </div>
      {email?.text ? (
        <>
          <blockquote className="mt-2 border-l-2 border-ink pl-3 text-[15px] leading-snug">
            <Highlighted text={email.text} />
            <footer className="mt-1 text-xs text-muted">
              {email.from} · {email.date}
            </footer>
          </blockquote>
          <p className="mt-2 text-sm text-muted">{item.summary}</p>
        </>
      ) : (
        <p className="mt-1.5 text-sm">{item.summary}</p>
      )}
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-indigo">Underlying record</summary>
        <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-muted">{JSON.stringify(item.raw, null, 2)}</pre>
      </details>
    </li>
  );
}

function Strength({ value }: { value: EvidenceItem["strength"] }) {
  const n = value === "strong" ? 3 : value === "moderate" ? 2 : 1;
  return (
    <span className="inline-flex items-center gap-1 text-muted" title={`${value} evidence`}>
      <span className="inline-flex items-end gap-px" aria-hidden>
        {[1, 2, 3].map((i) => (
          <span key={i} className={`w-1 rounded-sm ${i <= n ? "bg-ink" : "bg-rule"}`} style={{ height: 4 + i * 2 }} />
        ))}
      </span>
      {value}
    </span>
  );
}

/** Highlights the sentence that carries the weight: receipt, thanks, or a cancellation request. */
function Highlighted({ text }: { text: string }) {
  const parts = text.trim().split(/(?<=[.!?])\s+/);
  const key = parts.findIndex((p) => /\b(got|received|arrived|thanks|thank you|cancel)/i.test(p));
  return (
    <>
      {parts.map((p, i) => (
        <span key={i}>
          {i === key ? <mark className="rounded-sm bg-amber-wash px-0.5 text-ink">{p}</mark> : p}{" "}
        </span>
      ))}
    </>
  );
}

type Item = { kind: "event"; e: TimelineEvent; i: number } | { kind: "calls"; calls: ProviderCallEvent[]; i: number };

function Timeline({ events, animateFrom }: { events: TimelineEvent[]; animateFrom: number }) {
  const items: Item[] = [];
  events.forEach((e, i) => {
    const last = items[items.length - 1];
    if (e.type === "provider_call") {
      if (last?.kind === "calls") last.calls.push(e);
      else items.push({ kind: "calls", calls: [e], i });
    } else items.push({ kind: "event", e, i });
  });
  const failedBefore = new Set<string>();

  return (
    <ol className="mt-3 space-y-2" aria-live="polite">
      {items.map((it) => {
        if (it.kind === "calls")
          return (
            <li key={it.i} className="pl-4 text-xs text-muted">
              <details>
                <summary className="num cursor-pointer">
                  {it.calls.length} provider {it.calls.length === 1 ? "call" : "calls"}
                </summary>
                <ul className="mt-1 space-y-0.5 font-mono text-[11px]">
                  {it.calls.map((p, j) => (
                    <li key={j} className={p.status >= 400 || p.status === 0 ? "text-red" : ""}>
                      {p.system} {p.method} {p.path} → {p.status || "network error"} · {p.ms}ms
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          );
        const e = it.e;
        const fresh = it.i >= animateFrom;
        switch (e.type) {
          case "status":
            return (
              <li key={it.i} className="pl-4 text-xs text-muted">
                Status: <StatusPill status={e.status} />
              </li>
            );
          case "thought":
            return (
              <li key={it.i} className="pl-4 text-sm italic text-muted">
                {e.text}
              </li>
            );
          case "tool_call":
            return (
              <li key={it.i} className="flex items-baseline gap-2 border-l-2 border-rule pl-3.5 text-sm">
                <span className="w-20 shrink-0 text-xs font-medium">{SYSTEM_OF(e.tool)}</span>
                <span>{toolText(e.tool)}</span>
                {!!e.input && Object.keys(e.input as object).length > 0 && (
                  <span className="truncate font-mono text-xs text-muted">{JSON.stringify(e.input).slice(0, 90)}</span>
                )}
              </li>
            );
          case "tool_result":
            return (
              <li key={it.i} className={`pl-[6.75rem] font-mono text-xs ${e.ok ? "text-muted" : "text-red"}`}>
                {e.summary}
              </li>
            );
          case "evidence":
            return (
              <li key={it.i} className="pl-4 text-sm">
                <a href={`#${e.item.id}`} className="text-indigo hover:underline">
                  Found evidence {e.item.id}
                </a>{" "}
                <span className="text-muted">{e.item.summary.slice(0, 110)}</span>
              </li>
            );
          case "decision":
            return (
              <li key={it.i} className={`my-3 rounded-md border-2 border-ink bg-sheet p-4 ${fresh ? "anim-verify" : ""}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-lg font-semibold">{BRANCH_TEXT[e.decision.branch]}</p>
                  <p className="num text-sm text-muted">{Math.round(e.decision.confidence * 100)}% confident</p>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-rule" aria-hidden>
                  <div className="h-1.5 rounded-full bg-ink" style={{ width: `${e.decision.confidence * 100}%` }} />
                </div>
                <p className="mt-3 text-sm">{e.decision.rationale}</p>
                {e.decision.plannedActions.length > 0 && (
                  <ul className="mt-2 list-disc pl-5 text-sm text-muted">
                    {e.decision.plannedActions.map((a, j) => (
                      <li key={j}>{a}</li>
                    ))}
                  </ul>
                )}
                {e.decision.requiresApproval && <p className="mt-2 text-sm font-medium">Over the $200 limit: a person must approve first.</p>}
              </li>
            );
          case "action":
            return (
              <li key={it.i} className="border-l-2 border-ink pl-3.5 text-sm font-medium">
                {e.action} <span className="font-normal text-muted">· attempt {e.attempt}</span>
                <span className="block font-mono text-[11px] font-normal text-muted">key {e.idempotencyKey}</span>
              </li>
            );
          case "verify": {
            const recovered = e.passed && failedBefore.has(e.action);
            if (!e.passed) failedBefore.add(e.action);
            return (
              <li
                key={it.i}
                className={`rounded-md border-l-4 px-3.5 py-2 text-sm ${fresh ? "anim-verify" : ""} ${
                  e.passed ? "border-green bg-green-wash" : "border-red bg-red-wash"
                }`}
              >
                <p className={`font-medium ${e.passed ? "text-green" : "text-red"}`}>
                  {e.passed ? (recovered ? "Recovered and confirmed" : "Confirmed") : "Not confirmed"} · {e.action}
                </p>
                <p className="num mt-0.5 font-mono text-xs text-ink/80">
                  expected {e.expected}
                  <br />
                  observed {e.observed}
                </p>
              </li>
            );
          }
          case "recovery":
            return (
              <li key={it.i} className="pl-4 text-sm font-medium">
                Recovering: <span className="font-normal">{e.text}</span>
              </li>
            );
          case "chaos":
            return (
              <li key={it.i} className="rounded-md border border-dashed border-red px-3.5 py-2 text-sm text-red">
                <span className="font-semibold">Injected failure.</span> {e.text}
              </li>
            );
          case "error":
            return (
              <li key={it.i} role="alert" className="pl-4 text-sm text-red">
                {e.text}
              </li>
            );
          case "approval_requested":
            return (
              <li key={it.i} className="pl-4 text-sm font-medium">
                Asked for approval in Slack. The agent stopped here.
              </li>
            );
          case "approval_granted":
          case "approval_rejected":
            return (
              <li key={it.i} className="pl-4 text-sm font-medium">
                {e.type === "approval_granted" ? "Approved. Resuming." : "Rejected. No Stripe action will be taken."}
              </li>
            );
        }
      })}
    </ol>
  );
}
