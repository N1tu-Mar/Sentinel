import type { Metadata } from "next";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { LandingPreview } from "@/ui/landing-preview";
import { BrandMark } from "@/ui/site-header";
import evalResults from "../../eval/results.json";

export const metadata: Metadata = {
  title: "Sentinel — chargeback decisions, verified",
  description:
    "Sentinel investigates Stripe disputes across Salesforce and Gmail, applies policy before acting, and verifies every result across the systems involved.",
};

// Committed provider-backed run, not the in-memory API result.
const sandboxRun = evalResults.environments["local-sandbox"].metrics;

const STAKES = [
  { label: "Time to respond", figure: "About 1 week", text: "to assemble a response before a typical evidence deadline closes." },
  { label: "Submissions", figure: "1 final submit", text: "because submitted dispute evidence cannot be casually edited and sent again." },
  { label: "Systems involved", figure: "4 systems", text: "where the claim, customer history, communication, and operational follow-up live." },
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

const ROUTING = [
  {
    role: "E-commerce finance & operations",
    duty: "Own the result",
    body: "Fewer scattered investigations, explicit decision policy, and one auditable case record.",
  },
  {
    role: "Chargeback specialists",
    duty: "Run the queue",
    body: "Evidence arrives with its source, deadlines stay visible, and each action shows what was observed.",
  },
  {
    role: "Finance & risk leads",
    duty: "Approve exceptions",
    body: "Accepts over $200 wait for a named decision, while repeat-dispute handling remains traceable.",
  },
];

const STEPS = [
  {
    verb: "Read",
    title: "A dispute arrives",
    systems: ["Stripe"],
    text: "Sentinel syncs an open dispute and records its amount, reason, charge, status, submission count, and evidence deadline. Closed or past-due cases are blocked before any Stripe write.",
  },
  {
    verb: "Gather",
    title: "The evidence is assembled",
    systems: ["Stripe", "Salesforce", "Gmail"],
    text: "The agent reads the charge and customer, checks refunds, subscriptions, and other disputes, finds delivery records in Salesforce, and searches the merchant inbox for relevant customer messages. Evidence can only cite records returned during the run.",
  },
  {
    verb: "Decide",
    title: "One branch is recorded",
    systems: ["Anthropic", "Vercel AI SDK", "Sentinel policy"],
    text: "The agent records FIGHT, FIGHT_AND_FLAG, ACCEPT, ASK_HUMAN, or EXPIRED_OR_BLOCKED with a rationale and evidence IDs. Deterministic code—not model confidence—decides whether each requested action is permitted.",
  },
  {
    verb: "Act",
    title: "The right action runs",
    systems: ["Stripe", "Salesforce", "Slack"],
    text: "Sentinel submits evidence, accepts a valid claim, cancels an eligible subscription, creates follow-up work, or asks for missing evidence. Accepting more than $200 stops for a named human approval first.",
  },
  {
    verb: "Read back",
    title: "Every system answers back",
    systems: ["Lemma", "Arga Labs"],
    text: "Each write is read back from the provider. A mismatch is retried once with safe deduplication and a new idempotency key. Independent final checks decide whether the case is resolved or needs attention.",
  },
];

const DOORS = [
  {
    tab: "For dispute operations",
    title: "Work the queue. Open the evidence. See the result.",
    points: [
      "Sync open disputes or create a synthetic test case.",
      "Watch Stripe, Salesforce, and Gmail evidence arrive on one timeline.",
      "See the decision, approval state, actions, retries, and provider readbacks.",
      "Know why a case resolved—or why it needs attention.",
    ],
    cta: "Open the dispute queue",
    href: "/disputes",
    card: "border-canary-ink/25 bg-canary-wash hover:border-canary-ink/60 focus-within:border-canary-ink",
    tabTone: "bg-canary text-canary-ink",
  },
  {
    tab: "For engineering & risk",
    title: "A test suite that checks the providers, not the story.",
    points: [
      "Reset and replay deterministic dispute scenarios.",
      "Compare the chosen branch with the expected branch.",
      "Measure false actions, constraint violations, recovery, and state consistency.",
      "Inspect the resulting case and trace.",
    ],
    cta: "See the evaluation",
    href: "/eval",
    card: "border-ink/15 bg-sheet hover:border-ink/40 focus-within:border-ink",
    tabTone: "bg-ink text-sheet",
  },
];

const state = (text: string, tone: "red" | "green") => (
  <code className={`rounded-sm px-1 font-mono text-[0.88em] ${tone === "red" ? "bg-red-wash text-red" : "bg-green-wash text-green"}`}>{text}</code>
);

const CASE_ROWS: { title: string; body: ReactNode; stamp?: "match" | "mismatch" }[] = [
  { title: "Claim received", body: "A $96 product-not-received dispute arrives with an open evidence window." },
  {
    title: "Evidence found",
    body: "Salesforce shows the UPS delivery record. Gmail contains the customer’s confirmation that the insulated water bottle set arrived.",
  },
  { title: "Decision recorded", body: "The evidence contradicts the claim, so Sentinel records FIGHT and cites the source records." },
  {
    title: "Silent failure detected",
    stamp: "mismatch",
    body: (
      <>
        The first Stripe update returns successfully but saves the response as a draft. Readback still observes {state("needs_response", "red")} with{" "}
        {state("submission_count = 0", "red")}.
      </>
    ),
  },
  {
    title: "Recovery verified",
    stamp: "match",
    body: (
      <>
        Sentinel re-reads before retrying, uses a new idempotency key, submits once, and verifies {state("under_review", "green")} with{" "}
        {state("submission_count = 1", "green")}. The Slack summary is also read back.
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

const primaryCta =
  "inline-flex min-h-11 items-center rounded-md bg-ink px-5 text-sm font-semibold text-sheet transition-colors hover:bg-carbon";
const secondaryCta =
  "inline-flex min-h-11 items-center rounded-md border border-ink/25 px-5 text-sm font-semibold text-ink transition-colors hover:border-ink hover:bg-sheet";

function Stamp({ kind, className = "", style }: { kind: "match" | "mismatch"; className?: string; style?: CSSProperties }) {
  return (
    <span className={`stamp ${kind === "match" ? "text-green" : "text-red"} ${className}`} style={style}>
      {kind === "match" ? "Matches" : "Does not match"}
    </span>
  );
}

function SlipField({ label, tone, children }: { label: string; tone?: "copy"; children: ReactNode }) {
  return (
    <div className="px-4 py-3">
      <dt className={`field-label ${tone ? "text-canary-ink" : "text-muted"}`}>{label}</dt>
      <dd className="mt-1 font-mono text-[0.95rem] [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

/** Scenario 07, attempt 1: the original Sentinel sent, and the copy Stripe read back. */
function DuplicateSlip() {
  return (
    <figure className="w-full max-w-md justify-self-center lg:justify-self-end">
      <div className="relative z-10 rounded-t-md border border-b-0 border-ink/20 bg-sheet shadow-[0_24px_48px_-32px_rgba(22,26,51,0.55)]">
        <div className="flex items-baseline justify-between gap-3 border-b border-rule px-4 py-2.5">
          <p className="field-label text-ink">Original · sent to Stripe</p>
          <p className="font-mono text-xs text-muted">attempt 1</p>
        </div>
        <dl className="grid grid-cols-2 divide-x divide-rule border-b border-rule">
          <SlipField label="Action">submit evidence</SlipField>
          <SlipField label="Amount">$96.00</SlipField>
        </dl>
        <dl>
          <SlipField label="Provider response">HTTP 200 OK</SlipField>
        </dl>
        <div className="perforation" aria-hidden="true" />
      </div>
      <div
        className="anim-copy relative rounded-b-md border border-t-0 border-canary-ink/30 bg-canary text-carbon"
        style={{ "--stamp-ground": "var(--color-canary)" } as CSSProperties}
      >
        <p className="field-label border-b border-canary-ink/20 px-4 py-2.5 text-canary-ink">Copy · read back from Stripe</p>
        <dl className="grid grid-cols-2 divide-x divide-canary-ink/20">
          <SlipField label="status" tone="copy">
            needs_response
          </SlipField>
          <SlipField label="submission_count" tone="copy">
            0
          </SlipField>
        </dl>
        <Stamp kind="mismatch" className="anim-stamp absolute -top-4 right-3 bg-canary" style={{ animationDelay: "1s" }} />
      </div>
      <figcaption className="mt-5 text-sm leading-relaxed text-muted">
        Synthetic scenario 07. Stripe answered 200 but kept the evidence as a draft. Sentinel read the dispute back, caught the difference, and retried
        with a new idempotency key. The second copy matched.
      </figcaption>
    </figure>
  );
}

function Section({
  id,
  label,
  heading,
  children,
  wide,
  dark,
}: {
  id: string;
  label: string;
  heading: ReactNode;
  children?: ReactNode;
  wide?: ReactNode;
  dark?: boolean;
}) {
  return (
    <section aria-labelledby={id} className={`py-20 sm:py-28 ${dark ? "bg-ink text-sheet" : "border-t border-ink/10"}`}>
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid gap-4 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-12">
          <p className={`field-label lg:pt-3 ${dark ? "text-sheet/60" : "text-muted"}`}>{label}</p>
          <div>
            <h2 id={id} className="display max-w-3xl text-[2rem] leading-[1.06] sm:text-[2.6rem]">
              {heading}
            </h2>
            {children}
          </div>
        </div>
        {wide}
      </div>
    </section>
  );
}

export default function Page() {
  return (
    <main id="main" className="text-ink">
      <section aria-labelledby="hero-h" className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid items-center gap-14 py-14 sm:py-20 lg:min-h-[80vh] lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          <div>
            <p className="field-label text-muted">Chargeback operations for e-commerce</p>
            <h1 id="hero-h" className="display mt-5 text-[2.35rem] leading-[1.02] sm:text-[3.4rem] xl:text-[4rem]">
              The bank pulled the money back. Now prove what happened.
            </h1>
            <p className="mt-7 max-w-xl text-lg leading-relaxed text-muted">
              A customer says the order never arrived. The evidence is split across Stripe, Salesforce, and Gmail, the deadline is closing, and the final
              response cannot be taken back. Sentinel investigates the claim, applies policy before acting, and reads every system back to prove the work
              actually landed.
            </p>
            <p className="mt-4 max-w-xl text-lg font-medium leading-relaxed">High-value accepts wait for a named human. Missing evidence never becomes a guess.</p>
            <div className="mt-9 flex flex-wrap items-center gap-x-5 gap-y-3">
              <Link href="/disputes" className={primaryCta}>
                Open the dispute queue
              </Link>
              <Link href="/eval" className="inline-flex min-h-11 items-center text-sm font-medium text-carbon underline-offset-4 hover:underline">
                See the evaluation
              </Link>
              <span className="w-full text-sm text-muted">Synthetic demo · about 45 seconds</span>
            </div>
          </div>
          <DuplicateSlip />
        </div>
      </section>

      <Section id="stakes-h" label="The stakes" heading="A chargeback is a deadline with one shot at the answer.">
        <dl className="mt-10 grid divide-y divide-rule rounded-md border border-ink/15 bg-sheet sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {STAKES.map((s) => (
            <div key={s.label} className="p-5 sm:p-6">
              <dt className="field-label text-muted">{s.label}</dt>
              <dd className="display mt-3 text-[1.9rem] leading-none">{s.figure}</dd>
              <dd className="mt-3 text-sm leading-relaxed text-muted">{s.text}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section id="today-h" label="Today" heading="Chargeback work fails in the gaps between systems.">
        <div className="mt-10 grid overflow-hidden rounded-md border border-ink/15 md:grid-cols-2">
          <div className="bg-paper p-6 sm:p-7">
            <h3 className="field-label text-muted">Without Sentinel</h3>
            <ul className="mt-5 list-disc space-y-3 pl-5 text-[0.95rem] leading-relaxed text-muted marker:text-rule">
              {WITHOUT.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div className="border-t border-ink/15 bg-sheet p-6 sm:p-7 md:border-l md:border-t-0">
            <h3 className="field-label text-green">With Sentinel</h3>
            <ul className="mt-5 list-disc space-y-3 pl-5 text-[0.95rem] leading-relaxed marker:text-carbon">
              {WITH.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      <Section id="routing-h" label="Who it’s for" heading="Verified chargeback operations for the teams responsible for the outcome.">
        <ul className="mt-10 border-t border-ink/15">
          {ROUTING.map((r) => (
            <li key={r.role} className="grid gap-1 border-b border-rule py-5 sm:grid-cols-[15rem_11rem_minmax(0,1fr)] sm:gap-6">
              <h3 className="font-semibold">{r.role}</h3>
              <p className="field-label pt-0.5 text-carbon">{r.duty}</p>
              <p className="text-[0.95rem] leading-relaxed text-muted">{r.body}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        id="how-h"
        label="How it works"
        heading={
          <>
            AI investigates. Policy gates. <span className="text-carbon">Readback proves.</span>
          </>
        }
      >
        <p className="mt-4 max-w-xl text-muted">Five stages, with a recorded trail from the first Stripe read to the final cross-system check.</p>
        <ol className="mt-10">
          {STEPS.map((s, i) => (
            <li key={s.title} className="relative grid grid-cols-[2.75rem_minmax(0,1fr)] gap-4 pb-10 last:pb-0 sm:gap-6">
              {i < STEPS.length - 1 && <span aria-hidden="true" className="absolute bottom-0 left-[1.375rem] top-12 w-px bg-rule" />}
              <span aria-hidden="true" className="num grid size-11 place-items-center rounded-md border border-ink/20 bg-sheet font-mono text-sm">
                {i + 1}
              </span>
              <div className="pt-0.5">
                <p className="field-label text-carbon">{s.verb}</p>
                <h3 className="mt-1 text-lg font-semibold">{s.title}</h3>
                <p className="mt-2 max-w-2xl text-[0.95rem] leading-relaxed text-muted">{s.text}</p>
                <ul aria-label="Systems involved" className="mt-3 flex flex-wrap gap-1.5">
                  {s.systems.map((sys) => (
                    <li key={sys} className="rounded-sm border border-rule bg-sheet px-1.5 py-0.5 font-mono text-[11px] text-muted">
                      {sys}
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="doors-h" label="One system, two doors" heading="Two ways in, one case record underneath.">
        <div className="mt-12 grid gap-8 md:grid-cols-2">
          {DOORS.map((d) => (
            <article key={d.href} className={`group relative rounded-md border p-7 pt-9 transition-colors ${d.card}`}>
              <p className={`field-label absolute -top-3 left-6 rounded-sm px-2 py-1 ${d.tabTone}`}>{d.tab}</p>
              <h3 className="display text-[1.45rem] leading-tight">{d.title}</h3>
              <ul className="mt-5 list-disc space-y-2 pl-5 text-[0.95rem] leading-relaxed text-muted marker:text-ink/30">
                {d.points.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
              {/* The pseudo-element stretches this link over the whole card. */}
              <Link
                href={d.href}
                className="mt-6 inline-flex min-h-11 items-center text-sm font-semibold text-ink underline-offset-4 after:absolute after:inset-0 after:rounded-md group-hover:underline"
              >
                {d.cta}&nbsp;<span aria-hidden="true">→</span>
              </Link>
            </article>
          ))}
        </div>
      </Section>

      <Section id="case-h" label="One synthetic case" heading="A 200 response that did nothing—and the readback that caught it.">
        <ol className="mt-10 border-t border-ink/15">
          {CASE_ROWS.map((r) => (
            <li key={r.title} className="grid gap-2 border-b border-rule py-5 sm:grid-cols-[13rem_minmax(0,1fr)] sm:gap-6">
              <div className="flex items-start justify-between gap-3 sm:block">
                <h3 className="field-label pt-0.5 text-ink">{r.title}</h3>
                {r.stamp && <Stamp kind={r.stamp} className="sm:mt-3" style={{ "--stamp-ground": "var(--color-paper)" } as CSSProperties} />}
              </div>
              <p className="text-[0.95rem] leading-relaxed text-muted">{r.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section
        id="preview-h"
        label="See it"
        heading="Every source, decision, action, and check in one timeline."
        wide={
          <figure className="mt-12">
            <LandingPreview />
            <figcaption className="mt-4 text-sm text-muted">
              Synthetic scenario 07: the first write saved a draft; Sentinel detected the mismatch, retried safely, and verified the provider state.
            </figcaption>
          </figure>
        }
      />

      <Section id="trust-h" label="Why trust it" heading="What the last committed evaluation run showed." dark>
        <ul className="mt-12 grid gap-10 md:grid-cols-3">
          {METRICS.map((m) => (
            <li key={m.text} className="border-t border-sheet/20 pt-5">
              <p className="display num text-[3.6rem] leading-none">{m.figure}</p>
              <p className="mt-4 text-sm leading-relaxed text-sheet/75">{m.text}</p>
            </li>
          ))}
        </ul>
        {sandboxRun.scenariosSkipped > 0 && (
          <p className="mt-10 max-w-2xl border-l-2 border-canary/60 pl-4 text-sm leading-relaxed text-sheet/75">
            One past-due provider scenario was skipped because the backend could not seed its historical deadline; the no-submit deadline gate remains
            covered by the offline policy suite.
          </p>
        )}
        <Link href="/eval" className="mt-8 inline-flex min-h-11 items-center text-sm font-semibold text-canary underline-offset-4 hover:underline">
          Inspect the full evaluation&nbsp;<span aria-hidden="true">→</span>
        </Link>
      </Section>

      <section aria-labelledby="closing-h" className="mx-auto max-w-6xl px-4 py-24 sm:px-6 sm:py-32">
        <h2 id="closing-h" className="display max-w-4xl text-[2.2rem] leading-[1.04] sm:text-[3.4rem]">
          We don’t trust a successful response. <span className="text-carbon">We verify the result.</span>
        </h2>
        <p className="mt-6 max-w-xl text-lg text-muted">From the first evidence read to the final provider check, Sentinel leaves a case an operator can explain.</p>
        <div className="mt-10 flex flex-wrap gap-3">
          <Link href="/disputes" className={primaryCta}>
            Open the dispute queue
          </Link>
          <Link href="/eval" className={secondaryCta}>
            See the evaluation
          </Link>
        </div>
      </section>

      <footer className="border-t border-ink/15">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-muted sm:px-6 md:flex-row md:items-center md:justify-between">
          <p className="flex items-center gap-2">
            <BrandMark className="shrink-0 text-ink" />
            <span>
              <span className="display text-ink">Sentinel</span> — verified chargeback operations · demo · synthetic data
            </span>
          </p>
          <p className="field-label">AI investigates · policy gates · systems confirm</p>
        </div>
      </footer>
    </main>
  );
}
