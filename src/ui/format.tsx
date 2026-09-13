import type { Branch, CaseStatus, ChaosMode } from "@/domain/types";

export const money = (cents: number, currency = "usd") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);

const REASON: Record<string, string> = {
  product_not_received: "Says they didn't receive it",
  fraudulent: "Says they never made this purchase",
  duplicate: "Says they were charged twice",
  subscription_canceled: "Says they canceled before the charge",
  product_unacceptable: "Says it wasn't as described",
  credit_not_processed: "Says a refund never arrived",
  unrecognized: "Doesn't recognize the charge",
  general: "Disputes the charge",
};
export const reasonText = (r: string) => REASON[r] ?? r.replaceAll("_", " ");

export const BRANCH_TEXT: Record<Branch, string> = {
  FIGHT: "Fight the dispute",
  FIGHT_AND_FLAG: "Fight and flag the customer",
  ACCEPT: "Accept the dispute",
  ASK_HUMAN: "Ask a person",
  EXPIRED_OR_BLOCKED: "Too late to respond",
};

export const CHAOS_OPTIONS: { value: ChaosMode; label: string }[] = [
  { value: "none", label: "None" },
  { value: "drop_submit_once", label: "Drop evidence submit" },
  { value: "stripe_500_once", label: "Stripe 500 on readback" },
  { value: "slack_timeout_once", label: "Slack post timeout" },
];

export function deadline(dueBy: number | null) {
  if (!dueBy) return { label: "No deadline", used: 0, late: false };
  const days = (dueBy - Date.now()) / 86400_000;
  const label = days < 0 ? "Deadline passed" : days < 1 ? "Due today" : `${Math.floor(days)} ${Math.floor(days) === 1 ? "day" : "days"} left`;
  // Stripe gives roughly 7–21 days; show how much of a 21-day window is gone.
  return { label, used: Math.min(1, Math.max(0, 1 - days / 21)), late: days < 2 };
}

const STATUS: Record<CaseStatus, { text: string; cls: string }> = {
  new: { text: "Not reviewed", cls: "border-rule text-muted" },
  running: { text: "Investigating", cls: "border-ink text-ink" },
  awaiting_approval: { text: "Needs your approval", cls: "border-ink bg-ink text-sheet" },
  resolved: { text: "Handled and verified", cls: "border-green bg-green-wash text-green" },
  needs_attention: { text: "Needs attention", cls: "border-red bg-red-wash text-red" },
  failed: { text: "Run failed", cls: "border-red bg-red-wash text-red" },
};

export function StatusPill({ status }: { status: CaseStatus }) {
  const s = STATUS[status];
  return (
    <span className={`state-flip inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${s.cls}`}>
      {status === "running" && <span className="size-1.5 animate-pulse rounded-full bg-ink motion-reduce:animate-none" aria-hidden />}
      {s.text}
    </span>
  );
}
