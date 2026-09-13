"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { DisputeCase } from "@/domain/types";
import { deadline, money, reasonText, StatusPill } from "./format";

export function Queue() {
  const [cases, setCases] = useState<DisputeCase[] | null>(null);
  const [busy, setBusy] = useState<"sync" | "simulate" | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [scenarios, setScenarios] = useState<{ key: string; title: string }[]>([]);
  const [scenario, setScenario] = useState("scenario-07");

  useEffect(() => {
    fetch("/api/eval/results")
      .then((r) => r.json())
      .then((d) => setScenarios(d.scenarios ?? []))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    const res = await fetch("/api/cases", { cache: "no-store" });
    if (res.ok) setCases((await res.json()).cases);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  async function create(kind: "sync" | "simulate") {
    setBusy(kind);
    setMessage(null);
    try {
      const res = await fetch("/api/cases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(kind === "sync" ? { source: "stripe" } : { source: "scenario", scenario }),
      });
      const data = await res.json();
      if (!res.ok) setMessage({ text: `Couldn't reach Stripe: ${data.error}`, error: true });
      else
        setMessage({
          text: data.created.length ? `Added ${data.created.length} ${data.created.length === 1 ? "dispute" : "disputes"}.` : "Already up to date.",
          error: false,
        });
      await load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-rule pb-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Open disputes</h1>
          <p className="mt-1 max-w-xl text-sm text-muted">
            Each chargeback is investigated across Stripe, Salesforce and Gmail, answered, and then checked in every system.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => create("sync")}
            disabled={!!busy}
            className="rounded-md bg-ink px-3 py-1.5 text-sm font-medium text-sheet hover:bg-ink/85 disabled:opacity-50"
          >
            {busy === "sync" ? "Syncing…" : "Sync from Stripe"}
          </button>
          <div className="flex items-center overflow-hidden rounded-md border border-rule bg-sheet">
            <label htmlFor="scenario" className="sr-only">
              Test dispute scenario
            </label>
            <select
              id="scenario"
              value={scenario}
              onChange={(e) => setScenario(e.target.value)}
              className="max-w-72 bg-transparent px-2 py-1.5 text-sm"
            >
              {scenarios.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.title}
                </option>
              ))}
            </select>
            <button
              onClick={() => create("simulate")}
              disabled={!!busy}
              className="border-l border-rule px-3 py-1.5 text-sm font-medium hover:bg-paper disabled:opacity-50"
            >
              {busy === "simulate" ? "Creating…" : "Simulate new dispute"}
            </button>
          </div>
        </div>
      </header>

      {message && (
        <p role={message.error ? "alert" : "status"} className={`mt-4 text-sm ${message.error ? "text-red" : "text-muted"}`}>
          {message.text}
        </p>
      )}

      {cases === null ? (
        <p className="mt-10 text-sm text-muted">Loading disputes…</p>
      ) : cases.length === 0 ? (
        <p className="mt-10 text-sm text-muted">No open disputes. Sync from Stripe to pull them in.</p>
      ) : (
        <ul className="mt-2 divide-y divide-rule">
          {cases.map((c) => {
            const d = deadline(c.dispute.dueBy);
            return (
              <li key={c.id}>
                <Link
                  href={`/cases/${c.id}`}
                  className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 px-2 py-4 hover:bg-sheet sm:grid-cols-[1.3fr_0.7fr_1.4fr_1fr_10.5rem]"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{c.customer?.name || c.dispute.customerId}</span>
                    <span className="block truncate text-xs text-muted">{c.customer?.email}</span>
                  </span>
                  <span className="num text-right font-medium sm:text-left">{money(c.dispute.amount, c.dispute.currency)}</span>
                  <span className="text-sm">{reasonText(c.dispute.reason)}</span>
                  <span className="text-xs">
                    <span className={`num ${d.late ? "text-red" : "text-muted"}`}>{d.label}</span>
                    <span className="mt-1 block h-1 w-full max-w-32 rounded-full bg-rule" aria-hidden>
                      <span className={`block h-1 rounded-full ${d.late ? "bg-red" : "bg-ink"}`} style={{ width: `${d.used * 100}%` }} />
                    </span>
                  </span>
                  <span className="justify-self-end">
                    <StatusPill status={c.status} />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
