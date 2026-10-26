import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { PearlSandboxInspector } from "../src/renderer/PearlSandboxInspector";
import type { DesktopAPI } from "../src/shared/contracts";
import type { PearlChat } from "../src/shared/pearl-chat";

it("shows checkpoint files, verified content, diffs and recorded checks without local sync", async () => {
  const chat = {
    id: "11111111-1111-1111-1111-111111111111",
    status: "idle",
    sandbox: {
      activeBranchId: "main",
      branches: [
        { id: "main", name: "Main", headImage: "checkpoint-id", checks: [] },
      ],
      operations: [],
    },
  } as unknown as PearlChat;
  const snapshot = vi.fn(async () => ({
    branch: "Main",
    checkpoint: "checkpoint-id",
    files: [{ path: "src/main.ts", changed: true, sha256: "hash" }],
    operations: [
      {
        stage: "write",
        status: "complete",
        remoteId: "operation-id",
        resultImageId: "checkpoint-id",
        at: "now",
      },
    ],
    checks: [
      {
        command: "node",
        args: ["test.mjs"],
        exitCode: 0,
        passed: true,
        at: "now",
        stdout: "ok",
        stderr: "",
      },
    ],
  }));
  const inspect = vi.fn(async () => ({
    path: "src/main.ts",
    before: "old",
    after: "new",
    binary: false,
  }));
  const api = {
    pearlSandboxSnapshot: snapshot,
    inspectPearlSandboxFile: inspect,
  } as unknown as DesktopAPI;
  const view = render(
    <PearlSandboxInspector
      api={api}
      chat={chat}
      onClose={() => {}}
      width={420}
      onResizeStart={() => {}}
    />,
  );
  fireEvent.click(await screen.findByRole("button", { name: /src\/main.ts/ }));
  await waitFor(() =>
    expect(inspect).toHaveBeenCalledWith(chat.id, "src/main.ts"),
  );
  expect(screen.getByLabelText("Sandbox file diff")).toHaveTextContent("new");
  view.rerender(
    <PearlSandboxInspector
      api={api}
      chat={{ ...chat, status: "running" }}
      onClose={() => {}}
      width={420}
      onResizeStart={() => {}}
    />,
  );
  expect(snapshot).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText("Sandbox file diff")).toHaveTextContent("new");
  view.rerender(
    <PearlSandboxInspector
      api={api}
      chat={{
        ...chat,
        status: "running",
        sandbox: {
          ...chat.sandbox!,
          operations: [
            {
              stage: "write",
              status: "submitted",
              remoteId: "operation-id",
              at: "now",
            },
          ],
        },
      }}
      onClose={() => {}}
      width={420}
      onResizeStart={() => {}}
    />,
  );
  await waitFor(() => expect(snapshot).toHaveBeenCalledTimes(2));
  expect(screen.getByLabelText("Sandbox file diff")).toHaveTextContent("new");
  fireEvent.click(screen.getByRole("tab", { name: "Activity" }));
  expect(screen.getByText("write")).toBeInTheDocument();
  expect(screen.getByText(/Check: node test.mjs/)).toBeInTheDocument();
});
