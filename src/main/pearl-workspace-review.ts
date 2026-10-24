import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { safePath, type ProjectWorkspace } from "../shared/runs";
import type {
  FileReview,
  TaskChangeSet,
  TaskFileChange,
  WorkspaceEntry,
} from "../shared/pearl-workspace";
import { blockedProjectPart } from "./pearl-project-map";
import { verifyProjectRoot } from "./project-workspace";

const maxFiles = 20_000;
const maxSnapshotBytes = 128 * 1024 * 1024;
const maxReviewBytes = 512_000;
type Image = { content: string; mode: number; size: number; digest: string };
type Snapshot = {
  project: string;
  files: Record<string, Image>;
  dirs: string[];
  unsupported: Record<string, string>;
};
type SavedReview = { before: Snapshot; after: Snapshot; undone?: boolean };

function digest(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function validatedPath(path: unknown): string {
  safePath(path);
  if (path.split("/").some(blockedProjectPart))
    throw new Error("That project path is private or unavailable");
  return path;
}

function safeFile(binding: ProjectWorkspace, path: string): string {
  verifyProjectRoot(binding);
  let current = binding.path;
  for (const part of path.split("/")) {
    current = join(current, part);
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (stat) {
      if (stat.isSymbolicLink() || (stat.nlink > 1 && stat.isFile()))
        throw new Error(`Unsafe project path: ${path}`);
    }
  }
  return current;
}

export function workspaceTree(
  binding: ProjectWorkspace,
  directory = "",
  offset = 0,
): WorkspaceEntry[] {
  if (directory) validatedPath(directory);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100_000)
    throw new Error("Invalid folder page");
  verifyProjectRoot(binding);
  const parent = directory ? safeFile(binding, directory) : binding.path;
  if (!lstatSync(parent).isDirectory()) throw new Error("Not a folder");
  return readdirSync(parent, { withFileTypes: true })
    .filter((entry) => {
      if (!entry.isDirectory() && !entry.isFile()) return false;
      try {
        validatedPath(directory ? `${directory}/${entry.name}` : entry.name);
        return true;
      } catch {
        return false;
      }
    })
    .sort(
      (a, b) =>
        Number(b.isDirectory()) - Number(a.isDirectory()) ||
        a.name.localeCompare(b.name),
    )
    .slice(offset, offset + 500)
    .map((entry) => {
      const path = directory ? `${directory}/${entry.name}` : entry.name;
      const stat = lstatSync(join(parent, entry.name));
      return {
        path,
        kind: entry.isDirectory() ? ("directory" as const) : ("file" as const),
        size: stat.size,
      };
    })
    .filter(
      (entry) =>
        entry.kind === "directory" ||
        lstatSync(join(binding.path, entry.path)).isFile(),
    );
}

export function readWorkspaceFile(
  binding: ProjectWorkspace,
  path: unknown,
): string {
  const target = safeFile(binding, validatedPath(path));
  const stat = lstatSync(target);
  if (!stat.isFile() || stat.size > 1024 * 1024)
    throw new Error("This file is too large or cannot be viewed as text");
  return new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(target));
}

export function snapshotProject(binding: ProjectWorkspace): Snapshot {
  verifyProjectRoot(binding);
  const files: Record<string, Image> = {};
  const dirs: string[] = [];
  const unsupported: Record<string, string> = {};
  const pending = [""];
  let count = 0;
  let total = 0;
  while (pending.length) {
    const directory = pending.pop()!;
    for (const entry of readdirSync(join(binding.path, directory), {
      withFileTypes: true,
    })) {
      if (entry.name === ".git") continue;
      const path = directory ? `${directory}/${entry.name}` : entry.name;
      const stat = lstatSync(join(binding.path, path));
      count++;
      if (count > maxFiles)
        throw new Error(
          "Project exceeds the 20,000 entry checkpoint limit. Task Undo is unavailable for this project.",
        );
      if (stat.isSymbolicLink()) {
        unsupported[path] = `symlink:${readlinkSync(join(binding.path, path))}`;
        continue;
      }
      if (stat.isDirectory()) {
        dirs.push(path);
        pending.push(path);
        continue;
      }
      if (!stat.isFile()) {
        unsupported[path] = `special:${stat.mode}:${stat.size}`;
        continue;
      }
      if (stat.nlink !== 1) {
        total += stat.size;
        if (total > maxSnapshotBytes)
          throw new Error(
            "Project exceeds the 128 MB checkpoint limit. Task Undo is unavailable for this project.",
          );
        unsupported[path] =
          `hardlink:${stat.mode}:${stat.size}:${digest(readFileSync(join(binding.path, path)))}`;
        continue;
      }
      total += stat.size;
      if (total > maxSnapshotBytes)
        throw new Error(
          "Project exceeds the 20,000 file or 128 MB checkpoint limit. Task Undo is unavailable for this project.",
        );
      const bytes = readFileSync(join(binding.path, path));
      files[path] = {
        content: bytes.toString("base64"),
        size: bytes.length,
        mode: stat.mode & 0o777,
        digest: digest(bytes),
      };
    }
  }
  return { project: binding.path, files, dirs, unsupported };
}

