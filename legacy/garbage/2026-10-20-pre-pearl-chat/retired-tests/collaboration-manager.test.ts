// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { CollaborationManager } from "../src/main/collaboration-manager";
import { Store } from "../src/main/store";
import { bindProjectWorkspace } from "../src/main/project-workspace";
import { lineupPlanRevision } from "../src/engine/revision";
import {
  changeBranchFile,
  integrateCollaboration,
} from "../src/shared/collaboration";
import type { Run } from "../src/shared/runs";
import {
  initialPlanningState,
  type WorkAssignment,
} from "../src/shared/planning-state";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function setup(
  model: (
    actor: string,
    context: any,
    request?: import("../src/engine/provider").Completion,
  ) => object | Promise<object>,
) {
  const root = mkdtempSync(join(tmpdir(), "scully-collab-"));
  roots.push(root);
  const project = join(root, "project");
  const privateRoot = join(root, "private");
  const fs = require("node:fs") as typeof import("node:fs");
  fs.mkdirSync(project);
  fs.mkdirSync(privateRoot);
  writeFileSync(join(project, "app.ts"), "base");
  const store = new Store(join(privateRoot, "workspace.sqlite"));
  const task = store.createTask({
    title: "Build",
    description: "Add an interface and tests",
    mode: "work",
  });
  const run: Run = {
    id: "collab-run",
    taskId: task.id,
    taskSnapshot: task,
    teamSnapshot: store.teamForTask(task.id),
    sourceName: "project",
    workspaceMode: "direct",
    projectWorkspace: bindProjectWorkspace(project, "existing", privateRoot),
    files: [{ path: "app.ts", content: "base" }],
    status: "prepared",
    events: [],
    plan: "",
    drafts: [],
    findings: [],
    checks: [],
    error: "",
    calls: 0,
    model: "fixture",
    outputTokens: 1024,
  };
  store.saveRun(run);
  const calls: string[] = [];
  const manager = new CollaborationManager(
    store,
    () => {},
    privateRoot,
    () => ({ key: "fixture-key", model: "fixture", outputTokens: 1024 }),
    () => null,
    () => ({
      complete: async (request) => {
        calls.push(request.actor || "");
        request.onUsage?.({ inputTokens: 100, outputTokens: 50 });
        return model(request.actor || "", JSON.parse(request.input), request);
      },
    }),
  );
  return { root, project, privateRoot, store, task, run, manager, calls };
}
async function until(condition: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for collaboration fixture");
}
function planned(
  fixture: ReturnType<typeof setup>,
  assignments: WorkAssignment[],
) {
  const run = fixture.store.getRun(fixture.run.id);
  const planning = initialPlanningState();
  run.plan = "Build an interface with two features and test both";
  const revision = lineupPlanRevision(run, fixture.task);
  planning.planReview = { revision, approvedAt: new Date().toISOString() };
  planning.proposal = {
    planRevision: revision,
    assignments,
    rationale: "Distinct work from task evidence",
  };
  planning.approved = {
    planRevision: revision,
    assignments,
    approvedAt: new Date().toISOString(),
  };
  run.planning = planning;
  run.status = "planned";
  fixture.store.saveRun(run);
}
function assignment(
  memberId: string,
  role: WorkAssignment["role"],
  objective: string,
  dependsOn: string[] = [],
): WorkAssignment {
  return {
    memberId,
    role,
    objective,
    evidence: "Task asks for independent work and verification",
    permissions:
      role === "auditor"
        ? ["read", "audit"]
        : role === "specialist"
          ? ["read"]
          : ["read", "edit", "check"],
    dependsOn,
    environment: {
      tools: [],
      reason: "No project executable needed for this fixture",
      checks: [],
    },
  };
}
it("runs multiple approved builders, testers and auditors without substituting the starter lineup", async () => {
  const steps = new Map<string, number>();
  const fixture = setup((actor, context) => {
    const step = steps.get(actor) || 0;
    steps.set(actor, step + 1);
    if (["maya", "tessa", "jun", "malik"].includes(actor))
      return step === 0
        ? {
            action: "write",
            path:
              actor === "jun" || actor === "malik"
                ? `tests/${actor}.test.ts`
                : `src/${actor}.ts`,
            content: `export const ${actor} = true;`,
          }
        : {
            action: "finish",
            text: `${actor} published a distinct checkpoint.`,
          };
    if (["ellis", "meryl"].includes(actor))
      return {
        action: "audit",
        checkpointId: context.integration.headId,
        text: `${actor} reviewed the integrated revision.`,
      };
    return { action: "finish", text: "Coordinating current assignments." };
  });
  planned(fixture, [
    assignment("maya", "builder", "Implement one feature"),
    assignment("tessa", "builder", "Implement another feature"),
    assignment("jun", "tester", "Test the first feature"),
    assignment("malik", "tester", "Test the second feature"),
    assignment("ellis", "auditor", "Review data and behavior"),
    assignment("meryl", "auditor", "Review recovery and handoff"),
  ]);
  try {
    const review = fixture.manager.review(fixture.run.id, { mode: "local" });
    expect(review.members.map((item) => item.id)).toEqual([
      "pearl",
      "maya",
      "tessa",
      "jun",
      "malik",
      "ellis",
      "meryl",
    ]);
    fixture.manager.approve(review.token, true);
    await until(
      () => !!fixture.store.getRun(fixture.run.id).collaboration?.auditedHeadId,
    );
    const state = fixture.store.getRun(fixture.run.id).collaboration!;
    expect(state.audits?.map((item) => item.actor).sort()).toEqual([
      "ellis",
      "meryl",
    ]);
    expect(state.integration.conflicts).toEqual([]);
    expect(
      state.checkpoints.filter((item) => item.sourceRevision === state.baseId),
    ).toHaveLength(7);
    const sync = fixture.manager.reviewSync(fixture.run.id);
    expect(sync.files).toEqual(
      expect.arrayContaining([
        "src/maya.ts",
        "src/tessa.ts",
        "tests/jun.test.ts",
        "tests/malik.test.ts",
      ]),
    );
  } finally {
    await fixture.manager.whenIdle();
    fixture.store.close();
  }
});
it("routes a teammate's evidence-backed staffing request through Pearl and one-use user approval", async () => {
  let mayaCalls = 0;
  const fixture = setup((actor, context) => {
    if (actor === "maya") {
      mayaCalls++;
      return mayaCalls === 1
        ? {
            action: "request_help",
            text: "Review the authentication boundary",
            evidence: "The implementation reads account credentials.",
          }
        : { action: "finish", text: "Implementation checkpoint ready." };
    }
    if (actor === "pearl") {
      const request = context.staffingRequests?.find(
        (item: any) => item.status === "open",
      );
      if (request)
        return {
          action: "propose_teammate",
          requestId: request.id,
          text: "Kiran should examine the credential boundary Maya observed.",
          assignment: assignment(
            "kiran",
            "specialist",
            "Review credential handling",
          ),
        };
    }
    if (actor === "ellis")
      return {
        action: "audit",
        checkpointId: context.integration.headId,
        text: "Reviewed the integrated work.",
      };
    return { action: "finish", text: "Current work complete." };
  });
  planned(fixture, [
    assignment("maya", "builder", "Build the account interface"),
    assignment("ellis", "auditor", "Review the credential boundary", ["maya"]),
  ]);
  try {
    const review = fixture.manager.review(fixture.run.id, { mode: "local" });
    fixture.manager.approve(review.token, true);
    await until(
      () =>
        fixture.store.getRun(fixture.run.id).collaboration
          ?.dispatchProposals?.[0]?.status === "pending",
    );
    const proposal = fixture.store.getRun(fixture.run.id).collaboration!
      .dispatchProposals![0];
    expect(proposal.assignment.memberId).toBe("kiran");
    const dispatch = await fixture.manager.reviewDispatchProposal(
      fixture.run.id,
      proposal.id,
    );
    expect(dispatch.mode).toBe("local");
    fixture.manager.approveDispatch(dispatch.token, true);
    expect(() =>
      fixture.manager.approveDispatch(dispatch.token, true),
    ).toThrow();
    await until(
      () =>
        fixture.store
          .getRun(fixture.run.id)
          .collaboration?.members.find((item) => item.id === "kiran")
          ?.status === "finished",
    );
    const state = fixture.store.getRun(fixture.run.id).collaboration!;
    expect(state.staffingRequests?.[0].status).toBe("resolved");
    expect(state.dispatchProposals?.[0].status).toBe("approved");
  } finally {
    await fixture.manager.whenIdle();
    fixture.store.close();
  }
});
it("returns a rejected tool action to its teammate for repair, then keeps the valid checkpoint", async () => {
  let mayaCalls = 0;
  const fixture = setup((actor) => {
    if (actor === "maya") {
      mayaCalls++;
      if (mayaCalls === 1) return { action: "read", path: "missing.ts" };
      if (mayaCalls === 2)
        return {
          action: "write",
          path: "src/repaired.ts",
          content: "export const ready = true;",
        };
      return { action: "finish", text: "The branch is ready." };
    }
    return { action: "finish" };
  });
  planned(fixture, [assignment("maya", "builder", "Build feature")]);
  try {
    const review = fixture.manager.review(fixture.run.id, { mode: "local" });
    fixture.manager.approve(review.token, true);
    await until(
      () =>
        fixture.store
          .getRun(fixture.run.id)
          .collaboration?.members.find((item) => item.id === "maya")?.status ===
        "finished",
    );
    const state = fixture.store.getRun(fixture.run.id).collaboration!;
    expect(mayaCalls).toBe(3);
    expect(
      state.members
        .find((item) => item.id === "maya")
        ?.thread.some(
          (entry) =>
            entry.role === "tool" &&
            entry.text.includes("File is not in this branch"),
        ),
    ).toBe(true);
    expect(
      state.checkpoints.some((item) =>
        item.files.some((file) => file.path === "src/repaired.ts"),
      ),
    ).toBe(true);
  } finally {
    await fixture.manager.whenIdle();
    fixture.store.close();
  }
});
it("pauses a teammate after three invalid tool actions without losing the base checkpoint", async () => {
  let mayaCalls = 0;
  const fixture = setup((actor) => {
    if (actor === "maya") {
      mayaCalls++;
      return { action: "read", path: `missing-${mayaCalls}.ts` };
    }
    return { action: "finish" };
  });
  planned(fixture, [assignment("maya", "builder", "Build feature")]);
  try {
    const review = fixture.manager.review(fixture.run.id, { mode: "local" });
    fixture.manager.approve(review.token, true);
    await until(
      () =>
        fixture.store
          .getRun(fixture.run.id)
          .collaboration?.members.find((item) => item.id === "maya")?.status ===
        "paused",
    );
    const state = fixture.store.getRun(fixture.run.id).collaboration!;
    expect(mayaCalls).toBe(3);
    const head = state.checkpoints.find(
      (item) =>
        item.id ===
        state.members.find((person) => person.id === "maya")?.headId,
    )!;
    expect(head.sourceRevision).toBe(state.baseId);
    expect(head.files).toEqual(
      state.checkpoints.find((item) => item.id === state.baseId)?.files,
    );
    expect(state.events.some((item) => item.code === "invalid_tool")).toBe(
      true,
    );
  } finally {
    await fixture.manager.whenIdle();
    fixture.store.close();
  }
});
it("enforces an optional collaborative request cap at the storage boundary", () => {
  const fixture = setup(() => ({ action: "finish" }));
  try {
    const run = fixture.store.getRun(fixture.run.id);
    run.planning = initialPlanningState();
    run.usagePolicy = {
      preset: "custom",
      model: "fixture",
      outputTokens: 8192,
      requestCeiling: 1,
      earlyReviews: false,
    };
    fixture.store.saveRun(run);
    expect(
      fixture.store.reserveUsage(run.id, {
        id: "11111111-1111-4111-8111-111111111111",
        stage: "collaborate",
        actor: "maya",
        model: "fixture",
        maxOutputTokens: 512,
      }),
    ).toBe("allowed");
    expect(
      fixture.store.reserveUsage(run.id, {
        id: "22222222-2222-4222-8222-222222222222",
        stage: "collaborate",
        actor: "jun",
        model: "fixture",
        maxOutputTokens: 512,
      }),
    ).toBe("paused");
    expect(fixture.store.usageForRun(run.id).requests).toBe(1);
  } finally {
    fixture.store.close();
  }
});
it("pauses only an unmatched teammate and binds local fallback to a one-use review", async () => {
  const steps = new Map<string, number>();
  const fixture = setup((actor, context) => {
    const step = steps.get(actor) || 0;
    steps.set(actor, step + 1);
    if (actor === "maya" || actor === "jun")
      return step === 0
        ? {
            action: "write",
            path: actor === "maya" ? "src/feature.ts" : "tests/feature.test.ts",
            content: `export const ${actor} = true;`,
          }
        : { action: "finish", text: "Branch ready." };
    if (actor === "ellis")
      return {
        action: "audit",
        checkpointId: context.integration.headId,
        text: "Reviewed the integrated work.",
      };
    return { action: "finish" };
  });
  planned(fixture, [
    assignment("maya", "builder", "Build feature"),
    assignment("jun", "tester", "Test feature"),
    assignment("ellis", "auditor", "Review result"),
  ]);
  const manager = fixture.manager as any;
  manager.cloudConfig = () => ({ projectId: "test-project", key: "fixture" });
  manager.workspaceFactory = (mode: string) => ({
    prepare: async () => (mode === "sandbox" ? "sandbox-image" : null),
    write: async () => (mode === "sandbox" ? "sandbox-next" : null),
    read: async (_image: unknown, _path: unknown, content: string) => content,
    check: async () => ({
      passed: true,
      unknown: false,
      exitCode: 0,
      stdout: "",
      stderr: "",
    }),
    reconcile: async () => ({ status: "failed", resultImageId: null }),
  });
  try {
    const run = fixture.store.getRun(fixture.run.id);
    const environmentToken = "inspected-environments";
    manager.environmentRecommendations.set(environmentToken, {
      token: environmentToken,
      runId: run.id,
      expiresAt: Date.now() + 60_000,
      fingerprint: manager.recommendationFingerprint(run, "test-project"),
      selections: [
        {
          memberId: "maya",
          imageId: "sandbox-image",
          imageTag: "typescript",
          tools: [],
          reason: "Verified",
        },
        {
          memberId: "jun",
          imageId: null,
          imageTag: null,
          tools: [],
          reason: "No compatible image",
        },
        {
          memberId: "ellis",
          imageId: "sandbox-image",
          imageTag: "typescript",
          tools: [],
          reason: "Verified",
        },
      ],
      catalogLimited: false,
    });
    const review = fixture.manager.review(run.id, {
      mode: "sandbox",
      environmentToken,
    });
    fixture.manager.approve(review.token, true);
    await until(() => {
      const state = fixture.store.getRun(run.id).collaboration!;
      return (
        state.members.find((item) => item.id === "maya")?.status ===
          "finished" &&
        state.members.find((item) => item.id === "jun")?.status ===
          "waiting_user"
      );
    });
    expect(fixture.calls).not.toContain("jun");
    const denied = fixture.manager.reviewLocalFallback(run.id, "jun");
    fixture.manager.approveLocalFallback(denied.token, false);
    await expect(
      fixture.manager.approveLocalFallback(denied.token, true),
    ).rejects.toThrow();
    expect(
      fixture.store
        .getRun(run.id)
        .collaboration!.members.find((item) => item.id === "jun")?.status,
    ).toBe("waiting_user");
    const allowed = fixture.manager.reviewLocalFallback(run.id, "jun");
    await fixture.manager.approveLocalFallback(allowed.token, true);
    await until(
      () => !!fixture.store.getRun(run.id).collaboration?.auditedHeadId,
    );
    expect(fixture.calls).toContain("jun");
    expect(
      fixture.store.getRun(run.id).collaboration!.scope.memberEnvironments?.jun
        .localApproved,
    ).toBe(true);
  } finally {
    await fixture.manager.whenIdle();
    fixture.store.close();
  }
});
it("runs local-only teammates through tool results, integration, audit and selected-folder synchronization", async () => {
  const steps = new Map<string, number>();
  const fixture = setup((actor, context) => {
    const step = steps.get(actor) || 0;
    steps.set(actor, step + 1);
    if (actor === "maya")
      return step === 0
        ? {
            action: "write",
            path: "src/interface.ts",
            content: "export const answer = 42;",
          }
        : { action: "finish", text: "Interface checkpoint is ready." };
    if (actor === "jun")
      return step === 0
        ? {
            action: "write",
            path: "tests/interface.test.ts",
            content: "test('answer', () => {});",
          }
        : { action: "finish", text: "Test checkpoint is ready." };
    if (actor === "ellis")
      return step === 0
        ? { action: "read", path: "src/interface.ts" }
        : {
            action: "audit",
            checkpointId: context.integration.headId,
            text: "Reviewed the integrated revision; the test result remains unverified.",
          };
    return { action: "finish", text: "I am tracking the team." };
  });
  try {
    const review = fixture.manager.review(fixture.run.id, { mode: "local" });
    expect(review.manifest).toHaveLength(1);
    expect(fixture.calls).toEqual([]);
    fixture.manager.approve(review.token, true);
    expect(() => fixture.manager.approve(review.token, true)).toThrow();
    await until(
      () => !!fixture.store.getRun(fixture.run.id).collaboration?.auditedHeadId,
    ).catch(() => {
      throw new Error(
        JSON.stringify(fixture.store.getRun(fixture.run.id).collaboration),
      );
    });
    const state = fixture.store.getRun(fixture.run.id).collaboration!;
    expect(state.scope.mode).toBe("local");
    expect(state.checkpoints.some((item) => item.actor === "maya")).toBe(true);
    expect(state.checkpoints.some((item) => item.actor === "jun")).toBe(true);
    expect(state.integration.conflicts).toEqual([]);
    expect(
      state.events.some(
        (event) => event.actor === "ellis" && event.kind === "message",
      ),
    ).toBe(true);
    const sync = fixture.manager.reviewSync(fixture.run.id);
    expect(sync.files).toEqual(
      expect.arrayContaining(["src/interface.ts", "tests/interface.test.ts"]),
    );
    fixture.manager.approveSync(sync.token, true);
    expect(
      readFileSync(join(fixture.project, "src/interface.ts"), "utf8"),
    ).toBe("export const answer = 42;");
    expect(fixture.store.getRun(fixture.run.id).collaboration?.status).toBe(
      "complete",
    );
  } finally {
    await fixture.manager.whenIdle();
    fixture.store.close();
  }
});

