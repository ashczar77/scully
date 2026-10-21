import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
  act,
} from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { App } from "../src/renderer/App";
import { initialTeam, type DesktopAPI } from "../src/shared/contracts";
import { rosterMembers, starterRoster } from "../src/shared/fixed-teams";
import {
  defaultUsageAlertPolicy,
  emptyUsageAlertState,
} from "../src/shared/usage-alerts";
const api = (): DesktopAPI => ({
  listPearlChats: vi.fn(),
  createPearlChat: vi.fn(),
  getPearlChat: vi.fn(),
  sendPearlMessage: vi.fn(),
  choosePearlProject: vi.fn(),
  approvePearlProject: vi.fn(),
  decidePearlTool: vi.fn(),
  answerPearlQuestion: vi.fn(),
  retryPearlChat: vi.fn(),
  stopPearlChat: vi.fn(),
  onPearlChatUpdate: vi.fn(() => () => {}),
  reviewCollaboration: vi.fn(),
  recommendEnvironments: vi.fn(),
  reviewLocalFallback: vi.fn(),
  approveLocalFallback: vi.fn(),
  reviewDispatchProposal: vi.fn(),
  approveCollaboration: vi.fn(),
  sendCollaborationMessage: vi.fn(),
  continueTeammate: vi.fn(),
  reconcileCollaboration: vi.fn(),
  reviewSpecialistDispatch: vi.fn(),
  approveSpecialistDispatch: vi.fn(),
  reviewCollaborationSync: vi.fn(),
  approveCollaborationSync: vi.fn(),
  roleModelSettings: vi.fn().mockResolvedValue({
    pearl: "nvidia/nemotron-3-super-120b-a12b",
    builder: "nvidia/Nemotron-3_5-Lightning",
    tester: "nvidia/Nemotron-3_5-Lightning",
    auditor: "nvidia/Nemotron-3_5-Lightning",
    specialists: {},
  }),
  setRoleModelSettings: vi.fn(),
  copyText: vi.fn().mockResolvedValue(undefined),
  rawCaptureStatus: vi.fn().mockResolvedValue({ armed: false, saved: false }),
  armRawCapture: vi.fn(),
  readRawCapture: vi.fn(),
  clearRawCapture: vi.fn(),
  conversationAllowance: vi.fn().mockResolvedValue({
    remaining: 0,
    model: "",
    outputTokens: 2048,
    valid: false,
  }),
  reviewConversation: vi.fn(),
  approveConversation: vi.fn(),
  autoAnswerMessage: vi.fn(),
  listModels: vi.fn().mockResolvedValue([]),
  selectRunModel: vi.fn(),
  sendPlanningMessage: vi.fn(),
  answerPlanningQuestion: vi.fn(),
  answerPlanningQuestions: vi.fn(),
  approvePlanningPlan: vi.fn(),
  retryPlanning: vi.fn(),
  sendConversationMessage: vi.fn(),
  answerConversationMessage: vi.fn(),
  answerBuildQuestion: vi.fn(),
  selectDefaultModel: vi.fn(),
  inspectLocalArtifacts: vi.fn(),
  reviewRoutedReply: vi.fn(),
  messageRoutingSettings: vi.fn().mockResolvedValue({ unclear: "pearl" }),
  setMessageRoutingSettings: vi.fn(),
  planningSettings: vi.fn().mockResolvedValue({ temperature: 0.2 }),
  setPlanningSettings: vi.fn(),
  chooseProjectWorkspace: vi.fn(),
  openProjectWorkspace: vi.fn(),
  gitHistory: vi.fn().mockResolvedValue({ state: "no-project" }),
  initializeGit: vi.fn(),
  cloudImages: vi.fn(),
  resolveCloudExecutable: vi.fn(),
  cloudSession: vi.fn().mockResolvedValue({ configured: false, projectId: "" }),
  configureCloud: vi.fn(),
  reviewCloud: vi.fn(),
  submitCloud: vi.fn(),
  refreshCloud: vi.fn(),
  load: vi.fn().mockResolvedValue({
    tasks: [],
    teammates: initialTeam,
    activity: {
      byTeammate: {
        maya: { recordedEvents: 0, runsWithEvents: 0 },
        ellis: { recordedEvents: 2, runsWithEvents: 1 },
        jun: { recordedEvents: 0, runsWithEvents: 0 },
      },
      scannedRuns: 1,
      partial: false,
    },
  }),
  taskActivity: vi
    .fn()
    .mockResolvedValue({ byTeammate: {}, scannedRuns: 0, partial: false }),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
  taskDisposition: vi.fn().mockResolvedValue({
    canDelete: true,
    canArchive: true,
    reason: null,
    runCount: 0,
    requestCount: 0,
  }),
  archiveTask: vi.fn(),
  restoreTask: vi.fn(),
  permanentlyDeleteArchivedTask: vi.fn(),
  updateTeammate: vi.fn(),
  applyTeamStyle: vi.fn(),
  saveTeam: vi.fn(),
  setDefaultTeam: vi.fn(),
  deleteTeam: vi.fn(),
  restoreTeam: vi.fn(),
  selectSource: vi.fn(),
  prepareRun: vi.fn(),
  runs: vi.fn().mockResolvedValue([]),
  usageForRun: vi.fn().mockResolvedValue({
    requests: 0,
    measured: 0,
    unknown: 0,
    pending: 0,
    inputTokens: 0,
    outputTokens: 0,
    pendingMaxOutputTokens: 0,
  }),
  usageAlertsForRun: vi.fn().mockResolvedValue({
    policy: defaultUsageAlertPolicy,
    state: emptyUsageAlertState(),
    waiting: false,
  }),
  costForRun: vi.fn(),
  configureCost: vi.fn(),
  configureUsageAlerts: vi.fn(),
  continueUsage: vi.fn(),
  saveTokensForRemaining: vi.fn(),
  configureUsagePolicy: vi.fn(),
  reviewUsagePolicy: vi.fn(),
  session: vi
    .fn()
    .mockResolvedValue({ configured: false, model: "", outputTokens: 2048 }),
  configureSession: vi.fn(),
  startRun: vi.fn(),
  approveLineup: vi.fn(),
  reviewConsultation: vi.fn(),
  startConsultation: vi.fn(),
  stopConsultation: vi.fn(),
  reviewAdvice: vi.fn(),
  approveAdvice: vi.fn(),
  removeAdvice: vi.fn(),
  stopRun: vi.fn(),
  requestRunPause: vi.fn(),
  resumeRunPause: vi.fn(),
  configureCoordination: vi.fn(),
  startAudit: vi.fn(),
  decideFinding: vi.fn(),
  prepareCorrection: vi.fn(),
  sendTeamMessage: vi.fn(),
  stopReply: vi.fn(),
  reviewSuggestion: vi.fn(),
  reviewReply: vi.fn(),
  answerMessage: vi.fn(),
  metrics: vi
    .fn()
    .mockResolvedValue({ events: [], capacity: 1000, retentionMs: 86400000 }),
  reviewApply: vi.fn(),
  applyDraft: vi.fn(),
  inspectApplyRecovery: vi.fn(),
  reviewExecution: vi.fn(),
  executeCommand: vi.fn(),
  stopExecution: vi.fn(),
  decideCommand: vi.fn(),
  onRun: vi.fn().mockReturnValue(() => {}),
});
async function fixedBridge(): Promise<DesktopAPI> {
  const bridge = api();
  const base = await bridge.load();
  bridge.load = vi.fn().mockResolvedValue({
    ...base,
    teammates: rosterMembers(starterRoster),
    savedTeams: [
      {
        id: "fixed-default",
        kind: "library",
        name: "Scully team",
        version: 1,
        createdAt: "now",
        roster: starterRoster,
        members: rosterMembers(starterRoster),
      },
    ],
    defaultTeamId: "fixed-default",
  });
  return bridge;
}
it("shows a teammate question badge and clears it only when that question is answered", async () => {
  const bridge = await fixedBridge();
  const base = await bridge.load();
  const task = {
    id: "question-task",
    title: "Reading list",
    description: "Build a reading list",
    mode: "work" as const,
    createdAt: "2026-10-17T13:00:00.000Z",
  };
  bridge.load = vi.fn().mockResolvedValue({ ...base, tasks: [task] });
  const pending = {
    id: "question-1",
    actor: "maya",
    text: "Which table should store the books?",
    askedAt: "2026-10-17T13:39:00.000Z",
  };
  const run = {
    id: "question-run",
    taskId: task.id,
    status: "awaiting_input",
    pendingQuestions: [pending],
    files: [],
    drafts: [],
    events: [],
    messages: [],
    replies: [],
    plan: "",
    teamSnapshot: {
      id: "team",
      name: "Scully team",
      version: 1,
      createdAt: "now",
      members: rosterMembers(starterRoster),
    },
  } as any;
  bridge.runs = vi.fn().mockResolvedValue([run]);
  const listeners: ((run: any) => void)[] = [];
  bridge.onRun = vi.fn().mockImplementation((listener) => {
    listeners.push(listener);
    return () => {};
  });
  render(<App api={bridge} />);
  fireEvent.click(await screen.findByRole("button", { name: /Reading list/ }));
  const card = await screen.findByRole("button", {
    name: "Maya, 1 unanswered question",
  });
  expect(within(card).getByText("1")).toBeTruthy();
  await act(async () => {
    listeners.forEach((listener) =>
      listener({
        ...run,
        pendingQuestions: [
          {
            ...pending,
            answer: "books",
            answeredAt: "2026-10-17T13:40:00.000Z",
          },
        ],
      }),
    );
  });
  expect(
    screen.queryByRole("button", { name: "Maya, 1 unanswered question" }),
  ).toBeNull();
});
it("opens a fresh workspace without fabricated task activity", async () => {
  const bridge = api();
  render(<App api={bridge} />);
  expect(
    await screen.findByRole("heading", {
      name: "What would you like to build?",
    }),
  ).toBeInTheDocument();
  expect(screen.getByText("Scully home")).toBeInTheDocument();
  expect(screen.queryByText("Your workspace")).not.toBeInTheDocument();
  expect(screen.queryByText("Build password reset")).not.toBeInTheDocument();
  expect(screen.queryByText(/Example conversation/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Single-use token check/)).not.toBeInTheDocument();
  expect(screen.queryByText("Ready")).not.toBeInTheDocument();
  expect(screen.queryByText("CURRENT ACTIVITY")).not.toBeInTheDocument();
  expect(
    screen.getByRole("textbox", { name: "Start a task" }),
  ).toBeInTheDocument();
  expect(bridge.createTask).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /New task/ }));
  expect(
    screen.queryByRole("dialog", { name: "What shall we build?" }),
  ).not.toBeInTheDocument();
  expect(bridge.createTask).not.toHaveBeenCalled();
});
it("collapses and restores each side panel without hiding the room", async () => {
  render(<App api={api()} />);
  await screen.findByRole("heading", { name: "What would you like to build?" });
  const room = screen.getByRole("main");
  fireEvent.click(screen.getByRole("button", { name: "Collapse task list" }));
  fireEvent.click(screen.getByRole("button", { name: "Collapse team panel" }));
  expect(
    screen.getByRole("button", { name: "Expand task list" }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Expand team panel" }),
  ).toBeVisible();
  expect(room).toHaveClass("room-panel");
  fireEvent.click(screen.getByRole("button", { name: "Expand task list" }));
  fireEvent.click(screen.getByRole("button", { name: "Expand team panel" }));
  expect(
    screen.getByRole("button", { name: "Collapse task list" }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Collapse team panel" }),
  ).toBeVisible();
});
it("moves the main navigation selection with the active page", async () => {
  render(<App api={api()} />);
  await screen.findByRole("heading", { name: "What would you like to build?" });
  const navigation = screen.getByRole("navigation", {
    name: "Main navigation",
  });
  expect(navigation.querySelector(".main-nav-indicator")).toBeInTheDocument();
  expect(navigation).toHaveStyle("--nav-index: 0");
  fireEvent.click(within(navigation).getByRole("button", { name: "Settings" }));
  expect(navigation).toHaveStyle("--nav-index: 4");
  expect(
    within(navigation).getByRole("button", { name: "Settings" }),
  ).toHaveAttribute("aria-current", "page");
  expect(
    screen.getByText(
      "Choose another team for new tasks before deleting the current one. Existing tasks keep their saved team.",
    ),
  ).toHaveClass("saved-team-deletion-note");
});
it("keeps a first message draft while visiting team settings", async () => {
  render(<App api={api()} />);
  const composer = await screen.findByRole("textbox", { name: "Start a task" });
  fireEvent.change(composer, {
    target: { value: "Keep this private idea" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Manage team" }));
  expect(
    screen.getByRole("region", { name: "Team settings" }),
  ).toBeInTheDocument();
  fireEvent.click(
    within(
      screen.getByRole("navigation", { name: "Main navigation" }),
    ).getByRole("button", { name: "Room" }),
  );
  expect(screen.getByRole("textbox", { name: "Start a task" })).toHaveValue(
    "Keep this private idea",
  );
});
it("creates a private task and starts Pearl's planning turn from the first message", async () => {
  const bridge = await fixedBridge();
  vi.mocked(bridge.session).mockResolvedValue({
    configured: true,
    model: "test/model",
    outputTokens: 2048,
  });
  vi.mocked(bridge.listModels).mockResolvedValue([
    { id: "test/model", name: "Test model" },
  ]);
  const created = {
    id: "new-task",
    title: "Build a reading list",
    description: "Build a reading list",
    mode: "plan" as const,
    createdAt: "2026-10-15T00:00:00.000Z",
  };
  vi.mocked(bridge.createTask).mockResolvedValue(created);
  vi.mocked(bridge.prepareRun).mockResolvedValue({
    id: "new-run",
    taskId: created.id,
    status: "prepared",
    files: [],
    drafts: [],
    events: [],
    messages: [],
    replies: [],
    plan: "",
    diagnostics: [],
    error: "",
    usagePolicy: { outputTokens: 2048 },
  } as any);
  vi.mocked(bridge.sendPlanningMessage).mockImplementation(
    async (_id, text) =>
      ({
        id: "new-run",
        taskId: created.id,
        status: "planning",
        files: [],
        drafts: [],
        events: [],
        messages: [
          {
            text,
            intent: "continue",
            id: "message",
            at: "2026-10-15T00:00:00.000Z",
          },
        ],
        replies: [],
        plan: "",
        diagnostics: [],
        error: "",
        usagePolicy: { outputTokens: 2048 },
      }) as any,
  );
  render(<App api={bridge} />);
  fireEvent.change(
    await screen.findByRole("textbox", { name: "Start a task" }),
    { target: { value: "Build a reading list" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() =>
    expect(bridge.createTask).toHaveBeenCalledWith({
      title: "Build a reading list",
      description: "Build a reading list",
      mode: "plan",
    }),
  );
  expect(bridge.prepareRun).toHaveBeenCalledWith(
    created.id,
    null,
    [],
    "direct",
  );
  expect(bridge.sendPlanningMessage).toHaveBeenCalledWith(
    "new-run",
    "Build a reading list",
  );
  expect(bridge.startRun).not.toHaveBeenCalled();
  expect(bridge.autoAnswerMessage).not.toHaveBeenCalled();
});
it("opens team settings directly from the sidebar and keeps run controls separate", async () => {
  render(<App api={api()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Manage team" }));
  expect(
    screen.getByRole("region", { name: "Team settings" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Run settings" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Run usage" }));
  expect(
    screen.queryByRole("region", { name: "Team settings" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "Choose a task" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Run usage" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});
it("selects and removes a fixed specialist while keeping active assignments", async () => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  const bridge = api();
  const base = await bridge.load();
  let roster = { ...starterRoster, memberIds: [...starterRoster.memberIds] };
  bridge.load = vi.fn(async () => ({
    ...base,
    teammates: rosterMembers(roster),
    savedTeams: [
      {
        id: "team-default",
        kind: "library" as const,
        name: "Scully team",
        version: 1,
        createdAt: "now",
        roster,
        members: rosterMembers(roster),
      },
    ],
    defaultTeamId: "team-default",
  }));
  bridge.saveTeam = vi.fn(async (input) => {
    roster = {
      memberIds: [...input.memberIds],
      activeBuilderId: input.activeBuilderId,
      activeAuditorId: input.activeAuditorId,
      activeTesterId: input.activeTesterId,
    };
    return {
      id: "team-default",
      name: input.name,
      version: 2,
      createdAt: "now",
      roster,
      members: rosterMembers(roster),
    };
  });
  render(<App api={bridge} />);
  fireEvent.click(await screen.findByRole("button", { name: "Manage team" }));
  fireEvent.click(screen.getByRole("button", { name: "Choose team members" }));
  let dialog = screen.getByRole("dialog", { name: "Choose team members" });
  expect(dialog.querySelectorAll(".fixed-character-choice")).toHaveLength(16);
  expect(
    within(dialog).getByRole("button", { name: /Pearl, Coordinator/ }),
  ).toBeDisabled();
  fireEvent.click(within(dialog).getByRole("button", { name: /Sloane/ }));
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Save team roster" }),
  );
  await waitFor(() => expect(roster.memberIds).toContain("sloane"));
  expect(rosterMembers(roster).find(({ id }) => id === "sloane")?.runRole).toBe(
    "reserve",
  );
  fireEvent.click(screen.getByRole("button", { name: "Choose team members" }));
  dialog = screen.getByRole("dialog", { name: "Choose team members" });
  fireEvent.click(within(dialog).getByRole("button", { name: /Sloane/ }));
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Save team roster" }),
  );
  await waitFor(() => expect(roster.memberIds).not.toContain("sloane"));
  expect(roster.activeBuilderId).toBe("maya");
  expect(roster.activeAuditorId).toBe("ellis");
});
it("saves a team name directly and creates a separate team explicitly", async () => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  const bridge = api();
  const before = await bridge.load();
  bridge.load = vi.fn().mockResolvedValue({
    ...before,
    teammates: rosterMembers(starterRoster),
    savedTeams: [
      {
        id: "fixed-default",
        kind: "library",
        name: "Scully team",
        version: 1,
        createdAt: "now",
        roster: starterRoster,
        members: rosterMembers(starterRoster),
      },
    ],
    defaultTeamId: "fixed-default",
  });
  bridge.saveTeam = vi.fn().mockResolvedValue({
    id: "fixed-default",
    name: "Night watch",
    version: 1,
    createdAt: "now",
    roster: starterRoster,
    members: rosterMembers(starterRoster),
  });
  render(<App api={bridge} />);
  fireEvent.click(await screen.findByRole("button", { name: "Manage team" }));
  fireEvent.click(screen.getByRole("button", { name: "Change team name" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Team name" }), {
    target: { value: "Night watch" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(bridge.saveTeam).toHaveBeenCalledWith({
      name: "Night watch",
      ...starterRoster,
      expectedDefaultTeamId: "fixed-default",
      saveMode: "overwrite",
    }),
  );
  expect(
    screen.queryByRole("dialog", { name: /save choice/i }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Create team" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Team name" }), {
    target: { value: "Release team" },
  });
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "Create team" })).getByRole(
      "button",
      { name: "Create team" },
    ),
  );
  await waitFor(() =>
    expect(bridge.saveTeam).toHaveBeenCalledWith({
      name: "Release team",
      ...starterRoster,
      expectedDefaultTeamId: "fixed-default",
      saveMode: "new",
    }),
  );
});
it("shows library teams separately from task snapshots and restores deleted teams", async () => {
  const bridge = api();
  const base = await bridge.load();
  const original = {
    id: "one",
    familyId: "family-one",
    kind: "snapshot" as const,
    name: "Scully team",
    version: 1,
    createdAt: "2026-10-12T10:00:00Z",
    members: initialTeam,
  };
  const updated = {
    ...original,
    id: "two",
    kind: "library" as const,
    name: "Cerberus",
    version: 2,
    createdAt: "2026-10-13T10:00:00Z",
  };
  const separate = {
    ...original,
    id: "three",
    familyId: "family-two",
    kind: "library" as const,
    name: "Release review",
    version: 1,
  };
  bridge.load = vi.fn().mockResolvedValue({
    ...base,
    savedTeams: [separate, updated, original],
    defaultTeamId: updated.id,
    teammates: updated.members,
  });
  render(<App api={bridge} />);
  fireEvent.click(await screen.findByRole("button", { name: "Manage team" }));
  expect(
    within(screen.getByRole("region", { name: "Team settings" })).getByRole(
      "heading",
      { name: "Cerberus" },
    ),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Use for new tasks" }),
  ).toBeInTheDocument();
  expect(screen.queryByText(/Earlier states/)).not.toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "Saved teams (2/20)" }),
  ).toBeInTheDocument();
});
it("deletes a noncurrent team into recovery and restores it", async () => {
  const bridge = api();
  const base = await bridge.load();
  const current = {
    id: "current",
    kind: "library" as const,
    name: "Scully team",
    version: 1,
    createdAt: "now",
    members: initialTeam,
    deletedAt: null,
  };
  const other = { ...current, id: "other", name: "Release team" };
  let deleted = false;
  bridge.load = vi.fn(async () => ({
    ...base,
    savedTeams: [
      current,
      { ...other, deletedAt: deleted ? "2026-10-13T00:00:00Z" : null },
    ],
    defaultTeamId: current.id,
  }));
  bridge.deleteTeam = vi.fn(async () => {
    deleted = true;
    return other;
  });
  bridge.restoreTeam = vi.fn(async () => {
    deleted = false;
    return other;
  });
  render(<App api={bridge} />);
  fireEvent.click(await screen.findByRole("button", { name: "Manage team" }));
  const region = screen.getByRole("region", { name: "Team settings" });
  const deleteButtons = within(region).getAllByRole("button", {
    name: "Delete",
  });
  expect(deleteButtons[0]).toBeDisabled();
  fireEvent.click(deleteButtons[1]);
  expect(
    screen.getByRole("dialog", { name: "Delete team?" }),
  ).toHaveTextContent("Release team");
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "Delete team?" })).getByRole(
      "button",
      { name: "Delete team" },
    ),
  );
  await waitFor(() => expect(bridge.deleteTeam).toHaveBeenCalledWith("other"));
  fireEvent.click(await screen.findByText("Deleted teams (1)"));
  fireEvent.click(screen.getByRole("button", { name: "Restore team" }));
  await waitFor(() => expect(bridge.restoreTeam).toHaveBeenCalledWith("other"));
});
it("explains the 20-team limit in settings", async () => {
  const bridge = api();
  const base = await bridge.load();
  const savedTeams = Array.from({ length: 20 }, (_, index) => ({
    id: `team-${index}`,
    kind: "library" as const,
    name: `Team ${index}`,
    version: 1,
    createdAt: "now",
    members: initialTeam,
    deletedAt: null,
  }));
  bridge.load = vi.fn().mockResolvedValue({
    ...base,
    savedTeams,
    defaultTeamId: savedTeams[0].id,
  });
  render(<App api={bridge} />);
  fireEvent.click(await screen.findByRole("button", { name: "Manage team" }));
  expect(screen.getByRole("button", { name: "Create team" })).toBeDisabled();
  expect(screen.getByText(/20-team limit is reached/)).toBeInTheDocument();
});
it("shows a task's saved team after selecting a different default", async () => {
  const bridge = api();
  const old = {
    id: "old",
    name: "Original",
    version: 1,
    createdAt: "now",
    members: initialTeam,
  };
  const newer = {
    id: "new",
    name: "Updated",
    version: 1,
    createdAt: "now",
    members: initialTeam.map((member) =>
      member.id === "ellis" ? { ...member, name: "Ari" } : member,
    ),
  };
  const base = await bridge.load();
  let selected = "old";
  const task = {
    id: "task-team",
    title: "Older task",
    description: "",
    mode: "work" as const,
    createdAt: "now",
    teamConfigId: "old",
  };
  bridge.load = vi.fn(async () => ({
    ...base,
    tasks: [task],
    savedTeams: [newer, old],
    defaultTeamId: selected,
    teammates: selected === "new" ? newer.members : old.members,
  }));
  bridge.setDefaultTeam = vi.fn(async (id) => {
    selected = id;
    return newer;
  });
  render(<App api={bridge} />);
  fireEvent.click(await screen.findByRole("button", { name: /Older task/ }));
  expect(screen.getByRole("heading", { name: "Original" })).toBeInTheDocument();
  expect(screen.getByText("Saved for this task")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  expect(
    screen.getByRole("region", { name: "Team settings" }),
  ).toHaveTextContent("Original");
  fireEvent.click(screen.getByRole("button", { name: "Use for new tasks" }));
  await waitFor(() =>
    expect(bridge.setDefaultTeam).toHaveBeenCalledWith("new"),
  );
  expect(
    screen.getByRole("region", { name: "Team settings" }),
  ).toHaveTextContent("Updated");
  fireEvent.click(screen.getByRole("button", { name: "Room" }));
  expect(screen.getByRole("heading", { name: "Original" })).toBeInTheDocument();
  expect(screen.getByText("Saved for this task")).toBeInTheDocument();
});
it("resizes both room side panels by keyboard and remembers their widths", async () => {
  localStorage.removeItem("scully-panel-layout-v1");
  const first = render(<App api={api()} />);
  const left = await screen.findByRole("separator", {
    name: "Resize task panel",
  });
  const right = screen.getByRole("separator", { name: "Resize team panel" });
  const grid = left.parentElement as HTMLElement;
  expect(left).toHaveAttribute("tabindex", "0");
  expect(left).toHaveAttribute("aria-valuenow", "242");
  fireEvent.keyDown(left, { key: "ArrowRight" });
  fireEvent.keyDown(right, { key: "ArrowRight" });
  expect(grid.style.getPropertyValue("--task-panel-width")).toBe("262px");
  expect(grid.style.getPropertyValue("--team-panel-width")).toBe("310px");
  await waitFor(() =>
    expect(localStorage.getItem("scully-panel-layout-v1")).toBe(
      '{"task":262,"team":310}',
    ),
  );
  first.unmount();
  render(<App api={api()} />);
  expect(
    await screen.findByRole("separator", { name: "Resize task panel" }),
  ).toHaveAttribute("aria-valuenow", "262");
  expect(
    screen.getByRole("separator", { name: "Resize team panel" }),
  ).toHaveAttribute("aria-valuenow", "310");
  localStorage.removeItem("scully-panel-layout-v1");
});
it("keeps preferred panel widths when a restart opens in a narrower window", async () => {
  const originalWidth = window.innerWidth;
  localStorage.setItem("scully-panel-layout-v1", '{"task":262,"team":330}');
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 942,
  });
  try {
    render(<App api={api()} />);
    const left = await screen.findByRole("separator", {
      name: "Resize task panel",
    });
    expect(left).toHaveAttribute("aria-valuenow", "180");
    expect(localStorage.getItem("scully-panel-layout-v1")).toBe(
      '{"task":262,"team":330}',
    );
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: originalWidth,
    });
    fireEvent(window, new Event("resize"));
    expect(left).toHaveAttribute("aria-valuenow", "262");
  } finally {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: originalWidth,
    });
    localStorage.removeItem("scully-panel-layout-v1");
  }
});
it("ignores invalid saved panel sizes and prevents panels from hiding the room", async () => {
  localStorage.setItem("scully-panel-layout-v1", '{"task":99999,"team":-5}');
  render(<App api={api()} />);
  const left = await screen.findByRole("separator", {
    name: "Resize task panel",
  });
  const right = screen.getByRole("separator", { name: "Resize team panel" });
  expect(Number(left.getAttribute("aria-valuenow"))).toBeLessThanOrEqual(420);
  expect(Number(right.getAttribute("aria-valuenow"))).toBeGreaterThanOrEqual(
    240,
  );
  localStorage.removeItem("scully-panel-layout-v1");
});
it("drags the task divider within the room's width boundary", async () => {
  localStorage.removeItem("scully-panel-layout-v1");
  render(<App api={api()} />);
  const divider = await screen.findByRole("separator", {
    name: "Resize task panel",
  });
  const grid = divider.parentElement as HTMLElement;
  vi.spyOn(grid, "getBoundingClientRect").mockReturnValue({
    left: 0,
    right: 1024,
    width: 1024,
  } as DOMRect);
  fireEvent.pointerDown(divider, { pointerId: 1 });
  fireEvent(
    divider,
    new MouseEvent("pointermove", { bubbles: true, clientX: 400 }),
  );
  expect(divider).toHaveAttribute("aria-valuenow", "262");
  fireEvent.pointerUp(divider, { pointerId: 1 });
  fireEvent(
    divider,
    new MouseEvent("pointermove", { bubbles: true, clientX: 180 }),
  );
  expect(divider).toHaveAttribute("aria-valuenow", "262");
  localStorage.removeItem("scully-panel-layout-v1");
});
it("shows a saved task from storage without invented progress", async () => {
  const bridge = api();
  bridge.load = vi.fn().mockResolvedValue({
    tasks: [
      {
        id: "saved-1",
        title: "Fix login",
        description: "Use the saved project",
        mode: "plan",
        createdAt: "2026-10-12T00:00:00.000Z",
      },
    ],
    teammates: initialTeam,
    activity: { byTeammate: {}, scannedRuns: 0, partial: false },
  });
  render(<App api={bridge} />);
  expect(
    await screen.findByRole("button", { name: /Fix login/ }),
  ).toBeInTheDocument();
  expect(screen.queryByText("Build password reset")).not.toBeInTheDocument();
  expect(screen.queryByText("Plan agreed")).not.toBeInTheDocument();
});
it("edits a saved task and deletes it only after confirmation", async () => {
  const bridge = api();
  const saved = {
    id: "saved-1",
    title: "Fix login",
    description: "Original detail",
    mode: "plan" as const,
    createdAt: "2026-10-12T00:00:00.000Z",
  };
  bridge.load = vi.fn().mockResolvedValue({
    tasks: [saved],
    teammates: initialTeam,
    activity: { byTeammate: {}, scannedRuns: 0, partial: false },
  });
  bridge.updateTask = vi.fn().mockResolvedValue({
    ...saved,
    title: "Fix sign in",
    description: "Updated detail",
  });
  bridge.deleteTask = vi.fn().mockResolvedValue({ deletedRuns: 0 });
  render(<App api={bridge} />);
  fireEvent.click(await screen.findByRole("button", { name: /Fix login/ }));
  fireEvent.click(
    within(
      screen.getByRole("navigation", { name: "Main navigation" }),
    ).getByRole("button", { name: "Task" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Edit task" }));
  const editor = await screen.findByRole("dialog", { name: "Edit task" });
  await waitFor(() => expect(bridge.runs).toHaveBeenCalledWith(saved.id));
  fireEvent.change(
    within(editor).getByRole("textbox", { name: "Task title" }),
    {
      target: { value: "Fix sign in" },
    },
  );
  fireEvent.change(
    within(editor).getByRole("textbox", { name: "What should the team know?" }),
    { target: { value: "Updated detail" } },
  );
  fireEvent.click(within(editor).getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(bridge.updateTask).toHaveBeenCalledWith(saved.id, {
      title: "Fix sign in",
      description: "Updated detail",
      mode: "plan",
    }),
  );
  fireEvent.click(await screen.findByRole("button", { name: "Remove task" }));
  let confirmation = await screen.findByRole("dialog", {
    name: "Delete task?",
  });
  await within(confirmation).findByRole("button", { name: "Delete task" });
  expect(bridge.deleteTask).not.toHaveBeenCalled();
  fireEvent.click(within(confirmation).getByRole("button", { name: "Cancel" }));
  expect(bridge.deleteTask).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Remove task" }));
  confirmation = await screen.findByRole("dialog", { name: "Delete task?" });
  await within(confirmation).findByRole("button", { name: "Delete task" });
  fireEvent.click(
    within(confirmation).getByRole("button", { name: "Delete task" }),
  );
  await waitFor(() => expect(bridge.deleteTask).toHaveBeenCalledWith(saved.id));
  expect(
    await screen.findByRole("heading", {
      name: "What would you like to build?",
    }),
  ).toBeInTheDocument();
});
it("offers archive and recovery when a task has a recorded model request", async () => {
  const bridge = api();
  const saved = {
    id: "task-with-request",
    title: "Build a local reading list",
    description: "Build a reading list",
    mode: "plan" as const,
    createdAt: "2026-10-15T00:00:00.000Z",
  };
  const active = {
    tasks: [saved],
    archivedTasks: [],
    teammates: initialTeam,
    activity: { byTeammate: {}, scannedRuns: 0, partial: false },
  };
  const archived = {
    ...active,
    tasks: [],
    archivedTasks: [{ ...saved, archivedAt: "2026-10-15T01:00:00.000Z" }],
  };
  vi.mocked(bridge.load)
    .mockResolvedValueOnce(active)
    .mockResolvedValueOnce(archived)
    .mockResolvedValueOnce(active);
  vi.mocked(bridge.taskDisposition).mockResolvedValue({
    canDelete: false,
    canArchive: true,
    reason: "saved_work",
    runCount: 2,
    requestCount: 1,
  });
  vi.mocked(bridge.archiveTask).mockResolvedValue({
    ...saved,
    archivedAt: "2026-10-15T01:00:00.000Z",
  });
  vi.mocked(bridge.restoreTask).mockResolvedValue(saved);
  render(<App api={bridge} />);
  fireEvent.click(
    await screen.findByRole("button", { name: /Build a local reading list/ }),
  );
  fireEvent.click(
    within(
      screen.getByRole("navigation", { name: "Main navigation" }),
    ).getByRole("button", { name: "Task" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Remove task" }));
  const dialog = await screen.findByRole("dialog", { name: "Archive task?" });
  expect(within(dialog).getByText(/1 model request/)).toBeInTheDocument();
  expect(
    within(dialog).queryByRole("button", { name: "Delete task" }),
  ).not.toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "Archive task" }));
  await waitFor(() =>
    expect(bridge.archiveTask).toHaveBeenCalledWith(saved.id),
  );
  expect(bridge.deleteTask).not.toHaveBeenCalled();
  fireEvent.click(
    await screen.findByRole("button", { name: "Archived tasks (1)" }),
  );
  const recovery = screen.getByRole("dialog", { name: "Archived tasks" });
  expect(within(recovery).getByText(saved.title)).toBeInTheDocument();
  fireEvent.click(within(recovery).getByRole("button", { name: "Restore" }));
  await waitFor(() =>
    expect(bridge.restoreTask).toHaveBeenCalledWith(saved.id),
  );
  expect(
    await screen.findByRole("button", { name: /Build a local reading list/ }),
  ).toBeInTheDocument();
});
it("requires the exact archived task title before deleting it forever", async () => {
  const bridge = api();
  const archived = {
    id: "archived-1",
    title: "Old reading list",
    description: "",
    mode: "plan" as const,
    createdAt: "2026-10-15T00:00:00.000Z",
    archivedAt: "2026-10-15T01:00:00.000Z",
  };
  vi.mocked(bridge.load)
    .mockResolvedValueOnce({
      tasks: [],
      archivedTasks: [archived],
      teammates: initialTeam,
      activity: { byTeammate: {}, scannedRuns: 0, partial: false },
    })
    .mockResolvedValueOnce({
      tasks: [],
      archivedTasks: [],
      teammates: initialTeam,
      activity: { byTeammate: {}, scannedRuns: 0, partial: false },
    });
  vi.mocked(bridge.permanentlyDeleteArchivedTask).mockResolvedValue({
    deletedRuns: 1,
    privateArtifacts: { removed: 0, failed: 0 },
  });
  render(<App api={bridge} />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Archived tasks (1)" }),
  );
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "Archived tasks" })).getByRole(
      "button",
      { name: "Delete forever" },
    ),
  );
  const confirm = screen.getByRole("dialog", {
    name: "Delete archived task forever?",
  });
  const action = within(confirm).getByRole("button", {
    name: "Delete forever",
  });
  expect(action).toBeDisabled();
  fireEvent.change(
    within(confirm).getByLabelText("Type the task title to confirm"),
    { target: { value: "Wrong" } },
  );
  expect(action).toBeDisabled();
  fireEvent.change(
    within(confirm).getByLabelText("Type the task title to confirm"),
    { target: { value: archived.title } },
  );
  fireEvent.click(action);
  await waitFor(() =>
    expect(bridge.permanentlyDeleteArchivedTask).toHaveBeenCalledWith(
      archived.id,
      archived.title,
    ),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Archived tasks" }),
    ).not.toBeInTheDocument(),
  );
  expect(screen.queryByText(archived.title)).not.toBeInTheDocument();
});