function reviewPath(root: string, chatId: string, turnId: string): string {
  if (![chatId, turnId].every((part) => /^[0-9a-f-]{36}$/.test(part)))
    throw new Error("Invalid task ID");
  return join(root, "pearl-reviews", chatId, `${turnId}.json`);
}

function writePrivate(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const next = `${path}.next`;
  writeFileSync(next, JSON.stringify(value), { mode: 0o600 });
  renameSync(next, path);
}

function load(path: string): SavedReview {
  return JSON.parse(readFileSync(path, "utf8")) as SavedReview;
}

export function beginTaskSnapshot(
  root: string,
  chatId: string,
  turnId: string,
  binding: ProjectWorkspace,
): void {
  const path = reviewPath(root, chatId, turnId);
  if (!existsSync(path)) {
    const before = snapshotProject(binding);
    writePrivate(path, { before, after: before });
  }
}

function changed(before: Snapshot, after: Snapshot): TaskFileChange[] {
  return [
    ...new Set([...Object.keys(before.files), ...Object.keys(after.files)]),
  ]
    .sort()
    .flatMap((path) => {
      const original = before.files[path];
      const final = after.files[path];
      if (original?.digest === final?.digest && original?.mode === final?.mode)
        return [];
      return [
        {
          path,
          kind: !original
            ? ("added" as const)
            : !final
              ? ("deleted" as const)
              : ("modified" as const),
          beforeBytes: original?.size || 0,
          afterBytes: final?.size || 0,
        },
      ];
    });
}

function unsupportedChanges(before: Snapshot, after: Snapshot): string[] {
  return [
    ...new Set([
      ...Object.keys(before.unsupported),
      ...Object.keys(after.unsupported),
    ]),
  ].filter((path) => before.unsupported[path] !== after.unsupported[path]);
}

function allChanges(before: Snapshot, after: Snapshot): TaskFileChange[] {
  const regular = changed(before, after);
  const directories: TaskFileChange[] = [
    ...new Set([...before.dirs, ...after.dirs]),
  ]
    .filter((path) => before.dirs.includes(path) !== after.dirs.includes(path))
    .map((path) => ({
      path,
      kind: before.dirs.includes(path) ? "deleted" : "added",
      entry: "directory",
      beforeBytes: 0,
      afterBytes: 0,
    }));
  const unsupported: TaskFileChange[] = unsupportedChanges(before, after).map(
    (path) => ({
      path,
      kind: !before.unsupported[path]
        ? "added"
        : !after.unsupported[path]
          ? "deleted"
          : "modified",
      entry: "linked-or-special",
      beforeBytes: 0,
      afterBytes: 0,
    }),
  );
  return [...regular, ...directories, ...unsupported].sort((a, b) =>
    a.path.localeCompare(b.path),
  );
}

export function finishTaskSnapshot(
  root: string,
  chatId: string,
  turnId: string,
  binding: ProjectWorkspace,
): TaskChangeSet | null {
  const path = reviewPath(root, chatId, turnId);
  if (!existsSync(path)) return null;
  const review = load(path);
  if (review.before.project !== binding.path)
    throw new Error("Task project changed");
  review.after = snapshotProject(binding);
  writePrivate(path, review);
  const excluded = unsupportedChanges(review.before, review.after);
  return {
    turnId,
    at: new Date().toISOString(),
    files: allChanges(review.before, review.after),
    undoAvailable: !review.undone && excluded.length === 0,
    ...(excluded.length
      ? {
          reason: `This task changed ${excluded.length} linked or special path(s). Automatic Undo cannot safely restore them.`,
        }
      : {}),
    undone: Boolean(review.undone),
  };
}

export function readTaskFileReview(
  root: string,
  chatId: string,
  turnId: string,
  binding: ProjectWorkspace,
  path: unknown,
): FileReview {
  if (typeof path !== "string" || path.length > 500)
    throw new Error("Invalid review path");
  const name = path;
  const review = load(reviewPath(root, chatId, turnId));
  if (review.before.project !== binding.path)
    throw new Error("Task project changed");
  if (
    !allChanges(review.before, review.after).some((file) => file.path === name)
  )
    throw new Error("File is not part of this task");
  if (!review.before.files[name] && !review.after.files[name])
    return { path: name, before: null, after: null, binary: true };
  const before = review.before.files[name];
  const after = review.after.files[name];
  const decode = (image?: Image) =>
    image
      ? new TextDecoder("utf-8", { fatal: true }).decode(
          Buffer.from(image.content, "base64"),
        )
      : null;
  if (
    (before?.size || 0) > maxReviewBytes ||
    (after?.size || 0) > maxReviewBytes
  )
    return { path: name, before: null, after: null, binary: true };
  try {
    return {
      path: name,
      before: decode(before),
      after: decode(after),
      binary: false,
    };
  } catch {
    return { path: name, before: null, after: null, binary: true };
  }
}

