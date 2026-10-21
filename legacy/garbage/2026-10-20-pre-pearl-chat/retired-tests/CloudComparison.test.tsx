import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import {
  CloudComparison,
  comparisonGroups,
  invocationDifferences,
} from "../src/renderer/CloudComparison";
import type { CloudExecution } from "../src/shared/cloud";
import type { CommandProposal } from "../src/shared/commands";

const commands = [
  {
    id: "first-command",
    revision: "revision-a",
    executable: "node",
    args: ["test.js"],
    cwd: ".",
    reason: "Check the behavior",
    timeoutSeconds: 30,
    decision: "approved",
  },
  {
    id: "second-command",
    revision: "revision-a",
    executable: "npm",
    args: ["test"],
    cwd: ".",
    reason: "Compare another check",
    timeoutSeconds: 30,
    decision: "approved",
  },
] as CommandProposal[];

function execution(
  id: string,
  overrides: Partial<CloudExecution> = {},
): CloudExecution {
  return {
    id,
    runId: "run",
    commandId: "first-command",
    revision: "revision-a",
    projectId: "project-a",
    image: "image-a",
    imageTag: "node:22",
    executable: "/usr/bin/node",
    args: ["test.js"],
    cwd: "/workspace",
    timeoutSeconds: 30,
    files: [],
    status: "complete",
    operationId: `operation-${id}`,
    remoteStatus: "SUCCESS",
    startedAt: "2026-10-09T10:00:00Z",
    commandPassed: true,
    exitCode: 0,
    stdout: "baseline output",
    stderr: "",
    error: "",
    ...overrides,
  };
}

it("groups only confirmed completed checks from an identical source", () => {
  const comparable = [
    execution("one"),
    execution("two", { commandId: "second-command" }),
  ];
  const unrelated = [
    execution("other-image", { image: "image-b" }),
    execution("other-project", { projectId: "project-b" }),
    execution("other-revision", { revision: "revision-b" }),
    execution("unfinished", { status: "submitted" }),
    execution("unconfirmed", { operationId: null }),
  ];
  const groups = comparisonGroups([...comparable, ...unrelated], commands);
  expect(groups).toHaveLength(1);
  expect(groups[0].map(({ execution: item }) => item.id)).toEqual([
    "one",
    "two",
  ]);
  expect(groups[0][1].command?.executable).toBe("npm");
});

it("does not attach a command proposal from a different revision", () => {
  const staleCommand = { ...commands[0], revision: "revision-b" };
  const groups = comparisonGroups(
    [execution("one"), execution("two")],
    [staleCommand],
  );
  expect(groups[0][0].command).toBeUndefined();
});

it("requires the exact invocation and uploaded content for a like-for-like check", () => {
  const base = execution("one", {
    files: [
      { path: "app.js", bytes: 10, sha256: "first" },
      { path: "test.js", bytes: 8, sha256: "second" },
    ],
  });
  expect(
    invocationDifferences(
      base,
      execution("two", {
        files: [
          { path: "test.js", bytes: 8, sha256: "second" },
          { path: "app.js", bytes: 10, sha256: "first" },
        ],
      }),
    ),
  ).toEqual([]);
  expect(
    invocationDifferences(
      base,
      execution("two", {
        args: ["other.js"],
        files: [
          { path: "app.js", bytes: 10, sha256: "changed" },
          { path: "test.js", bytes: 8, sha256: "second" },
        ],
      }),
    ),
  ).toEqual(["arguments", "uploaded files"]);
  expect(
    invocationDifferences(
      base,
      execution("two", {
        executable: "/other/node",
        cwd: "/other",
        timeoutSeconds: 60,
      }),
    ),
  ).toEqual(["executable", "working directory", "timeout", "uploaded files"]);
});

it("lets the engineer select a pair and treats matching output as captured text only", () => {
  const runs = [
    execution("one"),
    execution("two", {
      commandId: "second-command",
      stdout: "changed output",
      exitCode: 1,
      commandPassed: false,
    }),
    execution("three", { stdout: "baseline output" }),
  ];
  render(<CloudComparison executions={runs} commands={commands} />);
  const comparison = screen.getByRole("region", {
    name: "Experiment comparison",
  });
  expect(
    within(comparison).getByText(/Same command, arguments/),
  ).toBeInTheDocument();
  expect(
    within(comparison).getByText(/Recorded stdout differs/),
  ).toBeInTheDocument();
  expect(within(comparison).getByText(/Process exit: 1/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Set check 3 as B" }));
  expect(
    within(comparison).getByText(/Recorded stdout matches/),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Set check 3 as B" }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    within(comparison).getByText(/does not prove the approach works/),
  ).toBeInTheDocument();
});

it("does not call different commands a like-for-like result", () => {
  render(
    <CloudComparison
      executions={[
        execution("one"),
        execution("two", {
          args: ["other.js"],
          stdout: "different result",
        }),
      ]}
      commands={commands}
    />,
  );
  expect(
    screen.getByText(/Different check invocation: arguments/),
  ).toBeInTheDocument();
  expect(screen.queryByText(/Recorded stdout differs/)).toBeNull();
});

it("withholds outcome comparison when the service failed or process exit is absent", () => {
  render(
    <CloudComparison
      executions={[
        execution("one"),
        execution("two", {
          remoteStatus: "FAILED",
          exitCode: null,
          stdout: "different result",
        }),
      ]}
      commands={commands}
    />,
  );
  expect(
    screen.getByText(/lacks a successful service result/),
  ).toBeInTheDocument();
  expect(screen.queryByText(/Recorded stdout differs/)).toBeNull();
});

it("renders remote output as text, limits previews, and makes no comparison across different images", () => {
  const malicious = '<img src=x onerror="window.hacked=true">';
  const longOutput = `${malicious}${"x".repeat(2_100)}`;
  const runs = [
    execution("one", { stdout: longOutput }),
    execution("two", { stdout: "other" }),
    execution("different", { image: "image-b" }),
  ];
  render(<CloudComparison executions={runs} commands={commands} />);
  const output = screen.getByLabelText("Check 1 captured stdout");
  expect(output).toHaveTextContent(malicious);
  expect(output.textContent!.length).toBeLessThan(longOutput.length);
  expect(output).toHaveTextContent("Comparison preview ends here");
  expect(document.querySelector("img")).toBeNull();
  expect(screen.queryByRole("button", { name: "Set check 3 as A" })).toBeNull();
});

it("does not show a comparison for only one completed check", () => {
  const { rerender } = render(
    <CloudComparison executions={[execution("one")]} commands={commands} />,
  );
  expect(
    screen.queryByRole("region", { name: "Experiment comparison" }),
  ).toBeNull();
  rerender(
    <CloudComparison
      executions={[execution("one"), execution("two", { status: "failed" })]}
      commands={commands}
    />,
  );
  expect(
    screen.queryByRole("region", { name: "Experiment comparison" }),
  ).toBeNull();
});
