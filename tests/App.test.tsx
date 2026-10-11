import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { App } from "../src/renderer/App";
import { initialTeam, type DesktopAPI } from "../src/shared/contracts";
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
  load: vi.fn().mockResolvedValue({ tasks: [], teammates: initialTeam }),
  createTask: vi.fn(),
  updateTeammate: vi.fn(),
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
it("labels illustrative activity and keeps execution unavailable", async () => {
  render(<App api={api()} />);
  expect(await screen.findByText(/Example conversation/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Review code" })).toBeDisabled();
});
it("navigates to honest empty and settings states", async () => {
  render(<App api={api()} />);
  await screen.findByText("Team room");
  fireEvent.click(screen.getByRole("button", { name: "Changes" }));
  expect(screen.getByText(/No changes yet/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  expect(
    screen.getByText("Approve each command individually"),
  ).toBeInTheDocument();
});
it("opens the selected full profile", async () => {
  render(<App api={api()} />);
  await screen.findByText("Team room");
  fireEvent.click(screen.getByRole("button", { name: "Open full profile" }));
  expect(screen.getByText("Working instructions")).toBeInTheDocument();
});
it("shows load failure instead of pretending to have saved state", async () => {
  const bridge = api();
  bridge.load = vi.fn().mockRejectedValue(new Error("disk"));
  render(<App api={bridge} />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "could not be loaded",
  );
});
