import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { LandingPreview } from "@/ui/landing-preview";
import evalResults from "../../eval/results.json";

export const metadata: Metadata = {
  title: "Sentinel — chargeback decisions, verified",
  description:
    "Sentinel investigates Stripe disputes across Salesforce and Gmail, applies policy before acting, and verifies every result across the systems involved.",
};

// Committed provider-backed run, not the in-memory API result.
const sandboxRun = evalResults.environments["local-sandbox"].metrics;

const STAKES = [
  { figure: "About 1 week", text: "to assemble a response before a typical evidence deadline closes." },
  { figure: "1 final submit", text: "because submitted dispute evidence cannot be casually edited and sent again." },
  { figure: "4 systems", text: "where the claim, customer history, communication, and operational follow-up live." },
];

const WITHOUT = [
  "The dispute starts in Stripe, while the useful context lives somewhere else.",
  "An operator searches CRM records, inbox threads, refunds, subscriptions, and dispute history by hand.",
  "Evidence gets copied into a one-way submission under deadline pressure.",
  "A successful API response is treated as completion, even when the intended state never changed.",
  "Missing evidence, duplicate actions, and expired deadlines become expensive judgment calls.",
];

const WITH = [
  "One case gathers the live dispute, delivery record, customer email, refunds, subscriptions, and prior disputes.",
  "Every conclusion cites evidence the agent actually read.",
  "Code-level policy gates irreversible actions before they reach a provider.",
  "Every write is read back; mismatches trigger a safe retry or a human handoff.",
  "The case closes only after Stripe, Salesforce, and Slack agree with the recorded decision.",
];

const AUDIENCES = [
  {
    title: "E-commerce finance & operations",
    body: "own the result — fewer scattered investigations, explicit decision policy, and one auditable case record.",
  },
  {
    title: "Chargeback specialists",
    body: "run the queue — evidence arrives with its source, deadlines stay visible, and each action shows what was observed.",
  },
  {
    title: "Finance & risk leads",
    body: "approve exceptions — high-value accepts wait for a named decision, while repeat-dispute handling remains traceable.",
  },
];

const STEPS = [
  {
    title: "A dispute arrives",
    systems: ["Stripe"],
    text: "Sentinel syncs an open dispute and records its amount, reason, charge, status, submission count, and evidence deadline. Closed or past-due cases are blocked before any Stripe write.",
  },
  {
    title: "The evidence is assembled",
    systems: ["Stripe", "Salesforce", "Gmail"],
    text: "The agent reads the charge and customer, checks refunds, subscriptions, and other disputes, finds delivery records in Salesforce, and searches the merchant inbox for relevant customer messages. Evidence can only cite records returned during the run.",
  },
  {
    title: "One branch is recorded",
    systems: ["Anthropic", "Vercel AI SDK", "Sentinel policy"],
    text: "The agent records FIGHT, FIGHT_AND_FLAG, ACCEPT, ASK_HUMAN, or EXPIRED_OR_BLOCKED with a rationale and evidence IDs. Deterministic code—not model confidence—decides whether each requested action is permitted.",
  },
  {
    title: "The right action runs",
    systems: ["Stripe", "Salesforce", "Slack"],
    text: "Sentinel submits evidence, accepts a valid claim, cancels an eligible subscription, creates follow-up work, or asks for missing evidence. Accepting more than $200 stops for a named human approval first.",
  },
  {
    title: "Every system answers back",
    systems: ["Lemma", "Arga Labs"],
    text: "Each write is read back from the provider. A mismatch is retried once with safe deduplication and a new idempotency key. Independent final checks decide whether the case is resolved or needs attention.",
  },
];

