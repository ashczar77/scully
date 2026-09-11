import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import { runSequence } from "../src/reproduction.mjs";

const incident = await runSequence();
assert.deepEqual(incident.payload.responses, [200, 429]);
assert.deepEqual(incident.payload.events, ["request_accepted", "rate_limit_rejected"]);
assert.equal(incident.payload.identity_digests[0], incident.payload.identity_digests[1]);

const knownGood = await runSequence({ trustProxy: "loopback" });
assert.deepEqual(knownGood.payload.responses, [200, 200]);
assert.notEqual(
  knownGood.payload.identity_digests[0],
  knownGood.payload.identity_digests[1],
);

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
    failing_test_exit_code: failingTest.status,
  }),
);
