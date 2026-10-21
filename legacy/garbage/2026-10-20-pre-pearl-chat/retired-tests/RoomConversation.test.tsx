import React from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { RoomConversation, RoomFiles } from "../src/renderer/RoomConversation";
import { rosterMembers, starterRoster } from "../src/shared/fixed-teams";
import type { DesktopAPI, Task } from "../src/shared/contracts";

const task: Task = {
  id: "task-1",
  title: "Reading list",
  description: "Build a reading list",
  mode: "plan",
  createdAt: "2026-10-15T00:00:00.000Z",
};
const team = rosterMembers(starterRoster);
const run = {
  id: "run-1",
  taskId: task.id,
  status: "prepared",
  sourceName: "New project",
  files: [],
  drafts: [],
  events: [],
  messages: [],
  replies: [],
  plan: "",
  teamSnapshot: {
    id: "team-1",
    name: "Scully team",
    version: 1,
    createdAt: "now",
    members: team,
  },
  usagePolicy: { outputTokens: 2048 },
} as any;
function bridge(initial = run) {
  return {
    copyText: vi.fn().mockResolvedValue(undefined),
    onRun: vi.fn().mockReturnValue(() => {}),
    runs: vi.fn().mockResolvedValue([initial]),
    session: vi.fn().mockResolvedValue({
      configured: true,
      model: "test/model",
      outputTokens: 2048,
    }),
    listModels: vi.fn().mockResolvedValue([
      { id: "test/model", name: "Test model" },
      { id: "test/other", name: "Other model" },
    ]),
    selectRunModel: vi
      .fn()
      .mockImplementation(async (_id, model) => ({ ...initial, model })),
    sendPlanningMessage: vi.fn().mockImplementation(async (_id, text) => ({
      ...initial,
      status: "planning",
      messages: [
        ...(initial.messages || []),
        {
          id: "sent",
          text,
          intent: "continue",
          at: "2026-10-15T00:02:00.000Z",
        },
      ],
    })),
    answerPlanningQuestion: vi.fn().mockResolvedValue(initial),
    answerPlanningQuestions: vi.fn().mockResolvedValue(initial),
    approvePlanningPlan: vi.fn().mockResolvedValue(initial),
    retryPlanning: vi.fn().mockImplementation(async () => ({
      ...initial,
      status: "planning",
    })),
    sendConversationMessage: vi.fn().mockImplementation(async (_id, text) => ({
      run: {
        ...initial,
        messages: [
          {
            id: "message-1",
            at: "2026-10-15T00:02:00.000Z",
            text,
            intent: "continue",
          },
        ],
      },
      needsChoice: false,
    })),
    answerConversationMessage: vi.fn().mockImplementation(async () => initial),
    answerBuildQuestion: vi
      .fn()
      .mockImplementation(async () => ({ ...initial, status: "building" })),
    conversationAllowance: vi.fn().mockResolvedValue({
      valid: false,
      remaining: 0,
      model: "test/model",
      outputTokens: 2048,
    }),
    sendTeamMessage: vi.fn().mockImplementation(async (_id, input) => ({
      ...initial,
      messages: [{ ...input, id: "message-1", at: "2026-10-15T00:01:00.000Z" }],
    })),
    reviewConversation: vi.fn().mockResolvedValue({
      token: "one-use-review",
      expiresAt: Date.now() + 1000,
      remaining: 3,
      model: "test/model",
      outputTokens: 2048,
    }),
    approveConversation: vi.fn().mockResolvedValue({
      valid: true,
      remaining: 3,
      model: "test/model",
      outputTokens: 2048,
    }),
    autoAnswerMessage: vi.fn().mockImplementation(async () => ({
      ...initial,
      messages: [
        {
          id: "message-1",
          at: "2026-10-15T00:01:00.000Z",
          text: "How should it work?",
          intent: "continue",
        },
      ],
      replies: [
        {
          id: "reply-1",
          messageId: "message-1",
          status: "answered",
          answer: "Keep it simple.",
          recipient: { id: "pearl", name: "Pearl", role: "Coordinator" },
        },
      ],
    })),
  } as unknown as DesktopAPI;
}
function conversation(
  api: DesktopAPI,
  value = "How should it work?",
  onOpenProfile = vi.fn(),
) {
  return render(
    <RoomConversation
      api={api}
      task={task}
      team={team}
      draft={value}
      onDraftChange={vi.fn()}
      onCreated={vi.fn()}
      onOpenTask={vi.fn()}
      onOpenSettings={vi.fn()}
      onOpenProfile={onOpenProfile}
    />,
  );
}

