import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ChangesPanel, layoutGitGraph } from "../src/renderer/ChangesPanel";
import type { DesktopAPI, Task } from "../src/shared/contracts";
import type { GitCommit } from "../src/shared/git-history";
import type { Run } from "../src/shared/runs";

const task: Task = {
  id: "task",
  title: "Build an app",
  description: "",
  mode: "plan",
  createdAt: "now",
};
const run = {
  id: "run",
  taskId: "task",
  sourceName: "New project",
  files: [],
  status: "complete",
  workspaceMode: "direct",
  projectWorkspace: { path: "/tmp/project", kind: "new", dev: 1, ino: 1 },
  events: [],
  plan: "",
  drafts: [],
  findings: [],
  checks: [],
  error: "",
  calls: 0,
  model: "",
  outputTokens: 2048,
} as Run;
const commits: GitCommit[] = [
  {
    hash: "a".repeat(40),
    parents: ["b".repeat(40)],
    subject: "Latest work",
    author: "Maya",
    date: "2026-10-17T10:00:00Z",
    refs: ["HEAD -> main"],
  },
  {
    hash: "b".repeat(40),
    parents: [],
    subject: "Start project",
    author: "Pearl",
    date: "2026-10-16T10:00:00Z",
    refs: [],
  },
];

it("offers Git setup and Pearl's help when the selected project has no repository", async () => {
  const ask = vi.fn();
  const api = {
    gitHistory: vi.fn().mockResolvedValue({ state: "no-repository" }),
    initializeGit: vi.fn().mockResolvedValue({
      state: "ready",
      branch: "main",
      branches: ["main"],
      commits: [],
      changes: [],
    }),
  } as unknown as DesktopAPI;
  render(
    <ChangesPanel api={api} task={task} run={run} loaded onAskPearl={ask} />,
  );
  expect(
    await screen.findByText("Set up Git for this project"),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Ask Pearl for help" }));
  expect(ask).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Initialize Git here" }));
  await waitFor(() => expect(api.initializeGit).toHaveBeenCalledWith("run"));
  expect(await screen.findByText(/No commits yet/)).toBeInTheDocument();
});

it("shows actual commit metadata and uncommitted files in the graph", async () => {
  const api = {
    gitHistory: vi.fn().mockResolvedValue({
      state: "ready",
      branch: "main",
      branches: ["main", "feature/reading-list"],
      commits,
      changes: [{ status: " M", path: "src/app.ts" }],
    }),
  } as unknown as DesktopAPI;
  render(
    <ChangesPanel
      api={api}
      task={task}
      run={run}
      loaded
      onAskPearl={vi.fn()}
    />,
  );
  expect(
    await screen.findByRole("heading", { name: "Latest work" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Start project")).toBeInTheDocument();
  expect(screen.getByText("src/app.ts")).toBeInTheDocument();
  expect(screen.getByText("feature/reading-list")).toBeInTheDocument();
  expect(screen.getAllByText("HEAD -> main")).toHaveLength(2);
  expect(layoutGitGraph(commits).map((row) => row.lane)).toEqual([0, 0]);
});

it("draws separate lanes for the parents of a merge commit", () => {
  const merge: GitCommit[] = [
    {
      ...commits[0],
      hash: "d".repeat(40),
      parents: ["c".repeat(40), "b".repeat(40)],
    },
    { ...commits[0], hash: "c".repeat(40), parents: ["a".repeat(40)] },
    { ...commits[0], hash: "b".repeat(40), parents: ["a".repeat(40)] },
    { ...commits[0], hash: "a".repeat(40), parents: [] },
  ];
  const rows = layoutGitGraph(merge);
  expect(rows.map((row) => row.lane)).toEqual([0, 0, 1, 0]);
  expect(rows[0].outgoing).toEqual(["c".repeat(40), "b".repeat(40)]);
});
