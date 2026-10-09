import { expect, it } from "vitest";
import {
  recordFindingDecision,
  decisionCurrent,
  findingKey,
  type FindingDecisionInput,
} from "../src/shared/audits";
import type { Run } from "../src/shared/runs";
function fixture() {
  const finding = {
    path: "app.js",
    severity: "warning" as const,
    detail: "Issue",
  };
  const run = {
    specialistAudits: [{ revision: "rev", findings: [finding] }],
    coordination: { integratedRevision: "rev", auditedRevision: "rev" },
    commands: [
      {
        id: "command",
        revision: "cmd",
        findingLink: {
          auditIndex: 0,
          findingIndex: 0,
          revision: "rev",
          ...finding,
        },
      },
    ],
    executions: [
      {
        id: "e",
        commandId: "command",
        revision: "cmd",
        status: "exited",
        exitCode: 0,
        signal: null,
      },
    ],
  } as Run;
  const input: FindingDecisionInput = {
    auditIndex: 0,
    findingIndex: 0,
    revision: "rev",
    findingKey: findingKey(finding),
    previousCount: 0,
    decision: "resolved",
    reason: "Reviewed assertion and output",
    evidenceIds: ["e"],
  };
  return { run, input };
}
it("records a user resolution and reopening without deleting history", () => {
  const { run, input } = fixture();
  const d = recordFindingDecision(run, input);
  expect(decisionCurrent(run, d)).toBe(true);
  recordFindingDecision(run, {
    ...input,
    previousCount: 1,
    decision: "unresolved",
    reason: "Needs broader coverage",
    evidenceIds: [],
  });
  expect(run.findingDecisions).toHaveLength(2);
  expect(run.findingDecisions![0].decision).toBe("resolved");
});
it.each([
  "missing",
  "foreign",
  "running",
  "stale-result",
  "finding",
  "revision",
  "reason",
  "history",
  "duplicate",
  "unknown",
])("rejects %s decisions without mutation", (mode) => {
  const { run, input } = fixture();
  if (mode === "missing") input.evidenceIds = [];
  if (mode === "foreign") input.evidenceIds = ["other"];
  if (mode === "running") run.executions![0].status = "running";
  if (mode === "stale-result") run.executions![0].revision = "old";
  if (mode === "finding") run.specialistAudits![0].findings[0].detail = "new";
  if (mode === "revision") input.revision = "old";
  if (mode === "reason") input.reason = " ";
  if (mode === "history") input.previousCount = 1;
  if (mode === "duplicate") input.evidenceIds = ["e", "e"];
  if (mode === "unknown") input.decision = "verified" as never;
  expect(() => recordFindingDecision(run, input)).toThrow();
  expect(run.findingDecisions).toBeUndefined();
});
it("marks decisions stale after finding or command revision changes", () => {
  const { run, input } = fixture();
  const d = recordFindingDecision(run, input);
  run.commands![0].revision = "new";
  expect(decisionCurrent(run, d)).toBe(false);
});
