import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import {
  PearlWorkspacePanel,
  reviewLines,
} from "../src/renderer/PearlWorkspacePanel";
import type { PearlChat } from "../src/shared/pearl-chat";
import type { DesktopAPI } from "../src/shared/contracts";

const turnId = "12345678-1234-1234-1234-123456789abc";
const chat: PearlChat = {
  id: "12345678-1234-1234-1234-123456789abd",
  title: "Update notes",
  createdAt: "2026-10-24T00:00:00Z",
  updatedAt: "2026-10-24T00:00:00Z",
  status: "idle",
  messages: [],
  questions: [],
  project: { path: "/tmp/project", dev: 1, ino: 1, approved: true },
  taskChanges: [
    {
      turnId,
      at: "2026-10-24T00:00:00Z",
      files: [
        { path: "notes.txt", kind: "modified", beforeBytes: 3, afterBytes: 3 },
      ],
      undoAvailable: true,
    },
  ],
};

it("renders added and removed lines from a task review", async () => {
  expect(reviewLines("old\nkeep", "new\nkeep")).toEqual([
    { kind: "removed", text: "old" },
    { kind: "added", text: "new" },
    { kind: "same", text: "keep" },
  ]);
  const undo = vi.fn();
  const onOpenFile = vi.fn();
  const api = {
    reviewPearlTaskFile: vi.fn(async () => ({
      path: "notes.txt",
      before: "old\n",
      after: "new\n",
      binary: false,
    })),
  } as unknown as DesktopAPI;
  render(
    <PearlWorkspacePanel
      api={api}
      chat={chat}
      inspector={{ kind: "review", turnId }}
      width={420}
      onResizeStart={() => {}}
      onClose={() => {}}
      onUndo={undo}
      onOpenFile={onOpenFile}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /modified notes.txt/ }));
  await waitFor(() =>
    expect(onOpenFile).toHaveBeenCalledWith(
      expect.objectContaining({
        review: expect.objectContaining({ before: "old\n", after: "new\n" }),
      }),
    ),
  );
  expect(screen.queryByLabelText("File preview")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Undo task changes" }));
  expect(undo).toHaveBeenCalledWith(turnId);
});

it("opens nested project files in a read-only preview", async () => {
  const onOpenFile = vi.fn();
  const api = {
    listPearlProjectFiles: vi.fn(async (_id: string, path?: string) =>
      path
        ? [{ path: "src/app.ts", kind: "file", size: 4 }]
        : [{ path: "src", kind: "directory" }],
    ),
    readPearlProjectFile: vi.fn(async () => "const app = true;"),
  } as unknown as DesktopAPI;
  render(
    <PearlWorkspacePanel
      api={api}
      chat={chat}
      inspector={{ kind: "files" }}
      width={420}
      onResizeStart={() => {}}
      onClose={() => {}}
      onUndo={() => {}}
      onOpenFile={onOpenFile}
    />,
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "src" })).toBeInTheDocument(),
  );
  fireEvent.click(screen.getByRole("button", { name: "src" }));
  fireEvent.click(await screen.findByRole("button", { name: /app.ts/ }));
  await waitFor(() =>
    expect(onOpenFile).toHaveBeenCalledWith({
      path: "src/app.ts",
      content: "const app = true;",
    }),
  );
  expect(screen.queryByRole("textbox")).toBeNull();
});

it("renders untrusted source as text and never activates markup in the preview", async () => {
  const onOpenFile = vi.fn();
  const api = {
    listPearlProjectFiles: vi.fn(async () => [
      { path: "index.html", kind: "file", size: 32 },
    ]),
    readPearlProjectFile: vi.fn(
      async () => "<script>window.exploited = true</script>",
    ),
  } as unknown as DesktopAPI;
  render(
    <PearlWorkspacePanel
      api={api}
      chat={chat}
      inspector={{ kind: "files" }}
      width={420}
      onResizeStart={() => {}}
      onClose={() => {}}
      onUndo={() => {}}
      onOpenFile={onOpenFile}
    />,
  );
  fireEvent.click(await screen.findByRole("button", { name: "index.html" }));
  await waitFor(() =>
    expect(onOpenFile).toHaveBeenCalledWith({
      path: "index.html",
      content: "<script>window.exploited = true</script>",
    }),
  );
  expect(document.querySelector("script")).toBeNull();
});

it("shows Git branch, working changes and commits as a read-only timeline", async () => {
  const onOpenFile = vi.fn();
  const api = {
    pearlGitView: vi.fn(async () => ({
      state: "ready",
      branch: "main",
      changes: [{ status: "M", path: "src/app.ts" }],
      commits: [
        {
          hash: "abcdef0123456789",
          subject: "Update app",
          author: "A",
          date: "2026-10-24T00:00:00Z",
        },
      ],
    })),
    pearlGitCommitFiles: vi.fn(async () => [
      { status: "M", path: "src/app.ts" },
    ]),
    pearlGitDiff: vi.fn(async () => "+new line"),
  } as unknown as DesktopAPI;
  render(
    <PearlWorkspacePanel
      api={api}
      chat={chat}
      inspector={{ kind: "git" }}
      width={420}
      onResizeStart={() => {}}
      onClose={() => {}}
      onUndo={() => {}}
      onOpenFile={onOpenFile}
    />,
  );
  expect(await screen.findByText("Update app")).toBeInTheDocument();
  expect(screen.getByText("Current branch")).toBeInTheDocument();
  expect(screen.getByText("Commit history")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Update app/ }));
  fireEvent.click(
    (await screen.findAllByRole("button", { name: /src\/app.ts/ })).at(-1)!,
  );
  await waitFor(() =>
    expect(onOpenFile).toHaveBeenCalledWith({
      path: "src/app.ts",
      content: "+new line",
    }),
  );
  expect(screen.queryByRole("button", { name: /Commit$/ })).toBeNull();
});

it("loads the next folder page when the first page is full", async () => {
  const api = {
    listPearlProjectFiles: vi.fn(
      async (_id: string, _path?: string, offset?: number) =>
        offset === 500
          ? [{ path: "last.txt", kind: "file", size: 1 }]
          : Array.from({ length: 500 }, (_, index) => ({
              path: `file-${index}.txt`,
              kind: "file",
              size: 1,
            })),
    ),
  } as unknown as DesktopAPI;
  render(
    <PearlWorkspacePanel
      api={api}
      chat={chat}
      inspector={{ kind: "files" }}
      width={420}
      onResizeStart={() => {}}
      onClose={() => {}}
      onUndo={() => {}}
      onOpenFile={() => {}}
    />,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Load more files" }),
  );
  expect(
    await screen.findByRole("button", { name: /last.txt/ }),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Load more files" })).toBeNull();
});
