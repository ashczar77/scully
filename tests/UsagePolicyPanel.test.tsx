import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { UsagePolicyPanel } from "../src/renderer/UsagePolicyPanel";
import type { Run } from "../src/shared/runs";
import type { DesktopAPI } from "../src/shared/contracts";

const run: Run = {
  id: "run",
  taskId: "task",
  sourceName: "New project",
  files: [],
  status: "planned",
  events: [],
  plan: "Plan",
  drafts: [],
  findings: [],
  checks: [],
  error: "",
  calls: 1,
  model: "model",
  outputTokens: 2048,
  usagePolicy: {
    preset: "balanced",
    model: "model",
    outputTokens: 2048,
    requestCeiling: 4,
    earlyReviews: false,
  },
};
const session = { configured: true, model: "model", outputTokens: 2048 };

it("applies Save tokens for the remaining requests in one click", async () => {
  const configureUsagePolicy = vi.fn().mockResolvedValue({
    ...run,
    usagePolicy: { ...run.usagePolicy, preset: "save", outputTokens: 1024 },
  });
  const onUpdate = vi.fn();
  render(
    <UsagePolicyPanel
      run={run}
      mode="plan"
      session={session}
      api={{ configureUsagePolicy } as unknown as DesktopAPI}
      onUpdate={onUpdate}
    />,
  );
  expect(screen.getByText(/Model: model/)).toHaveTextContent(
    "price have not been verified",
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: "Save tokens for the rest of this run",
    }),
  );
  await waitFor(() =>
    expect(configureUsagePolicy).toHaveBeenCalledWith(
      "run",
      { preset: "save" },
      null,
    ),
  );
  expect(onUpdate).toHaveBeenCalled();
});

it("shows the larger Thorough allowance before one-click approval and blocks Custom increases without review", async () => {
  const configureUsagePolicy = vi.fn().mockResolvedValue(run);
  const reviewUsagePolicy = vi
    .fn()
    .mockResolvedValue({ token: "one-use-token" });
  render(
    <UsagePolicyPanel
      run={run}
      mode="plan"
      session={session}
      api={{ configureUsagePolicy, reviewUsagePolicy } as unknown as DesktopAPI}
      onUpdate={vi.fn()}
    />,
  );
  const thorough = screen.getByRole("button", { name: "Apply Thorough" });
  expect(thorough).toHaveTextContent(
    "4096 output tokens per request, 6 coordinator requests, early reviews on. Increases allowance.",
  );
  fireEvent.click(thorough);
  await waitFor(() =>
    expect(reviewUsagePolicy).toHaveBeenCalledWith("run", {
      preset: "thorough",
    }),
  );
  await waitFor(() =>
    expect(configureUsagePolicy).toHaveBeenCalledWith(
      "run",
      { preset: "thorough" },
      "one-use-token",
    ),
  );
  fireEvent.click(screen.getByText("Custom usage settings"));
  fireEvent.change(screen.getByLabelText("Maximum output tokens per request"), {
    target: { value: "3000" },
  });
  expect(screen.getByRole("button", { name: "Apply Custom" })).toBeDisabled();
  fireEvent.click(
    screen.getByLabelText(
      "I reviewed the increased request or output allowance.",
    ),
  );
  expect(screen.getByRole("button", { name: "Apply Custom" })).toBeEnabled();
});