it("keeps peer questions, a mid-task specialist and both branches in one collaborative workflow", async () => {
  const steps = new Map<string, number>();
  let fixture: ReturnType<typeof setup>;
  fixture = setup(async (actor, context) => {
    const step = steps.get(actor) || 0;
    steps.set(actor, step + 1);
    if (actor === "maya") {
      if (step === 0)
        return {
          action: "write",
          path: "src/interface.ts",
          content: "export const answer = 42;",
        };
      if (step === 1)
        return { action: "checkpoint", text: "Interface available to Jun." };
      if (step === 2)
        return {
          action: "question",
          recipient: "jun",
          text: "Does this interface support your test?",
        };
      return { action: "finish", text: "I incorporated Jun's answer." };
    }
    if (actor === "jun") {
      if (step === 0)
        return {
          action: "write",
          path: "tests/interface.test.ts",
          content: "test('answer', () => {});",
        };
      if (step === 1)
        return { action: "read", path: "tests/interface.test.ts" };
      if (step === 2) {
        await until(() => {
          const state = fixture.store.getRun(fixture.run.id).collaboration!;
          return (
            state.members.find((item) => item.id === "maya")!.headId !==
            state.baseId
          );
        });
        const state = fixture.store.getRun(fixture.run.id).collaboration!;
        return {
          action: "inspect_peer",
          checkpointId: state.members.find((item) => item.id === "maya")!
            .headId,
          path: "src/interface.ts",
        };
      }
      if (step === 3) {
        await until(() =>
          fixture.store
            .getRun(fixture.run.id)
            .collaboration!.events.some(
              (item) => item.actor === "sloane" && item.kind === "message",
            ),
        );
        const question = fixture.store
          .getRun(fixture.run.id)
          .collaboration!.questions.find(
            (item) => item.owner === "maya" && item.recipient === "jun",
          )!;
        return {
          action: "message",
          recipient: "maya",
          questionId: question.id,
          text: "Yes. I inspected the interface and my test references it.",
        };
      }
      return { action: "finish", text: "Test branch ready for integration." };
    }
    if (actor === "sloane") {
      if (step === 0) return { action: "read", path: "src/interface.ts" };
      if (step === 1)
        return {
          action: "message",
          recipient: "jun",
          text: "The interface checkpoint has the expected export.",
        };
      return { action: "finish", text: "Review shared with Jun." };
    }
    if (actor === "ellis")
      return {
        action: "audit",
        checkpointId: context.integration.headId,
        text: "Reviewed the exact integrated checkpoint.",
      };
    return { action: "finish" };
  });
  try {
    fixture.manager.approve(
      fixture.manager.review(fixture.run.id, { mode: "local" }).token,
      true,
    );
    await until(() =>
      fixture.store
        .getRun(fixture.run.id)
        .collaboration!.questions.some(
          (item) => item.owner === "maya" && item.status === "pending",
        ),
    );
    const state = fixture.store.getRun(fixture.run.id).collaboration!;
    const mayaHead = state.members.find((item) => item.id === "maya")!.headId;
    const specialist = fixture.manager.reviewDispatch(
      fixture.run.id,
      "sloane",
      ["read", "audit"],
      mayaHead,
    );
    fixture.manager.approveDispatch(specialist.token, true);
    await until(
      () => !!fixture.store.getRun(fixture.run.id).collaboration?.auditedHeadId,
    );
    const finished = fixture.store.getRun(fixture.run.id).collaboration!;
    expect(
      finished.questions.find((item) => item.owner === "maya")?.status,
    ).toBe("answered");
    expect(finished.members.find((item) => item.id === "sloane")?.headId).toBe(
      mayaHead,
    );
    expect(
      finished.events.some(
        (item) => item.actor === "sloane" && item.recipient === "jun",
      ),
    ).toBe(true);
    expect(
      finished.events.some(
        (item) =>
          item.actor === "jun" && item.recipient === "maya" && item.questionId,
      ),
    ).toBe(true);
    expect(finished.integration.conflicts).toEqual([]);
    fixture.manager.approveSync(
      fixture.manager.reviewSync(fixture.run.id).token,
      true,
    );
    expect(
      readFileSync(join(fixture.project, "src/interface.ts"), "utf8"),
    ).toBe("export const answer = 42;");
    expect(
      readFileSync(join(fixture.project, "tests/interface.test.ts"), "utf8"),
    ).toContain("answer");
  } finally {
    await fixture.manager.whenIdle();
    fixture.store.close();
  }
});