const DOORS = [
  {
    audience: "For dispute operations",
    title: "Work the queue. Open the evidence. See the result.",
    points: [
      "Sync open disputes or create a synthetic test case.",
      "Watch Stripe, Salesforce, and Gmail evidence arrive on one timeline.",
      "See the decision, approval state, actions, retries, and provider readbacks.",
      "Know why a case resolved—or why it needs attention.",
    ],
    cta: "Open the dispute queue",
    href: "/disputes",
    tone: "border-canary-ink/30 bg-canary-wash hover:border-canary-ink/60 focus-within:border-canary-ink",
    ctaTone: "text-carbon",
  },
  {
    audience: "For engineering & risk",
    title: "A test suite that checks the providers, not the story.",
    points: [
      "Reset and replay deterministic dispute scenarios.",
      "Compare the chosen branch with the expected branch.",
      "Measure false actions, constraint violations, recovery, and state consistency.",
      "Inspect the resulting case and trace.",
    ],
    cta: "See the evaluation",
    href: "/eval",
    tone: "border-slate-200 bg-slate-50/60 hover:border-slate-300 focus-within:border-slate-400",
    ctaTone: "text-slate-800",
  },
];

const code = (text: string, tone: "red" | "green") => (
  <code className={`rounded px-1 font-mono text-[0.9em] ${tone === "red" ? "bg-red-wash text-red" : "bg-green-wash text-green"}`}>{text}</code>
);

const CASE_ROWS: { title: string; body: ReactNode }[] = [
  { title: "Claim received", body: "A $96 product-not-received dispute arrives with an open evidence window." },
  {
    title: "Evidence found",
    body: "Salesforce shows the UPS delivery record. Gmail contains the customer’s confirmation that the insulated water bottle set arrived.",
  },
  { title: "Decision recorded", body: "The evidence contradicts the claim, so Sentinel records FIGHT and cites the source records." },
  {
    title: "Silent failure detected",
    body: (
      <>
        The first Stripe update returns successfully but saves the response as a draft. Readback still observes {code("needs_response", "red")} with{" "}
        {code("submission_count = 0", "red")}.
      </>
    ),
  },
  {
    title: "Recovery verified",
    body: (
      <>
        Sentinel re-reads before retrying, uses a new idempotency key, submits once, and verifies {code("under_review", "green")} with{" "}
        {code("submission_count = 1", "green")}. The Slack summary is also read back.
      </>
    ),
  },
];

const passedRuns = Math.round((sandboxRun.taskSuccessRate * sandboxRun.scenariosRun) / 100);
const METRICS = [
  {
    figure: `${passedRuns}/${sandboxRun.scenariosRun}`,
    text: "scenarios passed in the latest committed evaluation (Stripe test mode with Sentinel's Salesforce, Gmail and Slack sandbox, not Arga twins).",
  },
  {
    figure: `${Math.max(sandboxRun.falseActionRate, sandboxRun.constraintViolationRate)}${sandboxRun.falseActionRate || sandboxRun.constraintViolationRate ? "%" : ""}`,
    text: "false Stripe actions and constraint violations observed in that run.",
  },
  {
    figure: `${Math.min(sandboxRun.recoveryRate, sandboxRun.stateConsistency)}%`,
    text: "recovery and state consistency across the scenarios that ran.",
  },
];

const eyebrow = "text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500";
const h2 = "mt-5 max-w-3xl text-3xl font-bold leading-tight tracking-tight text-slate-900 sm:text-4xl";
const primaryCta =
  "inline-flex min-h-11 items-center rounded-full bg-slate-900 px-6 text-sm font-semibold text-white transition-colors hover:bg-slate-700";

function Section({ id, eyebrowText, heading, children }: { id: string; eyebrowText: string; heading?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="border-t border-slate-100 py-20 sm:py-24">
      {heading ? (
        <>
          <p className={eyebrow}>{eyebrowText}</p>
          <h2 id={id} className={h2}>
            {heading}
          </h2>
        </>
      ) : (
        <h2 id={id} className={eyebrow}>
          {eyebrowText}
        </h2>
      )}
      {children}
    </section>
  );
}

function Step({ n, title, systems, text }: (typeof STEPS)[number] & { n: number }) {
  return (
    <li className="grid gap-2 border-t border-slate-100 py-8 first:border-t-0 md:grid-cols-[3rem_14rem_1fr] md:gap-6">
      <span className="num text-2xl font-bold text-carbon" aria-hidden="true">
        {n}
      </span>
      <div>
        <h3 className="font-semibold text-slate-900">{title}</h3>
        <ul aria-label="Systems involved" className="mt-2 flex flex-wrap gap-1.5">
          {systems.map((s) => (
            <li key={s} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600">
              {s}
            </li>
          ))}
        </ul>
      </div>
      <p className="text-sm leading-relaxed text-slate-600">{text}</p>
    </li>
  );
}

