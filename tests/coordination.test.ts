// @vitest-environment node
import { mkdtemp, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { executeLoop } from "../src/engine/loop";
import { integrate, snapshotRevision } from "../src/engine/integration";
import {
  makeCoordination,
  isTestPath,
  parseCoordinationSettings,
  ownerFor,
  requestLimit,
} from "../src/shared/coordination";
import { initialTeam, type Task } from "../src/shared/contracts";
import type { Run } from "../src/shared/runs";
const task: Task = {
  id: "task",
  title: "Add sum and tests",
  description: "Export sum(a,b) from math.js; test negative values",
  mode: "work",
  createdAt: "now",
};
function run(): Run {
  return {
    id: "run",
    taskId: "task",
    sourceName: "Fixture",
    files: [{ path: "README.md", content: "base" }],
    status: "prepared",
    events: [],
    plan: "",
    drafts: [],
    findings: [],
    checks: [],
    error: "",
    calls: 0,
    model: "",
    outputTokens: 2048,
    coordination: makeCoordination(),
  };
}
const implementation = {
  summary: "Implemented sum",
  files: [{ path: "math.js", content: "exports.sum=(a,b)=>a+b" }],
  commands: [],
};
const tests = {
  summary: "Added negative test",
  files: [{ path: "tests/math.js", content: "// fixture test" }],
  commands: [],
};
it.each([
  "jun ../escape",
  "ellis src/",
  "jun src/\nmaya src/a.js",
  "maya A.js\njun a.js",
  "jun .env",
])("rejects unsafe or ambiguous ownership %s", (ownership) => {
  expect(() =>
    parseCoordinationSettings({ ownership, chunkReviews: true }),
  ).toThrow();
});
it("explicit ownership overrides conventions, but never another writer's claim", () => {
  const { rules } = parseCoordinationSettings({
    ownership: "jun src/verification/\nmaya tests/fixture.json",
    chunkReviews: false,
  });
  expect(ownerFor("src/verification/check.js", rules)).toBe("jun");
  expect(ownerFor("tests/fixture.json", rules)).toBe("maya");
  const c = makeCoordination();
  c.assignments[1].files = [
    { path: "src/verification/check.js", content: "check" },
  ];
  expect(integrate([], c.assignments, rules).conflicts).toEqual([]);
  c.assignments[0].files = [...c.assignments[1].files];
  expect(integrate([], c.assignments, rules).files).toEqual([]);
});
it("reviews an immutable completed chunk while the sibling writer is still waiting", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scully-chunk-"));
  let releaseJun!: (value: unknown) => void;
  let reviewedMaya = false;
  const complete = vi.fn().mockImplementation((request) => {
    if (request.name === "audit_chunk") {
      const input = JSON.parse(request.input);
      if (input.owner === "maya") reviewedMaya = true;
      expect(input.revision).toBe(snapshotRevision(run().files, input.changes));
      return Promise.resolve({ summary: "Chunk inspected", findings: [] });
    }
    if (request.name === "audit_files")
      return Promise.resolve({ summary: "Combined inspected", findings: [] });
    return request.system.includes("implementation engineer")
      ? Promise.resolve(implementation)
      : new Promise((resolve) => {
          releaseJun = resolve;
        });
  });
  const initial = run();
  initial.coordination!.settings = { ownership: "", chunkReviews: true };
  const updates: Run[] = [];
  try {
    const pending = executeLoop(
      initial,
      task,
      initialTeam,
      { complete },
      join(dir, "draft"),
      (r) => updates.push(r),
    );
    await vi.waitFor(() => expect(reviewedMaya).toBe(true));
    expect(
      updates.some(
        (r) =>
          r.coordination!.chunkReviews?.some(
            (c) => c.owner === "maya" && c.status === "complete",
          ) && r.coordination!.assignments[1].status === "working",
      ),
    ).toBe(true);
    releaseJun(tests);
    const result = await pending;
    expect(result.status).toBe("complete");
    expect(result.calls).toBe(5);
    expect(requestLimit(result)).toBe(6);
    expect(result.coordination!.chunkReviews).toHaveLength(2);
    expect(
      complete.mock.calls.filter(([r]) => r.name === "audit_files"),
    ).toHaveLength(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("a failed early review does not cancel unrelated writer work or silently integrate", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scully-chunk-fail-"));
  const complete = vi.fn().mockImplementation((request) => {
    if (request.name === "audit_chunk")
      return Promise.reject(new Error("Review fixture failed"));
    return Promise.resolve(
      request.system.includes("implementation engineer")
        ? implementation
        : tests,
    );
  });
  const initial = run();
  initial.coordination!.settings = { ownership: "", chunkReviews: true };
  try {
    const result = await executeLoop(
      initial,
      task,
      initialTeam,
      { complete },
      join(dir, "draft"),
      () => {},
    );
    expect(result.status).toBe("failed");
    expect(result.drafts).toEqual([]);
    expect(result.coordination!.assignments.map((a) => a.status)).toEqual([
      "ready",
      "ready",
    ]);
    expect(
      result.coordination!.chunkReviews!.every((r) => r.status === "failed"),
    ).toBe(true);
    expect(complete.mock.calls.some(([r]) => r.name === "audit_files")).toBe(
      false,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("starts both writers before either finishes, isolates branches and audits the combined revision", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scully-team-"));
  const resolvers = new Map<string, (value: unknown) => void>();
  const complete = vi
    .fn()
    .mockImplementation((request) =>
      request.name === "audit_files"
        ? Promise.resolve({ summary: "Review", findings: [] })
        : new Promise((resolve) =>
            resolvers.set(
              request.system.includes("implementation engineer")
                ? "maya"
                : "jun",
              resolve,
            ),
          ),
    );
  const emitted: Run[] = [];
  try {
    const pending = executeLoop(
      run(),
      task,
      initialTeam,
      { complete },
      join(dir, "draft"),
      (r) => emitted.push(r),
    );
    await vi.waitFor(() => expect(resolvers.size).toBe(2));
    resolvers.get("jun")!(tests);
    resolvers.get("maya")!(implementation);
    const result = await pending;
    expect(result.status).toBe("complete");
    expect(result.calls).toBe(3);
    expect(result.coordination!.assignments.map((a) => a.status)).toEqual([
      "ready",
      "ready",
    ]);
    expect(
      await readFile(join(dir, "draft.branches/maya/README.md"), "utf8"),
    ).toBe("base");
    await expect(
      access(join(dir, "draft.branches/maya/tests/math.js")),
    ).rejects.toThrow();
    await expect(
      access(join(dir, "draft.branches/jun/math.js")),
    ).rejects.toThrow();
    expect(await readFile(join(dir, "draft/tests/math.js"), "utf8")).toBe(
      "// fixture test",
    );
    const audit = JSON.parse(complete.mock.calls[2][0].input);
    expect(audit.changes).toHaveLength(2);
    expect(audit.revision).toBe(snapshotRevision(result.files, result.drafts));
    expect(result.coordination!.auditedRevision).toBe(audit.revision);
    expect(emitted.some((r) => r.events.some((e) => e.actor === "jun"))).toBe(
      true,
    );
    expect(result.coordination!.metrics.writerWallMs).toBeGreaterThanOrEqual(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it.each(["overlap", "out-of-scope", "parent-collision"])(
  "blocks integration on %s without choosing a winner",
  async (kind) => {
    const dir = await mkdtemp(join(tmpdir(), "scully-conflict-"));
    const first =
      kind === "parent-collision"
        ? {
            ...implementation,
            files: [{ path: "tests", content: "not a directory" }],
          }
        : implementation;
    const second = {
      ...tests,
      files: [
        {
          path:
            kind === "parent-collision"
              ? "tests/math.js"
              : kind === "overlap"
                ? "math.js"
                : "other.js",
          content: "competing content",
        },
      ],
    };
    const complete = vi
      .fn()
      .mockImplementation((request) =>
        Promise.resolve(
          request.system.includes("implementation engineer") ? first : second,
        ),
      );
    try {
      const result = await executeLoop(
        run(),
        task,
        initialTeam,
        { complete },
        join(dir, "draft"),
        () => {},
      );
      expect(result.status).toBe("conflicted");
      expect(result.drafts).toEqual([]);
      expect(result.coordination!.conflicts.length).toBeGreaterThan(0);
      expect(complete).toHaveBeenCalledTimes(2);
      await expect(access(join(dir, "draft"))).rejects.toThrow();
      expect(result.coordination!.assignments[1].files).toEqual(second.files);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
it("keeps failed-writer work separate and does not audit or retry partial output", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scully-failed-team-"));
  const complete = vi
    .fn()
    .mockImplementation((request) =>
      request.system.includes("implementation engineer")
        ? Promise.resolve(implementation)
        : Promise.reject(new Error("fixture failure")),
    );
  try {
    const result = await executeLoop(
      run(),
      task,
      initialTeam,
      { complete },
      join(dir, "draft"),
      () => {},
    );
    expect(result.status).toBe("failed");
    expect(result.drafts).toEqual([]);
    expect(result.coordination!.assignments.map((a) => a.status)).toEqual([
      "ready",
      "failed",
    ]);
    expect(complete).toHaveBeenCalledTimes(2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("plan-first pauses then completes within its explicitly disclosed four-call cap", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scully-team-plan-"));
  const complete = vi
    .fn()
    .mockImplementation((request) =>
      Promise.resolve(
        request.name === "propose_plan"
          ? { plan: "Maya exports sum from math.js; Jun writes tests/math.js" }
          : request.name === "audit_files"
            ? { summary: "Reviewed", findings: [] }
            : request.system.includes("implementation engineer")
              ? implementation
              : tests,
      ),
    );
  try {
    const planned = await executeLoop(
      run(),
      { ...task, mode: "plan" },
      initialTeam,
      { complete },
      join(dir, "draft"),
      () => {},
    );
    expect(planned.status).toBe("planned");
    expect(complete).toHaveBeenCalledTimes(1);
    const result = await executeLoop(
      planned,
      { ...task, mode: "plan" },
      initialTeam,
      { complete },
      join(dir, "draft"),
      () => {},
    );
    expect(result.status).toBe("complete");
    expect(result.calls).toBe(4);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("checks path collisions against unchanged base and combined size without dropping files", () => {
  const c = makeCoordination();
  c.assignments[0].files = [{ path: "FILE.js", content: "new" }];
  expect(
    integrate([{ path: "file.js", content: "base" }], c.assignments).conflicts
      .length,
  ).toBeGreaterThan(0);
  c.assignments[0].files = [{ path: "file.js", content: "x".repeat(48001) }];
  expect(integrate([], c.assignments).files).toEqual([]);
});
it.each([
  "tests/a.py",
  "spec/a.rb",
  "a.test.ts",
  "a_test.go",
  "test_a.py",
  "FooTest.java",
  "__tests__/a.js",
])("recognises test ownership for %s", (path) =>
  expect(isTestPath(path)).toBe(true),
);
