// @vitest-environment node
import {
  mkdtemp,
  rm,
  writeFile,
  readFile,
  symlink,
  mkdir,
  chmod,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { expect, it, vi } from "vitest";
import { Store } from "../src/main/store";
import { ExecutionManager } from "../src/main/execution-manager";
import { commandRevision } from "../src/engine/revision";
import {
  resolveExecutable,
  verifyWorkspace,
  snapshotFiles,
} from "../src/main/local-workspace";
import type { Run } from "../src/shared/runs";
import { makeCoordination } from "../src/shared/coordination";
import { snapshotRevision } from "../src/engine/integration";
import { executeSpecialist } from "../src/engine/specialist";
it("runs a proposed finding check only with fresh permission and retains unresolved evidence", async () => {
  const c = await setup(
    'require("node:assert/strict").equal(2 + 2, 4); console.log("focused fixture passed")',
  );
  try {
    const revision = snapshotRevision(c.run.files, c.run.drafts);
    c.run.coordination = {
      ...makeCoordination(),
      integratedRevision: revision,
      auditedRevision: revision,
    };
    c.run.specialistAudits = [
      {
        kind: "testing",
        revision,
        status: "reviewing",
        calls: 0,
        summary: "",
        findings: [],
        response: "",
      },
    ];
    const model = {
      complete: vi
        .fn()
        .mockResolvedValueOnce({
          summary: "Check arithmetic",
          findings: [
            {
              path: "test.js",
              severity: "warning",
              detail: "Verify arithmetic",
            },
          ],
        })
        .mockResolvedValueOnce({
          response: "Run the assertion",
          checks: [
            {
              findingIndex: 0,
              expected: "Assertion exits zero",
              criterion: { exitCode: 0 },
              command: {
                executable: basename(process.execPath),
                args: ["test.js"],
                cwd: ".",
                reason: "Verify arithmetic",
                timeoutSeconds: 3,
              },
            },
          ],
        }),
    };
    const audited = await executeSpecialist(
      c.run,
      c.store.load().tasks[0],
      model,
      () => {},
    );
    c.store.saveRun(audited);
    const command = audited.commands!.at(-1)!;
    const denied = await c.manager.review(c.run.id, command.id);
    await expect(c.manager.execute(denied.token, false)).rejects.toThrow(
      "permission",
    );
    expect(c.store.getRun(c.run.id).executions).toBeUndefined();
    const review = await c.manager.review(c.run.id, command.id);
    await c.manager.execute(review.token, true);
    const result = await finished(c);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("focused fixture passed");
    expect(result.commandId).toBe(command.id);
    expect(result.revision).toBe(command.revision);
    expect(c.store.getRun(c.run.id).specialistAudits![0].status).toBe(
      "needs-review",
    );
    const stale = await c.manager.review(c.run.id, command.id);
    const updated = c.store.getRun(c.run.id);
    updated.specialistAudits![0].findings[0].detail = "Changed finding";
    c.store.saveRun(updated);
    await expect(c.manager.execute(stale.token, true)).rejects.toThrow("stale");
    expect(c.store.getRun(c.run.id).executions).toHaveLength(1);
  } finally {
    await c.cleanup();
  }
});

async function setup(code = 'console.log("fixture passed")', seconds = 3) {
  const root = await mkdtemp(join(tmpdir(), "scully-execution-test-"));
  const store = new Store(join(root, "db.sqlite"));
  const task = store.createTask({
    title: "Synthetic local execution test",
    description: "",
    mode: "work",
  });
  const run: Run = {
    id: "fixture",
    taskId: task.id,
    sourceName: "Fixture",
    files: [],
    status: "complete",
    events: [],
    plan: "",
    drafts: [{ path: "test.js", content: code, before: null }],
    findings: [],
    checks: [],
    error: "",
    calls: 0,
    model: "",
    outputTokens: 0,
    commands: [
      {
        id: "command",
        revision: "",
        decision: "pending",
        executable: basename(process.execPath),
        args: ["test.js"],
        cwd: ".",
        reason: "Execute synthetic fixture",
        timeoutSeconds: seconds,
      },
    ],
  };
  run.commands![0].revision = commandRevision(run);
  store.saveRun(run);
  const updates: Run[] = [];
  const manager = new ExecutionManager(store, root, (r) =>
    updates.push(structuredClone(r)),
  );
  return {
    root,
    store,
    run,
    manager,
    updates,
    async cleanup() {
      manager.close();
      store.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
async function finished(c: Awaited<ReturnType<typeof setup>>) {
  await vi.waitFor(
    () =>
      expect(c.store.getRun(c.run.id).executions?.at(-1)?.status).not.toBe(
        "running",
      ),
    { timeout: 5000, interval: 25 },
  );
  return c.store.getRun(c.run.id).executions!.at(-1)!;
}
it("will not execute a coordinated draft with a stale final audit", async () => {
  const c = await setup();
  try {
    c.run.coordination = makeCoordination();
    c.run.coordination.integratedRevision = "old";
    c.run.coordination.auditedRevision = "old";
    c.store.saveRun(c.run);
    await expect(c.manager.review(c.run.id, "command")).rejects.toThrow(
      "revision-bound audit",
    );
  } finally {
    await c.cleanup();
  }
});
it("executes only after fresh permission, streams output, persists exact command and leaves draft unchanged", async () => {
  const c = await setup(
    'console.log("early"); setTimeout(() => console.log("late"), 500)',
  );
  try {
    const review = await c.manager.review(c.run.id, "command");
    expect(c.store.getRun(c.run.id).executions).toBeUndefined();
    expect(review.executable).toMatch(/^\//);
    expect(review.executableHash).toMatch(/^[a-f0-9]{64}$/);
    await c.manager.execute(review.token, true);
    const result = await finished(c);
    expect(result.status).toBe("exited");
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("early");
    expect(result.output).toContain("late");
    expect(
      c.updates.some(
        (r) =>
          r.executions?.at(-1)?.status === "running" &&
          r.executions.at(-1)!.output.includes("early"),
      ),
    ).toBe(true);
    expect(c.store.getRun(c.run.id).drafts).toEqual(c.run.drafts);
    expect(await readFile(join(review.cwd, "test.js"), "utf8")).toBe(
      c.run.drafts[0].content,
    );
    await expect(c.manager.execute(review.token, true)).rejects.toThrow(
      "fresh",
    );
  } finally {
    await c.cleanup();
  }
});
it("does not inherit credential or runtime injection environment variables", async () => {
  const c = await setup(
    "console.log(JSON.stringify({ secret: process.env.SCULLY_TEST_SECRET, home: process.env.HOME, nodeOptions: process.env.NODE_OPTIONS }))",
  );
  process.env.SCULLY_TEST_SECRET = "must-not-inherit";
  try {
    const r = await c.manager.review(c.run.id, "command");
    await c.manager.execute(r.token, true);
    const result = await finished(c);
    expect(result.output).not.toContain("must-not-inherit");
    expect(result.output).toContain(r.cwd);
    expect(result.output).not.toContain("nodeOptions");
  } finally {
    delete process.env.SCULLY_TEST_SECRET;
    await c.cleanup();
  }
});
it.each([false, "yes", null])(
  "rejects missing explicit consent %j even with recorded approval",
  async (approval) => {
    const c = await setup();
    try {
      c.run.commands![0].decision = "approved";
      c.store.saveRun(c.run);
      const review = await c.manager.review(c.run.id, "command");
      await expect(c.manager.execute(review.token, approval)).rejects.toThrow(
        "permission",
      );
      await expect(c.manager.execute(review.token, true)).rejects.toThrow(
        "fresh",
      );
      expect(c.store.getRun(c.run.id).executions).toBeUndefined();
    } finally {
      await c.cleanup();
    }
  },
);
it.each([
  "changed-file",
  "extra-file",
  "symlink",
  "changed-draft",
  "denied",
  "expired",
  "wrong-token",
])("blocks %s before spawning", async (kind) => {
  const c = await setup();
  try {
    const review = await c.manager.review(c.run.id, "command");
    if (kind === "changed-file")
      await writeFile(join(review.cwd, "test.js"), "changed");
    if (kind === "extra-file")
      await writeFile(join(review.cwd, "extra.js"), "extra");
    if (kind === "symlink") await symlink(c.root, join(review.cwd, "link"));
    if (kind === "changed-draft") {
      c.run.drafts[0].content = "changed";
      c.store.saveRun(c.run);
    }
    if (kind === "denied") {
      c.run.commands![0].decision = "denied";
      c.store.saveRun(c.run);
    }
    const now =
      kind === "expired"
        ? vi
            .spyOn(Date, "now")
            .mockReturnValue(Date.parse(review.expiresAt) + 1)
        : null;
    try {
      await expect(
        c.manager.execute(kind === "wrong-token" ? "bad" : review.token, true),
      ).rejects.toThrow();
    } finally {
      now?.mockRestore();
    }
    expect(c.store.getRun(c.run.id).executions).toBeUndefined();
  } finally {
    await c.cleanup();
  }
});
it.each([
  ['console.error("expected failure"); process.exit(7)', 3, "exited", 7],
  ["setInterval(() => {}, 100)", 1, "timed_out", null],
  ['process.stdout.write("x".repeat(100000))', 3, "output_limit", null],
] as const)(
  "records actual failure and bounds: %s",
  async (code, seconds, status, exitCode) => {
    const c = await setup(code, seconds);
    try {
      const r = await c.manager.review(c.run.id, "command");
      await c.manager.execute(r.token, true);
      const result = await finished(c);
      expect(result.status).toBe(status);
      if (exitCode !== null) expect(result.exitCode).toBe(exitCode);
      expect(Buffer.byteLength(result.output)).toBeLessThanOrEqual(65_536);
    } finally {
      await c.cleanup();
    }
  },
);
it("stops an active process and rejects duplicate launches", async () => {
  const c = await setup("setInterval(() => {}, 100)");
  try {
    const r = await c.manager.review(c.run.id, "command");
    const started = await c.manager.execute(r.token, true);
    await expect(c.manager.execute(r.token, true)).rejects.toThrow("busy");
    await expect(c.manager.review(c.run.id, "command")).rejects.toThrow("busy");
    c.manager.stop(started.executions![0].id);
    expect((await finished(c)).status).toBe("stopped");
    expect(() => c.manager.stop(started.executions![0].id)).toThrow();
  } finally {
    await c.cleanup();
  }
});
it("marks interrupted executions on restart without replaying commands", async () => {
  const c = await setup("setInterval(() => {}, 100)");
  try {
    const r = await c.manager.review(c.run.id, "command");
    await c.manager.execute(r.token, true);
    c.manager.close();
    expect(c.store.getRun(c.run.id).executions![0].status).toBe("interrupted");
    const stale = c.store.getRun(c.run.id);
    stale.executions![0].status = "running";
    c.store.saveRun(stale);
    c.store.recoverRuns();
    expect(c.store.getRun(c.run.id).executions![0].status).toBe("interrupted");
  } finally {
    await c.cleanup();
  }
});
it("reports missing runtimes, excludes relative PATH and validates working directories", async () => {
  const c = await setup();
  try {
    await expect(
      resolveExecutable("no-such-runtime", dirname(process.execPath)),
    ).rejects.toThrow("not found");
    await expect(
      resolveExecutable(basename(process.execPath), "."),
    ).rejects.toThrow("not found");
    const r = await c.manager.review(c.run.id, "command");
    await expect(
      verifyWorkspace(r.cwd, snapshotFiles(c.run), "missing"),
    ).rejects.toThrow("directory");
    await mkdir(join(r.cwd, "extra"));
    await expect(
      verifyWorkspace(r.cwd, snapshotFiles(c.run), "."),
    ).rejects.toThrow("unexpected");
  } finally {
    await c.cleanup();
  }
});
it("rejects a changed executable and reports launch permission failure honestly", async () => {
  const c = await setup();
  const oldPath = process.env.PATH;
  try {
    const tool = join(c.root, "fixture-tool");
    await writeFile(tool, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    process.env.PATH = c.root;
    c.run.commands![0].executable = "fixture-tool";
    c.run.commands![0].revision = commandRevision(c.run);
    c.store.saveRun(c.run);
    const review = await c.manager.review(c.run.id, "command");
    await writeFile(tool, "#!/bin/sh\nexit 1\n");
    await expect(c.manager.execute(review.token, true)).rejects.toThrow(
      "Executable changed",
    );
    const next = await c.manager.review(c.run.id, "command");
    await chmod(tool, 0o600);
    await c.manager.execute(next.token, true);
    expect((await finished(c)).status).toBe("failed");
  } finally {
    process.env.PATH = oldPath;
    await c.cleanup();
  }
});
