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
  const onOpenFile = vi.fn();
  const view = render(
    <PearlSandboxInspector
      api={api}
      chat={chat}
      onClose={() => {}}
      width={420}
      onResizeStart={() => {}}
      onOpenFile={onOpenFile}
    />,
  );
  fireEvent.click(await screen.findByRole("button", { name: /src\/main.ts/ }));
  await waitFor(() =>
    expect(inspect).toHaveBeenCalledWith(chat.id, "src/main.ts"),
  );
  expect(onOpenFile).toHaveBeenCalledWith(
    expect.objectContaining({ after: "new" }),
  );
  view.rerender(
    <PearlSandboxInspector
      api={api}
      chat={{ ...chat, status: "running" }}
      onClose={() => {}}
      width={420}
      onResizeStart={() => {}}
      onOpenFile={onOpenFile}
    />,
  );
  expect(snapshot).toHaveBeenCalledTimes(1);
  expect(screen.queryByLabelText("Sandbox file diff")).toBeNull();
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
      onOpenFile={onOpenFile}
    />,
  );
  await waitFor(() => expect(snapshot).toHaveBeenCalledTimes(2));
  expect(onOpenFile).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("tab", { name: "Activity" }));
  expect(screen.getByText("write")).toBeInTheDocument();
  expect(screen.getByText(/Check: node test.mjs/)).toBeInTheDocument();
});

it("keeps the previous file tree visible while the next checkpoint loads", async () => {
  let finish: ((value: unknown) => void) | undefined;
  const snapshot = vi
    .fn()
    .mockResolvedValueOnce({
      branch: "Main",
      checkpoint: "first",
      files: [{ path: "first.ts", changed: true, sha256: "a" }],
      operations: [],
      checks: [],
    })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
  const chat = {
    id: "11111111-1111-1111-1111-111111111111",
    status: "running",
    sandbox: {
      activeBranchId: "main",
      branches: [{ id: "main", name: "Main", headImage: "first", checks: [] }],
      operations: [],
    },
  } as unknown as PearlChat;
  const api = { pearlSandboxSnapshot: snapshot } as unknown as DesktopAPI;
  const view = render(
    <PearlSandboxInspector
      api={api}
      chat={chat}
      onClose={() => {}}
      width={420}
      onResizeStart={() => {}}
      onOpenFile={() => {}}
    />,
  );
  expect(
    await screen.findByRole("button", { name: "first.ts" }),
  ).toBeInTheDocument();
  view.rerender(
    <PearlSandboxInspector
      api={api}
      chat={{
        ...chat,
        sandbox: {
          ...chat.sandbox!,
          branches: [
            {
              id: "main",
              name: "Main",
              headImage: "second",
              checks: [],
              files: {},
            },
          ],
        },
      }}
      onClose={() => {}}
      width={420}
      onResizeStart={() => {}}
      onOpenFile={() => {}}
    />,
  );
  await waitFor(() => expect(snapshot).toHaveBeenCalledTimes(2));
  expect(screen.getByRole("button", { name: "first.ts" })).toBeInTheDocument();
  finish?.({
    branch: "Main",
    checkpoint: "second",
    files: [{ path: "second.ts", changed: true, sha256: "b" }],
    operations: [],
    checks: [],
  });
  expect(
    await screen.findByRole("button", { name: "second.ts" }),
  ).toBeInTheDocument();
});