function Door({ audience, title, points, cta, href, tone, ctaTone }: (typeof DOORS)[number]) {
  return (
    <article className={`group relative rounded-2xl border p-7 transition-colors sm:p-8 ${tone}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">{audience}</p>
      <h3 className="mt-3 text-2xl font-bold leading-snug tracking-tight text-slate-900">{title}</h3>
      <ul className="mt-5 list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-600 marker:text-slate-300">
        {points.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      {/* The pseudo-element stretches this link over the whole card. */}
      <Link
        href={href}
        className={`mt-6 inline-flex min-h-11 items-center text-sm font-semibold after:absolute after:inset-0 after:rounded-2xl group-hover:underline ${ctaTone}`}
      >
        {cta}&nbsp;<span aria-hidden="true">→</span>
      </Link>
    </article>
  );
}

export default function Page() {
  return (
    <div className="bg-white text-slate-900 ">
      <main className="mx-auto max-w-4xl px-6">
        <section aria-labelledby="hero-h" className="flex flex-col justify-center py-16 sm:min-h-[78vh]">
          <h1 id="hero-h" className="max-w-3xl text-[2.6rem] font-bold leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl">
            <span className="block">The bank pulled the money back.</span>
            <span className="block">Now prove what happened.</span>
            <span className="mt-4 block text-slate-500">
              <span className="sr-only">Crossed out: </span>
              <s className="decoration-carbon decoration-[0.09em]">HTTP 200 means done.</s>
            </span>
          </h1>
          <p className="mt-8 max-w-xl text-lg leading-relaxed text-slate-600">
            A customer says the order never arrived. The evidence is split across Stripe, Salesforce, and Gmail, the deadline is closing, and the final
            response cannot be taken back. Sentinel investigates the claim, applies policy before acting, and reads every system back to prove the work
            actually landed.
          </p>
          <p className="mt-4 max-w-xl text-lg font-medium leading-relaxed text-slate-900">
            High-value accepts wait for a named human. Missing evidence never becomes a guess.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3">
            <Link href="/disputes" className={primaryCta}>
              Open the dispute queue
            </Link>
            <span className="text-sm text-slate-500">synthetic demo · about 45 seconds</span>
            <Link href="/eval" className="inline-flex min-h-11 items-center text-sm text-slate-600 underline-offset-4 hover:text-slate-900 hover:underline">
              See the evaluation
            </Link>
          </div>
        </section>

        <Section id="stakes-h" eyebrowText="The stakes">
          <dl className="mt-12 space-y-10">
            {STAKES.map((s) => (
              <div key={s.figure} className="flex flex-col gap-2 md:flex-row md:items-baseline md:gap-10">
                <dt className="text-5xl font-bold tracking-tight md:w-[22rem] md:shrink-0 md:text-6xl">{s.figure}</dt>
                <dd className="max-w-md text-slate-600">{s.text}</dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section id="today-h" eyebrowText="Today" heading="Chargeback work fails in the gaps between systems.">
          <div className="mt-12 grid gap-12 md:grid-cols-2">
            {[
              { label: "Without Sentinel", labelTone: "text-slate-500", items: WITHOUT, text: "text-slate-500" },
              { label: "With Sentinel", labelTone: "text-green", items: WITH, text: "text-slate-700" },
            ].map((col) => (
              <div key={col.label}>
                <h3 className={`text-sm font-semibold uppercase tracking-widest ${col.labelTone}`}>{col.label}</h3>
                <ul className={`mt-5 list-disc space-y-3 pl-5 text-sm leading-relaxed marker:text-slate-300 ${col.text}`}>
                  {col.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Section>

        <Section id="audience-h" eyebrowText="Sentinel" heading="Verified chargeback operations for the teams responsible for the outcome.">
          <div className="mt-12 grid gap-10 md:grid-cols-3">
            {AUDIENCES.map((a) => (
              <div key={a.title}>
                <h3 className="font-semibold text-slate-900">{a.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{a.body}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section id="how-h" eyebrowText="How it works" heading="AI investigates. Policy gates. Readback proves.">
          <p className="mt-4 max-w-xl text-slate-600">Five stages, with a recorded trail from the first Stripe read to the final cross-system check.</p>
          <ol className="mt-10">
            {STEPS.map((s, i) => (
              <Step key={s.title} n={i + 1} {...s} />
            ))}
          </ol>
        </Section>

        <Section id="doors-h" eyebrowText="One system, two doors">
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            {DOORS.map((d) => (
              <Door key={d.href} {...d} />
            ))}
          </div>
        </Section>

        <Section id="case-h" eyebrowText="One synthetic case" heading="A 200 response that did nothing—and the readback that caught it.">
          <ol className="mt-10 border-y border-slate-100">
            {CASE_ROWS.map((r, i) => (
              <li key={r.title} className="grid gap-1 border-t border-slate-100 py-5 first:border-t-0 sm:grid-cols-[13rem_1fr] sm:gap-6">
                <h3 className="text-sm font-semibold text-slate-900">
                  <span className="num mr-2 text-carbon" aria-hidden="true">
                    {i + 1}
                  </span>
                  {r.title}
                </h3>
                <p className="text-sm leading-relaxed text-slate-600">{r.body}</p>
              </li>
            ))}
          </ol>
        </Section>

        <Section id="preview-h" eyebrowText="See it" heading="Every source, decision, action, and check in one timeline.">
          <figure className="mt-10 xl:-mx-24">
            <LandingPreview />
            <figcaption className="mt-4 text-center text-sm text-slate-500">
              Synthetic scenario 07: the first write saved a draft; Sentinel detected the mismatch, retried safely, and verified the provider state.
            </figcaption>
          </figure>
        </Section>

        <Section id="trust-h" eyebrowText="Why trust it">
          <ul className="mt-12 grid gap-10 md:grid-cols-3">
            {METRICS.map((m) => (
              <li key={m.text}>
                <p className="num text-6xl font-bold tracking-tight">{m.figure}</p>
                <p className="mt-3 text-sm leading-relaxed text-slate-600">{m.text}</p>
              </li>
            ))}
          </ul>
          {sandboxRun.scenariosSkipped > 0 && (
            <p className="mt-10 max-w-2xl border-l-2 border-slate-200 pl-4 text-sm leading-relaxed text-slate-500">
              One past-due provider scenario was skipped because the backend could not seed its historical deadline; the no-submit deadline gate remains
              covered by the offline policy suite.
            </p>
          )}
          <Link href="/eval" className="mt-6 inline-flex min-h-11 items-center text-sm font-semibold text-slate-800 hover:underline">
            Inspect the full evaluation&nbsp;<span aria-hidden="true">→</span>
          </Link>
        </Section>

        <section aria-labelledby="closing-h" className="flex min-h-[50vh] flex-col items-center justify-center border-t border-slate-100 py-20 text-center">
          <h2 id="closing-h" className="max-w-4xl text-3xl font-bold leading-snug tracking-tight sm:text-4xl lg:text-5xl">
            <span className="block">We do not trust a successful response.</span>
            <span className="block">We verify the result.</span>
          </h2>
          <p className="mt-6 max-w-xl text-slate-600">
            From the first evidence read to the final provider check, Sentinel leaves a case an operator can explain.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-4">
            <Link href="/disputes" className={primaryCta}>
              Open the dispute queue
            </Link>
            <Link
              href="/eval"
              className="inline-flex min-h-11 items-center rounded-full border border-slate-300 px-6 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-500"
            >
              See the evaluation
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-100">
        <div className="mx-auto flex max-w-4xl flex-col items-center justify-between gap-2 px-6 py-8 text-center text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 md:flex-row md:text-left">
          <p>Sentinel — verified chargeback operations · demo · synthetic data</p>
          <p>AI investigates · policy gates · systems confirm</p>
        </div>
      </footer>
    </div>
  );
}
