import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

import { buildComparison, matchesSignature } from "./minimize.mjs";
import { runSequence } from "../src/reproduction.mjs";
import { loadTrigger } from "../src/trigger.mjs";

const trigger = await loadTrigger();
const incident = await runSequence({ variant: "incident", trigger });
assert.deepEqual(incident.payload.responses, [200, 429]);
assert.deepEqual(incident.payload.events, ["request_accepted", "rate_limit_rejected"]);
assert.equal(incident.payload.identity_digests[0], incident.payload.identity_digests[1]);

assert.equal(incident.payload.proxy_hops, 1);
assert.equal(incident.payload.trust_proxy, false);

const knownGood = await runSequence({ variant: "trust-loopback", trigger });
assert.deepEqual(knownGood.payload.responses, [200, 200]);
assert.notEqual(
  knownGood.payload.identity_digests[0],
  knownGood.payload.identity_digests[1],
);
assert.equal(knownGood.payload.proxy_hops, 1);
assert.equal(knownGood.payload.trust_proxy, "loopback");

const comparison = await buildComparison();
const expectedComparison = JSON.parse(
  await readFile(new URL("../minimization.json", import.meta.url), "utf8"),
);
const signature = JSON.parse(
  await readFile(
    new URL("../signatures/proxy-identity-collapse-v1.json", import.meta.url),
    "utf8",
  ),
);
assert.deepEqual(comparison, expectedComparison);
assert.equal(comparison.equivalent_signature, true);

const missingComparedValues = structuredClone(incident);
delete missingComparedValues.payload.identity_digests;
assert.equal(matchesSignature(signature, missingComparedValues), false);

const failingTest = spawnSync(
  process.execPath,
  ["--test", "test/proxy-identity-collapse.test.mjs"],
  { cwd: new URL("..", import.meta.url), encoding: "utf8" },
);
assert.equal(failingTest.status, 1);
assert.match(`${failingTest.stdout}\n${failingTest.stderr}`, /200[\s\S]*429/);

console.log(
  JSON.stringify({
    status: "verified",
    incident_responses: incident.payload.responses,
    known_good_responses: knownGood.payload.responses,
    minimized_payload_fields: comparison.minimized_payload_fields,
    removed_payload_fields: comparison.removed_payload_fields,
    failing_test_exit_code: failingTest.status,
  }),
);