it("shows message times outside bubbles and opens a teammate profile from the Room", async () => {
  const onOpenProfile = vi.fn();
  const api = bridge({
    ...run,
    events: [
      {
        actor: "maya",
        text: "I am reviewing the project files.",
        at: "2026-10-17T13:39:00.000Z",
      },
    ],
  });
  const { container } = conversation(api, "", onOpenProfile);
  await screen.findByText("I am reviewing the project files.");
  const article = container.querySelector(".chat-agent-maya")!;
  expect(
    article.querySelector(".chat-speaker time")?.getAttribute("datetime"),
  ).toBe("2026-10-17T13:39:00.000Z");
  expect(article.querySelector(".chat-agent-body time")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Open Maya's full profile" }),
  );
  expect(onOpenProfile).toHaveBeenCalledWith("maya");
});

it("routes a reply to the exact pending teammate question", async () => {
  const api = bridge({
    ...run,
    status: "awaiting_input",
    events: [
      {
        actor: "maya",
        text: "Which table should store the books?",
        at: "2026-10-17T13:39:00.000Z",
        questionId: "question-1",
      },
    ],
    pendingQuestions: [
      {
        id: "question-1",
        actor: "maya",
        text: "Which table should store the books?",
        askedAt: "2026-10-17T13:39:00.000Z",
      },
    ],
  });
  conversation(api, "books");
  fireEvent.click(await screen.findByRole("button", { name: "Reply to Maya" }));
  expect(screen.getByText("Replying to Maya")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() =>
    expect(api.answerBuildQuestion).toHaveBeenCalledWith(
      "run-1",
      "question-1",
      "books",
    ),
  );
  expect(api.sendConversationMessage).not.toHaveBeenCalled();
});

it("starts Pearl's planning turn directly from Send without a separate approval form", async () => {
  const api = bridge();
  conversation(api);
  await screen.findByRole("textbox", { name: "Message your team" });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() =>
    expect(api.sendPlanningMessage).toHaveBeenCalledWith(
      run.id,
      "How should it work?",
    ),
  );
  expect(api.reviewConversation).not.toHaveBeenCalled();
  expect(api.approveConversation).not.toHaveBeenCalled();
  expect(screen.queryByText("Approve this bounded conversation.")).toBeNull();
});

it("shows a separate plan approval and routes plan feedback back through Pearl", async () => {
  const planned = {
    ...run,
    status: "planned",
    plan: "## Product\nA reading list with durable storage and keyboard access.",
    planReply: "Here is the full plan for your review.",
    planning: {
      version: 2,
      questions: [],
      consultations: [],
      planReview: { revision: "reviewed-revision" },
    },
  };
  const api = bridge(planned);
  conversation(api, "Please include sign-in");
  await screen.findByRole("heading", { name: "Review Pearl's plan" });
  expect(screen.queryByText("Approve assignments")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", {
      name: "Approve plan and ask Pearl to propose a team",
    }),
  );
  await waitFor(() =>
    expect(api.approvePlanningPlan).toHaveBeenCalledWith(
      run.id,
      "reviewed-revision",
      true,
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: /^Send$/ }));
  await waitFor(() =>
    expect(api.sendPlanningMessage).toHaveBeenCalledWith(
      run.id,
      "Please include sign-in",
    ),
  );
  expect(api.sendConversationMessage).not.toHaveBeenCalled();
});