it("keeps conversations and activity separate when switching tasks", async () => {
  const bridge = api();
  const first = {
    id: "first",
    title: "First task",
    description: "",
    mode: "plan" as const,
    createdAt: "2026-10-15T00:00:00.000Z",
  };
  const second = {
    id: "second",
    title: "Second task",
    description: "",
    mode: "plan" as const,
    createdAt: "2026-10-15T00:00:01.000Z",
  };
  vi.mocked(bridge.load).mockResolvedValueOnce({
    tasks: [first, second],
    archivedTasks: [],
    teammates: initialTeam,
    activity: { byTeammate: {}, scannedRuns: 2, partial: false },
  });
  vi.mocked(bridge.runs).mockImplementation(async (id) => [
    {
      id: `run-${id}`,
      taskId: id,
      status: "prepared",
      sourceName: "New project",
      files: [],
      drafts: [],
      events: [],
      messages: [
        {
          id: `message-${id}`,
          text: `${id} private message`,
          at: "2026-10-15T00:00:00.000Z",
          intent: "continue",
        },
      ],
      replies: [],
      plan: "",
      calls: 0,
      model: "",
      outputTokens: 2048,
    } as any,
  ]);
  vi.mocked(bridge.taskActivity).mockImplementation(async (id) => ({
    byTeammate: {
      ellis: { recordedEvents: id === first.id ? 1 : 2, runsWithEvents: 1 },
    },
    scannedRuns: 1,
    partial: false,
  }));
  const { container } = render(<App api={bridge} />);
  fireEvent.click(await screen.findByRole("button", { name: first.title }));
  await waitFor(() =>
    expect(container.querySelector(".chat-user")?.textContent).toContain(
      "first private message",
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: second.title }));
  expect(
    container.querySelector(".chat-user")?.textContent ?? "",
  ).not.toContain("first private message");
  await waitFor(() =>
    expect(container.querySelector(".chat-user")?.textContent).toContain(
      "second private message",
    ),
  );
  expect(bridge.runs).toHaveBeenCalledWith(second.id);
  expect(bridge.taskActivity).toHaveBeenCalledWith(second.id);
});

