// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { executeLoop } from "../src/engine/loop";
import { initialTeam, type Task } from "../src/shared/contracts";
import type { Run } from "../src/shared/runs";
export const task: Task = {
  id: "task",
  title: "Add a greeting",
  description: "Include a test",
  mode: "work",
  createdAt: "2026-10-08",
};
export const run = (): Run => ({
  id: "run",
  taskId: "task",
  sourceName: "New project",
  files: [],
  status: "prepared",
  events: [],
  plan: "",
  drafts: [],
  findings: [],
  checks: [],
  error: "",
  calls: 0,
  model: "model",
  outputTokens: 2048,
});
it("returns deferred ideas after the final audit without additional calls or commands", async () => {
  const root = await mkdtemp(join(tmpdir(), "scully-suggestions-"));
  try {
    const complete = vi
      .fn()
      .mockResolvedValueOnce({
        summary: "Draft",
        files: [{ path: "app.js", content: "export const value=1;" }],
        commands: [],
      })
      .mockResolvedValueOnce({
        summary: "Review",
        findings: [],
        suggestions: ["Consider a usage guide"],
      });
    const updates: Run[] = [];
    const result = await executeLoop(
      run(),
      task,
      initialTeam,
      { complete },
      join(root, "draft"),
      (r) => updates.push(structuredClone(r)),
    );
    expect(result.status).toBe("complete");
    expect(complete).toHaveBeenCalledTimes(2);
    expect(result.suggestions).toEqual([
      expect.objectContaining({
        text: "Consider a usage guide",
        actor: "ellis",
        revision: expect.any(String),
      }),
    ]);
    expect(
      updates
        .filter((r) => r.status !== "complete")
        .every((r) => !r.suggestions?.length),
    ).toBe(true);
    expect(result.commands).toEqual([]);
    expect(result.findings).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("pauses a redirected work-mode task after planning with explicit revised context", async () => {
  const initial = run();
  initial.redirection = {
    parentId: "parent",
    instructions: ["New requirement"],
    previousPlan: "Old plan",
    previousDrafts: [],
  };
  const complete = vi
    .fn()
    .mockResolvedValue({ plan: "Revised plan for approval" });
  const result = await executeLoop(
    initial,
    task,
    initialTeam,
    { complete },
    "unused",
    () => {},
  );
  expect(result.status).toBe("planned");
  expect(result.calls).toBe(1);
  expect(result.drafts).toEqual([]);
  expect(complete.mock.calls[0][0].input).toContain("New requirement");
  expect(complete.mock.calls[0][0].input).toContain("Old plan");
});
it("corrects in two calls, preserves parent files and audits the full replacement draft", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scully-correction-"));
  try {
    const input = run();
    input.files = [{ path: "app.js", content: "original" }];
    input.correction = {
      parentId: "parent",
      parentRevision: "snapshot",
      auditIndex: 0,
      findingIndex: 0,
      finding: { path: "app.js", severity: "error", detail: "Wrong result" },
      parentDrafts: [
        { path: "app.js", content: "bug", before: "original" },
        { path: "keep.txt", content: "keep", before: null },
      ],
    };
    const complete = vi
      .fn()
      .mockResolvedValueOnce({
        summary: "Fixed",
        files: [{ path: "app.js", content: "fixed" }],
        commands: [],
      })
      .mockResolvedValueOnce({ summary: "Review only", findings: [] });
    const result = await executeLoop(
      input,
      { ...task, mode: "plan" },
      initialTeam,
      { complete },
      join(dir, "draft"),
      () => {},
    );
    expect(result.status).toBe("complete");
    expect(result.calls).toBe(2);
    expect(result.drafts).toEqual([
      { path: "app.js", content: "fixed", before: "original" },
      { path: "keep.txt", content: "keep", before: null },
    ]);
    expect(await readFile(join(dir, "draft", "keep.txt"), "utf8")).toBe("keep");
    expect(input.correction.parentDrafts[0].content).toBe("bug");
    expect(complete.mock.calls[1][0].input).toContain("keep.txt");
    expect(result.executions).toBeUndefined();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it.each(["no-change", "audit-fails", "retry"])(
  "does not silently accept or repeat correction: %s",
  async (mode) => {
    const dir = await mkdtemp(join(tmpdir(), "scully-correction-"));
    try {
      const input = run();
      input.correction = {
        parentId: "p",
        parentRevision: "r",
        auditIndex: 0,
        findingIndex: 0,
        finding: { path: "a", severity: "error", detail: "Issue" },
        parentDrafts: [{ path: "a", content: "bug", before: null }],
      };
      if (mode === "retry") input.calls = 1;
      const complete = vi
        .fn()
        .mockResolvedValueOnce({
          summary: "Change",
          files: [
            { path: "a", content: mode === "no-change" ? "bug" : "fixed" },
          ],
          commands: [],
        })
        .mockRejectedValueOnce(new Error("offline"));
      const result = await executeLoop(
        input,
        task,
        initialTeam,
        { complete },
        join(dir, "draft"),
        () => {},
      );
      expect(result.status).toBe("failed");
      expect(complete.mock.calls.length).toBe(
        mode === "retry" ? 0 : mode === "no-change" ? 1 : 2,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
it("builds and audits private files, emits progress before completion and leaves original unchanged", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scully-loop-"));
  const original = join(dir, "original.ts");
  await writeFile(original, "original");
  const initial = run();
  initial.files = [{ path: "original.ts", content: "original" }];
  const complete = vi
    .fn()
    .mockResolvedValueOnce({
      summary: "Made changes",
      commands: [
        {
          executable: "node",
          args: ["--test"],
          cwd: ".",
          reason: "Check tests",
          timeoutSeconds: 30,
        },
      ],
      files: [
        { path: "original.ts", content: "updated" },
        { path: "data.json", content: '{"ok":true}' },
      ],
    })
    .mockResolvedValueOnce({
      summary: "Review complete",
      findings: [
        { path: "original.ts", severity: "warning", detail: "Add edge cases" },
      ],
    });
  const statuses: string[] = [];
  try {
    const result = await executeLoop(
      initial,
      task,
      initialTeam,
      { complete },
      join(dir, "draft"),
      (r) => statuses.push(r.status),
    );
    expect(result.status).toBe("complete");
    expect(result.calls).toBe(2);
    expect(result.findings).toHaveLength(1);
    expect(result.commands![0].decision).toBe("pending");
    expect(result.commands![0].revision).toMatch(/^[a-f0-9]{64}$/);
    expect(complete.mock.calls[1][0].input).toContain("proposedCommands");
    expect(result.drafts[0].before).toBe("original");
    expect(await readFile(original, "utf8")).toBe("original");
    expect(await readFile(join(dir, "draft", "original.ts"), "utf8")).toBe(
      "updated",
    );
    expect(statuses).toContain("building");
    expect(statuses).toContain("auditing");
    expect(result.checks).toContain(
      "Generated code and test suites were NOT executed.",
    );
    expect(complete.mock.calls[1][0].input).toContain("updated");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("plan first pauses without writing code and resumes within the total three-call bound", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scully-plan-"));
  const complete = vi
    .fn()
    .mockResolvedValueOnce({ plan: "Implement then audit" })
    .mockResolvedValueOnce({
      summary: "done",
      files: [{ path: "main.py", content: 'print("hello")' }],
    })
    .mockResolvedValueOnce({ summary: "review", findings: [] });
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
    expect(planned.drafts).toHaveLength(0);
    const finished = await executeLoop(
      planned,
      { ...task, mode: "plan" },
      initialTeam,
      { complete },
      join(dir, "draft"),
      () => {},
    );
    expect(finished.calls).toBe(3);
    expect(finished.status).toBe("complete");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it.each([
  { summary: "x", files: [{ path: "../outside", content: "bad" }] },
  { summary: "x", files: [] },
  null,
])("fails closed on malformed builder response %j", async (value) => {
  const complete = vi.fn().mockResolvedValue(value);
  const result = await executeLoop(
    run(),
    task,
    initialTeam,
    { complete },
    "/unused-path",
    () => {},
  );
  expect(result.status).toBe("failed");
  expect(complete).toHaveBeenCalledTimes(1);
  expect(result.drafts).toEqual([]);
});
it("never retries a provider error", async () => {
  const complete = vi.fn().mockRejectedValue(new Error("Provider failed"));
  const result = await executeLoop(
    run(),
    task,
    initialTeam,
    { complete },
    "/unused-path",
    () => {},
  );
  expect(result.status).toBe("failed");
  expect(complete).toHaveBeenCalledTimes(1);
});
it("honours total request budget and blocks completed reruns", async () => {
  const complete = vi.fn();
  const result = await executeLoop(
    { ...run(), calls: 3 },
    task,
    initialTeam,
    { complete },
    "/unused-path",
    () => {},
  );
  expect(result.status).toBe("failed");
  expect(complete).not.toHaveBeenCalled();
  await expect(
    executeLoop(
      { ...run(), status: "complete" },
      task,
      initialTeam,
      { complete },
      "/unused-path",
      () => {},
    ),
  ).rejects.toThrow();
});