it("routes a direct Start working task through Pearl when it has the new planning state", async () => {
  const api = bridge({
    ...run,
    planning: { version: 1, questions: [], consultations: [] },
  });
  render(
    <RoomConversation
      api={api}
      task={{ ...task, mode: "work" }}
      team={team}
      draft="Build the reading list"
      onDraftChange={vi.fn()}
      onCreated={vi.fn()}
      onOpenTask={vi.fn()}
      onOpenSettings={vi.fn()}
      onOpenProfile={vi.fn()}
    />,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Send" }));
  await waitFor(() =>
    expect(api.sendPlanningMessage).toHaveBeenCalledWith(
      run.id,
      "Build the reading list",
    ),
  );
  expect(api.sendConversationMessage).not.toHaveBeenCalled();
});

it("shows one concise rendered plan and never treats the task prompt as an unanswered question", async () => {
  const plan =
    "## Overview\nBuild a **local** reading list.\n\n## User Decisions Required\n1. Choose the UI framework.\n2. Decide test coverage.";
  const api = bridge({
    ...run,
    status: "planned",
    plan,
    messages: [
      { id: "first", at: "now", text: task.description, intent: "continue" },
    ],
    events: [{ actor: "pearl", at: "now", text: plan }],
  });
  const onOpenTask = vi.fn();
  render(
    <RoomConversation
      api={api}
      task={task}
      team={team}
      draft=""
      onDraftChange={vi.fn()}
      onCreated={vi.fn()}
      onOpenTask={onOpenTask}
      onOpenSettings={vi.fn()}
    />,
  );
  expect(await screen.findByText("local")).toBeInTheDocument();
  expect(screen.getByText("local").closest("p")).toHaveTextContent(
    "Build a local reading list.",
  );
  expect(screen.queryByText(plan)).toBeNull();
  expect(screen.queryByText("Get an answer")).toBeNull();
  expect(screen.queryByRole("button", { name: "Copy Markdown" })).toBeNull();
  expect(
    screen.queryByRole("button", { name: "View draft analysis" }),
  ).toBeNull();
  expect(onOpenTask).not.toHaveBeenCalled();
});

it("shows structured planning questions with recommendations without duplicating a model reply", async () => {
  const api = bridge({
    ...run,
    status: "planned",
    plan: "Draft reading list plan",
    planReply: "I can help you choose how this small app should run.",
    planning: {
      version: 1,
      consultations: [],
      questions: [
        {
          id: "q1",
          text: "Should the reading list be a browser app or desktop app?",
          recommendation: "Start with a browser app.",
          options: ["Browser app", "Desktop app"],
          status: "pending",
          askedAt: "now",
        },
      ],
    },
    events: [{ actor: "pearl", at: "now", text: "Draft reading list plan" }],
  });
  render(
    <RoomConversation
      api={api}
      task={task}
      team={team}
      draft=""
      onDraftChange={vi.fn()}
      onCreated={vi.fn()}
      onOpenTask={vi.fn()}
      onOpenSettings={vi.fn()}
    />,
  );
  expect(
    await screen.findByText(/Should the reading list be a browser app/),
  ).toBeInTheDocument();
  expect(
    screen.getByText("Pearl recommends: Start with a browser app."),
  ).toBeInTheDocument();
  expect(
    screen.getByText("I can help you choose how this small app should run."),
  ).toBeInTheDocument();
  expect(screen.getByText("Browser app")).toBeInTheDocument();
  expect(screen.getByText("Desktop app")).toBeInTheDocument();
});

it("sends the complete question set with linked answers and one separate note", async () => {
  const active = {
    ...run,
    status: "planned",
    planReply: "Let's choose the interface.",
    planning: {
      version: 1,
      consultations: [],
      questions: [
        {
          id: "interface-choice",
          askedAt: "2026-10-19T00:00:00.000Z",
          status: "pending",
          text: "Which interface?",
          recommendation: "Browser app",
          options: ["Browser app", "Desktop app"],
        },
        {
          id: "storage-choice",
          askedAt: "2026-10-19T00:00:00.000Z",
          status: "pending",
          text: "Where should books be saved?",
          recommendation: "SQLite",
          options: ["SQLite", "JSON file"],
        },
      ],
    },
  } as any;
  const api = bridge(active);
  api.answerPlanningQuestions = vi
    .fn()
    .mockResolvedValue({ ...active, id: "next", status: "planning" });
  render(
    <RoomConversation
      api={api}
      task={task}
      team={team}
      draft=""
      onDraftChange={vi.fn()}
      onCreated={vi.fn()}
      onOpenTask={vi.fn()}
      onOpenSettings={vi.fn()}
    />,
  );
  const question = await screen.findByRole("region", {
    name: "Which interface?",
  });
  fireEvent.click(within(question).getByLabelText("Desktop app"));
  const send = screen.getByRole("button", { name: "Send answers" });
  expect(send).toBeDisabled();
  fireEvent.click(screen.getByLabelText("SQLite"));
  fireEvent.change(screen.getByLabelText("Additional message"), {
    target: { value: "Discuss accounts too" },
  });
  fireEvent.click(send);
  await waitFor(() =>
    expect(api.answerPlanningQuestions).toHaveBeenCalledWith("run-1", {
      answers: [
        {
          questionId: "interface-choice",
          askedAt: "2026-10-19T00:00:00.000Z",
          optionIndex: 1,
        },
        {
          questionId: "storage-choice",
          askedAt: "2026-10-19T00:00:00.000Z",
          optionIndex: 0,
        },
      ],
      note: "Discuss accounts too",
    }),
  );
  expect(api.answerPlanningQuestions).toHaveBeenCalledTimes(1);
});

it("renders Pearl and a consulted teammate with portraits and a live thinking state", async () => {
  const consulted = team.find((member) => member.id !== "pearl")!;
  const api = bridge({
    ...run,
    status: "planning",
    events: [
      {
        actor: "pearl",
        at: "2026-10-15T00:01:00.000Z",
        text: `${consulted.name}, could you check keyboard access?`,
      },
      {
        actor: consulted.id,
        at: "2026-10-15T00:01:01.000Z",
        text: "On it, Pearl. I'll check and report back.",
      },
    ],
    inFlightRequests: [
      {
        id: "request-1",
        actor: consulted.id,
        name: "propose_plan",
        startedAt: "2026-10-15T00:01:02.000Z",
      },
    ],
  });
  conversation(api, "");
  const log = await screen.findByRole("log", { name: "Team conversation" });
  expect(
    within(log).getByText(/could you check keyboard access/),
  ).toBeInTheDocument();
  expect(within(log).getByText(/On it, Pearl/)).toBeInTheDocument();
  expect(
    within(log).getByRole("img", { name: /Pearl portrait/ }),
  ).toBeInTheDocument();
  expect(
    within(log).getAllByRole("img", {
      name: new RegExp(`${consulted.name} portrait`),
    }),
  ).toHaveLength(2);
  expect(within(log).getByText("Maya is thinking")).toBeInTheDocument();
});

it("treats an answer to Pearl's open planning questions as a plan revision", async () => {
  const api = bridge({
    ...run,
    status: "planned",
    plan: "## Conversation Summary\nI'll build a local reading list.\n\n## User Decisions Required\n1. Which UI framework should we use?",
    lineupProposal: {
      planRevision: "revision",
      suggestions: [],
      core: { builderId: "maya", testerId: "jun", auditorId: "ellis" },
    },
  });
  conversation(api, "Use React and keep the interface simple.");
  expect(await screen.findByText(/Which UI framework/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Approve team" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() =>
    expect(api.sendPlanningMessage).toHaveBeenCalledWith(
      run.id,
      "Use React and keep the interface simple.",
    ),
  );
});

it("keeps Pearl's earlier plan between the user's original request and revision", async () => {
  const earlier = {
    ...run,
    status: "stopped",
    plan: "## Conversation Summary\nI'll make a small reading list.\n\n## User Decisions Required\n1. Which framework?",
    messages: [
      {
        id: "first",
        at: "2026-10-15T00:00:00.000Z",
        text: task.description,
        intent: "continue",
      },
      {
        id: "second",
        at: "2026-10-15T00:02:00.000Z",
        text: "Use React",
        intent: "replan",
      },
    ],
    redirectedTo: "run-2",
  };
  const newer = {
    ...run,
    id: "run-2",
    status: "planning",
    redirection: {
      parentId: run.id,
      instructions: ["Use React"],
      previousPlan: earlier.plan,
      previousDrafts: [],
    },
  };
  const api = bridge(newer);
  vi.mocked(api.runs).mockResolvedValue([newer, earlier]);
  conversation(api, "");
  const log = await screen.findByRole("log", { name: "Team conversation" });
  await waitFor(() =>
    expect(
      within(log).getByText("I'll make a small reading list."),
    ).toBeInTheDocument(),
  );
  expect(log.textContent?.indexOf(task.description)).toBeLessThan(
    log.textContent!.indexOf("I'll make a small reading list."),
  );
  expect(
    log.textContent?.indexOf("I'll make a small reading list."),
  ).toBeLessThan(log.textContent!.indexOf("Use React"));
});

it("starts exactly one read-only plan revision when a planning answer is sent", async () => {
  const planned = {
    ...run,
    status: "planned",
    plan: "## Conversation Summary\nI'll build the list.\n\n## User Decisions Required\n1. Which framework?",
  };
  const child = {
    ...run,
    id: "run-2",
    redirection: {
      parentId: run.id,
      instructions: ["Use React"],
      previousPlan: planned.plan,
      previousDrafts: [],
    },
  };
  const api = bridge(planned);
  vi.mocked(api.sendPlanningMessage).mockResolvedValue({
    ...child,
    status: "planning",
  });
  conversation(api, "Use React");
  await screen.findByText(/Which framework/);
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() =>
    expect(api.sendPlanningMessage).toHaveBeenCalledWith(run.id, "Use React"),
  );
  expect(api.sendPlanningMessage).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("Pearl: I’ll update the plan")).toBeNull();
});

