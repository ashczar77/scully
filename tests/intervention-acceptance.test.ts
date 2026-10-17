// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { it, expect, vi } from "vitest";
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
import { executeLoop } from "../src/engine/loop";
import { answerQuestion } from "../src/engine/answer";
import { lineupPlanRevision } from "../src/engine/revision";
import type { Model } from "../src/engine/provider";
const worker = () => vi.mocked(utilityProcess.fork).mock.results.at(-1)!.value;
async function finish(child: ReturnType<typeof worker>, model: Model) {
  const data = child.postMessage.mock.calls[0][0];
  const result = await executeLoop(
    data.run,
    data.task,
    data.team,
    model,
    data.outputRoot,
    (run) => child.emit("message", { run }),
  );
  child.emit("message", { run: result, done: true });
  return result;
}
it("preserves intent, permissions and history through questions, redirection, late results and restart", async () => {
  const root = mkdtempSync(join(tmpdir(), "scully-intervention-"));
  const path = join(root, "workspace.sqlite");
  let store = new Store(path);
  let manager = new RunManager(store, root, () => {});
  try {
    manager.configure({
      key: "fixture-key",
      model: "fixture-model",
      outputTokens: 1024,
    });
    const task = store.createTask({
      title: "Build a browser view",
      description: "Small fixture",
      mode: "work",
    });
    const original = manager.prepare(task.id, null, []);
    const noted = manager.sendTeamMessage(original.id, {
      text: "Why a browser view?",
      intent: "continue",
    });
    const consent = manager.reviewReply(
      original.id,
      noted.messages![0].id,
      "maya",
    );
    manager.answerMessage(consent.token, true);
    const obsoleteReply = worker();
    const revised = manager.sendTeamMessage(original.id, {
      text: "Build a command line tool instead",
      intent: "replan",
    });
    obsoleteReply.emit("message", {
      answer: "Continue the obsolete browser work",
    });
    expect(store.getRun(original.id).replies![0].status).toBe("failed");
    expect(store.getRun(original.id).redirectedTo).toBe(revised.id);
    expect(() => manager.start(original.id, true)).toThrow();
    expect(() => manager.start(revised.id, false)).toThrow("approval");
    expect(revised.commands).toBeUndefined();
    manager.start(revised.id, true);
    const planner = worker();
    const plan = await finish(planner, {
      complete: vi.fn().mockResolvedValue({
        plan: "Build only a command line tool",
        suggestedSpecialists: [],
        suggestedTeam: {
          builderId: "maya",
          auditorId: "ellis",
          testerId: "jun",
          reason: "The saved team can build, test and review this task.",
        },
      }),
    });
    expect(plan.status).toBe("planned");
    expect(plan.drafts).toEqual([]);
    expect(store.getRun(revised.id).lineupProposal?.planRevision).toBe(
      lineupPlanRevision(store.getRun(revised.id), task),
    );
    expect(store.getRun(revised.id).taskSnapshot).toMatchObject({
      title: task.title,
      description: task.description,
      mode: task.mode,
    });
    manager.approveLineup(
      revised.id,
      plan.lineupProposal!.planRevision,
      [],
      true,
      { builderId: "maya", auditorId: "ellis", testerId: "jun" },
    );
    const question = manager.sendTeamMessage(revised.id, {
      text: "Which tests are needed?",
      intent: "continue",
    });
    const review = manager.reviewReply(
      revised.id,
      question.messages![0].id,
      "jun",
    );
    expect(review.context).toContain("Build a command line tool instead");
    expect(review.context).not.toContain("Why a browser view?");
    manager.answerMessage(review.token, true);
    const replyWorker = worker();
    planner.emit("message", { run: plan, done: true });
    planner.emit("exit", 1);
    expect(store.getRun(revised.id).replies![0].status).toBe("answering");
    const answer = await answerQuestion(review.context, {
      complete: vi.fn().mockResolvedValue({
        answer: "Check arguments and invalid input; no checks have run.",
      }),
    });
    replyWorker.emit("message", { answer });
    expect(store.getRun(revised.id).status).toBe("planned");
    expect(() => manager.start(revised.id, false)).toThrow("approval");
    manager.start(revised.id, true);
    const builder = worker();
    // A finished planner must not replace a newer worker on the SAME run.
    planner.emit("message", { run: plan, done: true });
    planner.emit("message", { failed: true });
    planner.emit("exit", 1);
    expect(store.getRun(revised.id).status).toBe("building");
    const complete = vi
      .fn<Model["complete"]>()
      .mockImplementation(async (request) => {
        if (request.name === "audit_files")
          return {
            summary: "Not executed",
            findings: [],
            suggestions: ["Consider usage examples later"],
          };
        if (request.system.includes("implementation engineer"))
          return {
            summary: "CLI",
            files: [{ path: "app.js", content: "console.log('hello');" }],
            commands: [],
          };
        if (request.system.includes("test engineer"))
          return {
            summary: "Tests",
            files: [{ path: "tests/app.test.js", content: "// fixture only" }],
            commands: [],
          };
        throw new Error("Unexpected fixture role");
      });
    const final = await finish(builder, { complete });
    expect(final.status).toBe("complete");
    expect(final.drafts.map((file) => file.path).sort()).toEqual([
      "app.js",
      "tests/app.test.js",
    ]);
    expect(complete).toHaveBeenCalledTimes(3);
    expect(final.calls).toBe(4);
    expect(final.executions).toBeUndefined();
    const suggestion = final.suggestions![0];
    manager.reviewSuggestion(final.id, suggestion.id);
    manager.close();
    store.close();
    store = new Store(path);
    manager = new RunManager(store, root, () => {});
    expect(manager.session().configured).toBe(false);
    const recovered = store.getRun(revised.id);
    expect(recovered.status).toBe("complete");
    expect(recovered.reviewedSuggestionIds).toEqual([suggestion.id]);
    expect(recovered.replies![0].recipient!.id).toBe("jun");
    expect(recovered.replies![0].answer).toBe(answer);
    expect(recovered.applications).toBeUndefined();
    expect(store.getRun(original.id).status).toBe("stopped");
    expect(() => manager.answerMessage(review.token, true)).toThrow();
  } finally {
    manager.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
