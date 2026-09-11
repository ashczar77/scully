import assert from "node:assert/strict";
import test from "node:test";

import { runSequence } from "../src/reproduction.mjs";

test("two forwarded clients receive independent rate-limit buckets", async () => {
  const observation = await runSequence();

  assert.deepEqual(observation.payload.responses, [200, 200]);
});
