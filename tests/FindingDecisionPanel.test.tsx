import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { FindingDecisionPanel } from "../src/renderer/FindingDecisionPanel";
import type { Run, RunAPI } from "../src/shared/runs";
it("requires a reason and prevents resolution without evidence", async () => {
  const decideFinding = vi.fn().mockResolvedValue({});
  render(
    <FindingDecisionPanel
      api={{ decideFinding } as unknown as RunAPI}
      auditIndex={0}
      findingIndex={0}
      run={
        {
          id: "r",
          status: "complete",
          specialistAudits: [
            {
              revision: "rev",
              findings: [{ path: "a", severity: "warning", detail: "Issue" }],
            },
          ],
        } as Run
      }
    />,
  );
  fireEvent.click(screen.getByText("Review evidence and record a decision"));
  expect(screen.getByText("Record finding decision")).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Decision reason"), {
    target: { value: "Known limitation" },
  });
  fireEvent.click(screen.getByLabelText("resolved"));
  expect(screen.getByText("Record finding decision")).toBeDisabled();
  fireEvent.click(screen.getByLabelText("accepted-risk"));
  fireEvent.click(screen.getByText("Record finding decision"));
  await waitFor(() =>
    expect(decideFinding).toHaveBeenCalledWith(
      "r",
      expect.objectContaining({
        decision: "accepted-risk",
        reason: "Known limitation",
        evidenceIds: [],
      }),
    ),
  );
});
