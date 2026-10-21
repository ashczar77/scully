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

it("does not expose unfinished draft analysis", async () => {
  const api = {
    runs: vi.fn().mockResolvedValue([
      {
        plan: "## Overview\nBuild a list.\n\n## Active Lineup\nMaya builds.\n\n## User Decisions Required\n1. Which framework?",
      },
    ]),
    copyText: vi.fn().mockResolvedValue(undefined),
  } as unknown as DesktopAPI;
  render(<TaskPlan api={api} task={task} />);
  await screen.findByText("Reading list").catch(() => {});
  expect(screen.queryByRole("region", { name: "Draft analysis" })).toBeNull();
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

it("keeps durable pending questions private from the plan view", async () => {
  const api = {
    runs: vi.fn().mockResolvedValue([
      {
        plan: "## Overview\nBuild a list.\n\n## Active Lineup\nMaya builds.",
        planning: {
          version: 1,
          questions: [
            {
              id: "storage-choice",
              text: "Where should the list be stored?",
              recommendation: "Use local storage for this small app.",
              status: "pending",
              askedAt: "2026-10-16T00:00:00.000Z",
            },
          ],
          consultations: [],
        },
      },
    ]),
    copyText: vi.fn().mockResolvedValue(undefined),
  } as unknown as DesktopAPI;
  render(<TaskPlan api={api} task={{ ...task, mode: "work" }} />);
  expect(screen.queryByRole("region", { name: "Draft analysis" })).toBeNull();
  expect(screen.queryByText("Maya builds.")).toBeNull();
});

it("shows the approved structured plan as complete without a legacy lineup record", async () => {
  const api = {
    runs: vi.fn().mockResolvedValue([
      {
        plan: "## Overview\nBuild a list.\n\n## Active Lineup\nMaya builds.",
        planning: {
          version: 1,
          questions: [],
          consultations: [],
          approved: {
            planRevision: "revision",
            assignments: [],
            approvedAt: "2026-10-16T00:00:00.000Z",
          },
          proposal: {
            planRevision: "revision",
            assignments: [],
            rationale: "Ready",
          },
        },
      },
    ]),
    copyText: vi.fn().mockResolvedValue(undefined),
  } as unknown as DesktopAPI;
  render(<TaskPlan api={api} task={{ ...task, mode: "work" }} />);
  expect(
    await screen.findByRole("region", { name: "Full plan" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Maya builds.")).toBeInTheDocument();
});
