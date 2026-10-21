// @vitest-environment node
import { expect, it } from "vitest";
import { executePlanningV2 } from "../src/engine/planning-v2";
import { nebiusModel } from "../src/engine/provider";
import { starterRoster, rosterMembers } from "../src/shared/fixed-teams";
import { initialPlanningState } from "../src/shared/planning-state";
import type { Task } from "../src/shared/contracts";
import type { Run } from "../src/shared/runs";

it.skipIf(process.env.SCULLY_LIVE_TEST !== "1")(
  "continues a linked choice and a new sharing requirement without reclassifying the choice",
  async () => {
    const key = process.env.NEBIUS_API_KEY;
    if (!key)
      throw new Error("NEBIUS_API_KEY is required for this manual check");
    const task: Task = {
      id: "linked-choice-task",
      title: "Reading list",
      description:
        "Build a local reading list with persistence, keyboard access, and tests. Ask about important product choices before building.",
      mode: "plan",
      createdAt: new Date().toISOString(),
    };
    const planning = initialPlanningState();
    planning.questions.push({
      id: "storage-choice",
      text: "Where should the data live?",
      recommendation: "Browser storage",
      options: ["Browser storage", "SQLite"],
      status: "answered",
      answer: "Browser storage",
      askedAt: new Date().toISOString(),
      resolvedAt: new Date().toISOString(),
    });
    const run: Run = {
      id: "linked-choice-run",
      taskId: task.id,
      sourceName: "New project",
      files: [],
      status: "prepared",
      events: [],
      plan: "",
      planning,
      drafts: [],
      findings: [],
      checks: [],
      error: "",
      calls: 0,
      model: "nvidia/nemotron-3-super-120b-a12b",
      outputTokens: 8192,
      redirection: {
        parentId: "previous",
        previousPlan: "",
        previousDrafts: [],
        instructions: [
          "Browser storage\n\nWhat if people on separate devices can view and share lists?",
        ],
        directQuestionAnswer: {
          questionId: "storage-choice",
          answer: "Browser storage",
          note: "What if people on separate devices can view and share lists?",
        },
      },
    };
    const provider = nebiusModel({ key, model: run.model, outputTokens: 8192 });
    let requests = 0;
    const model = {
      complete: async (request: Parameters<typeof provider.complete>[0]) => {
        if (++requests > 3) throw new Error("Linked live request cap reached");
        return provider.complete(request);
      },
    };
    const result = await executePlanningV2(
      run,
      task,
      rosterMembers(starterRoster),
      model,
      () => {},
    );
    expect(result.status).toBe("planned");
    expect(result.planReply?.length).toBeGreaterThan(20);
    expect(result.planReply).toMatch(
      /share|device|account|server|storage|sync/i,
    );
    expect(result.planning?.questions[0].answer).toBe("Browser storage");
    expect(requests).toBeLessThanOrEqual(3);
  },
  300_000,
);