it("keeps model selection out of the new task composer", async () => {
  const api = bridge();
  render(
    <RoomConversation
      api={api}
      task={null}
      team={team}
      draft=""
      onDraftChange={vi.fn()}
      onCreated={vi.fn()}
      onOpenTask={vi.fn()}
      onOpenSettings={vi.fn()}
    />,
  );
  await screen.findByRole("textbox", { name: "Start a task" });
  expect(screen.queryByRole("button", { name: /Task model:/ })).toBeNull();
});

it("does not show a model picker when switching between tasks", async () => {
  const api = bridge();
  const props = {
    api,
    team,
    draft: "",
    onDraftChange: vi.fn(),
    onCreated: vi.fn(),
    onOpenTask: vi.fn(),
    onOpenSettings: vi.fn(),
  };
  const view = render(<RoomConversation {...props} task={null} />);
  await screen.findByRole("textbox", { name: "Start a task" });
  view.rerender(<RoomConversation {...props} task={task} />);
  view.rerender(<RoomConversation {...props} task={null} />);
  expect(screen.queryByRole("button", { name: /Task model:/ })).toBeNull();
});

it("sends on Enter and keeps Shift Enter available for a growing multiline draft", async () => {
  const api = bridge();
  conversation(api, "A reading list");
  const input = await screen.findByRole("textbox", {
    name: "Message your team",
  });
  fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
  expect(api.sendPlanningMessage).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() =>
    expect(api.sendPlanningMessage).toHaveBeenCalledWith(
      run.id,
      "A reading list",
    ),
  );
});