it("keeps local edits and requires a fresh review when synchronization preflight fails", async () => {
  const steps = new Map<string, number>();
  const fixture = setup((actor, context) => {
    const step = steps.get(actor) || 0;
    steps.set(actor, step + 1);
    if (actor === "maya")
      return step === 0
        ? { action: "write", path: "app.ts", content: "team change" }
        : { action: "finish" };
    if (actor === "ellis")
      return {
        action: "audit",
        checkpointId: context.integration.headId,
        text: "Reviewed.",
      };
    return { action: "finish" };
  });
  try {
    fixture.manager.approve(
      fixture.manager.review(fixture.run.id, { mode: "local" }).token,
      true,
    );
    await until(
      () => !!fixture.store.getRun(fixture.run.id).collaboration?.auditedHeadId,
    ).catch(() => {
      throw new Error(
        JSON.stringify(fixture.store.getRun(fixture.run.id).collaboration),
      );
    });
    const sync = fixture.manager.reviewSync(fixture.run.id);
    writeFileSync(join(fixture.project, "app.ts"), "user edit");
    expect(() => fixture.manager.approveSync(sync.token, true)).toThrow(
      /changed|baseline/i,
    );
    expect(readFileSync(join(fixture.project, "app.ts"), "utf8")).toBe(
      "user edit",
    );
    expect(
      fixture.store.getRun(fixture.run.id).collaboration?.synchronizedHeadId,
    ).toBeNull();
  } finally {
    await fixture.manager.whenIdle();
    fixture.store.close();
  }
});