it("does not offer edits to fixed character identity from the profile", async () => {
  render(<App api={api()} />);
  const profile = await screen.findByRole("region", { name: "Ellis profile" });
  const edit = profile.querySelector<HTMLButtonElement>(".edit-profile");
  expect(edit).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Manage team" }),
  ).toBeInTheDocument();
});
it("shows the Scully alien head throughout the opening workspace", async () => {
  render(<App api={api()} />);
  expect(
    screen.getByRole("img", { name: "Scully alien head" }),
  ).toBeInTheDocument();
  await screen.findByRole("heading", { name: "What would you like to build?" });
  expect(
    screen.getAllByRole("img", { name: "Scully alien head" }),
  ).toHaveLength(2);
});
it("navigates to honest empty and settings states", async () => {
  render(<App api={api()} />);
  await screen.findByRole("heading", { name: "What would you like to build?" });
  fireEvent.click(screen.getByRole("button", { name: "Changes" }));
  expect(
    screen.getByText(/Choose a task and its project folder/),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  fireEvent.click(screen.getByRole("button", { name: "App & connection" }));
  expect(
    screen.getByText("Approve each command individually"),
  ).toBeInTheDocument();
});
it("configures Sandbox access in app settings before a collaborative build", async () => {
  const bridge = api();
  bridge.configureCloud = vi.fn().mockResolvedValue({
    configured: true,
    projectId: "project-123",
  });
  bridge.cloudImages = vi.fn().mockResolvedValue({
    images: [{ uuid: "image-123", tag: "node-22" }],
    limited: false,
  });
  render(<App api={bridge} />);
  await screen.findByRole("heading", { name: "What would you like to build?" });
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  fireEvent.click(screen.getByRole("button", { name: "App & connection" }));
  fireEvent.change(screen.getByLabelText("Sandbox project ID"), {
    target: { value: "project-123" },
  });
  fireEvent.change(screen.getByLabelText("Sandbox API key"), {
    target: { value: "secret-token" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Use for this app session" }),
  );
  await waitFor(() =>
    expect(bridge.configureCloud).toHaveBeenCalledWith({
      key: "secret-token",
      projectId: "project-123",
    }),
  );
  expect(screen.queryByDisplayValue("secret-token")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Check Sandbox access" }));
  await waitFor(() => expect(bridge.cloudImages).toHaveBeenCalledWith(""));
  expect(screen.getByText("node-22")).toBeInTheDocument();
});
it("explains a failed Sandbox access check without reporting images", async () => {
  const bridge = api();
  bridge.cloudSession = vi.fn().mockResolvedValue({
    configured: true,
    projectId: "project-123",
  });
  bridge.cloudImages = vi.fn().mockRejectedValue(new Error("Access denied"));
  render(<App api={bridge} />);
  await screen.findByRole("heading", { name: "What would you like to build?" });
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  fireEvent.click(screen.getByRole("button", { name: "App & connection" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Check Sandbox access" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Access denied Check that this project has Sandbox access",
  );
  expect(
    screen.queryByText(/Sandbox images available/),
  ).not.toBeInTheDocument();
});
it("shows every fixed character and saves an explicit active builder", async () => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  const bridge = await fixedBridge();
  bridge.saveTeam = vi.fn().mockResolvedValue(undefined);
  render(<App api={bridge} />);
  await screen.findByRole("heading", { name: "What would you like to build?" });
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  fireEvent.click(screen.getByRole("button", { name: "Choose team members" }));
  const dialog = screen.getByRole("dialog", { name: "Choose team members" });
  expect(dialog.querySelectorAll(".fixed-character-choice")).toHaveLength(16);
  expect(
    within(dialog).getByRole("img", { name: /Pearl portrait/ }),
  ).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: /Tessa/ }));
  fireEvent.change(within(dialog).getByLabelText("Legacy default builder"), {
    target: { value: "tessa" },
  });
  expect(dialog).toHaveTextContent(
    "Pearl receives one planning request for Plan first tasks",
  );
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Save team roster" }),
  );
  await waitFor(() =>
    expect(bridge.saveTeam).toHaveBeenCalledWith(
      expect.objectContaining({
        memberIds: expect.arrayContaining([
          "pearl",
          "maya",
          "tessa",
          "ellis",
          "jun",
        ]),
        activeBuilderId: "tessa",
        activeAuditorId: "ellis",
        activeTesterId: "jun",
        expectedDefaultTeamId: "fixed-default",
      }),
    ),
  );
  expect(bridge.applyTeamStyle).not.toHaveBeenCalled();
});

it("keeps the current roster visible when saving a new selection fails", async () => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  const bridge = await fixedBridge();
  bridge.saveTeam = vi.fn().mockRejectedValue(new Error("Disk unavailable"));
  render(<App api={bridge} />);
  await screen.findByRole("heading", { name: "What would you like to build?" });
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  fireEvent.click(screen.getByRole("button", { name: "Choose team members" }));
  const dialog = screen.getByRole("dialog", { name: "Choose team members" });
  fireEvent.click(within(dialog).getByRole("button", { name: /Nico/ }));
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Save team roster" }),
  );
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "Disk unavailable",
  );
  expect(
    screen.getByRole("region", { name: "Team settings" }),
  ).toHaveTextContent("Team members (4/16)");
  expect(within(dialog).getByRole("button", { name: /Nico/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
it("shows grouped member stories and clear selection states", async () => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  render(<App api={await fixedBridge()} />);
  await screen.findByRole("heading", { name: "What would you like to build?" });
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  fireEvent.click(screen.getByRole("button", { name: "Choose team members" }));
  const dialog = screen.getByRole("dialog", { name: "Choose team members" });
  for (const group of [
    "Coordinator",
    "Builders",
    "Testers",
    "Auditors",
    "Specialists",
  ]) {
    expect(
      within(dialog).getByRole("region", { name: group }),
    ).toBeInTheDocument();
  }
  expect(within(dialog).queryAllByRole("checkbox")).toHaveLength(0);
  expect(dialog).toHaveTextContent(
    "Sloane began with museum exhibition guides and signs",
  );
  const pearl = within(dialog).getByRole("button", {
    name: "Pearl, Coordinator",
  });
  expect(pearl).toBeDisabled();
  expect(pearl).toHaveAttribute("aria-pressed", "true");
  const sloane = within(dialog).getByRole("button", {
    name: "Sloane, UI and UX design",
  });
  expect(sloane).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(sloane);
  expect(sloane).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(sloane);
  expect(sloane).toHaveAttribute("aria-pressed", "false");
});
it("opens the selected full profile", async () => {
  render(<App api={api()} />);
  await screen.findByRole("heading", { name: "What would you like to build?" });
  fireEvent.click(screen.getByRole("button", { name: "Open full profile" }));
  expect(screen.getByText("Working instructions")).toBeInTheDocument();
  expect(screen.getAllByText("Recorded events")).toHaveLength(2);
  expect(screen.getAllByText(/Across 1 recent saved run/)).toHaveLength(2);
});
it("shows a catalog background and member-specific strengths on the full profile", async () => {
  render(<App api={await fixedBridge()} />);
  await screen.findByRole("heading", { name: "What would you like to build?" });
  const sideProfile = screen.getByRole("region", { name: "Ellis profile" });
  expect(sideProfile).toHaveTextContent("Reproducible evidence");
  expect(sideProfile).not.toHaveTextContent("Code review");
  fireEvent.click(
    within(sideProfile).getByRole("button", { name: "Open full profile" }),
  );
  const profiles = screen.getAllByRole("region", { name: "Ellis profile" });
  const fullProfile = profiles.find((node) =>
    node.classList.contains("full-profile"),
  );
  expect(fullProfile).toHaveTextContent(
    "Ellis worked on environmental-monitoring software",
  );
  expect(fullProfile).toHaveTextContent("Open questions");
});
it("refreshes saved activity and keeps previous counts after a failed refresh", async () => {
  const bridge = api();
  render(<App api={bridge} />);
  await screen.findByRole("heading", { name: "What would you like to build?" });
  vi.mocked(bridge.load).mockResolvedValueOnce({
    tasks: [],
    teammates: initialTeam,
    activity: {
      byTeammate: {
        maya: { recordedEvents: 0, runsWithEvents: 0 },
        ellis: { recordedEvents: 4, runsWithEvents: 2 },
        jun: { recordedEvents: 0, runsWithEvents: 0 },
      },
      scannedRuns: 2,
      partial: true,
    },
  });
  fireEvent.click(screen.getByRole("button", { name: "Open full profile" }));
  fireEvent.click(
    screen.getAllByRole("button", { name: "Refresh activity" })[0],
  );
  expect(
    await screen.findAllByText(/Across 2 recent saved runs \(partial count\)/),
  ).toHaveLength(2);
  vi.mocked(bridge.load).mockRejectedValueOnce(new Error("disk"));
  fireEvent.click(
    screen.getAllByRole("button", { name: "Refresh activity" })[0],
  );
  expect(await screen.findAllByRole("alert")).toHaveLength(2);
  expect(screen.getAllByText(/Across 2 recent saved runs/)).toHaveLength(2);
});
it("shows load failure instead of pretending to have saved state", async () => {
  const bridge = api();
  bridge.load = vi.fn().mockRejectedValue(new Error("disk"));
  render(<App api={bridge} />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "could not be loaded",
  );
});
