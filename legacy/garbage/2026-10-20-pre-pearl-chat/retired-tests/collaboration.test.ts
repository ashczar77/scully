import { describe, expect, it } from "vitest";
import {
  askCollaborationQuestion,
  attachCheckpointImage,
  changeBranchFile,
  checkpoint,
  createCollaboration,
  dispatchCollaborationMember,
  integrateCollaboration,
  manifestFor,
  member,
  sendCollaborationMessage,
  startMemberBranch,
} from "../src/shared/collaboration";

const now = () => new Date("2026-01-02T03:04:05.000Z");
const files = [{ path: "src/a.ts", content: "base" }];
function state() {
  return createCollaboration(
    "task-1",
    {
      projectPath: "/project",
      projectDev: 1,
      projectIno: 2,
      projectId: "local",
      mode: "local",
      baseImageId: null,
      manifest: manifestFor(files),
      allowedCommands: ["npm"],
      approvedAt: now().toISOString(),
    },
    files,
    [
      {
        id: "maya",
        name: "Maya",
        role: "builder",
        permissions: ["read", "edit", "check"],
        model: "builder",
        thinking: "off",
      },
      {
        id: "jun",
        name: "Jun",
        role: "tester",
        permissions: ["read", "edit", "check"],
        model: "tester",
        thinking: "off",
      },
      {
        id: "ellis",
        name: "Ellis",
        role: "auditor",
        permissions: ["read", "audit"],
        model: "auditor",
        thinking: "off",
      },
    ],
    now,
  );
}
describe("collaborative branch and conversation state", () => {
  it("prepares source-equivalent branches in different teammate environments", () => {
    const work = state();
    const first = startMemberBranch(
      work,
      "maya",
      "11111111-1111-1111-1111-111111111111",
      now,
    );
    const second = startMemberBranch(
      work,
      "jun",
      "22222222-2222-2222-2222-222222222222",
      now,
    );
    expect(first.id).not.toBe(second.id);
    expect(first.sourceRevision).toBe(work.baseId);
    expect(second.sourceRevision).toBe(work.baseId);
    expect(first.files).toEqual(second.files);
    expect(() => startMemberBranch(work, "maya", null, now)).toThrow(
      /already started/,
    );
  });
  it("keeps independent branches and permits repeated peer exchange tied to a checkpoint", () => {
    const work = state();
    const maya = changeBranchFile(
      work,
      "maya",
      work.baseId,
      "src/a.ts",
      "interface",
      now,
    );
    const jun = changeBranchFile(
      work,
      "jun",
      work.baseId,
      "tests/a.test.ts",
      "test",
      now,
    );
    expect(maya.parentId).toBe(work.baseId);
    expect(jun.parentId).toBe(work.baseId);
    expect(checkpoint(work, maya.id).files).not.toContainEqual({
      path: "tests/a.test.ts",
      content: "test",
    });
    const q1 = askCollaborationQuestion(
      work,
      "jun",
      "maya",
      "How should this behave?",
      jun.id,
      now,
    );
    sendCollaborationMessage(
      work,
      "maya",
      "jun",
      "Use the current interface in my checkpoint.",
      maya.id,
      q1.id,
      now,
    );
    const q2 = askCollaborationQuestion(
      work,
      "jun",
      "maya",
      "What about an empty value?",
      jun.id,
      now,
    );
    sendCollaborationMessage(
      work,
      "maya",
      "jun",
      "Reject it explicitly.",
      maya.id,
      q2.id,
      now,
    );
    expect(work.questions.map((question) => question.status)).toEqual([
      "answered",
      "answered",
    ]);
    expect(
      work.events.filter((event) => event.kind === "message"),
    ).toHaveLength(2);
    expect(member(work, "jun").status).toBe("ready");
    const result = integrateCollaboration(work, "maya", now);
    expect(result.conflicts).toEqual([]);
    expect(checkpoint(work, result.headId).files).toHaveLength(2);
  });

  it("requires exact question routing, role permission and current branch revisions", () => {
    const work = state();
    const question = askCollaborationQuestion(
      work,
      "maya",
      "user",
      "Which account flow?",
      work.baseId,
      now,
    );
    expect(() =>
      sendCollaborationMessage(
        work,
        "jun",
        "maya",
        "Not my question",
        work.baseId,
        question.id,
        now,
      ),
    ).toThrow();
    expect(
      work.events.filter((event) => event.kind === "message"),
    ).toHaveLength(0);
    sendCollaborationMessage(
      work,
      "user",
      "maya",
      "Use the existing account flow, with the recovery link.",
      work.baseId,
      question.id,
      now,
    );
    expect(question.status).toBe("answered");
    expect(() =>
      sendCollaborationMessage(
        work,
        "user",
        "maya",
        "Again",
        work.baseId,
        question.id,
        now,
      ),
    ).toThrow();
    expect(() =>
      changeBranchFile(work, "ellis", work.baseId, "src/a.ts", "bad", now),
    ).toThrow(/Permission denied/);
    expect(() =>
      changeBranchFile(work, "maya", "old", "src/a.ts", "bad", now),
    ).toThrow(/stale/);
    expect(() =>
      changeBranchFile(work, "maya", work.baseId, "../outside", "bad", now),
    ).toThrow();
  });

  it("preserves both conflicting branches and identifies the path and revisions", () => {
    const work = state();
    const first = changeBranchFile(
      work,
      "maya",
      work.baseId,
      "src/a.ts",
      "one",
      now,
    );
    const second = changeBranchFile(
      work,
      "jun",
      work.baseId,
      "src/a.ts",
      "two",
      now,
    );
    const result = integrateCollaboration(work, "maya", now);
    expect(result.conflicts[0]).toContain("src/a.ts");
    expect(result.conflicts[0]).toContain(second.id);
    expect(checkpoint(work, first.id).files[0].content).toBe("one");
    expect(checkpoint(work, second.id).files[0].content).toBe("two");
  });

  it("integrates a teammate's later revision without colliding with their earlier integration", () => {
    const work = state();
    const first = changeBranchFile(
      work,
      "maya",
      work.baseId,
      "src/a.ts",
      "one",
      now,
    );
    const integrated = integrateCollaboration(work, "maya", now);
    expect(integrated.conflicts).toEqual([]);
    const second = changeBranchFile(
      work,
      "maya",
      first.id,
      "src/a.ts",
      "two",
      now,
    );
    const revised = integrateCollaboration(work, "maya", now);
    expect(revised.conflicts).toEqual([]);
    expect(checkpoint(work, revised.headId).files[0].content).toBe("two");
    expect(checkpoint(work, second.id).parentId).toBe(first.id);
  });

  it("dispatches a read-only specialist from the current integration with no edit authority", () => {
    const work = state();
    const head = changeBranchFile(
      work,
      "maya",
      work.baseId,
      "src/a.ts",
      "new",
      now,
    );
    attachCheckpointImage(
      work,
      "maya",
      head.id,
      "00000000-0000-4000-8000-000000000001",
    );
    integrateCollaboration(work, "maya", now);
    const specialist = dispatchCollaborationMember(
      work,
      {
        id: "kiran",
        name: "Kiran",
        role: "specialist",
        permissions: ["read", "audit"],
        model: "specialist",
        thinking: "off",
      },
      work.integration.headId,
    );
    expect(specialist.headId).toBe(work.integration.headId);
    expect(work.decisions).toEqual([]);
    expect(() =>
      changeBranchFile(
        work,
        "kiran",
        specialist.headId,
        "src/a.ts",
        "override",
        now,
      ),
    ).toThrow(/Permission denied/);
  });

  it("rejects a manifest changed after approval", () => {
    expect(() =>
      createCollaboration(
        "task",
        { ...state().scope, manifest: [] },
        files,
        [],
        now,
      ),
    ).toThrow();
  });
});
