import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { CostPanel } from "../src/renderer/CostPanel";
import type { DesktopAPI } from "../src/shared/contracts";
import type { Run } from "../src/shared/runs";

const run = { id: "run", model: "custom/model" } as Run;
const snapshot = {
  model: "custom/model",
  settings: { budgetCents: null, manualRate: null },
  rate: null,
  referenceRate: null,
  rateStatus: "unknown",
  totals: {
    verifiedNanoUsd: 0,
    estimatedNanoUsd: 0,
    unpricedMeasured: 1,
    unknownUsage: 1,
    pendingProjectedNanoUsd: 0,
    unpricedPending: 1,
  },
  nextProjectedNanoUsd: null,
  budgetExposureNanoUsd: 0,
};

it("shows unknown portions and saves a model-bound user estimate", async () => {
  const costForRun = vi.fn().mockResolvedValue(snapshot);
  const configureCost = vi.fn().mockResolvedValue({
    ...snapshot,
    settings: {
      budgetCents: 125,
      manualRate: {
        model: "custom/model",
        inputMilliUsdPerMillion: 100,
        outputMilliUsdPerMillion: 200,
        checkedAt: "2026-10-11",
        source: "user_supplied",
        sourceUrl: null,
      },
    },
  });
  render(
    <CostPanel
      run={run}
      api={{ costForRun, configureCost } as unknown as DesktopAPI}
    />,
  );
  await screen.findByText(/Their cost is unknown/);
  expect(
    screen.getByText(/Nebius Sandboxes: 0 check attempts/),
  ).toHaveTextContent("Their dollar cost is unknown");
  expect(
    screen.getByText(/Tavily: not connected in this build/),
  ).toHaveTextContent("no Tavily requests");
  expect(
    screen.getByText(/Next request projection: unknown/),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("USD warning budget"), {
    target: { value: "1.25" },
  });
  fireEvent.click(screen.getByLabelText(/Use a user supplied rate/));
  fireEvent.change(screen.getByLabelText("Input USD per million tokens"), {
    target: { value: "0.100" },
  });
  fireEvent.change(screen.getByLabelText("Output USD per million tokens"), {
    target: { value: "0.200" },
  });
  fireEvent.change(screen.getByLabelText("Rate checked date"), {
    target: { value: "2026-10-11" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save cost settings" }));
  await waitFor(() =>
    expect(configureCost).toHaveBeenCalledWith("run", {
      budgetCents: 125,
      manualRate: {
        model: "custom/model",
        inputMilliUsdPerMillion: 100,
        outputMilliUsdPerMillion: 200,
        checkedAt: "2026-10-11",
        source: "user_supplied",
        sourceUrl: null,
      },
    }),
  );
});

it("shows recorded Sandbox attempts without adding a fictional dollar amount", async () => {
  const costForRun = vi.fn().mockResolvedValue(snapshot);
  const cloudRun = {
    ...run,
    cloudExecutions: [
      { id: "cloud-1", status: "complete" },
      { id: "cloud-2", status: "submission_unknown" },
    ],
  } as Run;
  render(
    <CostPanel run={cloudRun} api={{ costForRun } as unknown as DesktopAPI} />,
  );
  await screen.findByText(/Nebius Sandboxes: 2 check attempts/);
  expect(
    screen.getByText(/Nebius Sandboxes: 2 check attempts/),
  ).toHaveTextContent("dollar cost is unknown");
});
