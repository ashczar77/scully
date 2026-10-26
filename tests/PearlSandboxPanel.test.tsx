import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { PearlSandboxPanel } from "../src/renderer/PearlSandboxPanel";
import type { PearlChat } from "../src/shared/pearl-chat";
import type { DesktopAPI } from "../src/shared/contracts";

const id = "11111111-1111-1111-1111-111111111111";
const image = "22222222-2222-2222-2222-222222222222";
const alternate = "33333333-3333-3333-3333-333333333333";
function chat(): PearlChat {
  return {
    id,
    title: "Task",
    createdAt: "2026-10-26T00:00:00Z",
    updatedAt: "2026-10-26T00:00:00Z",
    status: "idle",
    questions: [],
    messages: [],
    project: { path: "/project", dev: 1, ino: 1, approved: true },
  };
}

it("requires a separate manifest review before remote upload", async () => {
  const initial = chat();
  const prepared = {
    ...initial,
    sandbox: {
      status: "prepared",
      active: false,
      projectId: "project",
      projectPath: "/project",
      baseImage: image,
      baseDigest: "digest",
      manifest: [{ path: "main.ts", bytes: 20, sha256: "sha" }],
      excluded: [".env"],
      branches: [],
    },
  } as PearlChat;
  const prepare = vi.fn(async () => prepared);
  const start = vi.fn(async () => prepared);
  const api = {
    pearlSandboxImages: vi.fn(async () => ({
      images: [{ uuid: image, tag: "Node" }],
      limited: false,
    })),
    preparePearlSandbox: prepare,
    startPearlSandbox: start,
  } as unknown as DesktopAPI;
  const onChange = vi.fn();
  const view = render(
    <PearlSandboxPanel
      api={api}
      chat={initial}
      onChange={onChange}
      onSettings={() => {}}
    />,
  );
  expect(start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Work in Sandbox" }));
  await screen.findByRole("button", { name: "Review upload" });
  expect(
    screen.getByRole("button", { name: "Review upload" }).parentElement,
  ).toHaveClass("pearl-sandbox-controls");
  expect(screen.getByText("Local mode")).toHaveClass("local");
  fireEvent.click(screen.getByRole("button", { name: "Review upload" }));
  await waitFor(() => expect(prepare).toHaveBeenCalledWith(id, image));
  expect(start).not.toHaveBeenCalled();
  view.rerender(
    <PearlSandboxPanel
      api={api}
      chat={prepared}
      onChange={onChange}
      onSettings={() => {}}
    />,
  );
  expect(screen.getByText(/Upload 1 eligible files/)).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Upload files and start Sandbox" })
      .parentElement,
  ).toHaveClass("pearl-sandbox-upload-actions");
  fireEvent.click(
    screen.getByRole("button", { name: "Upload files and start Sandbox" }),
  );
  await waitFor(() => expect(start).toHaveBeenCalledWith(id));
});

it("lets a prepared task choose a different base image after a failed start", async () => {
  const prepared = {
    ...chat(),
    sandbox: {
      status: "prepared",
      active: false,
      projectId: "project",
      projectPath: "/project",
      baseImage: image,
      baseDigest: "digest",
      manifest: [{ path: "main.ts", bytes: 20, sha256: "sha" }],
      excluded: [],
      branches: [],
    },
  } as PearlChat;
  const prepare = vi.fn(async () => prepared);
  const api = {
    pearlSandboxImages: vi.fn(async () => ({
      images: [
        { uuid: image, tag: "Node 20 Alpine" },
        { uuid: alternate, tag: "Other Node" },
      ],
      limited: false,
    })),
    preparePearlSandbox: prepare,
    startPearlSandbox: vi.fn(async () => prepared),
  } as unknown as DesktopAPI;
  render(
    <PearlSandboxPanel
      api={api}
      chat={prepared}
      onChange={() => {}}
      onSettings={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Choose another image" }));
  const selector = await screen.findByRole("button", {
    name: "Sandbox base image: Node 20 Alpine",
  });
  fireEvent.click(selector);
  fireEvent.click(screen.getByRole("option", { name: "Other Node" }));
  expect(
    screen.getByRole("button", { name: "Upload files and start Sandbox" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Review new image" }));
  await waitFor(() => expect(prepare).toHaveBeenCalledWith(id, alternate));
});

it("keeps a ready Sandbox compact while exposing a styled branch picker and inspector", async () => {
  const ready = {
    ...chat(),
    sandbox: {
      status: "ready",
      active: true,
      projectId: "project",
      projectPath: "/project",
      baseImage: image,
      baseDigest: "digest",
      manifest: [],
      excluded: [],
      activeBranchId: "main",
      branches: [
        { id: "main", name: "Main", headImage: image, files: {}, checks: [] },
        {
          id: "feature",
          name: "Feature",
          headImage: alternate,
          files: {},
          checks: [],
        },
      ],
    },
  } as PearlChat;
  const onInspect = vi.fn();
  const switchBranch = vi.fn(async () => ready);
  render(
    <PearlSandboxPanel
      api={{ switchPearlSandboxBranch: switchBranch } as unknown as DesktopAPI}
      chat={ready}
      onChange={() => {}}
      onSettings={() => {}}
      onInspect={onInspect}
    />,
  );
  expect(
    screen.getByRole("button", { name: "Expand Sandbox details" }),
  ).toHaveAttribute("aria-expanded", "false");
  expect(
    screen
      .getByRole("button", { name: "Expand Sandbox details" })
      .querySelector("svg"),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Expand Sandbox details" }).textContent,
  ).toBe("");
  expect(screen.getByText("Remote mode")).toHaveClass("remote");
  expect(screen.getByText("ready")).toHaveClass("ready");
  fireEvent.click(screen.getByRole("button", { name: "View Sandbox" }));
  expect(onInspect).toHaveBeenCalledOnce();
  fireEvent.click(
    screen.getByRole("button", { name: "Expand Sandbox details" }),
  );
  expect(screen.getByText("Remote mode active")).toHaveClass("remote");
  expect(screen.getByText("Remote mode active").parentElement).toHaveClass(
    "pearl-sandbox-branch-row",
  );
  fireEvent.click(screen.getByRole("button", { name: "Sandbox branch: Main" }));
  fireEvent.click(screen.getByRole("option", { name: "Feature" }));
  await waitFor(() => expect(switchBranch).toHaveBeenCalledWith(id, "feature"));
});
