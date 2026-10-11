// @vitest-environment node
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  linkSync,
  statSync,
  chmodSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { ApplyManager } from "../src/main/apply-manager";
import { Store } from "../src/main/store";
import type { Run } from "../src/shared/runs";
import { makeCoordination } from "../src/shared/coordination";

function setup(beforeWrite?: (path: string) => void) {
  const root = mkdtempSync(join(tmpdir(), "scully-apply-test-"));
  const data = join(root, "data");
  const destination = join(root, "project");
  mkdirSync(data);
  mkdirSync(destination);
  const store = new Store(join(data, "db.sqlite"));
  const task = store.createTask({
    title: "Apply fixture",
    description: "",
    mode: "work",
  });
  const run: Run = {
    id: "run",
    taskId: task.id,
    sourceName: "Fixture",
    status: "complete",
    files: [
      { path: "main.txt", content: "original long text" },
      { path: "context.txt", content: "context" },
    ],
    drafts: [
      { path: "main.txt", before: "original long text", content: "new" },
      { path: "nested/added.txt", before: null, content: "added" },
    ],
    events: [],
    plan: "",
    findings: [],
    checks: [],
    error: "",
    calls: 0,
    model: "",
    outputTokens: 0,
  };
  for (const f of run.files)
    writeFileSync(join(destination, f.path), f.content);
  writeFileSync(join(destination, "unrelated.txt"), "user work");
  store.saveRun(run);
  const manager = new ApplyManager(store, data, vi.fn(), beforeWrite);
  return {
    root,
    data,
    destination,
    run,
    store,
    manager,
    cleanup() {
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
it("will not apply a coordinated draft with a stale final audit", () => {
  const c = setup();
  try {
    c.run.coordination = makeCoordination();
    c.run.coordination.integratedRevision = "old";
    c.run.coordination.auditedRevision = "old";
    c.store.saveRun(c.run);
    expect(() => c.manager.review(c.run.id, c.destination)).toThrow(
      "revision-bound audit",
    );
  } finally {
    c.cleanup();
  }
});
it("applies reviewed files, preserves unrelated edits/mode, truncates shorter replacements and retains originals", () => {
  const c = setup();
  try {
    chmodSync(join(c.destination, "main.txt"), 0o640);
    const review = c.manager.review(c.run.id, c.destination);
    expect(readFileSync(join(c.destination, "main.txt"), "utf8")).toBe(
      "original long text",
    );
    const result = c.manager.apply(review.token, true).applications![0];
    expect(result.status).toBe("applied");
    expect(result.written).toEqual(["main.txt", "nested/added.txt"]);
    expect(readFileSync(join(c.destination, "main.txt"), "utf8")).toBe("new");
    expect(statSync(join(c.destination, "main.txt")).mode & 0o777).toBe(0o640);
    expect(readFileSync(join(c.destination, "nested/added.txt"), "utf8")).toBe(
      "added",
    );
    expect(readFileSync(join(c.destination, "unrelated.txt"), "utf8")).toBe(
      "user work",
    );
    expect(
      readFileSync(join(result.backupDirectory, "originals/main.txt"), "utf8"),
    ).toBe("original long text");
    expect(
      JSON.parse(
        readFileSync(join(result.backupDirectory, "manifest.json"), "utf8"),
      ).status,
    ).toBe("applied");
    expect(() => c.manager.apply(review.token, true)).toThrow();
    expect(() => c.manager.review(c.run.id, c.destination)).toThrow("already");
  } finally {
    c.cleanup();
  }
});
it("supports a new project and does not overwrite existing files", () => {
  const c = setup();
  try {
    c.run.files = [];
    c.run.drafts = [
      { path: "index.txt", content: "new project", before: null },
    ];
    c.store.saveRun(c.run);
    writeFileSync(join(c.destination, "index.txt"), "existing user data");
    expect(() => c.manager.review(c.run.id, c.destination)).toThrow("Conflict");
    const empty = join(c.root, "empty");
    mkdirSync(empty);
    const r = c.manager.review(c.run.id, empty);
    expect(c.manager.apply(r.token, true).applications![0].status).toBe(
      "applied",
    );
    expect(readFileSync(join(empty, "index.txt"), "utf8")).toBe("new project");
  } finally {
    c.cleanup();
  }
});
it.each([false, null, "yes"])(
  "requires explicit consent %j and consumes the ticket",
  (value) => {
    const c = setup();
    try {
      const r = c.manager.review(c.run.id, c.destination);
      expect(() => c.manager.apply(r.token, value)).toThrow("permission");
      expect(() => c.manager.apply(r.token, true)).toThrow("review");
      expect(readFileSync(join(c.destination, "main.txt"), "utf8")).toBe(
        "original long text",
      );
    } finally {
      c.cleanup();
    }
  },
);
it.each([
  "edited",
  "context",
  "new-collision",
  "symlink",
  "hardlink",
  "case",
  "parent-file",
  "traversal",
])("blocks %s without destination writes", (kind) => {
  const c = setup();
  try {
    if (kind === "edited")
      writeFileSync(join(c.destination, "main.txt"), "user edited");
    if (kind === "context")
      writeFileSync(join(c.destination, "context.txt"), "new context");
    if (kind === "new-collision") {
      mkdirSync(join(c.destination, "nested"));
      writeFileSync(join(c.destination, "nested/added.txt"), "user file");
    }
    if (kind === "symlink") symlinkSync(c.root, join(c.destination, "nested"));
    if (kind === "hardlink")
      linkSync(join(c.destination, "main.txt"), join(c.root, "alias"));
    if (kind === "case") mkdirSync(join(c.destination, "Nested"));
    if (kind === "parent-file")
      writeFileSync(join(c.destination, "nested"), "not a directory");
    if (kind === "traversal") {
      c.run.drafts[1].path = "../escape";
      c.store.saveRun(c.run);
    }
    expect(() => c.manager.review(c.run.id, c.destination)).toThrow();
    expect(c.store.getRun(c.run.id).applications).toBeUndefined();
    expect(readFileSync(join(c.destination, "main.txt"), "utf8")).toBe(
      kind === "edited" ? "user edited" : "original long text",
    );
  } finally {
    c.cleanup();
  }
});
it.each([
  "destination",
  "draft",
  "findings",
  "specialist",
  "decision",
  "expired",
])("invalidates review after %s changes", (kind) => {
  const c = setup();
  try {
    const r = c.manager.review(c.run.id, c.destination);
    if (kind === "destination")
      writeFileSync(join(c.destination, "main.txt"), "user changed");
    if (kind === "draft") {
      c.run.drafts[0].content = "changed";
      c.store.saveRun(c.run);
    }
    if (kind === "findings") {
      c.run.findings = [
        { path: "main.txt", severity: "error", detail: "New finding" },
      ];
      c.store.saveRun(c.run);
    }
    const clock =
      kind === "specialist"
        ? null
        : kind === "expired"
          ? vi.spyOn(Date, "now").mockReturnValue(Date.parse(r.expiresAt) + 1)
          : null;
    if (kind === "decision") {
      c.run.findingDecisions = [
        {
          auditIndex: 0,
          findingIndex: 0,
          revision: "rev",
          findingKey: "key",
          previousCount: 0,
          decision: "accepted-risk",
          reason: "Known risk",
          evidenceIds: [],
          at: new Date().toISOString(),
        },
      ];
      c.store.saveRun(c.run);
    }
    if (kind === "specialist") {
      c.run.specialistAudits = [
        {
          kind: "security",
          revision: "test",
          status: "needs-review",
          calls: 2,
          summary: "Issue",
          findings: [
            { path: "main.txt", severity: "error", detail: "New issue" },
          ],
          response: "Needs a check",
        },
      ];
      c.store.saveRun(c.run);
    }
    try {
      expect(() => c.manager.apply(r.token, true)).toThrow();
    } finally {
      clock?.mockRestore();
    }
    expect(c.store.getRun(c.run.id).applications).toBeUndefined();
    expect(existsSync(join(c.destination, "nested/added.txt"))).toBe(false);
  } finally {
    c.cleanup();
  }
});
it("records partial application without clobbering an intervening user change", () => {
  let destination = "";
  const c = setup((path) => {
    if (path === "nested/added.txt") {
      mkdirSync(join(destination, "nested"));
      writeFileSync(join(destination, path), "user intervened");
    }
  });
  destination = c.destination;
  try {
    const r = c.manager.review(c.run.id, c.destination);
    const result = c.manager.apply(r.token, true).applications![0];
    expect(result.status).toBe("failed");
    expect(result.written).toEqual(["main.txt"]);
    expect(readFileSync(join(c.destination, "nested/added.txt"), "utf8")).toBe(
      "user intervened",
    );
    expect(
      readFileSync(join(result.backupDirectory, "originals/main.txt"), "utf8"),
    ).toBe("original long text");
    expect(result.error).toContain("No automatic rollback");
  } finally {
    c.cleanup();
  }
});
it("recovers interrupted records without replay and rejects application-data destinations", () => {
  const c = setup();
  try {
    expect(() => c.manager.review(c.run.id, c.data)).toThrow(
      "Application data",
    );
    const r = c.manager.review(c.run.id, c.destination);
    const run = c.manager.apply(r.token, true);
    run.applications![0].status = "applying";
    run.applications![0].error = "";
    delete run.applications![0].finishedAt;
    const manifestPath = join(
      run.applications![0].backupDirectory,
      "manifest.json",
    );
    writeFileSync(
      manifestPath,
      JSON.stringify({
        ...run.applications![0],
        files: run.drafts.map((file) => ({
          path: file.path,
          added: file.before === null,
        })),
      }),
    );
    c.store.saveRun(run);
    c.store.recoverRuns();
    expect(c.store.getRun(c.run.id).applications![0].status).toBe(
      "interrupted",
    );
    expect(readFileSync(join(c.destination, "main.txt"), "utf8")).toBe("new");
    const restarted = new ApplyManager(c.store, c.data, () => {});
    expect(() => restarted.apply(r.token, true)).toThrow("review");
    expect(
      restarted.inspectRecovery(c.run.id, run.applications![0].id).manifest,
    ).toBe("consistent");
  } finally {
    c.cleanup();
  }
});
it("inspects a partial apply after database reopen without changing destination files", () => {
  let destination = "";
  const c = setup((path) => {
    if (path === "nested/added.txt") {
      mkdirSync(join(destination, "nested"));
      writeFileSync(join(destination, path), "user intervened");
    }
  });
  destination = c.destination;
  let reopened: Store | undefined;
  try {
    const review = c.manager.review(c.run.id, c.destination);
    const result = c.manager.apply(review.token, true).applications![0];
    c.store.close();
    reopened = new Store(join(c.data, "db.sqlite"));
    const inspector = new ApplyManager(reopened, c.data, vi.fn());
    const state = inspector.inspectRecovery(c.run.id, result.id);
    expect(state.manifest).toBe("consistent");
    expect(state.recordStatus).toBe("failed");
    expect(state.files).toMatchObject([
      {
        path: "main.txt",
        recordedWritten: true,
        backup: "matches_baseline",
        destination: "draft",
      },
      {
        path: "nested/added.txt",
        recordedWritten: false,
        backup: "not_required",
        destination: "different",
      },
    ]);
    expect(readFileSync(join(c.destination, "main.txt"), "utf8")).toBe("new");
    expect(readFileSync(join(c.destination, "nested/added.txt"), "utf8")).toBe(
      "user intervened",
    );
  } finally {
    reopened?.close();
    rmSync(c.root, { recursive: true, force: true });
  }
});
it("reports missing or changed recovery evidence without trusting it", () => {
  const c = setup();
  try {
    const review = c.manager.review(c.run.id, c.destination);
    const result = c.manager.apply(review.token, true).applications![0];
    writeFileSync(join(result.backupDirectory, "manifest.json"), "broken");
    writeFileSync(
      join(result.backupDirectory, "originals/main.txt"),
      "tampered",
    );
    writeFileSync(join(c.destination, "main.txt"), "later user edit");
    const state = c.manager.inspectRecovery(c.run.id, result.id);
    expect(state.manifest).toBe("unavailable");
    expect(state.files[0]).toMatchObject({
      backup: "different",
      destination: "different",
    });
    writeFileSync(
      join(result.backupDirectory, "manifest.json"),
      JSON.stringify({ ...result, backupDirectory: c.root, files: [] }),
    );
    expect(c.manager.inspectRecovery(c.run.id, result.id).manifest).toBe(
      "diverged",
    );
    rmSync(join(result.backupDirectory, "manifest.json"));
    rmSync(join(result.backupDirectory, "originals/main.txt"));
    const missing = c.manager.inspectRecovery(c.run.id, result.id);
    expect(missing.manifest).toBe("missing");
    expect(missing.files[0].backup).toBe("missing");
  } finally {
    c.cleanup();
  }
});
it("rejects forged recovery paths and never follows symlinked backup evidence", () => {
  const c = setup();
  try {
    const review = c.manager.review(c.run.id, c.destination);
    const result = c.manager.apply(review.token, true).applications![0];
    expect(() => c.manager.inspectRecovery(c.run.id, "../outside")).toThrow();
    expect(() => c.manager.inspectRecovery("missing", result.id)).toThrow();
    const saved = c.store.getRun(c.run.id);
    saved.applications![0].backupDirectory = c.root;
    c.store.saveRun(saved);
    expect(() => c.manager.inspectRecovery(c.run.id, result.id)).toThrow(
      "backup path",
    );
    saved.applications![0].backupDirectory = result.backupDirectory;
    c.store.saveRun(saved);
    rmSync(join(result.backupDirectory, "manifest.json"));
    symlinkSync(
      join(c.destination, "main.txt"),
      join(result.backupDirectory, "manifest.json"),
    );
    expect(c.manager.inspectRecovery(c.run.id, result.id).manifest).toBe(
      "unavailable",
    );
    rmSync(join(result.backupDirectory, "originals/main.txt"));
    symlinkSync(
      join(c.destination, "main.txt"),
      join(result.backupDirectory, "originals/main.txt"),
    );
    expect(c.manager.inspectRecovery(c.run.id, result.id).files[0].backup).toBe(
      "unavailable",
    );
    rmSync(join(c.destination, "main.txt"));
    symlinkSync(
      join(c.destination, "context.txt"),
      join(c.destination, "main.txt"),
    );
    expect(
      c.manager.inspectRecovery(c.run.id, result.id).files[0].destination,
    ).toBe("unavailable");
  } finally {
    c.cleanup();
  }
});
