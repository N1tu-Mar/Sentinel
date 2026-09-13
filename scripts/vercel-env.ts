import "./_env";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { sandboxEnv } from "@/sandbox/server";

// npm run env:use -- sandbox   production Salesforce/Gmail/Slack → the sandbox hosted by the app itself (/api/sandbox)
// npm run env:use -- arga      production → the twins in .env.twins (run `npm run provision` first; Free-plan twins last 10 min)
// Updates the Vercel production env, then redeploys. Stripe (real test mode) is untouched in both modes.
const mode = process.argv[2];
const appUrl = process.env.PRODUCTION_URL ?? "https://sentinel-orpin-psi.vercel.app";
const PROVIDER_VARS = [
  "SANDBOX_URL",
  "SANDBOX_TOKEN",
  "SALESFORCE_INSTANCE_URL",
  "SALESFORCE_API_BASE_URL",
  "SALESFORCE_ACCESS_TOKEN",
  "GMAIL_API_BASE_URL",
  "GMAIL_ACCESS_TOKEN",
  "SLACK_API_URL",
  "SLACK_BOT_TOKEN",
  "ARGA_TWIN_RUN_IDS",
];

let env: Record<string, string>;
if (mode === "sandbox") {
  const token = crypto.randomUUID();
  env = { ...sandboxEnv(`${appUrl}/api/sandbox`, token), SANDBOX_TOKEN: token };
} else if (mode === "arga") {
  const text = await readFile(".env.twins", "utf8").catch(() => {
    throw new Error("no .env.twins: run `npm run provision` first");
  });
  env = Object.fromEntries(text.split("\n").filter((l) => /^[A-Z_]+=./.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
  delete env.EVAL_SEED_MODE;
} else {
  throw new Error("usage: npm run env:use -- sandbox|arga");
}

const vercel = (args: string[], input?: string) => execFileSync("vercel", args, { input, stdio: ["pipe", "pipe", "pipe"] }).toString();

for (const name of PROVIDER_VARS.filter((k) => !(k in env))) {
  try {
    vercel(["env", "rm", name, "production", "--yes"]);
    console.log(`removed ${name}`);
  } catch {
    // not set
  }
}
for (const [name, value] of Object.entries(env)) {
  vercel(["env", "add", name, "production", "--force"], value);
  console.log(`set ${name}`);
}
console.log(`production now uses ${mode === "sandbox" ? `the hosted sandbox at ${appUrl}/api/sandbox` : "Arga twins"}; redeploying…`);
console.log(vercel(["--prod", "--yes"]).trim().split("\n").filter(Boolean).pop());
