import { config } from "dotenv";

// First file wins: provisioned twin credentials, then local overrides.
config({ path: ".env.twins", quiet: true });
config({ path: ".env.local", quiet: true });
config({ quiet: true });
