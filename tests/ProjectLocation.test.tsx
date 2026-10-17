import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ProjectLocation } from "../src/renderer/ProjectLocation";
import type { DesktopAPI } from "../src/shared/contracts";
import type { Run } from "../src/shared/runs";

it("asks for a folder during planning and shows the selected working directory", async () => {
  const run: Run = {
    id: "run",
    taskId: "task",
    sourceName: "New project",
    workspaceMode: "direct",
    files: [],
    drafts: [],
    status: "planned",
    events: [],
    plan: "",
    findings: [],
    checks: [],
    error: "",
    calls: 0,
    model: "",
    outputTokens: 2048,
  };
  const updated = {
    ...run,
    projectWorkspace: {
      path: "/tmp/reading-list",
      kind: "new",
      dev: 1,
      ino: 2,
    },
  } as Run;
  const chooseProjectWorkspace = vi.fn().mockResolvedValue(updated);
  const onUpdated = vi.fn();
  const { rerender } = render(
    <ProjectLocation
      api={{ chooseProjectWorkspace } as unknown as DesktopAPI}
      run={run}
      onUpdated={onUpdated}
    />,
  );
  expect(
    screen.getByText(/Where should the team create this project/),
  ).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Choose project folder" }),
  );
  await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(updated));
  rerender(
    <ProjectLocation
      api={{ chooseProjectWorkspace } as unknown as DesktopAPI}
      run={updated}
      onUpdated={onUpdated}
    />,
  );
  expect(screen.getByText("/tmp/reading-list")).toBeInTheDocument();
});
