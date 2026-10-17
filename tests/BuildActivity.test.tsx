import { expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BuildActivity } from "../src/renderer/BuildActivity";
import type { Run } from "../src/shared/runs";

const run = (status: Run["status"]): Run => ({
  id: "run",
  taskId: "task",
  sourceName: "New project",
  files: [],
  status,
  events: [
    {
      actor: "maya",
      actorName: "Maya",
      text: "I am drafting the app.",
      at: "2026-10-16T12:00:00Z",
    },
  ],
  plan: "",
  drafts: [],
  findings: [],
  checks: [],
  error: "",
  calls: 1,
  model: "model",
  outputTokens: 2048,
});

it("shows live build stages and explains when there is no terminal output", () => {
  const view = render(<BuildActivity run={run("building")} />);
  expect(
    screen.getByRole("log", { name: "Build stage log" }),
  ).toHaveTextContent("Maya");
  expect(screen.getByText(/No commands have run/)).toBeInTheDocument();
  expect(screen.getByText(/No model request diagnostics/)).toBeInTheDocument();
  view.rerender(<BuildActivity run={run("failed")} />);
  expect(screen.getByText(/This attempt stopped/)).toBeInTheDocument();
});

it("shows captured output only for a command that actually ran", () => {
  const completed = run("complete");
  completed.executions = [
    {
      id: "execution",
      runId: "run",
      commandId: "check",
      revision: "revision",
      executable: "npm",
      executableHash: "hash",
      args: ["test"],
      cwd: ".",
      timeoutSeconds: 30,
      status: "exited",
      startedAt: "2026-10-16T12:00:00Z",
      exitCode: 0,
      signal: null,
      output: "1 test passed",
      error: "",
    },
  ];
  render(<BuildActivity run={completed} />);
  expect(screen.getByText("1 test passed")).toBeInTheDocument();
  expect(screen.queryByText(/No commands have run/)).not.toBeInTheDocument();
});