it("shows a composer without a preliminary planning form", async () => {
  const api = bridge();
  conversation(api, "");
  expect(
    await screen.findByRole("textbox", { name: "Message your team" }),
  ).toBeInTheDocument();
  expect(screen.queryByText("Pearl: Shall I make a plan?")).toBeNull();
  expect(screen.queryByText("Ready for a plan?")).toBeNull();
});

it.each(["failed", "conflicted"])(
  "keeps the Room composer usable and explains a %s build",
  async (status) => {
    const api = bridge({
      ...run,
      status,
      plan: "Approved plan",
      error: status === "failed" ? "The writer request failed" : "",
      coordination: {
        conflicts:
          status === "conflicted"
            ? [{ path: "src/App.tsx", detail: "Both writers changed it" }]
            : [],
      },
    });
    conversation(api, "Pearl, what happened?");
    const input = await screen.findByRole("textbox", {
      name: "Message your team",
    });
    expect(input).not.toBeDisabled();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(api.sendConversationMessage).toHaveBeenCalledWith(
        run.id,
        "Pearl, what happened?",
      ),
    );
  },
);

it("speaks to the user from Pearl's reply while keeping the draft separate", async () => {
  const api = bridge({
    ...run,
    status: "planned",
    plan: "## Conversation Summary\nThe user wants accounts.\n\n## User Decisions Required\n1. Which identity provider should we use?",
    planReply:
      "Yes, separate accounts make sense. Which identity provider would you like to use?",
  });
  conversation(api, "");
  expect(
    await screen.findByText(
      "Yes, separate accounts make sense. Which identity provider would you like to use?",
    ),
  ).toBeInTheDocument();
  expect(screen.queryByText("The user wants accounts.")).toBeNull();
  expect(
    screen.getByText(/Which identity provider would you like to use\?/),
  ).toBeInTheDocument();
  expect(
    screen.queryByText("Which identity provider should we use?"),
  ).toBeNull();
});