it.skipIf(process.env.SCULLY_LIVE_TEST !== "1")(
  "answers a storage follow-up and a digression without losing the pending choice",
  async () => {
    const key = process.env.NEBIUS_API_KEY;
    if (!key)
      throw new Error("NEBIUS_API_KEY is required for this manual check");
    const task: Task = {
      id: "live-planning-task",
      title: "Build a small local reading list",
      description:
        "Build a small local reading list. Add books, mark them as read, persist across restarts, support the keyboard, and include tests. Ask about important product choices before building.",
      mode: "plan",
      createdAt: new Date().toISOString(),
    };
    const planning = initialPlanningState();
    planning.questions.push({
      id: "storage-choice",
      text: "Where should the reading list data persist?",
      recommendation: "Use a local JSON file.",
      options: ["Local JSON file", "SQLite database", "Browser storage"],
      status: "pending",
      askedAt: new Date().toISOString(),
    });
    const base: Run = {
      id: "live-planning-run",
      taskId: task.id,
      sourceName: "New project",
      files: [],
      status: "prepared",
      events: [],
      plan: "",
      planning,
      drafts: [],
      findings: [],
      checks: [],
      error: "",
      calls: 0,
      model: "nvidia/nemotron-3-super-120b-a12b",
      outputTokens: 8192,
    };
    const provider = nebiusModel({
      key,
      model: base.model,
      outputTokens: 8192,
    });
    let requests = 0;
    const outcomes: string[] = [];
    const model = {
      complete: async (request: Parameters<typeof provider.complete>[0]) => {
        if (++requests > 8)
          throw new Error(
            `Manual live planning request cap reached: ${outcomes.join(", ")}`,
          );
        const originalDiagnostic = request.onDiagnostic;
        const response = await provider.complete({
          ...request,
          onDiagnostic: (diagnostic) => {
            outcomes.push(
              `${request.format || "action"}:${diagnostic.outcome}`,
            );
            originalDiagnostic?.(diagnostic);
          },
        });
        return response;
      },
    };
    const optionsRun = await executePlanningV2(
      {
        ...base,
        redirection: {
          parentId: "previous-turn",
          instructions: ["What are some other options?"],
          previousPlan: "",
          previousDrafts: [],
          conversation: [
            { from: "user", text: task.description },
            { from: "Pearl", text: planning.questions[0].text },
            { from: "user", text: "What are some other options?" },
          ],
        },
      },
      task,
      rosterMembers(starterRoster),
      model,
      () => {},
    );
    expect(optionsRun.status).toBe("planned");
    expect(optionsRun.planReply?.length).toBeGreaterThan(30);
    expect(optionsRun.planReply).toMatch(/SQLite|browser storage|database/i);
    expect(optionsRun.planning?.questions[0].status).toBe("pending");
    expect(optionsRun.planning?.proposal).toBeUndefined();

    const digressionRun = await executePlanningV2(
      {
        ...base,
        id: "live-digression-run",
        planning: optionsRun.planning,
        planningDraft: optionsRun.planningDraft,
        redirection: {
          parentId: optionsRun.id,
          instructions: ["Tell me one interesting fact about pineapples."],
          previousPlan: "",
          previousDrafts: [],
          conversation: [
            { from: "user", text: task.description },
            { from: "Pearl", text: planning.questions[0].text },
            { from: "user", text: "What are some other options?" },
            { from: "Pearl", text: optionsRun.planReply || "" },
            {
              from: "user",
              text: "Tell me one interesting fact about pineapples.",
            },
          ],
        },
      },
      task,
      rosterMembers(starterRoster),
      model,
      () => {},
    );
    expect(digressionRun.status).toBe("planned");
    expect(digressionRun.planReply?.length).toBeGreaterThan(15);
    expect(digressionRun.planReply).toMatch(/pineapple/i);
    expect(digressionRun.planning?.questions[0].status).toBe("pending");
    expect(requests).toBeLessThanOrEqual(8);
  },
  300_000,
);

it.skipIf(process.env.SCULLY_LIVE_TEST !== "1")(
  "opens the reading-list project with usable choices before proposing a team",
  async () => {
    const key = process.env.NEBIUS_API_KEY;
    if (!key)
      throw new Error("NEBIUS_API_KEY is required for this manual check");
    const task: Task = {
      id: "live-first-turn-task",
      title: "Build a small local reading list",
      description:
        "Build a small local reading list. I want to add books, mark them as read, and keep the list after restarting. Make it usable with a keyboard and include tests. Ask me about any important product choices before building.",
      mode: "plan",
      createdAt: new Date().toISOString(),
    };
    const base: Run = {
      id: "live-first-turn-run",
      taskId: task.id,
      sourceName: "New project",
      files: [],
      status: "prepared",
      events: [],
      plan: "",
      planning: initialPlanningState(),
      drafts: [],
      findings: [],
      checks: [],
      error: "",
      calls: 0,
      model: "nvidia/nemotron-3-super-120b-a12b",
      outputTokens: 8192,
    };
    const provider = nebiusModel({
      key,
      model: base.model,
      outputTokens: 8192,
    });
    let requests = 0;
    const model = {
      complete: async (request: Parameters<typeof provider.complete>[0]) => {
        if (++requests > 6)
          throw new Error("Manual first-turn request cap reached");
        return provider.complete(request);
      },
    };
    const result = await executePlanningV2(
      base,
      task,
      rosterMembers(starterRoster),
      model,
      () => {},
    );
    expect(result.status).toBe("planned");
    expect(result.planReply?.length).toBeGreaterThan(30);
    expect(result.planning?.questions.length).toBeGreaterThan(0);
    expect(result.planning?.questions.length).toBeLessThanOrEqual(2);
    for (const question of result.planning?.questions || []) {
      expect(question.status).toBe("pending");
      expect(question.recommendation.length).toBeGreaterThan(10);
      expect(question.options?.length).toBeGreaterThanOrEqual(2);
    }
    expect(result.planning?.proposal).toBeUndefined();
    expect(result.plan).toBe("");
    expect(requests).toBeLessThanOrEqual(6);
  },
  300_000,
);

