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
it("offers a passing unchanged corrective recheck for an explicit original-finding decision", async () => {
  const finding = {
    path: "app.js",
    severity: "error" as const,
    detail: "Wrong result",
  };
  const command = {
    executable: "node",
    args: ["app.test.js"],
    cwd: ".",
    reason: "Check behavior",
    timeoutSeconds: 5,
  };
  const lineage = {
    parentRunId: "parent",
    parentCommandId: "original",
    parentExecutionId: "baseline",
    parentCommandRevision: "original-revision",
    testPath: "app.test.js",
    testSha256: "recorded-hash",
    criterion: { exitCode: 0 },
  };
  const parent = {
    id: "parent",
    taskId: "task",
    status: "complete",
    files: [{ path: "app.test.js", content: "assertion" }],
    drafts: [{ path: "app.js", content: "bad", before: null }],
    coordination: { integratedRevision: "rev", auditedRevision: "rev" },
    specialistAudits: [{ revision: "rev", findings: [finding] }],
    commands: [
      {
        ...command,
        id: "original",
        revision: "original-revision",
        findingLink: {
          auditIndex: 0,
          findingIndex: 0,
          revision: "rev",
          ...finding,
          criterion: { exitCode: 0 },
        },
      },
    ],
    executions: [
      {
        id: "baseline",
        runId: "parent",
        commandId: "original",
        revision: "original-revision",
        status: "exited",
        exitCode: 1,
        signal: null,
        output: "assertion failed",
      },
    ],
  } as unknown as Run;
  const child = {
    ...parent,
    id: "child",
    drafts: [{ path: "app.js", content: "fixed", before: null }],
    correction: {
      parentId: "parent",
      parentRevision: "rev",
      auditIndex: 0,
      findingIndex: 0,
      finding,
      parentDrafts: parent.drafts,
      recheck: { ...lineage, command },
    },
    commands: [
      {
        ...command,
        id: "replay",
        revision: "child-revision",
        recheckOf: lineage,
      },
    ],
    executions: [
      {
        id: "candidate",
        runId: "child",
        commandId: "replay",
        revision: "child-revision",
        status: "exited",
        exitCode: 0,
        signal: null,
        output: "assertion passed",
      },
    ],
  } as Run;
  const decideFinding = vi.fn().mockResolvedValue({});
  render(
    <FindingDecisionPanel
      api={{ decideFinding } as unknown as RunAPI}
      run={parent}
      relatedRuns={[parent, child]}
      auditIndex={0}
      findingIndex={0}
    />,
  );
  fireEvent.click(screen.getByText("Review evidence and record a decision"));
  expect(screen.getByText(/Corrective recheck/)).toHaveTextContent("exit 0");
  fireEvent.click(screen.getByLabelText("resolved"));
  fireEvent.change(screen.getByLabelText("Decision reason"), {
    target: { value: "Reviewed the unchanged assertions and corrected output" },
  });
  expect(screen.getByText("Record finding decision")).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: /Corrective recheck/ }));
  fireEvent.click(screen.getByText("Record finding decision"));
  await waitFor(() =>
    expect(decideFinding).toHaveBeenCalledWith(
      "parent",
      expect.objectContaining({
        decision: "resolved",
        evidenceIds: ["candidate"],
      }),
    ),
  );
});
