import "./_env";
import { adminReset } from "@/adapters/salesforce";
import { resetTwins } from "@/eval/seed";

// Restores all twins in ARGA_TWIN_RUN_ID to their provisioned baseline. `--salesforce-admin` also calls the
// Salesforce twin's POST /admin/reset directly.
console.log("arga twins reset:", JSON.stringify(await resetTwins()));
if (process.argv.includes("--salesforce-admin")) console.log("salesforce /admin/reset:", JSON.stringify(await adminReset()));
