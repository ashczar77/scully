// @vitest-environment node
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { expect, it } from "vitest";
import { inspectLocalArtifacts } from "../src/main/artifacts";

it("counts only app-owned artifact roots without reading or changing file content", () => {
  const root = mkdtempSync(join(tmpdir(), "scully-artifacts-"));
  try {
    mkdirSync(join(root, "drafts", "run-a"), { recursive: true });
    mkdirSync(join(root, "executions", "check-a"), { recursive: true });
    mkdirSync(join(root, "applications", "app-a"), { recursive: true });
    writeFileSync(join(root, "drafts", "run-a", "draft.txt"), "draft");
    writeFileSync(join(root, "executions", "check-a", "output.txt"), "check");
    writeFileSync(join(root, "applications", "app-a", "manifest.json"), "{}");
    writeFileSync(join(root, "workspace.sqlite"), "private database");
    const result = inspectLocalArtifacts(root);
    expect(result.categories).toMatchObject([
      {
        kind: "drafts",
        status: "complete",
        items: 1,
        files: 1,
        logicalBytes: 5,
      },
      {
        kind: "executions",
        status: "complete",
        items: 1,
        files: 1,
        logicalBytes: 5,
      },
      {
        kind: "applications",
        status: "complete",
        items: 1,
        files: 1,
        logicalBytes: 2,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain(root);
    expect(JSON.stringify(result)).not.toContain("private database");
    expect(
      readFileSync(join(root, "drafts", "run-a", "draft.txt"), "utf8"),
    ).toBe("draft");
    expect(readFileSync(join(root, "workspace.sqlite"), "utf8")).toBe(
      "private database",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("does not follow symlinked category roots or nested entries", () => {
  const root = mkdtempSync(join(tmpdir(), "scully-artifacts-"));
  const outside = mkdtempSync(join(tmpdir(), "scully-artifacts-outside-"));
  try {
    writeFileSync(join(outside, "secret"), "sensitive");
    symlinkSync(outside, join(root, "drafts"));
    mkdirSync(join(root, "executions", "check-a"), { recursive: true });
    symlinkSync(outside, join(root, "executions", "check-a", "link"));
    const result = inspectLocalArtifacts(root);
    expect(result.categories[0]).toMatchObject({
      kind: "drafts",
      status: "unavailable",
      files: 0,
      logicalBytes: 0,
    });
    expect(result.categories[1]).toMatchObject({
      kind: "executions",
      status: "partial",
      files: 0,
      logicalBytes: 0,
      skipped: 1,
    });
    expect(result.categories[2].status).toBe("missing");
    expect(result.executionCopyLinks.status).toBe("partial");
    expect(readFileSync(join(outside, "secret"), "utf8")).toBe("sensitive");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

it("bounds traversal and reports incomplete totals honestly", () => {
  const root = mkdtempSync(join(tmpdir(), "scully-artifacts-"));
  try {
    mkdirSync(join(root, "drafts"));
    for (let i = 0; i < 8; i++)
      writeFileSync(join(root, "drafts", `file-${i}`), "x");
    const result = inspectLocalArtifacts(root, 3);
    expect(result.categories[0]).toMatchObject({
      status: "partial",
      scannedEntries: 3,
    });
    expect(result.categories[0].logicalBytes).toBeLessThanOrEqual(3);
    expect(result.categories[0].items).toBeLessThanOrEqual(3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("stops at the depth limit instead of scanning unbounded nesting", () => {
  const root = mkdtempSync(join(tmpdir(), "scully-artifacts-"));
  try {
    let nested = join(root, "drafts");
    mkdirSync(nested);
    for (let i = 0; i < 14; i++) {
      nested = join(nested, `level-${i}`);
      mkdirSync(nested);
    }
    writeFileSync(join(nested, "deep.txt"), "deep");
    expect(inspectLocalArtifacts(root).categories[0]).toMatchObject({
      status: "partial",
      files: 0,
      logicalBytes: 0,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("marks an unexpected regular file at a category root unavailable", () => {
  const root = mkdtempSync(join(tmpdir(), "scully-artifacts-"));
  try {
    writeFileSync(join(root, "applications"), "not a directory");
    expect(inspectLocalArtifacts(root).categories[2]).toMatchObject({
      status: "unavailable",
      items: 0,
      logicalBytes: 0,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("classifies check copy names against saved runs without returning paths", () => {
  const root = mkdtempSync(join(tmpdir(), "scully-artifacts-"));
  const owner = createHash("sha256").update("run-a").digest("hex");
  const unknown = createHash("sha256").update("run-b").digest("hex");
  try {
    mkdirSync(join(root, "executions", `check-r-${owner}-ABC123`), {
      recursive: true,
    });
    mkdirSync(join(root, "executions", `check-r-${unknown}-ABC123`));
    mkdirSync(join(root, "executions", "check-legacy"));
    const inventory = inspectLocalArtifacts(root, 2000, ["run-a"], true);
    expect(inventory.executionCopyLinks).toEqual({
      status: "complete",
      matchingSavedRuns: 1,
      unassigned: 2,
      scanned: 3,
    });
    expect(JSON.stringify(inventory)).not.toContain(root);
    expect(JSON.stringify(inventory)).not.toContain("run-a");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("does not call unknown copies unassigned when the saved run list is incomplete", () => {
  const root = mkdtempSync(join(tmpdir(), "scully-artifacts-"));
  try {
    mkdirSync(join(root, "executions", "check-legacy"), {
      recursive: true,
    });
    expect(
      inspectLocalArtifacts(root, 2000, [], false).executionCopyLinks,
    ).toEqual({
      status: "partial",
      matchingSavedRuns: 0,
      unassigned: null,
      scanned: 1,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("bounds copy-name classification and rejects a symlinked execution root", () => {
  const root = mkdtempSync(join(tmpdir(), "scully-artifacts-"));
  const outside = mkdtempSync(join(tmpdir(), "scully-artifacts-outside-"));
  try {
    mkdirSync(join(root, "executions"));
    for (let i = 0; i < 5; i++)
      mkdirSync(join(root, "executions", `check-old-${i}`));
    expect(inspectLocalArtifacts(root, 2, [], true).executionCopyLinks).toEqual(
      {
        status: "partial",
        matchingSavedRuns: 0,
        unassigned: 2,
        scanned: 2,
      },
    );
    rmSync(join(root, "executions"), { recursive: true });
    symlinkSync(outside, join(root, "executions"));
    expect(inspectLocalArtifacts(root, 2, [], true).executionCopyLinks).toEqual(
      {
        status: "unavailable",
        matchingSavedRuns: 0,
        unassigned: null,
        scanned: 0,
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