it.skipIf(process.env.SCULLY_LIVE_TEST !== "1")(
  "turns an accepted recommendation into a plan and team for review",
  async () => {
    const key = process.env.NEBIUS_API_KEY;
    if (!key)
      throw new Error("NEBIUS_API_KEY is required for this manual check");
    const task: Task = {
      id: "live-proposal-task",
      title: "Build a small local reading list",
      description:
        "Build a small local reading list with persistent books, keyboard access, and tests. Ask about important product choices before building.",
      mode: "plan",
      createdAt: new Date().toISOString(),
    };
    const planning = initialPlanningState();
    planning.questions.push({
      id: "storage-choice",
      text: "Where should the reading list data persist?",
      recommendation: "Use a local JSON file.",
      options: ["Local JSON file", "SQLite database", "Browser storage"],
      status: "pending",
      askedAt: new Date().toISOString(),
    });
    const base: Run = {
      id: "live-proposal-run",
      taskId: task.id,
      sourceName: "New project",
      files: [],
      status: "prepared",
      events: [],
      plan: "",
      planning,
      drafts: [],
      findings: [],
      checks: [],
      error: "",
      calls: 0,
      model: "nvidia/nemotron-3-super-120b-a12b",
      outputTokens: 8192,
      redirection: {
        parentId: "previous-turn",
        instructions: [
          "Let's use your JSON recommendation. Please prepare the plan.",
        ],
        previousPlan: "",
        previousDrafts: [],
        conversation: [
          { from: "user", text: task.description },
          { from: "Pearl", text: planning.questions[0].text },
          {
            from: "user",
            text: "Let's use your JSON recommendation. Please prepare the plan.",
          },
        ],
      },
    };
    const provider = nebiusModel({
      key,
      model: base.model,
      outputTokens: 8192,
    });
    let requests = 0;
    const outcomes: string[] = [];
    const model = {
      complete: async (request: Parameters<typeof provider.complete>[0]) => {
        if (++requests > 5)
          throw new Error(
            `Manual proposal request cap reached: ${outcomes.join(", ")}`,
          );
        const value = await provider.complete(request);
        if (value && typeof value === "object") {
          const action = value as Record<string, unknown>;
          outcomes.push(
            `q${Array.isArray(action.questions) ? action.questions.length : "?"}:c${Boolean(action.consultation)}:s${Boolean(action.staffing)}:r${Array.isArray(action.resolvedQuestionIds) ? action.resolvedQuestionIds.length : "?"}`,
          );
        } else {
          outcomes.push(request.format || "non-object");
        }
        return value;
      },
    };
    const result = await executePlanningV2(
      base,
      task,
      rosterMembers(starterRoster),
      model,
      () => {},
    );
    expect(result.planning?.questions[0].status).toBe("answered");
    expect(result.plan.length).toBeGreaterThan(100);
    expect(result.planning?.proposal?.assignments.length).toBeGreaterThan(1);
    expect(result.planReply?.length).toBeGreaterThan(20);
    expect(requests).toBeLessThanOrEqual(5);
  },
  300_000,
);
