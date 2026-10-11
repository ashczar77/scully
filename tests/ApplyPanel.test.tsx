import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ApplyPanel } from "../src/renderer/ApplyPanel";
import type { Run } from "../src/shared/runs";
import type { DesktopAPI } from "../src/shared/contracts";
const run = {
  id: "run",
  status: "complete",
  drafts: [{ path: "a.txt", before: "old", content: "new" }],
  findings: [],
  executions: [],
} as unknown as Run;
function api() {
  return {
    reviewApply: vi.fn().mockResolvedValue({
      token: "one-use",
      destination: "/chosen/project",
      revision: "revision",
      expiresAt: "2026-10-09T20:00:00Z",
      files: run.drafts,
    }),
    applyDraft: vi.fn().mockResolvedValue(run),
  } as unknown as DesktopAPI;
}
it("requires fresh permission and shows the exact destination and contents", async () => {
  const bridge = api();
  render(<ApplyPanel run={run} api={bridge} />);
  fireEvent.click(
    screen.getByRole("button", { name: "Choose destination and review" }),
  );
  const apply = await screen.findByRole("button", {
    name: "Apply reviewed files",
  });
  expect(apply).toBeDisabled();
  expect(screen.getByText("/chosen/project")).toBeInTheDocument();
  expect(screen.getByText("old")).toBeInTheDocument();
  expect(screen.getByText("new")).toBeInTheDocument();
  fireEvent.click(apply);
  expect(bridge.applyDraft).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox", { name: /I approve writing/ }));
  fireEvent.click(apply);
  await waitFor(() =>
    expect(bridge.applyDraft).toHaveBeenCalledWith("one-use", true),
  );
});
it("cancel writes nothing and conflicts remain errors, not success", async () => {
  const bridge = api();
  render(<ApplyPanel run={run} api={bridge} />);
  fireEvent.click(
    screen.getByRole("button", { name: "Choose destination and review" }),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Cancel apply review" }),
  );
  expect(bridge.applyDraft).not.toHaveBeenCalled();
  vi.mocked(bridge.reviewApply).mockRejectedValueOnce(
    new Error("Conflict at a.txt"),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Choose destination and review" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("Conflict");
});
it("shows a read-only recovery inspection without offering an automatic restore", async () => {
  const bridge = {
    inspectApplyRecovery: vi.fn().mockResolvedValue({
      applicationId: "application",
      recordStatus: "failed",
      manifest: "consistent",
      checkedAt: "2026-10-11T10:00:00Z",
      files: [
        {
          path: "a.txt",
          recordedWritten: true,
          pending: false,
          backup: "matches_baseline",
          destination: "different",
        },
      ],
    }),
  } as unknown as DesktopAPI;
  render(
    <ApplyPanel
      run={{
        ...run,
        applications: [
          {
            id: "application",
            status: "failed",
            destination: "/chosen/project",
            backupDirectory: "/private/backups/application",
            revision: "revision",
            written: ["a.txt"],
            pendingPath: "",
            error: "Partial write",
            startedAt: "2026-10-11T09:00:00Z",
          },
        ],
      }}
      api={bridge}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Inspect recovery state" }),
  );
  await screen.findByText(/Backup matches saved baseline/);
  expect(bridge.inspectApplyRecovery).toHaveBeenCalledWith(
    "run",
    "application",
  );
  expect(screen.getByText(/Destination differs from both/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /restore/i })).toBeNull();
});
