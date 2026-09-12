import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { runSequence } from "../src/reproduction.mjs";
import { loadTrigger } from "../src/trigger.mjs";

const SIGNATURE_URL = new URL(
  "../signatures/proxy-identity-collapse-v1.json",
  import.meta.url,
);

function atPath(value, path) {
  let current = value;
  for (const segment of path) {
    if (
      current === null ||
      typeof current !== "object" ||
      !Object.hasOwn(current, segment)
    ) {
      return { found: false, value: undefined };
    }
    current = current[segment];
  }
  return { found: true, value: current };
}

function equal(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function matchesSignature(signature, observation) {
  return signature.matchers
    .filter((matcher) => matcher.required)
    .every((matcher) => {
      const observed = atPath(observation, matcher.path);
      if (!observed.found) return false;
      if (matcher.kind === "equals") {
        return equal(observed.value, matcher.expected);
      }
      if (matcher.kind === "same_value") {
        const compared = atPath(observation, matcher.comparison_path);
        return compared.found && equal(observed.value, compared.value);
      }
      throw new Error("Unsupported signature matcher");
    });
}

export function minimizeObservation(signature, observation) {
  assert.equal(matchesSignature(signature, observation), true);
  let minimized = structuredClone(observation);
  const removed = [];
  for (const field of Object.keys(observation.payload).sort()) {
    const candidate = structuredClone(minimized);
    delete candidate.payload[field];
    if (matchesSignature(signature, candidate)) {
      minimized = candidate;
      removed.push(field);
    }
  }
  return { minimized, removed };
}

export async function buildComparison() {
  const trigger = await loadTrigger();
  const signature = JSON.parse(await readFile(SIGNATURE_URL, "utf8"));
  const full = await runSequence({ variant: "incident", trigger });
  const { minimized, removed } = minimizeObservation(signature, full);
  return {
    schema_version: "1.0",
    signature_id: signature.signature_id,
    equivalent_signature:
      matchesSignature(signature, full) && matchesSignature(signature, minimized),
    full_payload_fields: Object.keys(full.payload).sort(),
    minimized_payload_fields: Object.keys(minimized.payload).sort(),
    removed_payload_fields: removed,
    structural_reductions: [
      {
        candidate: "remove-loopback-proxy",
        decision: "retain",
        reason: "The failure depends on the deployed proxy boundary.",
      },
      {
        candidate: "remove-second-client",
        decision: "retain",
        reason: "Two clients are required to prove identity collapse.",
      },
      {
        candidate: "remove-rate-limiter",
        decision: "retain",
        reason: "The HTTP 429 target response requires the limiter.",
      },
      {
        candidate: "remove-informational-observation-fields",
        decision: "remove",
        reason:
          "Seven fields are useful for diagnosis but not required by the target signature.",
      },
    ],
  };
}

const invokedUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedUrl) {
  console.log(JSON.stringify(await buildComparison(), null, 2));
}