it("sends a freeform answer to a pending teammate question from the Room composer", async () => {
  const paused = {
    ...run,
    status: "awaiting_input",
    pendingQuestions: [
      {
        id: "maya-question",
        actor: "maya",
        text: "Which table should I use?",
        askedAt: "2026-10-15T00:03:00.000Z",
      },
    ],
  };
  const api = bridge(paused);
  conversation(api, "Use reading_items for the books");
  expect(
    await screen.findByRole("textbox", { name: "Message your team" }),
  ).not.toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() =>
    expect(api.sendConversationMessage).toHaveBeenCalledWith(
      paused.id,
      "Use reading_items for the books",
    ),
  );
});

it("answers a question about a settled plan without generating another plan", async () => {
  const planned = {
    ...run,
    status: "planned",
    plan: "## Overview\nUse React.",
  };
  const api = bridge(planned);
  conversation(api, "Which framework did we choose?");
  await screen.findByRole("textbox", { name: "Message your team" });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() =>
    expect(api.sendConversationMessage).toHaveBeenCalledWith(
      planned.id,
      "Which framework did we choose?",
      "pearl",
    ),
  );
  expect(api.sendPlanningMessage).not.toHaveBeenCalled();
});

it("revises the plan when a question asks for a product change", async () => {
  const planned = {
    ...run,
    status: "planned",
    plan: "## Overview\nUse React.",
  };
  const api = bridge(planned);
  conversation(api, "Can we add authentication?");
  await screen.findByRole("textbox", { name: "Message your team" });
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Revise the plan with this message" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() =>
    expect(api.sendPlanningMessage).toHaveBeenCalledWith(
      planned.id,
      "Can we add authentication?",
    ),
  );
  expect(api.sendConversationMessage).not.toHaveBeenCalled();
});

it("lets the user retry a failed planning turn without retyping their answer", async () => {
  const failed = {
    ...run,
    status: "failed",
    error: "Pearl's revised draft did not reflect your latest answer.",
    failureCode: "planning_validation" as const,
  };
  const api = bridge(failed);
  conversation(api, "");
  const retry = await screen.findByRole("button", {
    name: "Ask Pearl to try again",
  });
  fireEvent.click(screen.getByText("Technical details"));
  expect(
    screen.getByText(/rejected Pearl's planning response/i),
  ).toBeInTheDocument();
  fireEvent.click(retry);
  await waitFor(() => expect(api.retryPlanning).toHaveBeenCalledWith(run.id));
  expect(api.sendPlanningMessage).not.toHaveBeenCalled();
});

it("routes a new Room message back to planning after a failed planning turn", async () => {
  const api = bridge({
    ...run,
    status: "failed",
    error: "The revised plan missed the answer",
  });
  conversation(api, "Please use the identity provider I chose");
  fireEvent.click(await screen.findByRole("button", { name: "Send" }));
  await waitFor(() =>
    expect(api.sendPlanningMessage).toHaveBeenCalledWith(
      run.id,
      "Please use the identity provider I chose",
    ),
  );
  expect(api.sendConversationMessage).not.toHaveBeenCalled();
});

it("shows a compact team proposal and requires detailed review for extra specialists", async () => {
  const api = bridge({
    ...run,
    status: "planned",
    plan: "## Overview\nBuild the reading list.",
    lineupProposal: {
      planRevision: "revision",
      suggestions: [
        { id: "sloane", phase: "planning", reason: "Review the flow" },
      ],
      core: {
        builderId: "maya",
        auditorId: "ellis",
        testerId: "jun",
        reason: "Small app",
        fallback: false,
      },
    },
  });
  conversation(api, "");
  expect(await screen.findByText("Maya")).toBeInTheDocument();
  expect(screen.getByText("Jun")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Approve team" })).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Review team and specialists" }),
  );
  expect(
    screen.getByRole("region", { name: "Team lineup" }),
  ).toBeInTheDocument();
});

it("sends an approved plan to the collaborative project scope review", async () => {
  const api = bridge({
    ...run,
    status: "planned",
    plan: "## Overview\nBuild the reading list.",
    lineupProposal: {
      planRevision: "revision",
      suggestions: [],
      core: { builderId: "maya", testerId: "jun", auditorId: "ellis" },
    },
    approvedLineup: { planRevision: "revision", entries: [] },
  });
  const onOpenTask = vi.fn();
  render(
    <RoomConversation
      api={api as DesktopAPI}
      task={task}
      team={team}
      draft=""
      onDraftChange={() => {}}
      onCreated={() => {}}
      onOpenTask={onOpenTask}
      onOpenSettings={() => {}}
    />,
  );
  const button = await screen.findByRole("button", {
    name: "Review project scope",
  });
  fireEvent.click(button);
  expect(onOpenTask).toHaveBeenCalledOnce();
  expect(screen.queryByRole("button", { name: "Start building" })).toBeNull();
});

