import assert from "node:assert/strict";
import test from "node:test";

import { runSequence } from "../src/reproduction.mjs";
import { loadTrigger } from "../src/trigger.mjs";

test("two forwarded clients receive independent rate-limit buckets", async () => {
  const trigger = await loadTrigger();
  const observation = await runSequence({ variant: "incident", trigger });

  assert.deepEqual(observation.payload.responses, [200, 200]);
});
