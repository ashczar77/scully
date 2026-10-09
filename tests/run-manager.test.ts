// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    utilityProcess: {
      fork: vi.fn(() => {
        const child = new EventEmitter();
        return Object.assign(child, {
          postMessage: vi.fn(),
          kill: vi.fn(() => child.emit("exit", 0)),
        });
      }),
    },
  };
});
import { utilityProcess } from "electron";
import { Store } from "../src/main/store";
import { RunManager } from "../src/main/run-manager";
import { commandRevision } from "../src/engine/revision";
import { snapshotRevision } from "../src/engine/integration";
import { findingKey } from "../src/shared/audits";
it("answers from frozen progress without stopping or overwriting an active build", () => {
  const c = setup();
  try {
    c.manager.configure({
      key: "fixture-key",
      model: "model",
      outputTokens: 1024,
    });
    const run = c.manager.prepare(c.task.id, null, []);
    c.manager.start(run.id, true);
    const build = vi.mocked(utilityProcess.fork).mock.results.at(-1)!.value;
    const noted = c.manager.sendTeamMessage(run.id, {
      text: "What are you working on?",
      intent: "continue",
    });
    const review = c.manager.reviewReply(run.id, noted.messages![0].id, "maya");
    expect(review.duringWork).toBe(true);
    const updated = {
      ...c.store.getRun(run.id),
      plan: "New progress after review",
    };
    build.emit("message", { run: updated });
    c.manager.answerMessage(review.token, true);
    const reply = vi.mocked(utilityProcess.fork).mock.results.at(-1)!.value;
    expect(reply.postMessage.mock.calls[0][0].replyContext).toBe(
      review.context,
    );
    expect(review.context).not.toContain("New progress after review");
    expect(build.kill).not.toHaveBeenCalled();
    expect(() =>
      c.manager.reviewReply(run.id, noted.messages![0].id),
    ).toThrow();
    expect(() =>
      c.manager.configure({
        key: "new-key",
        model: "model",
        outputTokens: 1024,
      }),
    ).toThrow();
    c.manager.stopReply(run.id);
    expect(c.store.getRun(run.id).status).toBe("building");
    expect(build.kill).not.toHaveBeenCalled();
    reply.emit("message", { answer: "Late answer" });
    expect(c.store.getRun(run.id).replies![0].status).toBe("failed");
    const next = c.manager.reviewReply(run.id, noted.messages![0].id, "jun");
    c.manager.answerMessage(next.token, true);
    const second = vi.mocked(utilityProcess.fork).mock.results.at(-1)!.value;
    build.emit("message", {
      run: { ...updated, status: "complete" },
      done: true,
    });
    second.emit("message", { answer: "This was an in-progress snapshot." });
    expect(c.store.getRun(run.id).status).toBe("complete");
    expect(c.store.getRun(run.id).plan).toBe("New progress after review");
    expect(c.store.getRun(run.id).replies![1].status).toBe("answered");
  } finally {
    c.cleanup();
  }
});
it("redirection stops both workers and rejects late progress and replies", () => {
  const c = setup();
  try {
    c.manager.configure({
      key: "fixture-key",
      model: "model",
      outputTokens: 1024,
    });
    const run = c.manager.prepare(c.task.id, null, []);
    c.manager.start(run.id, true);
    const build = vi.mocked(utilityProcess.fork).mock.results.at(-1)!.value;
    const noted = c.manager.sendTeamMessage(run.id, {
      text: "Why?",
      intent: "continue",
    });
    const review = c.manager.reviewReply(run.id, noted.messages![0].id);
    c.manager.answerMessage(review.token, true);
    const reply = vi.mocked(utilityProcess.fork).mock.results.at(-1)!.value;
    const child = c.manager.sendTeamMessage(run.id, {
      text: "Change direction",
      intent: "replan",
    });
    expect(build.kill).toHaveBeenCalled();
    expect(reply.kill).toHaveBeenCalled();
    build.emit("message", { run: { ...run, status: "complete" }, done: true });
    reply.emit("message", { answer: "Ignore redirection" });
    expect(c.store.getRun(run.id).status).toBe("stopped");
    expect(c.store.getRun(run.id).replies![0].status).toBe("failed");
    expect(c.store.getRun(child.id).status).toBe("prepared");
    expect(() => c.manager.start(child.id, false)).toThrow();
  } finally {
    c.cleanup();
  }
});
it("persists suggestion review without granting permissions or losing it to stale saves", () => {
  const c = setup();
  try {
    const run = c.manager.prepare(c.task.id, null, []);
    run.suggestions = [
      { id: "s", text: "Consider docs", actor: "ellis", revision: "rev" },
    ];
    c.store.saveRun(run);
    expect(() => c.manager.reviewSuggestion(run.id, "s")).toThrow();
    run.status = "complete";
    c.store.saveRun(run);
    expect(() => c.manager.reviewSuggestion(run.id, "unknown")).toThrow();
    c.manager.reviewSuggestion(run.id, "s");
    c.manager.reviewSuggestion(run.id, "s");
    c.store.saveRun(run);
    c.store.recoverRuns();
    const saved = c.store.getRun(run.id);
    expect(saved.reviewedSuggestionIds).toEqual(["s"]);
    expect(saved.calls).toBe(0);
    expect(saved.commands).toBeUndefined();
    expect(saved.status).toBe("complete");
  } finally {
    c.cleanup();
  }
});
it("routes replies through stored profiles and rejects edited profiles after review", () => {
  const c = setup();
  try {
    c.manager.configure({
      key: "fixture-key",
      model: "model",
      outputTokens: 1024,
    });
    const run = c.manager.prepare(c.task.id, null, []);
    const noted = c.manager.sendTeamMessage(run.id, {
      text: "What testing is missing?",
      intent: "continue",
    });
    const id = noted.messages![0].id;
    for (const recipient of [null, {}, "unknown", 42])
      expect(() => c.manager.reviewReply(run.id, id, recipient)).toThrow(
        "recipient",
      );
    let review = c.manager.reviewReply(run.id, id, "jun");
    expect(review.recipient).toMatchObject({
      id: "jun",
      role: "Test engineer",
    });
    expect(JSON.parse(review.context).recipient).toEqual(review.recipient);
    const profile = c.store.load().teammates.find((t) => t.id === "jun")!;
    c.store.updateTeammate({
      ...profile,
      instructions: "Check boundary cases carefully.",
    });
    expect(() => c.manager.answerMessage(review.token, true)).toThrow(
      "changed",
    );
    review = c.manager.reviewReply(run.id, id, "jun");
    const started = c.manager.answerMessage(review.token, true);
    c.store.updateTeammate({ ...profile, name: "Renamed" });
    const worker = vi.mocked(utilityProcess.fork).mock.results.at(-1)!.value;
    worker.emit("message", { answer: "Missing boundary evidence." });
    const saved = c.store.getRun(run.id);
    expect(saved.replies![0].recipient).toEqual(review.recipient);
    expect(saved.replies![0].recipient!.name).toBe("Jun");
    expect(saved.status).toBe(started.status);
    expect(saved.calls).toBe(0);
  } finally {
    c.cleanup();
  }
});
it("requires fresh one-use reply consent and binds the exact snapshot", () => {
  const c = setup();
  try {
    c.manager.configure({
      key: "fixture-key",
      model: "model",
      outputTokens: 1024,
    });
    const run = c.manager.prepare(c.task.id, null, []);
    const noted = c.manager.sendTeamMessage(run.id, {
      text: "Why this approach?",
      intent: "continue",
    });
    const message = noted.messages![0];
    let review = c.manager.reviewReply(run.id, message.id);
    expect(review.context).not.toContain("fixture-key");
    expect(() => c.manager.answerMessage(review.token, false)).toThrow(
      "approval",
    );
    expect(() => c.manager.answerMessage(review.token, true)).toThrow();
    review = c.manager.reviewReply(run.id, message.id);
    const changed = c.store.getRun(run.id);
    changed.plan = "New plan";
    c.store.saveRun(changed);
    expect(() => c.manager.answerMessage(review.token, true)).toThrow(
      "changed",
    );
    review = c.manager.reviewReply(run.id, message.id);
    c.manager.configure({
      key: "different-key",
      model: "model",
      outputTokens: 1024,
    });
    expect(() => c.manager.answerMessage(review.token, true)).toThrow();
    review = c.manager.reviewReply(run.id, message.id);
    const now = vi.spyOn(Date, "now").mockReturnValue(review.expiresAt);
    try {
      expect(() => c.manager.answerMessage(review.token, true)).toThrow(
        "expired",
      );
    } finally {
      now.mockRestore();
    }
  } finally {
    c.cleanup();
  }
});
it("answers without modifying work and preserves replies across stale saves", () => {
  const c = setup();
  try {
    c.manager.configure({
      key: "fixture-key",
      model: "model",
      outputTokens: 1024,
    });
    const run = c.manager.prepare(c.task.id, null, []);
    const noted = c.manager.sendTeamMessage(run.id, {
      text: "Why?",
      intent: "continue",
    });
    const review = c.manager.reviewReply(run.id, noted.messages![0].id);
    const started = c.manager.answerMessage(review.token, true);
    expect(started.status).toBe("prepared");
    const worker = vi.mocked(utilityProcess.fork).mock.results.at(-1)!.value;
    expect(worker.postMessage).toHaveBeenCalledWith({
      replyContext: review.context,
      config: expect.any(Object),
    });
    c.manager.sendTeamMessage(run.id, {
      text: "Private later note",
      intent: "continue",
    });
    worker.emit("message", { answer: "Not enough information to know." });
    c.store.saveRun(run);
    const saved = c.store.getRun(run.id);
    expect(saved.replies![0].status).toBe("answered");
    expect(saved.messages).toHaveLength(2);
    expect(saved.status).toBe("prepared");
    expect(saved.calls).toBe(0);
    expect(saved.drafts).toEqual(run.drafts);
    expect(review.context).not.toContain("Private later note");
    worker.emit("message", { answer: "Late result" });
    expect(c.store.getRun(run.id).replies![0].answer).toBe(
      "Not enough information to know.",
    );
  } finally {
    c.cleanup();
  }
});
it("bounds failed replies and stops locally without stopping the task", () => {
  const c = setup();
  try {
    c.manager.configure({
      key: "fixture-key",
      model: "model",
      outputTokens: 1024,
    });
    const run = c.manager.prepare(c.task.id, null, []);
    const noted = c.manager.sendTeamMessage(run.id, {
      text: "Why?",
      intent: "continue",
    });
    for (let i = 0; i < 3; i++) {
      const review = c.manager.reviewReply(run.id, noted.messages![0].id);
      c.manager.answerMessage(review.token, true);
      expect(() =>
        c.manager.reviewReply(run.id, noted.messages![0].id),
      ).toThrow("stable");
      const worker = vi.mocked(utilityProcess.fork).mock.results.at(-1)!.value;
      if (i === 0) c.manager.stop(run.id);
      else if (i === 1) worker.emit("message", { answer: "" });
      else worker.emit("exit", 1);
      expect(c.store.getRun(run.id).status).toBe("prepared");
    }
    expect(
      c.store.getRun(run.id).replies!.every((r) => r.status === "failed"),
    ).toBe(true);
    expect(() => c.manager.reviewReply(run.id, noted.messages![0].id)).toThrow(
      "Three",
    );
  } finally {
    c.cleanup();
  }
});
it("recovers unanswered replies without replay or task mutation", () => {
  const c = setup();
  try {
    const run = c.manager.prepare(c.task.id, null, []);
    c.store.updateReply(run.id, {
      id: "reply",
      messageId: "question",
      revision: "hash",
      status: "answering",
      answer: "",
      at: "now",
    });
    c.store.recoverRuns();
    expect(c.store.getRun(run.id).replies![0].status).toBe("failed");
    expect(c.store.getRun(run.id).status).toBe("prepared");
  } finally {
    c.cleanup();
  }
});
it("preserves notes across stale worker updates and blocks old work after redirection", () => {
  const c = setup();
  try {
    c.manager.configure({
      key: "fixture-key",
      model: "model",
      outputTokens: 1024,
    });
    const original = c.manager.prepare(c.task.id, null, []);
    c.manager.start(original.id, true);
    const worker = vi.mocked(utilityProcess.fork).mock.results.at(-1)!.value;
    const noted = c.manager.sendTeamMessage(original.id, {
      text: "Remember accessibility",
      intent: "continue",
    });
    expect(noted.status).toBe("building");
    worker.emit("message", { run: { ...original, status: "building" } });
    expect(c.store.getRun(original.id).messages![0].text).toBe(
      "Remember accessibility",
    );
    const revised = c.manager.sendTeamMessage(original.id, {
      text: "Use a command line interface instead",
      intent: "replan",
    });
    expect(revised.status).toBe("prepared");
    expect(revised.plan).toBe("");
    expect(revised.calls).toBe(0);
    expect(revised.redirection!.instructions).toEqual([
      "Use a command line interface instead",
    ]);
    expect(revised.commands).toBeUndefined();
    worker.emit("message", {
      run: { ...original, status: "complete" },
      done: true,
    });
    expect(c.store.getRun(original.id).status).toBe("stopped");
    expect(c.store.getRun(original.id).redirectedTo).toBe(revised.id);
    expect(() => c.manager.start(original.id, true)).toThrow("again");
    expect(() =>
      c.manager.sendTeamMessage(original.id, {
        text: "More",
        intent: "continue",
      }),
    ).toThrow("superseded");
    expect(() => c.manager.start(revised.id, false)).toThrow("approval");
    expect(c.manager.start(revised.id, true).status).toBe("planning");
    c.store.recoverRuns();
    expect(c.store.getRun(original.id).messages).toHaveLength(2);
  } finally {
    c.cleanup();
  }
});
it("rejects invalid messages, excessive notes and redirection during local execution", () => {
  const c = setup();
  try {
    const r = completed(c);
    for (const input of [
      { text: "", intent: "continue" },
      { text: "x".repeat(2001), intent: "continue" },
      { text: "x", intent: "execute" },
    ])
      expect(() => c.manager.sendTeamMessage(r.id, input)).toThrow();
    r.executions = [{ status: "running" } as never];
    c.store.saveRun(r);
    expect(() =>
      c.manager.sendTeamMessage(r.id, { text: "change", intent: "replan" }),
    ).toThrow("Stop active");
    for (let i = 0; i < 20; i++)
      c.manager.sendTeamMessage(r.id, { text: "note", intent: "continue" });
    expect(() =>
      c.manager.sendTeamMessage(r.id, { text: "extra", intent: "continue" }),
    ).toThrow("limit");
  } finally {
    c.cleanup();
  }
});
it("prepares one isolated corrective attempt without transferring permissions or calling a provider", () => {
  const c = setup();
  try {
    const parent = completed(c);
    const rev = snapshotRevision(parent.files, parent.drafts);
    parent.coordination!.auditedRevision = rev;
    parent.coordination!.integratedRevision = rev;
    const finding = {
      path: "test.js",
      severity: "error" as const,
      detail: "Fix this",
    };
    parent.specialistAudits = [
      {
        kind: "testing",
        revision: rev,
        findings: [finding],
        status: "needs-review",
        summary: "",
        response: "",
        calls: 2,
      },
    ];
    c.store.saveRun(parent);
    expect(() =>
      c.manager.prepareCorrection(
        parent.id,
        0,
        0,
        "stale",
        findingKey(finding),
      ),
    ).toThrow("stale");
    expect(() =>
      c.manager.prepareCorrection(parent.id, -1, 0, rev, findingKey(finding)),
    ).toThrow("Invalid");
    const before = JSON.stringify(c.store.getRun(parent.id));
    const child = c.manager.prepareCorrection(
      parent.id,
      0,
      0,
      rev,
      findingKey(finding),
    );
    expect(child.id).not.toBe(parent.id);
    expect(child.status).toBe("prepared");
    expect(child.calls).toBe(0);
    expect(child.commands).toBeUndefined();
    expect(child.executions).toBeUndefined();
    expect(child.findingDecisions).toBeUndefined();
    expect(child.correction!.parentDrafts).toEqual(parent.drafts);
    expect(JSON.stringify(c.store.getRun(parent.id))).toBe(before);
    expect(() =>
      c.manager.prepareCorrection(parent.id, 0, 0, rev, findingKey(finding)),
    ).toThrow("One corrective");
    expect(() => c.manager.start(child.id, false)).toThrow("approval");
  } finally {
    c.cleanup();
  }
});
it("persists finding decisions without a provider, rejects stale drafts and active runs", () => {
  const c = setup();
  try {
    const run = completed(c);
    const revision = snapshotRevision(run.files, run.drafts);
    const finding = {
      path: "test.js",
      severity: "warning" as const,
      detail: "Issue",
    };
    run.coordination!.integratedRevision = revision;
    run.coordination!.auditedRevision = revision;
    run.specialistAudits = [
      {
        kind: "testing",
        revision,
        status: "needs-review",
        calls: 2,
        summary: "",
        response: "",
        findings: [finding],
      },
    ];
    c.store.saveRun(run);
    const input = {
      auditIndex: 0,
      findingIndex: 0,
      revision,
      findingKey: findingKey(finding),
      previousCount: 0,
      decision: "accepted-risk",
      reason: "Known constraint",
      evidenceIds: [],
    };
    c.manager.decideFinding(run.id, input);
    c.store.recoverRuns();
    expect(c.store.getRun(run.id).findingDecisions![0].reason).toBe(
      "Known constraint",
    );
    expect(() => c.manager.decideFinding(run.id, input)).toThrow("history");
    run.status = "auditing";
    c.store.saveRun(run);
    expect(() => c.manager.decideFinding(run.id, input)).toThrow("Wait");
    run.status = "complete";
    run.drafts[0].content = "changed";
    c.store.saveRun(run);
    expect(() => c.manager.decideFinding(run.id, input)).toThrow(
      "Draft changed",
    );
  } finally {
    c.cleanup();
  }
});
it("gates specialist dispatch by permission, revision, idle execution and a persisted ceiling", () => {
  const c = setup();
  try {
    c.manager.configure({
      key: "test-key-only",
      model: "model",
      outputTokens: 1024,
    });
    const run = completed(c);
    const revision = snapshotRevision(run.files, run.drafts);
    run.coordination!.auditedRevision = revision;
    run.coordination!.integratedRevision = revision;
    c.store.saveRun(run);
    expect(() =>
      c.manager.startAudit(run.id, "testing", revision, false),
    ).toThrow("approval");
    expect(() =>
      c.manager.startAudit(run.id, "unknown", revision, true),
    ).toThrow("Unknown");
    expect(() =>
      c.manager.startAudit(run.id, "testing", "stale", true),
    ).toThrow("stale");
    run.executions = [{ status: "running" } as never];
    c.store.saveRun(run);
    expect(() =>
      c.manager.startAudit(run.id, "testing", revision, true),
    ).toThrow("execution");
    run.executions = [];
    c.store.saveRun(run);
    const started = c.manager.startAudit(run.id, "testing", revision, true);
    expect(started.status).toBe("auditing");
    expect(started.specialistAudits).toHaveLength(1);
    expect(() =>
      c.manager.startAudit(run.id, "security", revision, true),
    ).toThrow("active");
    const child = vi.mocked(utilityProcess.fork).mock.results.at(-1)!.value;
    expect(child.postMessage.mock.calls[0][0].specialist).toBe(true);
    c.manager.stop(run.id);
    expect(c.store.getRun(run.id).specialistAudits![0].status).toBe("failed");
    run.specialistAudits = Array.from({ length: 3 }, () => ({
      ...started.specialistAudits![0],
      status: "failed",
    }));
    c.store.saveRun(run);
    expect(() =>
      c.manager.startAudit(run.id, "testing", revision, true),
    ).toThrow("maximum");
    run.status = "auditing";
    run.specialistAudits[0].status = "reviewing";
    c.store.saveRun(run);
    c.store.recoverRuns();
    expect(c.store.getRun(run.id).specialistAudits![0].status).toBe("failed");
  } finally {
    c.cleanup();
  }
});
function setup() {
  const root = mkdtempSync(join(tmpdir(), "scully-manager-"));
  const store = new Store(join(root, "test.sqlite"));
  const publish = vi.fn();
  const manager = new RunManager(store, root, publish);
  const task = store.createTask({
    title: "Task",
    description: "Test",
    mode: "work",
  });
  return {
    store,
    manager,
    task,
    publish,
    cleanup: () => {
      manager.close();
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
function completed(c: ReturnType<typeof setup>) {
  const run = c.manager.prepare(c.task.id, null, []);
  run.status = "complete";
  run.drafts = [{ path: "test.js", content: "test", before: null }];
  run.commands = [
    {
      id: "command",
      executable: "node",
      args: ["--test", "test.js"],
      cwd: ".",
      reason: "Check behaviour",
      timeoutSeconds: 30,
      revision: "",
      decision: "pending",
    },
  ];
  run.commands[0].revision = commandRevision(run);
  c.store.saveRun(run);
  return run;
}
it("persists coordination overrides without starting work and locks them after planning begins", () => {
  const c = setup();
  try {
    const r = c.manager.prepare(c.task.id, null, []);
    const configured = c.manager.configureCoordination(r.id, {
      ownership: "jun src/checks/",
      chunkReviews: true,
    });
    expect(configured.calls).toBe(0);
    expect(c.store.getRun(r.id).coordination!.rules![0].owner).toBe("jun");
    configured.status = "planned";
    configured.calls = 1;
    c.store.saveRun(configured);
    expect(() =>
      c.manager.configureCoordination(r.id, {
        ownership: "",
        chunkReviews: false,
      }),
    ).toThrow("locked");
  } finally {
    c.cleanup();
  }
});
it("records exact approvals, permits revocation and never starts a worker", () => {
  const c = setup();
  const count = vi.mocked(utilityProcess.fork).mock.calls.length;
  try {
    const r = completed(c);
    const rev = r.commands![0].revision;
    expect(() => c.manager.decideCommand(r.id, "command", rev, true)).toThrow();
    expect(() =>
      c.manager.decideCommand(r.id, "other", rev, "approved"),
    ).toThrow();
    const approved = c.manager.decideCommand(r.id, "command", rev, "approved");
    expect(approved.commands![0].decision).toBe("approved");
    expect(c.store.getRun(r.id).commands![0].decidedAt).toBeTruthy();
    expect(() =>
      c.manager.decideCommand(r.id, "command", rev, "approved"),
    ).toThrow();
    c.manager.decideCommand(r.id, "command", rev, "denied");
    expect(c.store.getRun(r.id).commands![0].decision).toBe("denied");
    expect(() =>
      c.manager.decideCommand(r.id, "command", rev, "approved"),
    ).toThrow();
    expect(vi.mocked(utilityProcess.fork).mock.calls.length).toBe(count);
  } finally {
    c.cleanup();
  }
});
it.each([
  "files",
  "drafts",
  "args",
  "cwd",
  "timeout",
  "client-revision",
  "status",
])("rejects stale or premature decisions after %s changes", (field) => {
  const c = setup();
  try {
    const r = completed(c);
    const rev = r.commands![0].revision;
    if (field === "files") r.files.push({ path: "other.js", content: "new" });
    if (field === "drafts") r.drafts[0].content = "changed";
    if (field === "args") r.commands![0].args.push("--other");
    if (field === "cwd") r.commands![0].cwd = "nested";
    if (field === "timeout") r.commands![0].timeoutSeconds = 90;
    if (field === "status") r.status = "auditing";
    c.store.saveRun(r);
    expect(() =>
      c.manager.decideCommand(
        r.id,
        "command",
        field === "client-revision" ? "wrong" : rev,
        "approved",
      ),
    ).toThrow();
    expect(c.store.getRun(r.id).commands![0].decision).toBe("pending");
  } finally {
    c.cleanup();
  }
});
it("expires approvals on recovery but retains denials and supports old runs", () => {
  const c = setup();
  try {
    const approved = completed(c);
    c.manager.decideCommand(
      approved.id,
      "command",
      approved.commands![0].revision,
      "approved",
    );
    const denied = completed(c);
    c.manager.decideCommand(
      denied.id,
      "command",
      denied.commands![0].revision,
      "denied",
    );
    const old = c.manager.prepare(c.task.id, null, []);
    c.store.recoverRuns();
    expect(c.store.getRun(approved.id).commands![0].decision).toBe("expired");
    expect(c.store.getRun(denied.id).commands![0].decision).toBe("denied");
    expect(c.store.getRun(old.id).commands).toBeUndefined();
  } finally {
    c.cleanup();
  }
});
it("requires configuration and explicit approval before any worker can start", () => {
  const c = setup();
  try {
    const run = c.manager.prepare(c.task.id, null, []);
    expect(() => c.manager.start(run.id, true)).toThrow("Configure");
    c.manager.configure({
      key: "test-key-only",
      model: "model",
      outputTokens: 1024,
    });
    expect(() => c.manager.start(run.id, false)).toThrow("approval");
    expect(c.store.getRun(run.id).status).toBe("prepared");
  } finally {
    c.cleanup();
  }
});
it("binds a selected snapshot to allowed paths", () => {
  const c = setup();
  try {
    c.manager.select({
      id: "source",
      name: "project",
      files: [{ path: "file.ts", content: "source" }],
      excluded: 0,
    });
    expect(() => c.manager.prepare(c.task.id, "source", ["other"])).toThrow();
    expect(() =>
      c.manager.prepare(c.task.id, "expired", ["file.ts"]),
    ).toThrow();
    expect(() => c.manager.prepare(c.task.id, null, ["file.ts"])).toThrow();
    expect(
      c.manager.prepare(c.task.id, "source", ["file.ts"]).files[0].content,
    ).toBe("source");
  } finally {
    c.cleanup();
  }
});
it("blocks duplicate starts and ignores worker updates after stop", () => {
  const c = setup();
  try {
    c.manager.configure({
      key: "test-key-only",
      model: "model",
      outputTokens: 1024,
    });
    const run = c.manager.prepare(c.task.id, null, []);
    const started = c.manager.start(run.id, true);
    expect(started.status).toBe("building");
    expect(() => c.manager.start(run.id, true)).toThrow("active");
    const child = vi.mocked(utilityProcess.fork).mock.results.at(-1)!.value;
    expect(child.postMessage.mock.calls[0][0].run.status).toBe("prepared");
    c.manager.stop(run.id);
    child.emit("message", { run: { ...run, status: "complete" }, done: true });
    expect(c.store.getRun(run.id).status).toBe("stopped");
    expect(() => c.manager.start(run.id, true)).toThrow("again");
  } finally {
    c.cleanup();
  }
});
it("marks lost active runs interrupted instead of resuming or replaying permission", () => {
  const c = setup();
  try {
    const r = c.manager.prepare(c.task.id, null, []);
    c.store.saveRun({ ...r, status: "auditing" });
    c.store.recoverRuns();
    expect(c.store.getRun(r.id).status).toBe("interrupted");
  } finally {
    c.cleanup();
  }
});
it("never exposes or persists the session key in run metadata", () => {
  const c = setup();
  try {
    c.manager.configure({
      key: "private-session-key",
      model: "model",
      outputTokens: 1024,
    });
    const r = c.manager.prepare(c.task.id, null, []);
    expect(JSON.stringify(c.manager.session())).not.toContain(
      "private-session-key",
    );
    expect(JSON.stringify(c.store.getRun(r.id))).not.toContain(
      "private-session-key",
    );
    c.manager.close();
    expect(c.manager.session().configured).toBe(false);
  } finally {
    c.cleanup();
  }
});
