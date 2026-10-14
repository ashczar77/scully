import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
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
  inspectLocalArtifacts: vi.fn(),
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
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
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
  stopRun: vi.fn(),
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
it("opens a fresh workspace without fabricated task activity", async () => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  const bridge = api();
  render(<App api={bridge} />);
  expect(
    await screen.findByRole("heading", { name: "Start your first task." }),
  ).toBeInTheDocument();
  expect(screen.getByText("Scully home")).toBeInTheDocument();
  expect(screen.queryByText("Your workspace")).not.toBeInTheDocument();
  expect(screen.queryByText("Build password reset")).not.toBeInTheDocument();
  expect(screen.queryByText(/Example conversation/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Single-use token check/)).not.toBeInTheDocument();
  expect(screen.queryByText("Ready")).not.toBeInTheDocument();
  expect(screen.queryByText("CURRENT ACTIVITY")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Send message" }),
  ).not.toBeInTheDocument();
  expect(bridge.createTask).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Create your first task" }),
  );
  const taskDialog = screen.getByRole("dialog", {
    name: "What shall we build?",
  });
  expect(taskDialog).toHaveClass("new-task-dialog");
  expect(taskDialog.querySelector(".new-task-scroll")).toBeInTheDocument();
  expect(taskDialog.querySelector(".new-task-footer")).toContainElement(
    within(taskDialog).getByRole("button", { name: "Save task" }),
  );
  expect(bridge.createTask).not.toHaveBeenCalled();
});
it("moves the main navigation selection with the active page", async () => {
  render(<App api={api()} />);
  await screen.findByText("Team room");
  const navigation = screen.getByRole("navigation", {
    name: "Main navigation",
  });
  expect(navigation.querySelector(".main-nav-indicator")).toBeInTheDocument();
  expect(navigation).toHaveStyle("--nav-index: 0");
  fireEvent.click(within(navigation).getByRole("button", { name: "Settings" }));
  expect(navigation).toHaveStyle("--nav-index: 3");
  expect(
    within(navigation).getByRole("button", { name: "Settings" }),
  ).toHaveAttribute("aria-current", "page");
  expect(
    screen.getByText(
      "Choose another team for new tasks before deleting the current one. Existing tasks keep their saved team.",
    ),
  ).toHaveClass("saved-team-deletion-note");
});
it("keeps a task draft while editing the default team before creation", async () => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  render(<App api={api()} />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Create your first task" }),
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Task title" }), {
    target: { value: "Keep this draft" },
  });
  expect(
    screen.getByText(/Team for this task: Scully team/),
  ).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Edit team before creating task" }),
  );
  expect(
    screen.getByRole("region", { name: "Team settings" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Continue task setup" }));
  expect(screen.getByRole("textbox", { name: "Task title" })).toHaveValue(
    "Keep this draft",
  );
});
it("updates task request exposure when the start mode changes without starting a run", async () => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  const bridge = api();
  bridge.session = vi.fn().mockResolvedValue({
    configured: true,
    model: "zai-org/GLM-5.3",
    outputTokens: 2048,
  });
  render(<App api={bridge} />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Create your first task" }),
  );
  const preview = screen.getByRole("region", { name: "Team and cost preview" });
  expect(preview).toHaveTextContent("4 required model requests");
  await waitFor(() =>
    expect(preview).toHaveTextContent("using a current bundled model rate"),
  );
  fireEvent.click(screen.getByRole("radio", { name: "Start working" }));
  expect(preview).toHaveTextContent("3 required model requests");
  expect(bridge.prepareRun).not.toHaveBeenCalled();
  expect(bridge.startRun).not.toHaveBeenCalled();
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
  fireEvent.click(await screen.findByRole("button", { name: "Delete task" }));
  let confirmation = screen.getByRole("dialog", { name: "Delete task?" });
  expect(bridge.deleteTask).not.toHaveBeenCalled();
  fireEvent.click(within(confirmation).getByRole("button", { name: "Cancel" }));
  expect(bridge.deleteTask).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Delete task" }));
  confirmation = screen.getByRole("dialog", { name: "Delete task?" });
  fireEvent.click(
    within(confirmation).getByRole("button", { name: "Delete task" }),
  );
  await waitFor(() => expect(bridge.deleteTask).toHaveBeenCalledWith(saved.id));
  expect(
    await screen.findByRole("heading", { name: "Start your first task." }),
  ).toBeInTheDocument();
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
  await screen.findByText("Team room");
  expect(
    screen.getAllByRole("img", { name: "Scully alien head" }),
  ).toHaveLength(2);
});
it("navigates to honest empty and settings states", async () => {
  render(<App api={api()} />);
  await screen.findByText("Team room");
  fireEvent.click(screen.getByRole("button", { name: "Changes" }));
  expect(screen.getByText(/No changes yet/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  fireEvent.click(screen.getByRole("button", { name: "App & connection" }));
  expect(
    screen.getByText("Approve each command individually"),
  ).toBeInTheDocument();
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
  await screen.findByText("Team room");
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  fireEvent.click(screen.getByRole("button", { name: "Choose team members" }));
  const dialog = screen.getByRole("dialog", { name: "Choose team members" });
  expect(dialog.querySelectorAll(".fixed-character-choice")).toHaveLength(16);
  expect(
    within(dialog).getByRole("img", { name: /Pearl portrait/ }),
  ).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: /Tessa/ }));
  fireEvent.change(within(dialog).getByLabelText("Builder for current runs"), {
    target: { value: "tessa" },
  });
  expect(dialog).toHaveTextContent(
    "Only assigned members receive automatic requests",
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
  await screen.findByText("Team room");
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
  await screen.findByText("Team room");
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
  await screen.findByText("Team room");
  fireEvent.click(screen.getByRole("button", { name: "Open full profile" }));
  expect(screen.getByText("Working instructions")).toBeInTheDocument();
  expect(screen.getAllByText("Recorded events")).toHaveLength(2);
  expect(screen.getAllByText(/Across 1 recent saved run/)).toHaveLength(2);
});
it("shows a catalog background and member-specific strengths on the full profile", async () => {
  render(<App api={await fixedBridge()} />);
  await screen.findByText("Team room");
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
  await screen.findByText("Team room");
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
