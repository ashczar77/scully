import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ConnectionSettings, RunPanel } from "../src/renderer/RunPanel";
import { CollaborativeBuild } from "../src/renderer/CollaborativeBuild";
import {
  createCollaboration,
  manifestFor,
  type CollaborationScope,
} from "../src/shared/collaboration";
import type { DesktopAPI } from "../src/shared/contracts";
import type { Run } from "../src/shared/runs";

const task = {
  id: "task",
  title: "Build",
  description: "Example",
  mode: "work" as const,
  createdAt: "now",
};

it("keeps the output seed in advanced settings and saves an automatic-friendly default", async () => {
  const configureSession = vi.fn().mockResolvedValue({
    configured: true,
    model: "nvidia/nemotron-3-super-120b-a12b",
    outputTokens: 8192,
  });
  const connectionApi = {
    session: vi
      .fn()
      .mockResolvedValue({ configured: false, model: "", outputTokens: 2048 }),
    roleModelSettings: vi
      .fn()
      .mockResolvedValue({ pearl: "nvidia/nemotron-3-super-120b-a12b" }),
    configureSession,
  } as unknown as DesktopAPI;
  render(<ConnectionSettings api={connectionApi} />);
  await waitFor(() => expect(connectionApi.session).toHaveBeenCalled());
  expect(screen.getByText("Advanced request settings")).toBeInTheDocument();
  expect(
    screen.getByLabelText("Default output allowance for older workflows"),
  ).toHaveValue(8192);
  expect(
    screen.getByText(/make bounded retries when a response is incomplete/),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("API key"), {
    target: { value: "test-key-123" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Save session connection" }),
  );
  await waitFor(() =>
    expect(configureSession).toHaveBeenCalledWith({
      key: "test-key-123",
      model: "nvidia/nemotron-3-super-120b-a12b",
      outputTokens: 8192,
    }),
  );
});
const projectWorkspace = {
  path: "/tmp/project",
  kind: "existing" as const,
  dev: 1,
  ino: 2,
};
const files = [{ path: "app.ts", content: "base" }];
const run: Run = {
  id: "run",
  taskId: task.id,
  taskSnapshot: task,
  sourceName: "project",
  workspaceMode: "direct",
  projectWorkspace,
  files,
  status: "prepared",
  events: [],
  plan: "",
  drafts: [],
  findings: [],
  checks: [],
  error: "",
  calls: 0,
  model: "model",
  outputTokens: 2048,
};
const scope: CollaborationScope = {
  projectPath: projectWorkspace.path,
  projectDev: 1,
  projectIno: 2,
  projectId: "local",
  mode: "local",
  baseImageId: null,
  manifest: manifestFor(files),
  allowedCommands: [],
  approvedAt: "now",
};
function started(): Run {
  const state = createCollaboration(task.id, scope, files, [
    {
      id: "maya",
      name: "Maya",
      role: "builder",
      permissions: ["read", "edit", "check"],
      model: "model",
      thinking: "off",
    },
    {
      id: "ellis",
      name: "Ellis",
      role: "auditor",
      permissions: ["read", "check", "audit"],
      model: "model",
      thinking: "off",
    },
  ]);
  return { ...run, status: "building", collaboration: state };
}
function api(current: Run = run) {
  return {
    runs: vi.fn().mockResolvedValue([current]),
    onRun: vi.fn().mockReturnValue(() => {}),
    session: vi.fn().mockResolvedValue({
      configured: true,
      model: "model",
      outputTokens: 2048,
    }),
    usageForRun: vi.fn().mockResolvedValue({
      requests: 0,
      measured: 0,
      unknown: 0,
      pending: 0,
      inputTokens: 0,
      outputTokens: 0,
      pendingMaxOutputTokens: 0,
    }),
    cloudSession: vi
      .fn()
      .mockResolvedValue({ configured: false, projectId: "" }),
    cloudImages: vi.fn().mockResolvedValue({ images: [] }),
    reviewCollaboration: vi.fn().mockResolvedValue({
      token: "scope-token",
      expiresAt: "later",
      mode: "local",
      projectPath: projectWorkspace.path,
      projectId: "local",
      baseImageId: null,
      manifest: manifestFor(files),
      members: [{ id: "maya", role: "builder", permissions: ["read", "edit"] }],
      checks: [],
    }),
    approveCollaboration: vi.fn().mockResolvedValue(started()),
    continueTeammate: vi.fn().mockResolvedValue(started()),
    reviewCollaborationSync: vi.fn().mockResolvedValue({
      token: "sync-token",
      expiresAt: "later",
      projectPath: projectWorkspace.path,
      revision: "revision",
      files: ["app.ts"],
    }),
    approveCollaborationSync: vi.fn().mockResolvedValue(started()),
    reviewSpecialistDispatch: vi.fn().mockResolvedValue({
      token: "dispatch-token",
      teammate: { name: "Sloane", permissions: ["read", "audit"] },
      checkpoint: "revision",
      projectPath: projectWorkspace.path,
      mode: "local",
    }),
    approveSpecialistDispatch: vi.fn().mockResolvedValue(started()),
  } as unknown as DesktopAPI;
}

it("routes a prepared work task to scope review and keeps the selected project visible", async () => {
  const bridge = api();
  render(<RunPanel api={bridge} task={task} />);
  expect(
    await screen.findByRole("region", { name: "Collaborative build" }),
  ).toHaveTextContent(projectWorkspace.path);
  expect(screen.queryByRole("button", { name: "Build and audit" })).toBeNull();
  expect(bridge.startRun).toBeUndefined();
});

it("requires an explicit local-only choice and shows the exact manifest before start", async () => {
  const bridge = api();
  render(<CollaborativeBuild api={bridge} run={run} onRun={vi.fn()} />);
  const review = await screen.findByRole("button", {
    name: "Review project scope",
  });
  expect(review).toBeDisabled();
  fireEvent.click(screen.getByRole("radio", { name: /Local-only/ }));
  fireEvent.click(review);
  expect(
    await screen.findByRole("region", { name: "Approved scope preview" }),
  ).toHaveTextContent("app.ts");
  expect(
    screen.getByRole("region", { name: "Approved scope preview" }),
  ).toHaveTextContent("SHA-256");
  expect(bridge.reviewCollaboration).toHaveBeenCalledWith("run", {
    mode: "local",
    baseImageId: null,
    checks: [],
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Approve and start team" }),
  );
  await waitFor(() =>
    expect(bridge.approveCollaboration).toHaveBeenCalledWith(
      "scope-token",
      true,
    ),
  );
});

it("defaults to configured Sandboxes and shows an image and project identity", async () => {
  const bridge = api();
  bridge.cloudSession = vi
    .fn()
    .mockResolvedValue({ configured: true, projectId: "project-id" });
  bridge.cloudImages = vi
    .fn()
    .mockResolvedValue({ images: [{ uuid: "image-id", tag: "Node image" }] });
  render(<CollaborativeBuild api={bridge} run={run} onRun={vi.fn()} />);
  expect(
    await screen.findByRole("radio", { name: /Nebius Sandboxes/ }),
  ).toBeChecked();
  expect(
    await screen.findByRole("option", { name: "Node image" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Review project scope" }));
  await waitFor(() =>
    expect(bridge.reviewCollaboration).toHaveBeenCalledWith("run", {
      mode: "sandbox",
      baseImageId: "image-id",
      checks: [],
    }),
  );
});

it("shows paused teammate recovery, operation reconciliation and integration conflicts", async () => {
  const current = started();
  const state = current.collaboration!;
  state.members[0].status = "paused";
  state.integration.conflicts = ["app.ts: Maya and Jun changed the same file"];
  state.operations.push({
    id: "operation",
    actor: "maya",
    stage: "upload",
    inputRevision: state.baseId,
    status: "unknown",
    remoteId: "remote",
    resultImageId: null,
    at: "now",
  });
  const bridge = api(current);
  bridge.reconcileCollaboration = vi.fn().mockResolvedValue(current);
  render(<CollaborativeBuild api={bridge} run={current} onRun={vi.fn()} />);
  expect(screen.getByRole("alert")).toHaveTextContent("app.ts");
  fireEvent.click(
    screen.getByRole("button", { name: "Inspect remote status" }),
  );
  await waitFor(() =>
    expect(bridge.reconcileCollaboration).toHaveBeenCalledWith(
      "run",
      "operation",
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() =>
    expect(bridge.continueTeammate).toHaveBeenCalledWith("run", "maya"),
  );
});

it("binds synchronization to the reviewed integration and offers specialist dispatch", async () => {
  const current = started();
  const state = current.collaboration!;
  state.auditedHeadId = state.integration.headId;
  state.synchronizedHeadId = null;
  const bridge = api(current);
  render(<CollaborativeBuild api={bridge} run={current} onRun={vi.fn()} />);
  fireEvent.click(
    screen.getByRole("button", { name: "Review synchronization" }),
  );
  expect(
    await screen.findByText("Synchronize reviewed files"),
  ).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Apply to selected folder" }),
  );
  await waitFor(() =>
    expect(bridge.approveCollaborationSync).toHaveBeenCalledWith(
      "sync-token",
      true,
    ),
  );
  fireEvent.change(screen.getByRole("combobox", { name: "Specialist" }), {
    target: { value: "sloane" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Review dispatch" }));
  await waitFor(() =>
    expect(bridge.reviewSpecialistDispatch).toHaveBeenCalledWith(
      "run",
      "sloane",
      ["read", "audit"],
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Approve specialist" }));
  await waitFor(() =>
    expect(bridge.approveSpecialistDispatch).toHaveBeenCalledWith(
      "dispatch-token",
      true,
    ),
  );
});