export function undoTaskSnapshot(
  root: string,
  chatId: string,
  turnId: string,
  binding: ProjectWorkspace,
): TaskChangeSet {
  const path = reviewPath(root, chatId, turnId);
  const review = load(path);
  if (review.undone) throw new Error("This task was already undone");
  if (review.before.project !== binding.path)
    throw new Error("Task project changed");
  const files = changed(review.before, review.after);
  if (unsupportedChanges(review.before, review.after).length)
    throw new Error(
      "Undo cannot safely restore changed links or special files",
    );
  const current = snapshotProject(binding);
  const addedDirs = review.after.dirs.filter(
    (directory) => !review.before.dirs.includes(directory),
  );
  const removedDirs = review.before.dirs.filter(
    (directory) => !review.after.dirs.includes(directory),
  );
  const directoryConflicts = [...addedDirs, ...removedDirs].filter(
    (directory) =>
      current.dirs.includes(directory) !==
      review.after.dirs.includes(directory),
  );
  if (directoryConflicts.length)
    throw new Error(
      `Undo stopped. Newer directory changes exist in: ${directoryConflicts.join(", ")}`,
    );
  const extraDirs = current.dirs.filter(
    (directory) =>
      addedDirs.some((parent) => directory.startsWith(`${parent}/`)) &&
      !review.after.dirs.includes(directory),
  );
  if (extraDirs.length)
    throw new Error(
      `Undo stopped. Newer directories exist in: ${extraDirs.join(", ")}`,
    );
  const extraInAddedDirs = Object.keys(current.files).filter(
    (name) =>
      addedDirs.some((directory) => name.startsWith(`${directory}/`)) &&
      !review.after.files[name],
  );
  const extraUnsupported = Object.keys(current.unsupported).filter(
    (name) =>
      addedDirs.some((directory) => name.startsWith(`${directory}/`)) &&
      !review.after.unsupported[name],
  );
  if (extraInAddedDirs.length || extraUnsupported.length)
    throw new Error(
      `Undo stopped. Newer paths exist in: ${[...extraInAddedDirs, ...extraUnsupported].join(", ")}`,
    );
  const conflicts = files.filter(({ path: name }) => {
    const actual = current.files[name];
    const expected = review.after.files[name];
    return (
      actual?.digest !== expected?.digest || actual?.mode !== expected?.mode
    );
  });
  if (conflicts.length)
    throw new Error(
      `Undo stopped. Newer edits exist in: ${conflicts.map((item) => item.path).join(", ")}`,
    );
  // Preflight every path before the first write. Keep a full current image for rollback.
  const applied: string[] = [];
  try {
    for (const file of files) {
      const target = safeFile(binding, file.path);
      const expected = review.after.files[file.path];
      const actual = existsSync(target) ? readFileSync(target) : null;
      if (
        digest(actual || Buffer.alloc(0)) !==
          digest(
            expected
              ? Buffer.from(expected.content, "base64")
              : Buffer.alloc(0),
          ) ||
        Boolean(actual) !== Boolean(expected)
      )
        throw new Error(`Project changed during Undo: ${file.path}`);
      const original = review.before.files[file.path];
      if (original) {
        mkdirSync(dirname(target), { recursive: true });
        const temporary = `${target}.scully-undo-${turnId}`;
        writeFileSync(temporary, Buffer.from(original.content, "base64"), {
          flag: "wx",
          mode: original.mode,
        });
        renameSync(temporary, target);
        chmodSync(target, original.mode);
      } else {
        unlinkSync(target);
      }
      applied.push(file.path);
    }
    for (const directory of removedDirs.sort((a, b) => a.length - b.length))
      mkdirSync(safeFile(binding, directory));
    for (const directory of addedDirs.sort((a, b) => b.length - a.length))
      rmdirSync(safeFile(binding, directory));
  } catch (error) {
    for (const directory of review.after.dirs.sort(
      (a, b) => a.length - b.length,
    ))
      if (!existsSync(join(binding.path, directory)))
        mkdirSync(join(binding.path, directory));
    for (const name of applied.reverse()) {
      const target = safeFile(binding, name);
      const image = current.files[name];
      if (image) {
        writeFileSync(target, Buffer.from(image.content, "base64"));
        chmodSync(target, image.mode);
      } else if (existsSync(target)) unlinkSync(target);
    }
    for (const directory of removedDirs.sort((a, b) => b.length - a.length))
      if (existsSync(join(binding.path, directory)))
        rmdirSync(join(binding.path, directory));
    throw error;
  }
  review.undone = true;
  writePrivate(path, review);
  return {
    turnId,
    at: new Date().toISOString(),
    files: allChanges(review.before, review.after),
    undoAvailable: false,
    undone: true,
  };
}

export function removeTaskSnapshots(root: string, chatId: string): void {
  const directory = join(root, "pearl-reviews", chatId);
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory))
    unlinkSync(join(directory, entry));
  rmdirSync(directory);
}