it("synchronizes a revised branch after an earlier integration without overwriting local edits", async () => {
  const steps = new Map<string, number>();
  const fixture = setup((actor, context) => {
    const step = steps.get(actor) || 0;
    steps.set(actor, step + 1);
    return actor === "maya"
      ? step === 0
        ? { action: "write", path: "app.ts", content: "first revision" }
        : { action: "finish" }
      : actor === "ellis"
        ? {
            action: "audit",
            checkpointId: context.integration.headId,
            text: "Reviewed the first integration.",
          }
        : { action: "finish" };
  });
  try {
    fixture.manager.approve(
      fixture.manager.review(fixture.run.id, { mode: "local" }).token,
      true,
    );
    await until(
      () => !!fixture.store.getRun(fixture.run.id).collaboration?.auditedHeadId,
    );
    fixture.manager.approveSync(
      fixture.manager.reviewSync(fixture.run.id).token,
      true,
    );
    let run = fixture.store.getRun(fixture.run.id);
    const state = run.collaboration!;
    const maya = state.members.find((item) => item.id === "maya")!;
    changeBranchFile(state, "maya", maya.headId, "app.ts", "second revision");
    const integrated = integrateCollaboration(state, "maya");
    expect(integrated.conflicts).toEqual([]);
    state.auditedHeadId = integrated.headId;
    fixture.store.saveRun(run);
    const second = fixture.manager.reviewSync(fixture.run.id);
    fixture.manager.approveSync(second.token, true);
    expect(readFileSync(join(fixture.project, "app.ts"), "utf8")).toBe(
      "second revision",
    );
    run = fixture.store.getRun(fixture.run.id);
    expect(run.collaboration?.synchronizedHeadId).toBe(integrated.headId);
  } finally {
    await fixture.manager.whenIdle();
    fixture.store.close();
  }
});

