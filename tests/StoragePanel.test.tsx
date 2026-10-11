import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { RunAPI } from "../src/shared/runs";
import { StoragePanel } from "../src/renderer/StoragePanel";

it("shows bounded read-only totals without offering deletion", async () => {
  const inspectLocalArtifacts = vi.fn().mockResolvedValue({
    checkedAt: "2026-10-11T10:00:00Z",
    categories: [
      {
        kind: "drafts",
        status: "complete",
        items: 2,
        files: 4,
        logicalBytes: 150,
        scannedEntries: 6,
        skipped: 0,
      },
      {
        kind: "executions",
        status: "partial",
        items: 1,
        files: 1,
        logicalBytes: 9,
        scannedEntries: 2,
        skipped: 1,
      },
      {
        kind: "applications",
        status: "missing",
        items: 0,
        files: 0,
        logicalBytes: 0,
        scannedEntries: 0,
        skipped: 0,
      },
    ],
    executionCopyLinks: {
      status: "partial",
      matchingSavedRuns: 1,
      unassigned: null,
      scanned: 1,
    },
  });
  render(<StoragePanel api={{ inspectLocalArtifacts } as unknown as RunAPI} />);
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh storage inventory" }),
  );
  expect(
    await screen.findByText(/2 items, 4 files, 150 bytes/),
  ).toBeInTheDocument();
  expect(screen.getByText(/Partial count/)).toBeInTheDocument();
  expect(
    screen.getByText(/At least 1 name matches a saved run/),
  ).toBeInTheDocument();
  expect(inspectLocalArtifacts).toHaveBeenCalledTimes(1);
  expect(
    screen.queryByRole("button", { name: /delete|remove|clear/i }),
  ).toBeNull();
});

it("reports inventory failure without presenting zero as a measured total", async () => {
  const inspectLocalArtifacts = vi.fn().mockRejectedValue(new Error("disk"));
  render(<StoragePanel api={{ inspectLocalArtifacts } as unknown as RunAPI} />);
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh storage inventory" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Storage inventory unavailable",
  );
  expect(screen.queryByText(/0 items/)).toBeNull();
});

it("shows complete name classification as a clue, not cleanup permission", async () => {
  const inspectLocalArtifacts = vi.fn().mockResolvedValue({
    checkedAt: "2026-10-11T10:00:00Z",
    categories: [],
    executionCopyLinks: {
      status: "complete",
      matchingSavedRuns: 2,
      unassigned: 1,
      scanned: 3,
    },
  });
  render(<StoragePanel api={{ inspectLocalArtifacts } as unknown as RunAPI} />);
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh storage inventory" }),
  );
  expect(
    await screen.findByText(/2 match saved runs; 1 are legacy or unassigned/),
  ).toBeInTheDocument();
  expect(screen.getByText(/does not prove/)).toBeInTheDocument();
});
