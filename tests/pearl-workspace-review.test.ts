// @vitest-environment node
import { afterEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  existsSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bindProjectWorkspace } from "../src/main/project-workspace";
import {
  beginTaskSnapshot,
  finishTaskSnapshot,
  readTaskFileReview,
  readWorkspaceFile,
  undoTaskSnapshot,
  workspaceTree,
} from "../src/main/pearl-workspace-review";
import {
  readGitHistory,
  readPearlGitCommitFiles,
  readPearlGitDiff,
} from "../src/main/git-history";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "scully-review-"));
  roots.push(root);
  const data = join(root, "data");
  const project = join(root, "project");
  mkdirSync(data);
  mkdirSync(project);
  const binding = bindProjectWorkspace(project, "existing", data);
  return {
    root,
    data,
    project,
    binding,
    chatId: randomUUID(),
    turnId: randomUUID(),
  };
}

it("records command-style edits without confusing pre-existing changes and undoes added, modified and deleted files", () => {
  const f = fixture();
  writeFileSync(join(f.project, "existing.txt"), "manual change before task\n");
  writeFileSync(join(f.project, "deleted.txt"), "remove me\n");
  beginTaskSnapshot(f.data, f.chatId, f.turnId, f.binding);
  writeFileSync(join(f.project, "existing.txt"), "Pearl's later change\n");
  writeFileSync(join(f.project, "new.txt"), "created by terminal\n");
  unlinkSync(join(f.project, "deleted.txt"));
  const result = finishTaskSnapshot(f.data, f.chatId, f.turnId, f.binding)!;
  expect(result.files.map((file) => [file.path, file.kind])).toEqual([
    ["deleted.txt", "deleted"],
    ["existing.txt", "modified"],
    ["new.txt", "added"],
  ]);
  expect(
    readTaskFileReview(f.data, f.chatId, f.turnId, f.binding, "existing.txt"),
  ).toMatchObject({
    before: "manual change before task\n",
    after: "Pearl's later change\n",
  });
  expect(undoTaskSnapshot(f.data, f.chatId, f.turnId, f.binding).undone).toBe(
    true,
  );
  expect(readFileSync(join(f.project, "existing.txt"), "utf8")).toBe(
    "manual change before task\n",
  );
  expect(readFileSync(join(f.project, "deleted.txt"), "utf8")).toBe(
    "remove me\n",
  );
  expect(() => readFileSync(join(f.project, "new.txt"))).toThrow();
  expect(() => undoTaskSnapshot(f.data, f.chatId, f.turnId, f.binding)).toThrow(
    /already undone/,
  );
});

it("blocks Undo when a newer edit exists and leaves every file untouched", () => {
  const f = fixture();
  writeFileSync(join(f.project, "a.txt"), "before a");
  writeFileSync(join(f.project, "b.txt"), "before b");
  beginTaskSnapshot(f.data, f.chatId, f.turnId, f.binding);
  writeFileSync(join(f.project, "a.txt"), "after a");
  writeFileSync(join(f.project, "b.txt"), "after b");
  finishTaskSnapshot(f.data, f.chatId, f.turnId, f.binding);
  writeFileSync(join(f.project, "b.txt"), "newer edit");
  expect(() => undoTaskSnapshot(f.data, f.chatId, f.turnId, f.binding)).toThrow(
    /Newer edits/,
  );
  expect(readFileSync(join(f.project, "a.txt"), "utf8")).toBe("after a");
  expect(readFileSync(join(f.project, "b.txt"), "utf8")).toBe("newer edit");
});

