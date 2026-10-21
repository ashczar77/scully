import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { CollaborativeRoom } from "../src/renderer/CollaborativeRoom";
import {
  askCollaborationQuestion,
  createCollaboration,
  manifestFor,
  sendCollaborationMessage,
} from "../src/shared/collaboration";
import type { DesktopAPI } from "../src/shared/contracts";
import type { Run } from "../src/shared/runs";

function fixture() {
  const files = [{ path: "app.ts", content: "base" }];
  const state = createCollaboration(
    "task",
    {
      projectPath: "/tmp/project",
      projectDev: 1,
      projectIno: 2,
      projectId: "local",
      mode: "local",
      baseImageId: null,
      manifest: manifestFor(files),
      allowedCommands: [],
      approvedAt: "now",
    },
    files,
    [
      {
        id: "maya",
        name: "Maya",
        role: "builder",
        permissions: ["read", "edit"],
        model: "model",
        thinking: "off",
      },
      {
        id: "jun",
        name: "Jun",
        role: "tester",
        permissions: ["read", "check"],
        model: "model",
        thinking: "off",
      },
    ],
  );
  const question = askCollaborationQuestion(
    state,
    "maya",
    "user",
    "Which framework?",
    state.baseId,
  );
  sendCollaborationMessage(
    state,
    "jun",
    "maya",
    "**Tests ready**\n\n- Keyboard\n- Focus",
    state.baseId,
  );
  const run: Run = {
    id: "run",
    taskId: "task",
    taskSnapshot: { title: "Build", description: "Example", mode: "work" },
    sourceName: "project",
    files,
    status: "building",
    events: [],
    plan: "",
    drafts: [],
    findings: [],
    checks: [],
    error: "",
    calls: 0,
    model: "model",
    outputTokens: 2048,
    collaboration: state,
  };
  const api = {
    sendCollaborationMessage: vi
      .fn()
      .mockResolvedValue({ run, event: state.events.at(-1) }),
    continueTeammate: vi.fn().mockResolvedValue(run),
  } as unknown as DesktopAPI;
  return { state, question, run, api };
}

it("renders real teammate messages, Markdown and a question owned by its asker", async () => {
  const { run, api } = fixture();
  render(<CollaborativeRoom api={api} run={run} team={[]} onRun={vi.fn()} />);
  expect(screen.getByText("Tests ready")).toBeInTheDocument();
  expect(screen.getByText("Keyboard").closest("li")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: /Maya: Which framework/ }),
  ).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: /Maya: Which framework/ }),
  );
  const composer = screen.getByRole("textbox", { name: "Message the team" });
  expect(composer).toHaveFocus();
  fireEvent.change(composer, {
    target: { value: "Vue works for me, and keep keyboard support." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() =>
    expect(api.sendCollaborationMessage).toHaveBeenCalledWith(
      "run",
      "Vue works for me, and keep keyboard support.",
      "maya",
      expect.any(String),
    ),
  );
});

it("keeps the composer available during a teammate pause and sends direct messages", async () => {
  const { run, api, state } = fixture();
  state.members[1].status = "paused";
  render(<CollaborativeRoom api={api} run={run} team={[]} onRun={vi.fn()} />);
  expect(
    screen.getByRole("textbox", { name: "Message the team" }),
  ).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() =>
    expect(api.continueTeammate).toHaveBeenCalledWith("run", "jun"),
  );
  fireEvent.change(screen.getByRole("combobox", { name: "To" }), {
    target: { value: "jun" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Message the team" }), {
    target: { value: "Please inspect Maya's checkpoint." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() =>
    expect(api.sendCollaborationMessage).toHaveBeenCalledWith(
      "run",
      "Please inspect Maya's checkpoint.",
      "jun",
      undefined,
    ),
  );
});
