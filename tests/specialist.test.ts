// @vitest-environment node
import { expect, it, vi } from "vitest";
import { executeSpecialist } from "../src/engine/specialist";
import { snapshotRevision } from "../src/engine/integration";
import type { Run } from "../src/shared/runs";
import { initialTeam, type Task } from "../src/shared/contracts";
import { commandRevision } from "../src/engine/revision";
import { parseFindingChecks } from "../src/shared/audits";
import { rosterMembers, starterRoster } from "../src/shared/fixed-teams";
it("honours remaining command capacity and binds expected observations into approvals", () => {
  const findings = [
    { path: "app.js", severity: "error" as const, detail: "Issue" },
  ];
  const check = {
    findingIndex: 0,
    expected: "Exit nonzero",
    criterion: { exitCode: 1 },
    command: checkSpec,
  };
  expect(parseFindingChecks([], findings, 0)).toEqual([]);
  expect(() => parseFindingChecks([check], findings, 0)).toThrow("limit");
  const run = fixture();
  run.commands = [
    {
      ...checkSpec,
      id: "check",
      revision: "",
      decision: "pending",
      findingLink: {
        auditIndex: 0,
        findingIndex: 0,
        revision: "snapshot",
        ...findings[0],
        expected: "Exit nonzero",
      },
    },
  ];
  const before = commandRevision(run);
  run.commands[0].findingLink!.expected = "Exit zero";
  expect(commandRevision(run)).not.toBe(before);
  const beforeCriterion = commandRevision(run);
  run.commands[0].findingLink!.criterion = { exitCode: 0 };
  expect(commandRevision(run)).not.toBe(beforeCriterion);
});
const checkSpec = {
  executable: "node",
  args: ["--check", "app.js"],
  cwd: ".",
  reason: "Check syntax",
  timeoutSeconds: 5,
};
it("adds finding-bound proposals, expires old approvals and keeps the two-request ceiling", async () => {
  const run = fixture();
  run.commands = [
    { ...checkSpec, id: "old", revision: "old", decision: "approved" },
  ];
  const complete = vi
    .fn()
    .mockResolvedValueOnce({
      summary: "Issue",
      findings: [
        { path: "app.js", severity: "error", detail: "Syntax concern" },
      ],
    })
    .mockResolvedValueOnce({
      response: "Check the syntax",
      checks: [
        {
          findingIndex: 0,
          expected: "A syntax error should exit nonzero",
          criterion: { exitCode: 1, outputIncludes: "SyntaxError" },
          command: checkSpec,
        },
      ],
    });
  const team = initialTeam.map((member) =>
    member.id === "ellis"
      ? { ...member, name: "Security specialist", role: "Security reviewer" }
      : member,
  );
  const result = await executeSpecialist(
    run,
    task,
    { complete },
    vi.fn(),
    team,
  );
  expect(result.events.find((event) => event.actor === "ellis")).toMatchObject({
    actorName: "Security specialist",
    actorRole: "Security reviewer",
  });
  expect(result.specialistAudits![0].status).toBe("needs-review");
  expect(result.commands).toHaveLength(2);
  expect(result.commands![0].decision).toBe("expired");
  expect(result.commands![1]).toMatchObject({
    decision: "pending",
    revision: commandRevision(result),
    findingLink: {
      findingIndex: 0,
      auditIndex: 0,
      path: "app.js",
      revision: run.specialistAudits![0].revision,
      criterion: { exitCode: 1, outputIncludes: "SyntaxError" },
    },
  });
  expect(result.executions).toBeUndefined();
  expect(complete).toHaveBeenCalledTimes(2);
});
it.each(["index", "missing", "unsafe", "overflow", "expected", "criterion"])(
  "rejects invalid focused checks (%s) without partial proposals",
  async (mode) => {
    const run = fixture();
    const check = {
      findingIndex: 0,
      expected: "Expected observation",
      criterion: { exitCode: 0 },
      command: checkSpec,
    };
    const checks =
      mode === "missing"
        ? undefined
        : mode === "overflow"
          ? Array(4).fill(check)
          : [
              {
                ...check,
                findingIndex: mode === "index" ? 20 : 0,
                expected: mode === "expected" ? "" : check.expected,
                criterion:
                  mode === "criterion"
                    ? { exitCode: 0, outputIncludes: "" }
                    : check.criterion,
                command:
                  mode === "unsafe"
                    ? { ...checkSpec, cwd: "../outside" }
                    : checkSpec,
              },
            ];
    const complete = vi
      .fn()
      .mockResolvedValueOnce({
        summary: "Issue",
        findings: [{ path: "app.js", severity: "warning", detail: "Issue" }],
      })
      .mockResolvedValueOnce({ response: "Check", checks });
    const result = await executeSpecialist(run, task, { complete }, vi.fn());
    expect(result.specialistAudits![0].status).toBe("failed");
    expect(result.commands).toBeUndefined();
  },
);
function fixture(): Run {
  const drafts = [{ path: "app.js", content: "return 1", before: null }];
  return {
    id: "run",
    taskId: "task",
    files: [],
    drafts,
    status: "complete",
    sourceName: "New",
    events: [],
    plan: "",
    findings: [],
    checks: [],
    error: "",
    calls: 3,
    model: "test",
    outputTokens: 1024,
    specialistAudits: [
      {
        kind: "testing",
        revision: snapshotRevision([], drafts),
        status: "reviewing",
        calls: 0,
        summary: "",
        findings: [],
        response: "",
      },
    ],
  };
}
const task = { title: "Build", description: "Requirement" } as Task;
it("keeps a disputed finding unresolved after exactly one response, without mutating files or build results", async () => {
  const run = fixture();
  const complete = vi
    .fn()
    .mockResolvedValueOnce({
      summary: "Missing negative test",
      findings: [
        {
          path: "app.js",
          severity: "warning",
          detail: "No invalid input handling",
        },
      ],
    })
    .mockResolvedValueOnce({
      response: "I disagree; try invalid input to distinguish.",
      checks: [],
    });
  const emit = vi.fn();
  const result = await executeSpecialist(run, task, { complete }, emit);
  expect(complete).toHaveBeenCalledTimes(2);
  expect(result.specialistAudits![0]).toMatchObject({
    status: "needs-review",
    calls: 2,
  });
  expect(result.specialistAudits![0].findings).toHaveLength(1);
  expect(result.drafts).toEqual(run.drafts);
  expect(result.findings).toEqual(run.findings);
  expect(result.calls).toBe(3);
  expect(run.specialistAudits![0].calls).toBe(0);
  expect(
    emit.mock.calls.some(([r]) =>
      r.events.some((e: { actor: string }) => e.actor === "maya"),
    ),
  ).toBe(true);
});
it("stops after one request when no findings are reported without asserting correctness", async () => {
  const complete = vi
    .fn()
    .mockResolvedValue({ summary: "No findings", findings: [] });
  const result = await executeSpecialist(
    fixture(),
    task,
    { complete },
    vi.fn(),
  );
  expect(complete).toHaveBeenCalledTimes(1);
  expect(result.specialistAudits![0].status).toBe("clear");
  expect(result.events.at(-1)!.text).toContain("not proof");
});
it("uses the catalog auditor brief for a fixed-cast follow-up audit", async () => {
  const team = rosterMembers(starterRoster).map((member) =>
    member.id === "ellis"
      ? { ...member, instructions: "FORGED AUDIT INSTRUCTION" }
      : member,
  );
  const run = fixture();
  run.teamSnapshot = {
    id: "fixed-team",
    name: "Scully team",
    version: 1,
    createdAt: "2026-10-13",
    members: team,
    roster: starterRoster,
  };
  const complete = vi
    .fn()
    .mockResolvedValue({ summary: "No findings", findings: [] });
  await executeSpecialist(run, task, { complete }, vi.fn(), team);
  expect(complete).toHaveBeenCalledTimes(1);
  expect(complete.mock.calls[0][0].system).toContain("code smells");
  expect(complete.mock.calls[0][0].system).not.toContain(
    "FORGED AUDIT INSTRUCTION",
  );
});
it.each(["bad-path", "provider", "bad-response"])(
  "retains the draft and fails honestly for %s without retries",
  async (mode) => {
    const complete = vi.fn();
    if (mode === "provider") complete.mockRejectedValue(new Error("offline"));
    else
      complete
        .mockResolvedValueOnce({
          summary: "Issue",
          findings: [
            {
              path: mode === "bad-path" ? "unknown.js" : "app.js",
              severity: "error",
              detail: "Issue",
            },
          ],
        })
        .mockResolvedValueOnce({ response: "" });
    const run = fixture();
    const result = await executeSpecialist(run, task, { complete }, vi.fn());
    expect(result.specialistAudits![0].status).toBe("failed");
    expect(complete.mock.calls.length).toBeLessThanOrEqual(2);
    expect(result.drafts).toEqual(run.drafts);
    expect(result.status).toBe("complete");
  },
);
it("rejects stale snapshots and reused dispatches before any request", async () => {
  const run = fixture();
  run.drafts[0].content = "changed";
  const complete = vi.fn();
  await expect(
    executeSpecialist(run, task, { complete }, vi.fn()),
  ).rejects.toThrow("Stale");
  const reused = fixture();
  reused.specialistAudits![0].calls = 2;
  await expect(
    executeSpecialist(reused, task, { complete }, vi.fn()),
  ).rejects.toThrow("Stale");
  expect(complete).not.toHaveBeenCalled();
});
