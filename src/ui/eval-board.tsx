"use client";

import { useCallback, useEffect, useState } from "react";
import type { Branch, ChaosMode, EvalResult, ProviderEnvironment } from "@/domain/types";
import type { computeMetrics } from "@/eval/assertions";
import { BRANCH_TEXT, CHAOS_OPTIONS, ENVIRONMENT_TEXT } from "./format";

type EnvBoard = { results: EvalResult[]; metrics: ReturnType<typeof computeMetrics> };
type Board = {
  scenarios: { key: string; title: string; expected: Branch; chaos: ChaosMode }[];
  current: ProviderEnvironment;
  environments: Record<ProviderEnvironment, EnvBoard>;
};
const ENVIRONMENTS: ProviderEnvironment[] = ["arga-twins", "local-sandbox"];

export function EvalBoard() {
  const [board, setBoard] = useState<Board | null>(null);
  const [tab, setTab] = useState<ProviderEnvironment | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/eval/results", { cache: "no-store" });
    if (!res.ok) return;
    const data: Board = await res.json();
    setBoard(data);
    setTab((t) => t ?? (data.environments["arga-twins"].results.length ? "arga-twins" : data.current));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function run(keys: string[]) {
    setError(null);
    for (const key of keys) {
      setRunning(key);
      const res = await fetch("/api/eval/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scenario: key }),
      }).catch(() => null);
      if (!res?.ok) setError(`Scenario ${key} did not finish (${res ? `HTTP ${res.status}` : "network error"}).`);
      await load();
    }
    setRunning(null);
  }

  if (!board || !tab) return <main id="main" className="mx-auto max-w-6xl px-4 py-10 text-sm text-muted sm:px-6">Loading results…</main>;
  const { results, metrics: m } = board.environments[tab];
  const canRun = tab === board.current;
  const byKey = new Map(results.map((r) => [r.scenario, r]));
  const passed = results.filter((r) => r.passed).length;
  const lastRun = results.length ? new Date(Math.max(...results.map((r) => r.at))).toLocaleString() : null;
  const has = m.scenariosRun > 0;
  const figures: [string, string, string][] = [
    ["Task success", has ? `${passed}/${m.scenariosRun}` : "—", "All end-state assertions pass"],
    ["Decision accuracy", has ? `${m.decisionAccuracy}%` : "—", "Branch matches the expected one"],
    ["Recovery", m.chaosScenarios ? `${m.recoveryRate}%` : "—", "Injected failures that still end verified"],
    ["Constraint violations", has ? `${m.constraintViolationRate}%` : "—", "Accept without approval, late or double submit"],
    ["False actions", has ? `${m.falseActionRate}%` : "—", "Stripe writes where none were expected"],
    ["State consistency", has ? `${m.stateConsistency}%` : "—", "Agent's verdict matches the harness's reading"],
  ];

  return (
    <main id="main" className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <header className="border-b border-rule pb-5">
        <p className="field-label text-muted">Provider-backed scenarios</p>
        <h1 className="display mt-1 text-[1.9rem] leading-tight">Evaluation</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Each scenario resets the providers, seeds Stripe, Salesforce, Gmail and Slack, runs the agent, then reads every system to check the
          end state. Committed results live in <span className="font-mono text-xs">eval/results.json</span>.
        </p>
      </header>

      <div className="mt-5 flex flex-wrap items-end justify-between gap-3 border-b border-rule">
        <div role="tablist" aria-label="Environment" className="flex gap-1">
          {ENVIRONMENTS.map((env) => (
            <button
              key={env}
              role="tab"
              aria-selected={tab === env}
              onClick={() => setTab(env)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === env ? "border-carbon text-ink" : "border-transparent text-muted hover:text-ink"}`}
            >
              {ENVIRONMENT_TEXT[env]} <span className="num font-normal text-muted">{board.environments[env].results.length}</span>
              {board.current === env && <span className="field-label ml-2 rounded-sm bg-ink px-1.5 py-0.5 text-sheet">active</span>}
            </button>
          ))}
        </div>
        <button
          onClick={() => run(board.scenarios.map((s) => s.key))}
          disabled={!!running || !canRun}
          className="mb-2 rounded-md bg-ink px-3.5 py-2 text-sm font-semibold text-sheet transition-colors hover:bg-carbon disabled:opacity-50"
        >
          {running ? "Running…" : "Run all scenarios"}
        </button>
      </div>

      <p className="mt-3 text-sm text-muted">
        {lastRun ? `Last run ${lastRun} on ${ENVIRONMENT_TEXT[tab]} (Stripe in test mode).` : `No runs on ${ENVIRONMENT_TEXT[tab]} yet.`}
        {!canRun && ` Runs from this page go to ${ENVIRONMENT_TEXT[board.current]}.`}
      </p>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red">
          {error}
        </p>
      )}

      <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-3 lg:grid-cols-6">
        {figures.map(([label, value, hint]) => (
          <div key={label}>
            <dt className="field-label text-muted">{label}</dt>
            <dd className={`display num mt-2 text-[2rem] leading-none ${value === "—" ? "text-rule" : ""}`}>{value}</dd>
            <dd className="mt-1 text-xs text-muted">{hint}</dd>
          </div>
        ))}
      </dl>
      {has && (
        <p className="num mt-4 text-sm text-muted">
          Mean {m.meanProviderCalls} provider calls and {(m.meanWallMs / 1000).toFixed(1)} s per scenario
          {m.scenariosSkipped ? ` · ${m.scenariosSkipped} skipped` : ""}.
        </p>
      )}

      <div className="mt-8 overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-ink text-xs text-muted">
            <tr>
              <th className="py-2 pr-4 font-medium">Scenario</th>
              <th className="py-2 pr-4 font-medium">Expected</th>
              <th className="py-2 pr-4 font-medium">Agent chose</th>
              <th className="py-2 pr-4 font-medium">Injected failure</th>
              <th className="py-2 pr-4 text-right font-medium">Submits</th>
              <th className="py-2 pr-4 text-right font-medium">Calls</th>
              <th className="py-2 pr-4 font-medium">Result</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-rule">
            {board.scenarios.map((s) => {
              const r = byKey.get(s.key);
              return (
                <tr key={s.key} className="align-top">
                  <td className="py-3 pr-4">
                    <span className="font-medium">{s.title}</span>
                    <span className="block font-mono text-xs text-muted">{s.key}</span>
                  </td>
                  <td className="py-3 pr-4">{BRANCH_TEXT[s.expected]}</td>
                  <td className={`py-3 pr-4 ${r?.branch && r.branch !== s.expected ? "text-red" : ""}`}>{r?.branch ? BRANCH_TEXT[r.branch] : "—"}</td>
                  <td className="py-3 pr-4 text-muted">{CHAOS_OPTIONS.find((o) => o.value === s.chaos)?.label}</td>
                  <td className="num py-3 pr-4 text-right">{r ? r.submitAttempts : "—"}</td>
                  <td className="num py-3 pr-4 text-right">{r ? r.providerCalls : "—"}</td>
                  <td className="py-3 pr-4">
                    {running === s.key && canRun ? (
                      <span className="text-muted">Running…</span>
                    ) : !r ? (
                      <span className="text-muted">Not run</span>
                    ) : r.skipped ? (
                      <span className="text-muted">Skipped: {r.skipped}</span>
                    ) : r.passed ? (
                      <span className="font-medium text-green">Passed</span>
                    ) : (
                      <details>
                        <summary className="cursor-pointer font-medium text-red">Failed</summary>
                        <ul className="mt-1 space-y-0.5 font-mono text-xs text-red">
                          {r.failures.map((f, i) => (
                            <li key={i}>{f}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                    {r?.caseId && (
                      <a href={`/cases/${r.caseId}`} className="mt-0.5 block text-xs text-carbon hover:underline">
                        Open case
                      </a>
                    )}
                  </td>
                  <td className="py-3 text-right">
                    <button
                      onClick={() => run([s.key])}
                      disabled={!!running || !canRun}
                      className="rounded-md border border-rule px-2.5 py-1 text-xs font-medium hover:bg-sheet disabled:opacity-50"
                    >
                      Run
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