it("preserves an interrupted thread and checkpoint on restart", async () => {
  const fixture = setup(() => ({ action: "finish" }));
  try {
    fixture.manager.approve(
      fixture.manager.review(fixture.run.id, { mode: "local" }).token,
      true,
    );
    await until(
      () =>
        fixture.store
          .getRun(fixture.run.id)
          .collaboration?.members.every((item) => item.status !== "running") ||
        false,
    );
    const run = fixture.store.getRun(fixture.run.id);
    run.collaboration!.members[0].status = "running";
    fixture.store.saveRun(run);
    fixture.manager.recover();
    const recovered = fixture.store.getRun(fixture.run.id).collaboration!;
    expect(recovered.members[0].status).toBe("paused");
    expect(recovered.checkpoints[0].id).toBe(recovered.baseId);
    expect(recovered.events.at(-1)?.code).toBe("interrupted");
  } finally {
    await fixture.manager.whenIdle();
    fixture.store.close();
  }
});

it("rejects a changed approved upload and a tester edit outside test files", async () => {
  const fixture = setup((actor) =>
    actor === "jun"
      ? { action: "write", path: "app.ts", content: "unauthorized" }
      : { action: "finish" },
  );
  try {
    const first = fixture.manager.review(fixture.run.id, { mode: "local" });
    writeFileSync(join(fixture.project, "app.ts"), "changed after review");
    expect(() => fixture.manager.approve(first.token, true)).toThrow(
      /baseline changed/i,
    );
    writeFileSync(join(fixture.project, "app.ts"), "base");
    const second = fixture.manager.review(fixture.run.id, { mode: "local" });
    fixture.manager.approve(second.token, true);
    await until(
      () =>
        fixture.store
          .getRun(fixture.run.id)
          .collaboration?.members.find((item) => item.id === "jun")?.status ===
        "paused",
    );
    const state = fixture.store.getRun(fixture.run.id).collaboration!;
    expect(
      state.events.some(
        (event) => event.actor === "jun" && event.code === "permission_denied",
      ),
    ).toBe(true);
    expect(
      state.checkpoints.some(
        (point) =>
          point.actor === "jun" &&
          point.files.some((file) => file.content === "unauthorized"),
      ),
    ).toBe(false);
  } finally {
    await fixture.manager.whenIdle();
    fixture.store.close();
  }
});

