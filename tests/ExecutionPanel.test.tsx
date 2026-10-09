import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ExecutionPanel } from "../src/renderer/ExecutionPanel";
import type { DesktopAPI } from "../src/shared/contracts";
import type { Run } from "../src/shared/runs";
const run = {
  id: "run",
  status: "complete",
  commands: [{ id: "check", executable: "node", decision: "approved" }],
  executions: [],
} as unknown as Run;
function bridge() {
  return {
    reviewExecution: vi.fn().mockResolvedValue({
      token: "one-use",
      runId: "run",
      commandId: "check",
      revision: "revision",
      executable: "/resolved/node",
      executableHash: "hash",
      args: ["--test"],
      cwd: "/private/copy",
      timeoutSeconds: 30,
      expiresAt: "2026-10-08T20:00:00Z",
    }),
    executeCommand: vi.fn().mockResolvedValue(run),
    stopExecution: vi.fn(),
  } as unknown as DesktopAPI;
}
it("requires a fresh checkbox despite old approval and displays exact launch context", async () => {
  const api = bridge();
  render(<ExecutionPanel api={api} run={run} />);
  fireEvent.click(
    screen.getByRole("button", { name: /Review local execution/ }),
  );
  const start = await screen.findByRole("button", {
    name: "Approve and run locally",
  });
  expect(start).toBeDisabled();
  expect(screen.getByText(/resolved\/node/)).toHaveTextContent("/private/copy");
  fireEvent.click(start);
  expect(api.executeCommand).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox", { name: /I permit/ }));
  fireEvent.click(start);
  await waitFor(() =>
    expect(api.executeCommand).toHaveBeenCalledWith("one-use", true),
  );
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
});
it("cancel does not execute and preflight errors remain visible", async () => {
  const api = bridge();
  render(<ExecutionPanel api={api} run={run} />);
  fireEvent.click(
    screen.getByRole("button", { name: /Review local execution/ }),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Cancel execution review" }),
  );
  expect(api.executeCommand).not.toHaveBeenCalled();
  vi.mocked(api.reviewExecution).mockRejectedValueOnce(
    new Error("Runtime not found"),
  );
  fireEvent.click(
    screen.getByRole("button", { name: /Review local execution/ }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Runtime not found",
  );
});
it("shows actual exit failure without calling it a passing test", () => {
  render(
    <ExecutionPanel
      api={bridge()}
      run={{
        ...run,
        executions: [
          {
            id: "execution",
            executable: "/node",
            status: "exited",
            exitCode: 7,
            revision: "revision",
            output: "assertion failed",
            args: [],
            error: "",
          } as never,
        ],
      }}
    />,
  );
  expect(screen.getByText(/Exit code: 7/)).toBeInTheDocument();
  expect(screen.getByText(/did not exit successfully/)).toBeInTheDocument();
  expect(screen.getByLabelText("Command output")).toHaveTextContent(
    "assertion failed",
  );
});
