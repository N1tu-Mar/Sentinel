export type Branch =
  | "FIGHT"
  | "FIGHT_AND_FLAG"
  | "ACCEPT"
  | "ASK_HUMAN"
  | "EXPIRED_OR_BLOCKED";

export type CaseStatus =
  | "new"
  | "running"
  | "awaiting_approval"
  | "resolved"
  | "needs_attention"
  | "failed";

export type ChaosMode =
  | "none"
  | "drop_submit_once"
  | "stripe_500_once"
  | "slack_timeout_once";

export interface DisputeCase {
  id: string; // = Stripe dispute id (dp_...)
  status: CaseStatus;
  scenario?: string;
  chaosMode: ChaosMode;
  dispute: {
    id: string;
    chargeId: string;
    customerId: string;
    amount: number;
    currency: string;
    reason: string;
    status: string;
    dueBy: number | null; // ms epoch
    createdAt: number;
  };
  customer?: {
    email: string;
    name: string;
    stripeId: string;
    sfContactId?: string;
  };
  evidence: EvidenceItem[];
  decision?: Decision;
  actions: ActionRecord[]; // the idempotency ledger
  approval?: {
    requiredFor: "ACCEPT";
    requestedAt: number;
    decidedAt?: number;
    outcome?: "approved" | "rejected";
    by?: string;
  };
  verification?: { passed: boolean; checks: VerificationCheck[]; at: number };
  finalSummary?: string;
  lemmaTraceId?: string;
  providerCalls: number;
  forbiddenEffects: number;
  createdAt: number;
  updatedAt: number;
}

export interface EvidenceItem {
  id: string;
  source: "stripe" | "salesforce" | "gmail";
  kind:
    | "delivery_proof"
    | "customer_communication"
    | "dispute_history"
    | "cancellation_request"
    | "order_record"
    | "other";
  summary: string;
  raw: unknown;
  strength: "strong" | "moderate" | "weak";
  foundAt: number;
}

export interface Decision {
  branch: Branch;
  confidence: number;
  rationale: string;
  evidenceIds: string[];
  requiresApproval: boolean;
  plannedActions: string[];
  decidedAt: number;
  note?: string;
}

export type ActionName =
  | "stripe.submit_evidence"
  | "stripe.accept_dispute"
  | "stripe.cancel_subscription"
  | "salesforce.create_case"
  | "salesforce.flag_contact"
  | "slack.post";

export interface ActionRecord {
  key: string; // `${caseId}:${action}` (+ `:${target}` for per-channel / per-case-kind actions)
  action: ActionName;
  attempts: {
    n: number;
    idempotencyKey: string;
    at: number;
    httpStatus?: number;
    verified: boolean;
    note?: string;
  }[];
  state: "pending" | "succeeded_verified" | "failed";
  observed?: string;
}

export interface VerificationCheck {
  system: "stripe" | "salesforce" | "slack" | "sentinel";
  check: string;
  expected: string;
  observed: string;
  passed: boolean;
}

/** Shape every action tool returns to the model. */
export interface ActionResult {
  ok: boolean;
  verified: boolean;
  attempt: number;
  observed: string;
  note?: string;
}

export type TimelineEvent =
  | { t: number; type: "status"; status: CaseStatus }
  | { t: number; type: "thought"; text: string }
  | { t: number; type: "tool_call"; tool: string; input: unknown }
  | { t: number; type: "tool_result"; tool: string; summary: string; ok: boolean }
  | { t: number; type: "evidence"; item: EvidenceItem }
  | { t: number; type: "decision"; decision: Decision }
  | { t: number; type: "action"; action: ActionName; attempt: number; idempotencyKey: string }
  | { t: number; type: "verify"; action: string; expected: string; observed: string; passed: boolean }
  | { t: number; type: "recovery"; text: string }
  | { t: number; type: "approval_requested" | "approval_granted" | "approval_rejected" }
  | {
      t: number;
      type: "provider_call";
      system: string;
      method: string;
      path: string;
      status: number;
      ms: number;
      forbidden?: boolean;
    }
  | { t: number; type: "chaos"; mode: ChaosMode; text: string }
  | { t: number; type: "error"; text: string };

export type ProviderCall = Omit<Extract<TimelineEvent, { type: "provider_call" }>, "t" | "type">;

export interface EvalResult {
  scenario: string;
  passed: boolean;
  skipped?: string;
  failures: string[];
  expectedBranch: Branch;
  branch?: Branch;
  finalStatus?: CaseStatus;
  submitAttempts: number;
  providerCalls: number;
  forbiddenEffects: number;
  stripeWriteUnexpected: boolean;
  constraintViolation: boolean;
  chaos: ChaosMode;
  stateConsistent: boolean;
  wallMs: number;
  caseId?: string;
  lemmaTraceId?: string;
  at: number;
}