it("lets a coordinator correct one denied edit without granting write authority", async () => {
  let pearlCalls = 0;
  const fixture = setup((actor) => {
    if (actor === "pearl")
      return ++pearlCalls === 1
        ? { action: "write", path: "app.ts", content: "unauthorized" }
        : { action: "finish", text: "The approved team can continue." };
    return { action: "finish", text: "My assignment is complete." };
  });
  planned(fixture, [
    assignment("maya", "builder", "Handle the requested edit"),
    assignment("ellis", "auditor", "Review the result", ["maya"]),
  ]);
  try {
    fixture.manager.approve(
      fixture.manager.review(fixture.run.id, { mode: "local" }).token,
      true,
    );
    await until(
      () =>
        fixture.store
          .getRun(fixture.run.id)
          .collaboration?.members.find((item) => item.id === "pearl")
          ?.status === "finished",
    );
    const state = fixture.store.getRun(fixture.run.id).collaboration!;
    expect(pearlCalls).toBe(2);
    expect(
      state.members.find((item) => item.id === "pearl")?.permissions,
    ).toEqual(["read"]);
    expect(
      state.checkpoints.some((point) =>
        point.files.some((file) => file.content === "unauthorized"),
      ),
    ).toBe(false);
  } finally {
    await fixture.manager.whenIdle();
    fixture.store.close();
  }
});

