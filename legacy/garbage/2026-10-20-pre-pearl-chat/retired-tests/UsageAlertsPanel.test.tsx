import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { UsageAlertsPanel } from "../src/renderer/UsageAlertsPanel";
import {
  defaultUsageAlertPolicy,
  emptyUsageAlertState,
} from "../src/shared/usage-alerts";
import type { DesktopAPI } from "../src/shared/contracts";
import type { Run } from "../src/shared/runs";

const run = { id: "run", status: "building" } as Run;
const usage = {
  requests: 2,
  measured: 1,
  unknown: 1,
  pending: 0,
  inputTokens: 5000,
  outputTokens: 1000,
  pendingMaxOutputTokens: 0,
};

it("shows a held request and requires the current pause ID for a single continuation", async () => {
  const state = {
    ...emptyUsageAlertState(),
    pauseId: "current",
    pauseReason: "unknown" as const,
    latest: {
      kind: "unknown" as const,
      text: "Usage is unknown.",
      at: "now",
      sequence: 1,
    },
    sequence: 1,
  };
  const bridge = {
    usageAlertsForRun: vi.fn().mockResolvedValue({
      policy: defaultUsageAlertPolicy,
      state,
      waiting: true,
    }),
    continueUsage: vi.fn().mockResolvedValue({
      policy: defaultUsageAlertPolicy,
      state: { ...state, pauseId: null },
      waiting: false,
    }),
  } as unknown as DesktopAPI;
  const save = vi.fn();
  const stop = vi.fn();
  render(
    <UsageAlertsPanel
      run={run}
      usage={usage}
      api={bridge}
      onSaveTokens={save}
      onStop={stop}
    />,
  );
  await screen.findByText(/Usage is unknown/);
  expect(
    screen.getByText(/next model request has not been sent/),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Lower future usage" }));
  expect(save).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Continue once" }));
  await waitFor(() =>
    expect(bridge.continueUsage).toHaveBeenCalledWith("run", "current"),
  );
  expect(
    screen.queryByRole("button", { name: "Continue once" }),
  ).not.toBeInTheDocument();
});

it("saves warning-only and local notification choices without dispatching work", async () => {
  const configure = vi.fn().mockImplementation(async (_id, value) => ({
    policy: value,
    state: emptyUsageAlertState(),
    waiting: false,
  }));
  const bridge = {
    usageAlertsForRun: vi.fn().mockResolvedValue({
      policy: defaultUsageAlertPolicy,
      state: emptyUsageAlertState(),
      waiting: false,
    }),
    configureUsageAlerts: configure,
  } as unknown as DesktopAPI;
  render(
    <UsageAlertsPanel
      run={run}
      usage={usage}
      api={bridge}
      onSaveTokens={vi.fn()}
      onStop={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByText("Configure usage alerts"));
  await screen.findByLabelText("Run token budget");
  fireEvent.change(screen.getByLabelText("Run token budget"), {
    target: { value: "12000" },
  });
  fireEvent.change(screen.getByLabelText("At the budget or unknown usage"), {
    target: { value: "warn" },
  });
  fireEvent.change(screen.getByLabelText("Delivery"), {
    target: { value: "desktop" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save alert settings" }));
  await waitFor(() =>
    expect(configure).toHaveBeenCalledWith(
      "run",
      expect.objectContaining({
        budgetTokens: 12000,
        mode: "warn",
        delivery: "desktop",
      }),
    ),
  );
});
