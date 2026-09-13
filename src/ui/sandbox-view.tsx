"use client";

import { useEffect, useState } from "react";
import type { ProviderEnvironment } from "@/domain/types";

type SfRecord = Record<string, string>;
interface SandboxSnapshot {
  salesforce: { contacts: SfRecord[]; cases: SfRecord[] };
  gmail: { messages: { id: string; threadId: string; date: string; from: string; to: string; subject: string; body: string }[] };
  slack: { channels: { id: string; name: string; messages: { ts: string; text: string }[] }[] };
}

const card = "rounded-md border border-rule bg-sheet px-3 py-2.5";
const Empty = ({ children }: { children: React.ReactNode }) => <p className="text-sm text-muted">{children}</p>;

export function SandboxView() {
  const [snap, setSnap] = useState<SandboxSnapshot | null>(null);
  const [current, setCurrent] = useState<ProviderEnvironment | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/eval/results")
      .then((r) => r.json())
      .then((d) => setCurrent(d.current))
      .catch(() => {});
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const res = await fetch("/api/sandbox/_sandbox/state?full=1", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setSnap(await res.json());
        setError(null);
      } catch (e) {
        setError(`Couldn't read the sandbox: ${e instanceof Error ? e.message : e}`);
      }
      if (!stopped) timer = setTimeout(tick, 2000);
    };
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);

  const threads = snap ? Object.values(Object.groupBy(snap.gmail.messages, (m) => m.threadId)) : [];

  return (
    <main className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-rule pb-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sandbox</h1>
          <p className="mt-1 text-sm text-muted">Salesforce, Gmail and Slack as the agent sees them.</p>
        </div>
        {current && (
          <span className="rounded-full border border-rule px-2.5 py-0.5 text-xs text-muted">
            {current === "local-sandbox" ? "In use for runs" : "Not in use: runs go to Arga twins"}
          </span>
        )}
      </header>
      {error && (
        <p role="alert" className="mt-4 text-sm text-red">
          {error}
        </p>
      )}

      {!snap ? (
        <p className="mt-8 text-sm text-muted">Loading…</p>
      ) : (
        <div className="mt-6 grid gap-8 lg:grid-cols-3">
          <section aria-labelledby="sf-h" className="space-y-3">
            <h2 id="sf-h" className="text-sm font-semibold">
              Salesforce <span className="num font-normal text-muted">{snap.salesforce.contacts.length} contacts · {snap.salesforce.cases.length} cases</span>
            </h2>
            {snap.salesforce.contacts.length === 0 && <Empty>No contacts yet.</Empty>}
            {snap.salesforce.contacts.map((c) => (
              <div key={c.Id} className={card}>
                <p className="font-medium">{c.Name}</p>
                <p className="text-xs text-muted">{c.Email}</p>
                {c.Description && <pre className="mt-2 whitespace-pre-wrap font-mono text-xs">{c.Description}</pre>}
                <ul className="mt-2 space-y-2 border-t border-rule pt-2">
                  {snap.salesforce.cases
                    .filter((k) => k.ContactId === c.Id)
                    .map((k) => (
                      <li key={k.Id}>
                        <p className="text-sm font-medium">{k.Subject}</p>
                        <p className="num text-xs text-muted">
                          Case {k.CaseNumber} · {k.Priority ?? "Medium"} · {k.CreatedDate?.slice(0, 16).replace("T", " ")}
                        </p>
                        {k.Description && <pre className="mt-1 whitespace-pre-wrap font-mono text-xs text-muted">{k.Description}</pre>}
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </section>

          <section aria-labelledby="gm-h" className="space-y-3">
            <h2 id="gm-h" className="text-sm font-semibold">
              Gmail <span className="num font-normal text-muted">{threads.length} threads</span>
            </h2>
            {threads.length === 0 && <Empty>No email yet.</Empty>}
            {threads.map((msgs) => (
              <div key={msgs![0].threadId} className={card}>
                <p className="font-medium">{msgs![0].subject}</p>
                <ul className="mt-2 space-y-2">
                  {msgs!.map((m) => (
                    <li key={m.id} className="border-l-2 border-rule pl-2.5">
                      <p className="num text-xs text-muted">
                        {m.from} · {m.date.slice(0, 16).replace("T", " ")}
                      </p>
                      <p className="whitespace-pre-wrap text-sm">{m.body}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>

          <section aria-labelledby="sl-h" className="space-y-3">
            <h2 id="sl-h" className="text-sm font-semibold">
              Slack <span className="num font-normal text-muted">{snap.slack.channels.length} channels</span>
            </h2>
            {snap.slack.channels.length === 0 && <Empty>No channels yet.</Empty>}
            {snap.slack.channels.map((ch) => (
              <div key={ch.id} className={card}>
                <p className="font-medium">#{ch.name}</p>
                {ch.messages.length === 0 && <p className="mt-1 text-xs text-muted">No messages.</p>}
                <ul className="mt-2 space-y-2">
                  {ch.messages.map((msg) => (
                    <li key={msg.ts} className="border-l-2 border-rule pl-2.5">
                      <p className="num font-mono text-[11px] text-muted">ts {msg.ts}</p>
                      <p className="whitespace-pre-wrap text-sm">{msg.text}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        </div>
      )}
    </main>
  );
}