it("requires an auditor to record the integrated revision instead of silently finishing", async () => {
  let auditCalls = 0;
  const fixture = setup((actor, context) => {
    if (actor === "ellis")
      return ++auditCalls === 1
        ? { action: "finish", text: "Looks good" }
        : {
            action: "audit",
            checkpointId: context.integration.headId,
            evidence: "Reviewed the exact integrated greeting revision.",
          };
    return { action: "finish", text: "Assignment complete." };
  });
  planned(fixture, [
    assignment("maya", "builder", "Update greeting"),
    assignment("ellis", "auditor", "Review integrated greeting", ["maya"]),
  ]);
  try {
    fixture.manager.approve(
      fixture.manager.review(fixture.run.id, { mode: "local" }).token,
      true,
    );
    await until(
      () => !!fixture.store.getRun(fixture.run.id).collaboration?.auditedHeadId,
    );
    const state = fixture.store.getRun(fixture.run.id).collaboration!;
    expect(auditCalls).toBe(2);
    expect(state.audits).toEqual([
      expect.objectContaining({
        actor: "ellis",
        headId: state.integration.headId,
        text: "Reviewed the exact integrated greeting revision.",
      }),
    ]);
  } finally {
    await fixture.manager.whenIdle();
    fixture.store.close();
  }
});

