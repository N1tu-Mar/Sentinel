import type { ChaosMode } from "@/domain/types";

export type ChaosPoint = "stripe.submit_evidence" | "stripe.get_dispute_readback" | "slack.post";

const POINT: Record<Exclude<ChaosMode, "none">, ChaosPoint> = {
  drop_submit_once: "stripe.submit_evidence",
  stripe_500_once: "stripe.get_dispute_readback",
  slack_timeout_once: "slack.post",
};

export const CHAOS_TEXT: Record<Exclude<ChaosMode, "none">, string> = {
  drop_submit_once: "Injected failure: evidence sent without submit=true (saved as draft, HTTP 200)",
  stripe_500_once: "Injected failure: dispute readback returns a synthetic 500",
  slack_timeout_once: "Injected failure: Slack post times out after 100 ms",
};

/** One fault per run, fired at most once, at the named point. */
export class Chaos {
  consumed = false;
  constructor(public mode: ChaosMode) {}

  fire(point: ChaosPoint): boolean {
    if (this.mode === "none" || this.consumed || POINT[this.mode] !== point) return false;
    this.consumed = true;
    return true;
  }
}
