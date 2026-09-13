import type { Branch, ChaosMode } from "./types";

export const MERCHANT_EMAIL = "support@northwind-outfitters.example.com";

export interface ScenarioDef {
  key: string;
  title: string;
  customer: { firstName: string; lastName: string; email: string };
  amount: number; // cents
  reason: string; // Stripe reason code the scenario represents
  product: string;
  chaos: ChaosMode;
  expected: Branch;
  autoApprove?: boolean;
  stripe: {
    priorLostDisputes?: number;
    otherCharges?: { amount: number; description: string }[];
    activeSubscription?: boolean;
    deadlinePassed?: boolean;
  };
  salesforce: {
    contact: boolean;
    contactDescription?: string;
    cases: { subject: string; description: string }[];
  };
  gmail: { fromCustomer: boolean; subject: string; body: string; daysAgo: number }[];
  expect: {
    disputeStatus: "under_review" | "lost" | "needs_response";
    evidencePopulated: boolean;
    subscriptionCanceled: boolean;
    riskCases: 0 | 1;
    evidenceNeededCases: 0 | 1;
    followUpCases: 0 | 1;
    slackDisputes: 1;
    slackRisk: 0 | 1;
    slackApprovals: 0 | 1;
    submitAttempts: 0 | 1 | 2;
  };
}

const ymd = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400_000).toISOString().slice(0, 10);

const dana: Omit<ScenarioDef, "key" | "title" | "chaos" | "expect"> = {
  customer: { firstName: "Dana", lastName: "Kim", email: "dana.kim@example.com" },
  amount: 34000,
  reason: "product_not_received",
  product: "SKU-118 Waxed canvas field jacket",
  expected: "FIGHT_AND_FLAG",
  stripe: { priorLostDisputes: 2 },
  salesforce: {
    contact: true,
    cases: [
      {
        subject: "Order 4471 shipment",
        description: `Shipped ${ymd(11)} via UPS 1Z999AA10123456784, delivered ${ymd(8)} 15:12, signed by resident.`,
      },
    ],
  },
  gmail: [{ fromCustomer: true, subject: "Re: Your order 4471 has shipped", body: "Got the jacket, thanks! Fits great.", daysAgo: 7 }],
};

const fightFlagExpect: ScenarioDef["expect"] = {
  disputeStatus: "under_review",
  evidencePopulated: true,
  subscriptionCanceled: false,
  riskCases: 1,
  evidenceNeededCases: 0,
  followUpCases: 0,
  slackDisputes: 1,
  slackRisk: 1,
  slackApprovals: 0,
  submitAttempts: 1,
};

const cancelEmail = (daysAgo: number) => ({
  fromCustomer: true,
  subject: "Cancel my subscription",
  body: "Please cancel my subscription effective immediately.",
  daysAgo,
});

