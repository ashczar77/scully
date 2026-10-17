import React from "react";
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { TaskPlan } from "../src/renderer/TaskPlan";
import type { DesktopAPI, Task } from "../src/shared/contracts";

const task: Task = {
  id: "task-1",
  title: "Reading list",
  description: "Build a reading list",
  mode: "plan",
  createdAt: "2026-10-16T00:00:00.000Z",
};

it("labels an unfinished plan as a draft and omits premature team sections", async () => {
  const api = {
    runs: vi.fn().mockResolvedValue([
      {
        plan: "## Overview\nBuild a list.\n\n## Active Lineup\nMaya builds.\n\n## User Decisions Required\n1. Which framework?",
      },
    ]),
    copyText: vi.fn().mockResolvedValue(undefined),
  } as unknown as DesktopAPI;
  render(<TaskPlan api={api} task={task} />);
  expect(
    await screen.findByRole("region", { name: "Draft analysis" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Which framework?")).toBeInTheDocument();
  expect(screen.queryByText("Maya builds.")).toBeNull();
});

it("shows the full analysis after the team and plan are approved", async () => {
  const api = {
    runs: vi.fn().mockResolvedValue([
      {
        plan: "## Overview\nBuild a list.\n\n## Active Lineup\nMaya builds.",
        approvedLineup: { planRevision: "revision", entries: [] },
      },
    ]),
    copyText: vi.fn().mockResolvedValue(undefined),
  } as unknown as DesktopAPI;
  render(<TaskPlan api={api} task={task} />);
  expect(
    await screen.findByRole("region", { name: "Full plan" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Maya builds.")).toBeInTheDocument();
});
