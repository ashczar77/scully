import { runSequence } from "../src/reproduction.mjs";
import { loadTrigger } from "../src/trigger.mjs";

if (process.version !== "v22.22.2") {
  throw new Error("The reviewed fixture requires Node.js 22.22.2");
}

const variant = process.argv[2];
const allowed = new Set([
  "trust-loopback",
  "preserve-forwarded-chain",
  "per-request-identity",
]);

if (!allowed.has(variant)) {
  throw new Error("Branch variant is outside the local allowlist");
}

const trigger = await loadTrigger();
console.log(JSON.stringify(await runSequence({ variant, trigger })));
