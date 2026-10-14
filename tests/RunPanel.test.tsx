import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { RunPanel } from "../src/renderer/RunPanel";
import type { DesktopAPI } from "../src/shared/contracts";
import type { Run } from "../src/shared/runs";
import { initialTeam } from "../src/shared/contracts";
import { rosterMembers, starterRoster } from "../src/shared/fixed-teams";
import {
  defaultUsageAlertPolicy,
  emptyUsageAlertState,
} from "../src/shared/usage-alerts";
const task = {
  id: "task",
  title: "Build",
  description: "Example",
  mode: "work" as const,
  createdAt: "now",
};
const run: Run = {
  id: "run",
  taskId: "task",
  sourceName: "New project",
  files: [],
  status: "prepared",
  events: [],
  plan: "",
  drafts: [],
  findings: [],
  checks: [],
  error: "",
  calls: 0,
  model: "",
  outputTokens: 0,
};
it("shows the exact saved team attached to a prepared run", async () => {
  const bridge = api();
  bridge.runs = vi.fn().mockResolvedValue([
    {
      ...run,
      teamSnapshot: {
        id: "team-v1",
        name: "Security team",
        version: 2,
        createdAt: "now",
        members: initialTeam,
      },
    },
  ]);
  render(<RunPanel api={bridge} task={task} />);
  expect(
    await screen.findByText(/Saved team for this run: Security team v2/),
  ).toBeInTheDocument();
});
it("shows Pearl's task-specific suggestions beside the plan without adding a dispatch action", async () => {
  const bridge = api();
  const planned = {
    ...run,
    status: "planned",
    plan: "Build account recovery",
    calls: 1,
    teamSnapshot: {
      id: "fixed-team",
      name: "Scully team",
      version: 1,
      createdAt: "now",
      members: rosterMembers(starterRoster),
      roster: starterRoster,
    },
    lineupProposal: {
      planRevision: "revision",
      discardedInvalid: false,
      suggestions: [
        {
          id: "kiran",
          phase: "verification",
          reason: "Review account recovery boundaries",
        },
      ],
    },
  };
  bridge.runs = vi.fn().mockResolvedValue([planned]);
  bridge.approveLineup = vi
    .fn()
    .mockImplementation(async (_id, revision, entries) => ({
      ...planned,
      approvedLineup: { planRevision: revision, entries, approvedAt: "now" },
    }));
  render(<RunPanel api={bridge} task={{ ...task, mode: "plan" }} />);
  expect(await screen.findByText("Build account recovery")).toBeInTheDocument();
  expect(
    screen.getByRole("region", { name: "Suggested specialists" }),
  ).toHaveTextContent("Review account recovery boundaries");
  expect(
    screen.queryByRole("button", { name: /dispatch kiran/i }),
  ).not.toBeInTheDocument();
  expect(bridge.startRun).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: /Build and audit/ }),
  ).toBeDisabled();
  fireEvent.click(
    screen.getByRole("button", { name: "Approve specialist selection" }),
  );
  await waitFor(() =>
    expect(bridge.approveLineup).toHaveBeenCalledWith(
      "run",
      "revision",
      [
        {
          id: "kiran",
          phase: "verification",
          purpose: "Review account recovery boundaries",
        },
      ],
      true,
    ),
  );
  fireEvent.click(
    screen.getByRole("checkbox", { name: /I approve this upload/ }),
  );
  expect(screen.getByRole("button", { name: /Build and audit/ })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "release" }));
  expect(
    screen.getByRole("button", { name: /Build and audit/ }),
  ).toBeDisabled();
});
it("keeps a completed event's identity when the current profile is renamed", async () => {
  const bridge = api();
  bridge.runs = vi.fn().mockResolvedValue([
    {
      ...run,
      status: "complete",
      events: [
        {
          actor: "ellis",
          actorName: "Earlier name",
          actorRole: "Security reviewer",
          actorPortraitId: initialTeam[1].portraitId,
          text: "Review recorded",
          at: "2026-10-12T12:00:00.000Z",
        },
      ],
    },
  ]);
  render(
    <RunPanel
      api={bridge}
      task={task}
      team={initialTeam.map((person) =>
        person.id === "ellis"
          ? { ...person, name: "Current name", role: "Architect" }
          : person,
      )}
    />,
  );
  expect(
    await screen.findByText("Earlier name · Security reviewer"),
  ).toBeInTheDocument();
  expect(screen.queryByText("Current name · Auditor")).not.toBeInTheDocument();
});
it("renders recorded identity as text instead of markup", async () => {
  const bridge = api();
  bridge.runs = vi.fn().mockResolvedValue([
    {
      ...run,
      status: "complete",
      events: [
        {
          actor: "ellis",
          actorName: "<img src=x onerror=alert(1)>",
          actorRole: "Reviewer",
          text: "Safe display",
          at: "2026-10-12T12:00:00.000Z",
        },
      ],
    },
  ]);
  const { container } = render(<RunPanel api={bridge} task={task} />);
  expect(
    await screen.findByText("<img src=x onerror=alert(1)> · Reviewer"),
  ).toBeInTheDocument();
  expect(container.querySelector(".run-event img")).toBeNull();
});
function api() {
  return {
    cloudImages: vi.fn(),
    cloudSession: vi
      .fn()
      .mockResolvedValue({ configured: false, projectId: "" }),
    session: vi
      .fn()
      .mockResolvedValue({ configured: false, model: "", outputTokens: 2048 }),
    runs: vi.fn().mockResolvedValue([run]),
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
    costForRun: vi.fn().mockResolvedValue({
      model: "",
      settings: { budgetCents: null, manualRate: null },
      rate: null,
      referenceRate: null,
      rateStatus: "unknown",
      totals: {
        verifiedNanoUsd: 0,
        estimatedNanoUsd: 0,
        unpricedMeasured: 0,
        unknownUsage: 0,
        pendingProjectedNanoUsd: 0,
        unpricedPending: 0,
      },
      nextProjectedNanoUsd: null,
      budgetExposureNanoUsd: 0,
    }),
    configureCost: vi.fn(),
    configureUsageAlerts: vi.fn(),
    continueUsage: vi.fn(),
    saveTokensForRemaining: vi.fn(),
    onRun: vi.fn().mockReturnValue(() => {}),
    startRun: vi.fn().mockResolvedValue({ ...run, status: "building" }),
  } as unknown as DesktopAPI;
}
it("offers a fresh source choice and blocks consent when task details changed", async () => {
  const bridge = api();
  bridge.runs = vi.fn().mockResolvedValue([
    {
      ...run,
      taskSnapshot: {
        title: "Old title",
        description: task.description,
        mode: task.mode,
      },
    },
  ]);
  render(<RunPanel api={bridge} task={task} />);
  expect(
    await screen.findByText(/Task details changed after this run/),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("checkbox", { name: /I approve this upload/ }),
  ).toBeDisabled();
  fireEvent.click(
    screen.getByRole("button", { name: "Change project source" }),
  );
  expect(
    screen.getByRole("radio", { name: "Existing project" }),
  ).toBeInTheDocument();
  expect(bridge.startRun).not.toHaveBeenCalled();
});
it("shows compact run settings without empty token accounting in the task room", async () => {
  const openSettings = vi.fn();
  render(
    <RunPanel
      api={api()}
      task={task}
      settingsView="summary"
      onOpenSettings={openSettings}
    />,
  );
  const usage = await screen.findByRole("button", { name: /Run usage/ });
  expect(screen.queryByLabelText("Model token usage")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("region", { name: "Run usage policy" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: /Usage alerts/ }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: /Model cost estimates/ }),
  ).toBeInTheDocument();
  fireEvent.click(usage);
  expect(openSettings).toHaveBeenCalledOnce();
});
it("shows measured, pending and unknown usage separately", async () => {
  const bridge = api();
  bridge.usageForRun = vi.fn().mockResolvedValue({
    requests: 3,
    measured: 1,
    unknown: 1,
    pending: 1,
    inputTokens: 120,
    outputTokens: 40,
    pendingMaxOutputTokens: 1024,
  });
  render(<RunPanel api={bridge} task={task} />);
  await waitFor(() =>
    expect(screen.getByLabelText("Model token usage")).toHaveTextContent(
      "120 input + 40 output tokens reported across 1 measured request. 1 pending (up to 1,024 output tokens requested; input unknown). 1 request has unknown usage.",
    ),
  );
});
it.each(["approved", "denied"] as const)(
  "records an individual %s decision without dispatching execution",
  async (decision) => {
    const bridge = api();
    const completed: Run = {
      ...run,
      status: "complete",
      commands: [
        {
          id: "check",
          revision: "exact-revision",
          executable: "node",
          args: ["--test", "test.js"],
          cwd: ".",
          reason: "Exercise edge cases",
          timeoutSeconds: 30,
          decision: "pending",
        },
      ],
    };
    bridge.runs = vi.fn().mockResolvedValue([completed]);
    bridge.decideCommand = vi.fn().mockResolvedValue({
      ...completed,
      commands: [{ ...completed.commands![0], decision }],
    });
    render(<RunPanel api={bridge} task={task} />);
    expect(await screen.findByText(/Exercise edge cases/)).toBeInTheDocument();
    expect(
      screen.getByText(/recording approval here does not execute/),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name:
          decision === "approved"
            ? "Record approval for check 1"
            : "Deny check 1",
      }),
    );
    await waitFor(() =>
      expect(bridge.decideCommand).toHaveBeenCalledWith(
        "run",
        "check",
        "exact-revision",
        decision,
      ),
    );
    expect(bridge.startRun).not.toHaveBeenCalled();
    expect(
      await screen.findByText(new RegExp(`Decision: ${decision}`)),
    ).toHaveTextContent("Not executed");
  },
);
it("shows a stale approval error rather than changing its displayed decision", async () => {
  const bridge = api();
  bridge.runs = vi.fn().mockResolvedValue([
    {
      ...run,
      status: "complete",
      commands: [
        {
          id: "check",
          revision: "old",
          executable: "node",
          args: [],
          cwd: ".",
          reason: "Check",
          timeoutSeconds: 30,
          decision: "pending",
        },
      ],
    },
  ]);
  bridge.decideCommand = vi
    .fn()
    .mockRejectedValue(new Error("Draft changed. Approval is stale."));
  render(<RunPanel api={bridge} task={task} />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Record approval for check 1" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("stale");
  expect(screen.getByText(/Decision: pending/)).toBeInTheDocument();
});
it("cannot dispatch without explicit upload and credit approval", async () => {
  const bridge = api();
  render(<RunPanel api={bridge} task={task} />);
  const start = await screen.findByRole("button", { name: "Build and audit" });
  expect(start).toBeDisabled();
  fireEvent.click(start);
  expect(bridge.startRun).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox", { name: /I approve/ }));
  fireEvent.click(start);
  await waitFor(() =>
    expect(bridge.startRun).toHaveBeenCalledWith("run", true),
  );
});
it("surfaces start failure without inventing success", async () => {
  const bridge = api();
  bridge.startRun = vi
    .fn()
    .mockRejectedValue(new Error("Configure Nebius first"));
  render(<RunPanel api={bridge} task={task} />);
  await screen.findByRole("button", { name: "Build and audit" });
  fireEvent.click(screen.getByRole("checkbox", { name: /I approve/ }));
  fireEvent.click(screen.getByRole("button", { name: "Build and audit" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Configure Nebius first",
  );
});
