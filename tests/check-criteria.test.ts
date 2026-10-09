import { expect, it } from "vitest";
import { parseCheckCriterion } from "../src/shared/audits";
import {
  assessCloudCriterion,
  assessLocalCriterion,
} from "../src/shared/check-criteria";
import type { CloudExecution } from "../src/shared/cloud";
import type { CommandProposal } from "../src/shared/commands";
import type { ExecutionResult } from "../src/shared/execution";

const command = {
  id: "command",
  revision: "revision",
  executable: "node",
  args: ["test.js"],
  cwd: ".",
  reason: "Check the assertion",
  timeoutSeconds: 30,
  decision: "pending",
  findingLink: {
    auditIndex: 0,
    findingIndex: 0,
    revision: "revision",
    path: "test.js",
    detail: "Broken assertion",
    severity: "error",
    expected: "An assertion marker should appear",
    criterion: { exitCode: 0, outputIncludes: "assertions: 4" },
  },
} as CommandProposal;

function local(overrides: Partial<ExecutionResult> = {}): ExecutionResult {
  return {
    id: "local",
    runId: "run",
    commandId: "command",
    revision: "revision",
    executable: "/usr/bin/node",
    executableHash: "hash",
    args: ["test.js"],
    cwd: ".",
    timeoutSeconds: 30,
    startedAt: "2026-10-09T00:00:00Z",
    status: "exited",
    exitCode: 0,
    signal: null,
    output: "assertions: 4",
    error: "",
    ...overrides,
  };
}

function cloud(overrides: Partial<CloudExecution> = {}): CloudExecution {
  return {
    id: "cloud",
    runId: "run",
    commandId: "command",
    revision: "revision",
    projectId: "project",
    image: "image",
    executable: "/usr/bin/node",
    args: ["test.js"],
    cwd: ".",
    timeoutSeconds: 30,
    files: [],
    status: "complete",
    operationId: "operation",
    remoteStatus: "SUCCESS",
    startedAt: "2026-10-09T00:00:00Z",
    commandPassed: true,
    exitCode: 0,
    timedOut: false,
    signal: null,
    stdout: "assertions: 4",
    stderr: "",
    outputTruncated: false,
    error: "",
    ...overrides,
  };
}

it("accepts only bounded literal criteria without credential-shaped text", () => {
  expect(parseCheckCriterion({ exitCode: 0 })).toEqual({ exitCode: 0 });
  expect(
    parseCheckCriterion({ exitCode: 1, outputIncludes: "AssertionError" }),
  ).toEqual({ exitCode: 1, outputIncludes: "AssertionError" });
  for (const invalid of [
    undefined,
    { exitCode: -1 },
    { exitCode: 256 },
    { exitCode: 0, extra: "ignore me" },
    { exitCode: 0, outputIncludes: "" },
    { exitCode: 0, outputIncludes: "line\nnext" },
    { exitCode: 0, outputIncludes: "x".repeat(201) },
    { exitCode: 0, outputIncludes: "sk-123456789012345678901234" },
    Object.assign(Object.create({ exitCode: 0 }), {}),
  ])
    expect(() => parseCheckCriterion(invalid)).toThrow(
      "Invalid check criterion",
    );
});

it("evaluates local recorded exit and literal output without resolving a finding", () => {
  expect(assessLocalCriterion(command, local()).status).toBe("met");
  expect(assessLocalCriterion(command, local({ exitCode: 1 })).status).toBe(
    "not_met",
  );
  expect(assessLocalCriterion(command, local({ output: "other" })).status).toBe(
    "not_met",
  );
  expect(
    assessLocalCriterion(command, local({ status: "output_limit" })).status,
  ).toBe("unavailable");
  expect(
    assessLocalCriterion(command, local({ revision: "stale" })).status,
  ).toBe("unavailable");
  expect(
    assessLocalCriterion({ ...command, findingLink: undefined }, local())
      .status,
  ).toBe("not_specified");
});

it("does not treat truncated or uncertain cloud output as a failed criterion", () => {
  expect(assessCloudCriterion(command, cloud()).status).toBe("met");
  expect(assessCloudCriterion(command, cloud({ stdout: "other" })).status).toBe(
    "not_met",
  );
  expect(
    assessCloudCriterion(
      command,
      cloud({ stdout: "other", outputTruncated: true }),
    ).status,
  ).toBe("unavailable");
  expect(
    assessCloudCriterion(command, cloud({ outputTruncated: true })).status,
  ).toBe("unavailable");
  expect(
    assessCloudCriterion(command, cloud({ exitCode: 1, outputTruncated: true }))
      .status,
  ).toBe("not_met");
  expect(
    assessCloudCriterion(
      command,
      cloud({ stdout: "other", outputTruncated: undefined }),
    ).status,
  ).toBe("unavailable");
  expect(
    assessCloudCriterion(command, cloud({ remoteStatus: "FAILED" })).status,
  ).toBe("unavailable");
  expect(
    assessCloudCriterion(command, cloud({ operationId: null })).status,
  ).toBe("unavailable");
  expect(assessCloudCriterion(command, cloud({ timedOut: true })).status).toBe(
    "unavailable",
  );
  expect(assessCloudCriterion(command, cloud({ signal: 9 })).status).toBe(
    "unavailable",
  );
});
