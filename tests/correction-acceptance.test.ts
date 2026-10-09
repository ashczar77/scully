// @vitest-environment node
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { expect, it, vi } from "vitest";
vi.mock("electron", () => ({
  utilityProcess: {
    fork: vi.fn(() => {
      throw new Error("No live worker allowed in fixture acceptance");
    }),
  },
}));
import { Store } from "../src/main/store";
import { RunManager } from "../src/main/run-manager";
import { ExecutionManager } from "../src/main/execution-manager";
import { executeLoop } from "../src/engine/loop";
import { executeSpecialist } from "../src/engine/specialist";
import { assessLocalCriterion } from "../src/shared/check-criteria";
import { compareCorrection } from "../src/shared/correction-evidence";
import { findingKey } from "../src/shared/audits";
import { LocalMetrics, measured } from "../src/shared/telemetry";
import type { Completion, Model } from "../src/engine/provider";
import type { Run } from "../src/shared/runs";

// The oracle is authored independently of either fixture implementation and stays unchanged.
const oracle = `const assert = require('node:assert/strict');
const add = require('./calc.cjs');
assert.equal(add(2, 3), 5);
assert.equal(add(-2, 3), 1);
assert.equal(add(0, 0), 0);
console.log('addition assertions passed');`;
const broken = "module.exports = (a, b) => a - b;";
const check = {
  executable: basename(process.execPath),
  args: ["check.cjs"],
  cwd: ".",
  reason: "Check addition requirements",
  timeoutSeconds: 5,
};
it.each([true, false])(
  "acceptance: failing baseline, isolated correction, unchanged oracle (valid fix: %s)",
  async (validFix) => {
    const root = await mkdtemp(join(tmpdir(), "scully-acceptance-"));
    const store = new Store(join(root, "workspace.sqlite"));
    const metrics = new LocalMetrics();
    const manager = new RunManager(store, root, () => {});
    const runner = new ExecutionManager(store, root, () => {});
    const save = (run: Run) => store.saveRun(run);
    let requests = 0;
    function fixture(respond: (request: Completion) => unknown): Model {
      return {
        complete: (request) =>
          measured(
            "model.request",
            () => {
              requests++;
              return respond(request);
            },
            metrics.record,
          ),
      };
    }
    async function execute(run: Run) {
      const command = run.commands!.at(-1)!;
      const denied = await measured(
        "execution:review",
        () => runner.review(run.id, command.id),
        metrics.record,
      );
      await expect(
        measured(
          "execution:start",
          () => runner.execute(denied.token, false),
          metrics.record,
        ),
      ).rejects.toThrow("permission");
      expect(store.getRun(run.id).executions).toBeUndefined();
      // Denial consumes the ticket. Neither denial nor a parent check grants permission.
      await expect(runner.execute(denied.token, true)).rejects.toThrow("fresh");
      const review = await measured(
        "execution:review",
        () => runner.review(run.id, command.id),
        metrics.record,
      );
      await measured(
        "execution:start",
        () => runner.execute(review.token, true),
        metrics.record,
      );
      await vi.waitFor(
        () =>
          expect(store.getRun(run.id).executions?.at(-1)?.status).toBe(
            "exited",
          ),
        { timeout: 5000, interval: 20 },
      );
      const result = store.getRun(run.id).executions!.at(-1)!;
      expect(result.revision).toBe(command.revision);
      expect(result.commandId).toBe(command.id);
      return result;
    }
    try {
      const task = store.createTask({
        title: "Add numbers",
        description: "Export addition, including negative and zero inputs",
        mode: "work",
      });
      const team = store.load().teammates;
      const prepared = manager.prepare(task.id, null, []);
      const baselineRoot = join(root, "baseline");
      const parent = await executeLoop(
        prepared,
        task,
        team,
        fixture((request) => {
          if (request.name === "audit_files")
            return { summary: "Inspect arithmetic", findings: [] };
          const tester = request.system.includes("the test engineer");
          return {
            summary: tester ? "Requirement assertions" : "Implementation",
            files: tester
              ? [{ path: "check.test.cjs", content: oracle }]
              : [{ path: "calc.cjs", content: broken }],
            commands: [],
          };
        }),
        baselineRoot,
        save,
      );
      expect(parent.status).toBe("complete");
      // Use the actual test-owned filename in all command proposals.
      const command = { ...check, args: ["check.test.cjs"] };
      const finding = {
        path: "calc.cjs",
        severity: "error" as const,
        detail: "Subtraction does not satisfy addition",
      };
      parent.specialistAudits = [
        {
          kind: "testing",
          revision: parent.coordination!.integratedRevision,
          status: "reviewing",
          calls: 0,
          summary: "",
          findings: [],
          response: "",
        },
      ];
      const audited = await executeSpecialist(
        parent,
        task,
        fixture((request) =>
          request.name === "specialist_audit"
            ? { summary: "Arithmetic mismatch", findings: [finding] }
            : {
                response: "Run the unchanged requirement assertions",
                checks: [
                  {
                    findingIndex: 0,
                    expected: "All addition assertions should pass",
                    criterion: { exitCode: 0 },
                    command,
                  },
                ],
              },
        ),
        save,
      );
      save(audited);
      const beforeCheck = await execute(audited);
      expect(beforeCheck.exitCode).not.toBe(0);
      expect(beforeCheck.output).toContain("AssertionError");
      expect(
        assessLocalCriterion(audited.commands!.at(-1)!, beforeCheck).status,
      ).toBe("not_met");
      const parentRecord = JSON.stringify(store.getRun(parent.id));
      const child = await measured(
        "correction:prepare",
        () =>
          manager.prepareCorrection(
            parent.id,
            0,
            0,
            parent.coordination!.integratedRevision,
            findingKey(finding),
          ),
        metrics.record,
      );
      expect(child.commands).toBeUndefined();
      expect(child.executions).toBeUndefined();
      expect(child.findingDecisions).toBeUndefined();
      expect(child.correction?.recheck).toMatchObject({
        parentRunId: parent.id,
        parentCommandId: audited.commands!.at(-1)!.id,
        parentExecutionId: beforeCheck.id,
        testPath: "check.test.cjs",
        criterion: { exitCode: 0 },
      });
      await expect(
        measured(
          "run:start",
          () => manager.start(child.id, false),
          metrics.record,
        ),
      ).rejects.toThrow("approval");
      // Inject approved fixture responses directly into the engine, never a live worker.
      const afterRoot = join(root, "correction");
      const corrected = await executeLoop(
        child,
        task,
        team,
        fixture((request) => {
          if (request.name === "propose_files") {
            expect(request.input).not.toContain(beforeCheck.id);
            return {
              summary: "Proposed arithmetic correction",
              files: [
                {
                  path: "calc.cjs",
                  content: validFix
                    ? "module.exports = (a, b) => a + b;"
                    : "module.exports = (a, b) => a - b + 0;",
                },
              ],
              commands: [command],
            };
          }
          return {
            summary: "Fixture reviewer reported no findings",
            findings: [],
          };
        }),
        afterRoot,
        save,
      );
      save(corrected);
      expect(corrected.calls).toBe(2);
      expect(corrected.status).toBe("complete");
      expect(corrected.commands).toHaveLength(1);
      expect(corrected.commands![0].recheckOf).toMatchObject({
        parentCommandId: audited.commands!.at(-1)!.id,
        parentExecutionId: beforeCheck.id,
      });
      expect(corrected.commands![0].decision).toBe("pending");
      expect(
        compareCorrection(store.getRun(parent.id), corrected),
      ).toMatchObject({
        status: "awaiting_execution",
        baseline: { status: "not_met" },
      });
      const alteredTest = structuredClone(corrected);
      alteredTest.drafts.find(
        (file) => file.path === "check.test.cjs",
      )!.content = "console.log('no assertions');";
      expect(
        compareCorrection(store.getRun(parent.id), alteredTest).status,
      ).toBe("unavailable");
      const alteredLineage = structuredClone(corrected);
      alteredLineage.commands![0].recheckOf!.parentExecutionId = "other";
      expect(
        compareCorrection(store.getRun(parent.id), alteredLineage).status,
      ).toBe("unavailable");
      expect(await readFile(join(afterRoot, "check.test.cjs"), "utf8")).toBe(
        oracle,
      );
      expect(await readFile(join(baselineRoot, "calc.cjs"), "utf8")).toBe(
        broken,
      );
      const afterCheck = await execute(corrected);
      expect(
        compareCorrection(store.getRun(parent.id), store.getRun(child.id)),
      ).toMatchObject({
        status: "compared",
        baseline: { status: "not_met" },
        candidate: { status: validFix ? "met" : "not_met" },
      });
      const incomplete = structuredClone(store.getRun(child.id));
      incomplete.executions![0].status = "running";
      expect(
        compareCorrection(store.getRun(parent.id), incomplete),
      ).toMatchObject({
        status: "unavailable",
        candidate: { status: "unavailable" },
      });
      const foreignResult = structuredClone(store.getRun(child.id));
      foreignResult.executions![0].runId = "foreign-run";
      expect(
        compareCorrection(store.getRun(parent.id), foreignResult).status,
      ).toBe("unavailable");
      expect(afterCheck.revision).not.toBe(beforeCheck.revision);
      if (validFix) {
        expect(afterCheck.exitCode).toBe(0);
        expect(afterCheck.output).toContain("addition assertions passed");
      } else {
        expect(afterCheck.exitCode).not.toBe(0);
        expect(afterCheck.output).toContain("AssertionError");
      }
      expect(JSON.stringify(store.getRun(parent.id))).toBe(parentRecord);
      expect(store.getRun(parent.id).specialistAudits![0].status).toBe(
        "needs-review",
      );
      expect(store.getRun(child.id).applications).toBeUndefined();
      const decision = {
        auditIndex: 0,
        findingIndex: 0,
        revision: parent.coordination!.integratedRevision,
        findingKey: findingKey(finding),
        previousCount: 0,
        decision: "resolved" as const,
        reason: "Reviewed the unchanged assertions and the corrective result",
        evidenceIds: [afterCheck.id],
      };
      if (validFix) {
        const updated = manager.decideFinding(parent.id, decision);
        expect(updated.findingDecisions?.at(-1)).toMatchObject({
          decision: "resolved",
          evidenceIds: [afterCheck.id],
        });
      } else {
        expect(() => manager.decideFinding(parent.id, decision)).toThrow(
          "stale",
        );
        expect(store.getRun(parent.id).findingDecisions).toBeUndefined();
      }
      expect(requests).toBe(7);
      const events = metrics.snapshot().events;
      expect(
        events.filter((e) => e.operation === "model.request"),
      ).toHaveLength(7);
      expect(
        events.filter(
          (e) => e.operation === "execution:start" && e.outcome === "threw",
        ),
      ).toHaveLength(2);
      expect(
        events.filter(
          (e) => e.operation === "execution:start" && e.outcome === "returned",
        ),
      ).toHaveLength(2);
      expect(
        events.filter((e) => e.operation === "correction:prepare"),
      ).toHaveLength(1);
      for (const secret of [
        root,
        task.title,
        broken,
        oracle,
        finding.detail,
        parent.id,
      ])
        expect(JSON.stringify(events)).not.toContain(secret);
    } finally {
      runner.close();
      manager.close();
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
