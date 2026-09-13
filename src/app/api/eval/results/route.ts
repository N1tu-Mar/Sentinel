import { NextResponse } from "next/server";
import { providerEnvironment } from "@/agent/cases";
import { SCENARIOS } from "@/domain/scenarios";
import type { EvalResult, ProviderEnvironment } from "@/domain/types";
import { computeMetrics } from "@/eval/assertions";
import { getStore } from "@/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ENVIRONMENTS: ProviderEnvironment[] = ["arga-twins", "local-sandbox"];

/** Latest result per scenario, kept separately for Arga twins and the sandbox. */
export async function GET() {
  const latest = new Map<string, EvalResult>();
  for (const r of await getStore().getEvalResults()) {
    const key = `${r.environment ?? "arga-twins"}:${r.scenario}`;
    if ((latest.get(key)?.at ?? -1) < r.at) latest.set(key, r);
  }
  const environments = Object.fromEntries(
    ENVIRONMENTS.map((env) => {
      const results = [...latest.values()].filter((r) => (r.environment ?? "arga-twins") === env);
      return [env, { results, metrics: computeMetrics(results) }];
    }),
  );
  return NextResponse.json({
    scenarios: SCENARIOS.map((s) => ({ key: s.key, title: s.title, expected: s.expected, chaos: s.chaos })),
    current: providerEnvironment(),
    environments,
  });
}
