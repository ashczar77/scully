// @vitest-environment node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { Store } from "../src/main/store";
import { CollaborationManager } from "../src/main/collaboration-manager";
import { bindProjectWorkspace } from "../src/main/project-workspace";
import {
  initialPlanningState,
  type WorkAssignment,
} from "../src/shared/planning-state";
import { nebiusModel } from "../src/engine/provider";
import type { Run } from "../src/shared/runs";

it.skipIf(process.env.SCULLY_LIVE_TEST !== "1")(
  "exercises a bounded live local-only collaborative run",
  async () => {
    const key = process.env.NEBIUS_API_KEY;
    if (!key)
      throw new Error("NEBIUS_API_KEY is required for this manual check");
    const root = mkdtempSync(join(tmpdir(), "scully-live-runtime-"));
    const project = join(root, "project");
    const privateRoot = join(root, "private");
    mkdirSync(project);
    mkdirSync(privateRoot);
    writeFileSync(join(project, "greeting.js"), 'module.exports = "hello";\n');
    const store = new Store(join(privateRoot, "workspace.sqlite"));
    try {
      const task = store.createTask({
        title: "Update greeting",
        description:
          'Update greeting.js so it exports "hello world". Keep this tiny local project. No extra product decisions are needed.',
        mode: "work",
      });
      const assignments: WorkAssignment[] = [
        {
          memberId: "maya",
          role: "builder",
          objective: "Update the greeting export",
          evidence: "The task names greeting.js and the exact target text",
          permissions: ["read", "edit"],
          dependsOn: [],
          environment: {
            tools: [],
            reason: "A text edit needs no executable",
            checks: [],
          },
        },
        {
          memberId: "ellis",
          role: "auditor",
          objective: "Review the greeting change",
          evidence: "The user wants the exact exported text",
          permissions: ["read", "audit"],
          dependsOn: ["maya"],
          environment: {
            tools: [],
            reason: "Review needs no executable",
            checks: [],
          },
        },
      ];
      const planning = initialPlanningState();
      planning.proposal = {
        planRevision: "live-review",
        assignments,
        rationale: "Small file edit and independent review",
      };
      planning.approved = {
        planRevision: "live-review",
        assignments,
        approvedAt: new Date().toISOString(),
      };
      const run: Run = {
        id: "live-collaboration",
        taskId: task.id,
        taskSnapshot: task,
        teamSnapshot: store.teamForTask(task.id),
        sourceName: "project",
        workspaceMode: "direct",
        projectWorkspace: bindProjectWorkspace(
          project,
          "existing",
          privateRoot,
        ),
        files: [
          { path: "greeting.js", content: 'module.exports = "hello";\n' },
        ],
        status: "planned",
        events: [],
        plan: "Edit greeting.js and review the exact export.",
        planning,
        drafts: [],
        findings: [],
        checks: [],
        error: "",
        calls: 0,
        model: "nvidia/Nemotron-3_5-Lightning",
        outputTokens: 8192,
      };
      store.saveRun(run);
      let requests = 0;
      const manager = new CollaborationManager(
        store,
        () => {},
        privateRoot,
        () => ({
          key,
          model: "nvidia/Nemotron-3_5-Lightning",
          outputTokens: 8192,
        }),
        () => null,
        (config) => {
          const provider = nebiusModel(config);
          return {
            complete: async (request) => {
              if (requests >= 14)
                throw new Error("Manual live check request cap reached");
              requests++;
              return provider.complete(request);
            },
          };
        },
      );
      const review = manager.review(run.id, { mode: "local" });
      manager.approve(review.token, true);
      const deadline = Date.now() + 240_000;
      while (Date.now() < deadline) {
        const current = store.getRun(run.id).collaboration;
        if (
          current?.auditedHeadId ||
          current?.members.some((item) => item.status === "paused") ||
          current?.members.every((item) => item.status === "finished")
        )
          break;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      await manager.whenIdle();
      const current = store.getRun(run.id).collaboration!;
      expect(requests).toBeGreaterThan(0);
      expect(requests).toBeLessThanOrEqual(14);
      expect(current.auditedHeadId).toBeTruthy();
      expect(current.status).toBe("review");
      expect(current.audits).toHaveLength(1);
      expect(
        current.checkpoints
          .find((item) => item.id === current.integration.headId)
          ?.files.find((item) => item.path === "greeting.js")?.content,
      ).toContain('module.exports = "hello world";');
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  },
  300_000,
);