it("passes a changed direction to Pearl when the user selects plan revision", async () => {
  const api = bridge({
    ...run,
    status: "planned",
    plan: "## Overview\nBuild the list.",
  });
  const message = "Actually, change this to a mobile app.";
  conversation(api, message);
  await screen.findByRole("textbox", { name: "Message your team" });
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Revise the plan with this message" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() =>
    expect(api.sendPlanningMessage).toHaveBeenCalledWith(run.id, message),
  );
  expect(screen.queryByText(/Should I pause coordination/)).toBeNull();
});

it("keeps task model changes in Settings while the Room remains conversational", async () => {
  const api = bridge();
  conversation(api, "");
  await screen.findByRole("textbox", { name: "Message your team" });
  expect(screen.queryByRole("button", { name: /Task model:/ })).toBeNull();
  expect(api.selectRunModel).not.toHaveBeenCalled();
});

it("offers task teammates inline when routing needs a choice", async () => {
  const api = bridge({ ...run, status: "complete" });
  vi.mocked(api.sendConversationMessage).mockImplementation(
    async (_id, text) =>
      ({
        run: {
          ...run,
          status: "complete",
          messages: [
            {
              id: "message-1",
              at: "2026-10-15T00:02:00.000Z",
              text,
              intent: "continue",
            },
          ],
        },
        needsChoice: true,
      }) as any,
  );
  conversation(api);
  await screen.findByRole("textbox", { name: "Message your team" });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  const choices = await screen.findByText(
    "This could fit more than one specialty. Who would you like to hear from?",
  );
  fireEvent.click(
    within(choices.parentElement!).getByRole("button", { name: /Maya/ }),
  );
  await waitFor(() =>
    expect(api.answerConversationMessage).toHaveBeenLastCalledWith(
      run.id,
      "message-1",
      "maya",
    ),
  );
});

it("keeps recent conversation and replies visible in the Room", async () => {
  const api = bridge({
    ...run,
    messages: [
      {
        id: "prior",
        at: "2026-10-15T00:01:00.000Z",
        text: "Should books have tags?",
        intent: "continue",
      },
      {
        id: "current",
        at: "2026-10-15T00:02:00.000Z",
        text: "What happens offline?",
        intent: "continue",
      },
    ],
    replies: [
      {
        id: "reply-1",
        messageId: "prior",
        status: "answered",
        answer: "Tags are optional.",
      },
    ],
    redirection: { instructions: ["Keep data local."] },
    findings: [
      { path: "src/Book.tsx", severity: "warning", detail: "Check labels." },
    ],
  });
  conversation(api);
  const log = await screen.findByRole("log", { name: "Team conversation" });
  expect(within(log).getByText("Should books have tags?")).toBeInTheDocument();
  expect(within(log).getByText("Tags are optional.")).toBeInTheDocument();
  expect(within(log).getByText("What happens offline?")).toBeInTheDocument();
  expect(screen.queryByText("Review context and limits")).toBeNull();
});

it("shows selected project and writer proposals, then opens a file in the main preview", async () => {
  const api = bridge({
    ...run,
    files: [{ path: "src/components/Book.tsx", content: "private source" }],
    drafts: [],
    projectWorkspace: { path: "/tmp/reading-list", kind: "existing" },
    coordination: {
      assignments: [
        {
          owner: "maya",
          status: "ready",
          files: [{ path: "src/components/List.tsx", content: "new draft" }],
        },
      ],
    },
  });
  const onOpenFile = vi.fn();
  render(<RoomFiles api={api} task={task} onOpenFile={onOpenFile} />);
  expect(await screen.findByText("/tmp/reading-list")).toBeInTheDocument();
  expect(await screen.findByText("components")).toBeInTheDocument();
  expect(screen.getByText("Book.tsx")).toBeInTheDocument();
  expect(screen.getByText("List.tsx")).toBeInTheDocument();
  expect(screen.getByText("proposed by Maya")).toBeInTheDocument();
  expect(screen.queryByText("private source")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /List.tsx/ }));
  expect(onOpenFile).toHaveBeenCalledWith({
    path: "src/components/List.tsx",
    name: "List.tsx",
    content: "new draft",
    status: "proposed",
    owner: "Maya",
  });
});