it("offers model actions according to each teammate's approved permissions", async () => {
  const menus = new Map<string, string[]>();
  const fixture = setup((actor, context, request) => {
    menus.set(actor, (request!.schema as any).properties.action.enum);
    return actor === "ellis"
      ? {
          action: "audit",
          checkpointId: context.integration.headId,
          text: "Reviewed the current integration.",
        }
      : { action: "finish", text: "Assignment complete." };
  });
  planned(fixture, [
    assignment("maya", "builder", "Update greeting"),
    assignment("ellis", "auditor", "Review integrated greeting", ["maya"]),
  ]);
  try {
    fixture.manager.approve(
      fixture.manager.review(fixture.run.id, { mode: "local" }).token,
      true,
    );
    await until(
      () => !!fixture.store.getRun(fixture.run.id).collaboration?.auditedHeadId,
    );
    expect(menus.get("pearl")).not.toContain("write");
    expect(menus.get("pearl")).not.toContain("integrate");
    expect(menus.get("maya")).toContain("write");
    expect(menus.get("maya")).not.toContain("audit");
    expect(menus.get("ellis")).toContain("audit");
    expect(menus.get("ellis")).not.toContain("write");
    expect(menus.get("ellis")).not.toContain("finish");
  } finally {
    await fixture.manager.whenIdle();
    fixture.store.close();
  }
});

it("invalidates scope review when the plan or task details change", async () => {
  const fixture = setup(() => ({ action: "finish" }));
  try {
    const first = fixture.manager.review(fixture.run.id, { mode: "local" });
    const changed = fixture.store.getRun(fixture.run.id);
    changed.plan = "A new plan after review";
    fixture.store.saveRun(changed);
    expect(() => fixture.manager.approve(first.token, true)).toThrow(
      /changed after review/i,
    );
    fixture.store.updateTask(fixture.task.id, {
      title: fixture.task.title,
      description: "Changed project direction",
      mode: fixture.task.mode,
    });
    expect(() =>
      fixture.manager.review(fixture.run.id, { mode: "local" }),
    ).toThrow(/Task details changed/i);
  } finally {
    fixture.store.close();
  }
});

it("brings a reviewed specialist into the current checkpoint without edit authority", async () => {
  const fixture = setup((actor) =>
    actor === "sloane"
      ? { action: "write", path: "app.ts", content: "unapproved" }
      : { action: "finish" },
  );
  try {
    fixture.manager.approve(
      fixture.manager.review(fixture.run.id, { mode: "local" }).token,
      true,
    );
    await until(
      () =>
        fixture.store
          .getRun(fixture.run.id)
          .collaboration?.members.filter((item) => item.role !== "auditor")
          .every((item) => item.status === "finished") || false,
    );
    const before = fixture.store.getRun(fixture.run.id).collaboration!;
    const review = fixture.manager.reviewDispatch(fixture.run.id, "sloane", [
      "read",
      "audit",
    ]);
    expect(review.checkpoint).toBe(before.integration.headId);
    fixture.manager.approveDispatch(review.token, true);
    expect(() => fixture.manager.approveDispatch(review.token, true)).toThrow();
    await until(
      () =>
        fixture.store
          .getRun(fixture.run.id)
          .collaboration?.members.find((item) => item.id === "sloane")
          ?.status === "paused",
    );
    const after = fixture.store.getRun(fixture.run.id).collaboration!;
    expect(after.members.find((item) => item.id === "sloane")?.headId).toBe(
      review.checkpoint,
    );
    expect(
      after.events.some(
        (event) =>
          event.actor === "sloane" && event.code === "permission_denied",
      ),
    ).toBe(true);
  } finally {
    await fixture.manager.whenIdle();
    fixture.store.close();
  }
});
