import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { SpecialistPanel } from "../src/renderer/SpecialistPanel";
import { makeCoordination } from "../src/shared/coordination";
import type { Run, RunAPI } from "../src/shared/runs";
it("shows actual check output without resolving findings and labels old evidence stale", () => {
  const run = {
    status: "complete",
    coordination: {
      ...makeCoordination(),
      integratedRevision: "snapshot",
      auditedRevision: "snapshot",
    },
    specialistAudits: [
      {
        kind: "testing",
        revision: "snapshot",
        status: "needs-review",
        calls: 2,
        summary: "Issue",
        response: "Check it",
        findings: [{ path: "app.js", severity: "warning", detail: "Issue" }],
      },
    ],
    commands: [
      {
        id: "check",
        revision: "command",
        reason: "Check input",
        findingLink: {
          auditIndex: 0,
          findingIndex: 0,
          revision: "snapshot",
          path: "app.js",
          severity: "warning",
          detail: "Issue",
          expected: "Reject invalid input",
        },
      },
    ],
    executions: [
      {
        id: "execution",
        commandId: "check",
        revision: "command",
        status: "exited",
        exitCode: 0,
        output: "fixture output",
      },
    ],
  } as Run;
  const view = render(<SpecialistPanel run={run} api={{} as RunAPI} />);
  // Evidence is visible both beside the check and inside the decision review.
  expect(screen.getAllByText("fixture output")).toHaveLength(2);
  expect(screen.getByText(/Matches reviewed proposal/)).toBeInTheDocument();
  expect(screen.getByText(/Execution does not resolve/)).toBeInTheDocument();
  const changed = structuredClone(run);
  changed.specialistAudits![0].findings[0].detail = "New concern";
  view.rerender(<SpecialistPanel run={changed} api={{} as RunAPI} />);
  expect(screen.getByText(/Stale evidence/)).toBeInTheDocument();
  expect(screen.getByText(/Stale finding link/)).toBeInTheDocument();
});
it("requires fresh approval when the audit focus changes and sends the exact revision", async () => {
  const startAudit = vi.fn().mockResolvedValue({});
  render(
    <SpecialistPanel
      api={{ startAudit } as unknown as RunAPI}
      run={
        {
          id: "run",
          status: "complete",
          coordination: {
            ...makeCoordination(),
            integratedRevision: "revision",
          },
        } as Run
      }
    />,
  );
  fireEvent.click(screen.getByText("Audit testing"));
  expect(screen.getByText("Dispatch testing auditor")).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByText("Audit security"));
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByText("Dispatch security auditor"));
  await waitFor(() =>
    expect(startAudit).toHaveBeenCalledWith(
      "run",
      "security",
      "revision",
      true,
    ),
  );
});