export const SCENARIOS: ScenarioDef[] = [
  { key: "receipt_confirmed_repeat", title: "Receipt confirmed, repeat disputer", chaos: "none", ...dana, expect: fightFlagExpect },
  {
    key: "canceled_before_charge_small",
    title: "Canceled before charge ($89)",
    customer: { firstName: "Marcus", lastName: "Lee", email: "marcus.lee@example.com" },
    amount: 8900,
    reason: "subscription_canceled",
    product: "Monthly gear box subscription",
    chaos: "none",
    expected: "ACCEPT",
    stripe: { activeSubscription: true },
    salesforce: { contact: true, cases: [] },
    gmail: [cancelEmail(12)],
    expect: {
      disputeStatus: "lost",
      evidencePopulated: false,
      subscriptionCanceled: true,
      riskCases: 0,
      evidenceNeededCases: 0,
      followUpCases: 1,
      slackDisputes: 1,
      slackRisk: 0,
      slackApprovals: 0,
      submitAttempts: 0,
    },
  },
  {
    key: "canceled_before_charge_large",
    title: "Canceled before charge ($1,240, needs approval)",
    customer: { firstName: "Priya", lastName: "Shah", email: "priya.shah@example.com" },
    amount: 124000,
    reason: "subscription_canceled",
    product: "Annual expedition membership",
    chaos: "none",
    expected: "ACCEPT",
    autoApprove: true,
    stripe: { activeSubscription: true },
    salesforce: { contact: true, cases: [] },
    gmail: [cancelEmail(12)],
    expect: {
      disputeStatus: "lost",
      evidencePopulated: false,
      subscriptionCanceled: true,
      riskCases: 0,
      evidenceNeededCases: 0,
      followUpCases: 1,
      slackDisputes: 1,
      slackRisk: 0,
      slackApprovals: 1,
      submitAttempts: 0,
    },
  },
  {
    key: "no_evidence",
    title: "No evidence either way",
    customer: { firstName: "Tom", lastName: "Ortiz", email: "tom.ortiz@example.com" },
    amount: 21000,
    reason: "product_not_received",
    product: "SKU-330 Trail running shoes",
    chaos: "none",
    expected: "ASK_HUMAN",
    stripe: {},
    salesforce: { contact: true, cases: [] },
    gmail: [],
    expect: {
      disputeStatus: "needs_response",
      evidencePopulated: false,
      subscriptionCanceled: false,
      riskCases: 0,
      evidenceNeededCases: 1,
      followUpCases: 0,
      slackDisputes: 1,
      slackRisk: 0,
      slackApprovals: 0,
      submitAttempts: 0,
    },
  },
  {
    key: "false_duplicate_claim",
    title: "False duplicate claim",
    customer: { firstName: "Lena", lastName: "Park", email: "lena.park@example.com" },
    amount: 6000,
    reason: "duplicate",
    product: "SKU-902 Merino beanie",
    chaos: "none",
    expected: "FIGHT",
    stripe: { otherCharges: [{ amount: 6000, description: "SKU-771 Fleece hoodie" }] },
    salesforce: {
      contact: true,
      cases: [
        {
          subject: "Order 5120 shipment",
          description: `Two line items (SKU-771 Fleece hoodie, SKU-902 Merino beanie) shipped in one box ${ymd(9)} via USPS 9400111202555842332001, delivered ${ymd(6)}.`,
        },
      ],
    },
    gmail: [],
    expect: {
      disputeStatus: "under_review",
      evidencePopulated: true,
      subscriptionCanceled: false,
      riskCases: 0,
      evidenceNeededCases: 0,
      followUpCases: 0,
      slackDisputes: 1,
      slackRisk: 0,
      slackApprovals: 0,
      submitAttempts: 1,
    },
  },
  {
    key: "delivered_no_email_loyal",
    title: "Delivered with signature, loyal customer",
    customer: { firstName: "Omar", lastName: "Haddad", email: "omar.haddad@example.com" },
    amount: 52000,
    reason: "fraudulent",
    product: "SKU-640 Four-season tent",
    chaos: "none",
    expected: "FIGHT",
    stripe: {},
    salesforce: {
      contact: true,
      contactDescription: "14 orders since 2023. No prior issues.",
      cases: [
        {
          subject: "Order 6002 shipment",
          description: `Shipped ${ymd(10)} via FedEx 794644790138, delivered ${ymd(7)} 11:40, signature: O. Haddad.`,
        },
      ],
    },
    gmail: [],
    expect: {
      disputeStatus: "under_review",
      evidencePopulated: true,
      subscriptionCanceled: false,
      riskCases: 0,
      evidenceNeededCases: 0,
      followUpCases: 0,
      slackDisputes: 1,
      slackRisk: 0,
      slackApprovals: 0,
      submitAttempts: 1,
    },
  },
  {
    key: "chaos_drop_submit",
    title: "Receipt confirmed + injected dropped submit",
    chaos: "drop_submit_once",
    ...dana,
    expect: { ...fightFlagExpect, submitAttempts: 2 },
  },
  {
    key: "deadline_passed",
    title: "Strong evidence, deadline passed",
    customer: { firstName: "Ruth", lastName: "Adler", email: "ruth.adler@example.com" },
    amount: 15500,
    reason: "product_not_received",
    product: "SKU-212 Cast iron camp skillet",
    chaos: "none",
    expected: "EXPIRED_OR_BLOCKED",
    stripe: { deadlinePassed: true },
    salesforce: {
      contact: true,
      cases: [
        {
          subject: "Order 3390 shipment",
          description: `Shipped ${ymd(20)} via UPS 1Z999AA10123456799, delivered ${ymd(16)}, signed by resident.`,
        },
      ],
    },
    gmail: [{ fromCustomer: true, subject: "Skillet", body: "Skillet arrived, thank you.", daysAgo: 15 }],
    expect: {
      disputeStatus: "needs_response",
      evidencePopulated: false,
      subscriptionCanceled: false,
      riskCases: 0,
      evidenceNeededCases: 0,
      followUpCases: 0,
      slackDisputes: 1,
      slackRisk: 0,
      slackApprovals: 0,
      submitAttempts: 0,
    },
  },
];

export const scenarioByKey = (key: string) => SCENARIOS.find((s) => s.key === key);
