import { money, reasonText, StatusPill } from "./format";

// Static picture of the case page for synthetic scenario 07. No fetching, no polling, nothing clickable.

function Call({ system, tool, result }: { system: string; tool: string; result: string }) {
  return (
    <li className="border-l-2 border-rule pl-3.5 text-sm">
      <span className="flex items-baseline gap-2">
        <span className="field-label w-20 shrink-0 text-muted">{system}</span>
        <span>{tool}</span>
      </span>
      <span className="mt-0.5 block font-mono text-xs text-muted [overflow-wrap:anywhere] sm:pl-[5.5rem]">{result}</span>
    </li>
  );
}

function Verify({ passed, label, expected, observed }: { passed: boolean; label: string; expected: string; observed: string }) {
  return (
    <li
      className={`relative rounded-md border-l-4 px-3.5 py-2.5 text-sm ${passed ? "border-green bg-green-wash" : "border-red bg-red-wash"}`}
      style={{ "--stamp-ground": `var(--color-${passed ? "green" : "red"}-wash)` } as React.CSSProperties}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className={`font-medium ${passed ? "text-green" : "text-red"}`}>{label}</p>
        <span className={`stamp ${passed ? "text-green" : "text-red"}`}>{passed ? "Matches" : "Does not match"}</span>
      </div>
      <p className="num mt-1 font-mono text-xs text-ink/80 [overflow-wrap:anywhere]">
        expected {expected}
        <br />
        observed {observed}
      </p>
    </li>
  );
}

const FINAL_CHECKS: [string, string][] = [
  ["Stripe", "Evidence submitted"],
  ["Stripe", "Evidence narrative present"],
  ["Slack", "Summary found in #disputes"],
  ["Salesforce", "No repeat-dispute flag"],
  ["Sentinel", "0 forbidden effects"],
];

export function LandingPreview() {
  return (
    <div className="overflow-hidden rounded-md border border-ink/20 bg-paper text-left text-ink shadow-[0_30px_60px_-40px_rgba(22,26,51,0.5)]">
      <div className="flex items-center justify-between gap-3 border-b border-ink/10 bg-ink px-4 py-2 text-xs text-sheet/75">
        <span className="field-label text-sheet">Scenario preview</span>
        <span>synthetic · not live</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-rule bg-sheet px-4 py-4 sm:px-6">
        <div className="min-w-0">
          <p className="display text-xl">
            Alex Rivera <span className="num text-muted">{money(9600)}</span>
          </p>
          <p className="mt-1 text-sm text-muted">{reasonText("product_not_received")} · Sandbox</p>
        </div>
        <StatusPill status="resolved" />
      </div>

      <div className="grid gap-8 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div>
          <p className="field-label text-muted">What the agent did</p>
          <ol className="mt-3 space-y-2">
            <Call system="Stripe" tool="get dispute" result="needs_response · $96.00 · evidence due Sep 18" />
            <Call system="Salesforce" tool="list cases" result="Order JP-10407 delivered · UPS 1Z999AA10123450778 · Aug 30" />
            <Call system="Gmail" tool="get thread" result="“Got it, thanks! The Insulated water bottle set arrived today…”" />
            <li className="my-3 rounded-md border-2 border-ink bg-sheet p-4">
              <p className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="display text-lg">Submit evidence</span>
                <span className="font-mono text-xs text-muted">FIGHT</span>
              </p>
              <p className="mt-2 text-sm">Delivery record and the customer&apos;s own email contradict the claim. Cites the Salesforce case and Gmail message.</p>
            </li>
            <li className="border-l-2 border-ink pl-3.5 text-sm font-medium">
              stripe.submit_evidence <span className="font-normal text-muted">· attempt 1 · HTTP 200</span>
            </li>
            <Verify passed={false} label="Not confirmed · stripe.submit_evidence" expected="under_review · submission_count 1" observed="needs_response · submission_count 0" />
            <li className="pl-4 text-sm font-medium">
              Recovering: <span className="font-normal">retrying with a new idempotency key</span>
            </li>
            <li className="border-l-2 border-ink pl-3.5 text-sm font-medium">
              stripe.submit_evidence <span className="font-normal text-muted">· attempt 2</span>
            </li>
            <Verify passed label="Recovered and confirmed · stripe.submit_evidence" expected="under_review · submission_count 1" observed="under_review · submission_count 1" />
            <Verify passed label="Confirmed · slack.post" expected="message in #disputes" observed="message in #disputes" />
          </ol>
        </div>

        <div>
          <p className="field-label text-muted">Final verification</p>
          <ul className="mt-3 divide-y divide-rule rounded-md border border-rule bg-sheet text-sm">
            {FINAL_CHECKS.map(([system, check]) => (
              <li key={check} className="flex items-baseline justify-between gap-3 px-3 py-2">
                <span>
                  <span className="text-xs text-muted">{system}</span> {check}
                </span>
                <span className="text-xs font-medium text-green">Verified</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 border-t border-rule pt-4 text-sm font-medium text-green">All checks passed</p>
        </div>
      </div>
    </div>
  );
}
