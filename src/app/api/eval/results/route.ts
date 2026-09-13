import { NextResponse } from "next/server";
import { SCENARIOS } from "@/domain/scenarios";
import { computeMetrics } from "@/eval/assertions";
import { getStore } from "@/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const results = await getStore().getEvalResults();
  return NextResponse.json({
    scenarios: SCENARIOS.map((s) => ({ key: s.key, title: s.title, expected: s.expected, chaos: s.chaos })),
    results,
    metrics: computeMetrics(results),
  });
}
