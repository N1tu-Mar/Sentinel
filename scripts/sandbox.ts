import { writeFile } from "node:fs/promises";
import { createSandbox, sandboxEnv } from "@/sandbox/server";

// npm run sandbox — local Salesforce + Gmail + Slack sandbox (Stripe stays on real test mode).
// Writes .env.development.local (gitignored), which next dev and the scripts pick up. Delete it to use Arga twins again.
const port = Number(process.env.SANDBOX_PORT ?? 4010);
const { server } = createSandbox();
server.listen(port, async () => {
  const env = sandboxEnv(`http://localhost:${port}`);
  await writeFile(
    ".env.development.local",
    `# Written by npm run sandbox: Salesforce, Gmail and Slack point at the local sandbox. Delete to use Arga twins.\n${Object.entries(env)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n")}\n`,
  );
  console.log(`Local sandbox (Salesforce, Gmail, Slack) listening on http://localhost:${port}`);
  console.log("Wrote .env.development.local — restart `npm run dev` so the app uses it. State: GET /_sandbox/state, reset: POST /_sandbox/reset");
});