it("summarizes and undoes directories created or removed during a task", () => {
  const f = fixture();
  mkdirSync(join(f.project, "old-empty"));
  beginTaskSnapshot(f.data, f.chatId, f.turnId, f.binding);
  rmSync(join(f.project, "old-empty"), { recursive: true });
  mkdirSync(join(f.project, "new-dir"));
  writeFileSync(join(f.project, "new-dir", "note.txt"), "new");
  const result = finishTaskSnapshot(f.data, f.chatId, f.turnId, f.binding)!;
  expect(result.files).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: "old-empty",
        kind: "deleted",
        entry: "directory",
      }),
      expect.objectContaining({
        path: "new-dir",
        kind: "added",
        entry: "directory",
      }),
      expect.objectContaining({ path: "new-dir/note.txt", kind: "added" }),
    ]),
  );
  undoTaskSnapshot(f.data, f.chatId, f.turnId, f.binding);
  expect(existsSync(join(f.project, "old-empty"))).toBe(true);
  expect(existsSync(join(f.project, "new-dir"))).toBe(false);
});

it("reports linked paths and disables Undo rather than silently omitting them", () => {
  const f = fixture();
  writeFileSync(join(f.project, "target"), "target");
  beginTaskSnapshot(f.data, f.chatId, f.turnId, f.binding);
  symlinkSync(join(f.project, "target"), join(f.project, "link"));
  const result = finishTaskSnapshot(f.data, f.chatId, f.turnId, f.binding)!;
  expect(result.files).toContainEqual(
    expect.objectContaining({ path: "link", entry: "linked-or-special" }),
  );
  expect(result.undoAvailable).toBe(false);
  expect(() => undoTaskSnapshot(f.data, f.chatId, f.turnId, f.binding)).toThrow(
    /links or special/,
  );
});

it("enforces read-only viewer path and symlink boundaries", () => {
  const f = fixture();
  mkdirSync(join(f.project, "src"));
  writeFileSync(join(f.project, "src", "app.ts"), "export const x = 1;\n");
  writeFileSync(join(f.project, ".env"), "SECRET=private");
  symlinkSync(join(f.project, "src", "app.ts"), join(f.project, "link.ts"));
  expect(workspaceTree(f.binding).map((entry) => entry.path)).toContain("src");
  expect(readWorkspaceFile(f.binding, "src/app.ts")).toBe(
    "export const x = 1;\n",
  );
  expect(() => readWorkspaceFile(f.binding, ".env")).toThrow();
  expect(() => readWorkspaceFile(f.binding, "link.ts")).toThrow();
  expect(() => readWorkspaceFile(f.binding, "../data/secret")).toThrow();
});

it("pages large folders in stable order and rejects invalid offsets", () => {
  const f = fixture();
  for (let index = 0; index < 501; index++)
    writeFileSync(
      join(f.project, `file-${String(index).padStart(3, "0")}.txt`),
      "x",
    );
  const first = workspaceTree(f.binding);
  const second = workspaceTree(f.binding, "", 500);
  expect(first).toHaveLength(500);
  expect(second).toHaveLength(1);
  expect(first.at(-1)?.path).toBe("file-499.txt");
  expect(second[0].path).toBe("file-500.txt");
  expect(() => workspaceTree(f.binding, "", -1)).toThrow(/Invalid folder page/);
});

it("shows Git history and commit diffs without executing repository hooks", () => {
  const f = fixture();
  execFileSync("git", ["init", "-q", f.project]);
  writeFileSync(join(f.project, "hello.txt"), "hello\n");
  execFileSync("git", ["-C", f.project, "add", "hello.txt"]);
  execFileSync("git", [
    "-C",
    f.project,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-qm",
    "Initial",
  ]);
  const history = readGitHistory(f.project);
  expect(history.state).toBe("ready");
  if (history.state !== "ready") return;
  expect(history.commits[0].subject).toBe("Initial");
  const files = readPearlGitCommitFiles(f.project, history.commits[0].hash);
  expect(files).toContainEqual({ status: "A", path: "hello.txt" });
  expect(
    readPearlGitDiff(f.project, "hello.txt", history.commits[0].hash),
  ).toContain("+hello");
  expect(() => readPearlGitDiff(f.project, "../outside")).toThrow();
  symlinkSync(join(f.project, "hello.txt"), join(f.project, "linked.txt"));
  expect(() => readPearlGitDiff(f.project, "linked.txt")).toThrow(
    /Unsafe project path/,
  );
});
