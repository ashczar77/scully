import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { MetricsPanel } from "../src/renderer/MetricsPanel";
import type { RunAPI } from "../src/shared/runs";
it("shows retained counts and duration without treating returned as a test pass", async () => {
  const metrics = vi.fn().mockResolvedValue({
    capacity: 1000,
    retentionMs: 86400000,
    events: [
      {
        version: 1,
        at: 1,
        operation: "run:start",
        outcome: "returned",
        durationMs: 20,
      },
    ],
  });
  render(<MetricsPanel api={{ metrics } as unknown as RunAPI} />);
  expect(metrics).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Refresh local metrics"));
  expect(
    await screen.findByText(/run:start · returned: 1 events · mean 20 ms/),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/not that a task or test passed/),
  ).toBeInTheDocument();
});
