import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  lstatSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  safePath,
  type DraftFile,
  type ProjectWorkspace,
} from "../shared/runs";
import { inspectProjectFile, verifyProjectRoot } from "./project-workspace";
import { blockedProjectPart } from "./pearl-project-map";

type Manifest = {
  version: 1;
  project: ProjectWorkspace;
  state: "pending" | "committed";
  files: DraftFile[];
};

function syncDirectory(path: string): void {
  const fd = openSync(path, constants.O_RDONLY);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function saveManifest(directory: string, manifest: Manifest): void {
  const temporary = join(directory, "manifest-next.json");
  writeFileSync(temporary, JSON.stringify(manifest), {
    flag: "w",
    mode: 0o600,
  });
  const fd = openSync(temporary, constants.O_RDONLY);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, join(directory, "manifest.json"));
  syncDirectory(directory);
}

function createParents(root: string, path: string, made: string[]): void {
  let current = root;
  for (const part of path.split("/").slice(0, -1)) {
    current = join(current, part);
    if (!existsSync(current)) {
      mkdirSync(current, { mode: 0o700 });
      made.push(current);
    }
    const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error(`Unsafe parent directory: ${path}`);
  }
}

function removeEmptyParents(paths: string[]): void {
  for (const path of [...paths].reverse()) {
    try {
      rmdirSync(path);
    } catch {
      // A directory with other contents belongs to the project.
    }
  }
}

function validateDrafts(binding: ProjectWorkspace, files: DraftFile[]): void {
  if (!Array.isArray(files) || files.length < 2 || files.length > 8)
    throw new Error("A transaction needs two to eight files");
  verifyProjectRoot(binding);
  const seen = new Set<string>();
  let total = 0;
  for (const file of files) {
    safePath(file.path);
    if (file.path.split("/").some(blockedProjectPart))
      throw new Error("That project path is private or unavailable");
    const key = file.path.toLowerCase();
    if (seen.has(key)) throw new Error("Duplicate transaction path");
    seen.add(key);
    if (
      typeof file.content !== "string" ||
      (file.before !== null && typeof file.before !== "string")
    )
      throw new Error("Invalid transaction content");
    total += file.content.length + (file.before?.length || 0);
    if (total > 400_000) throw new Error("Transaction exceeds size limit");
  }
  for (const path of seen)
    if ([...seen].some((other) => other.startsWith(`${path}/`)))
      throw new Error("Transaction paths overlap");
  for (const file of files)
    if (inspectProjectFile(binding, file.path) !== file.before)
      throw new Error(
        `Project baseline changed at ${file.path}; nothing was written`,
      );
}

function restore(manifest: Manifest): void {
  verifyProjectRoot(manifest.project);
  const conflicts: string[] = [];
  for (const file of [...manifest.files].reverse()) {
    let current: string | null;
    try {
      current = inspectProjectFile(manifest.project, file.path);
    } catch {
      conflicts.push(file.path);
      continue;
    }
    if (current === file.before) continue;
    if (current !== file.content) {
      conflicts.push(file.path);
      continue;
    }
    const target = join(manifest.project.path, file.path);
    if (file.before === null) {
      unlinkSync(target);
    } else {
      const temporary = join(
        dirname(target),
        `.scully-restore-${randomUUID()}`,
      );
      writeFileSync(temporary, file.before, {
        flag: "wx",
        mode: lstatSync(target).mode & 0o777,
      });
      const fd = openSync(temporary, constants.O_RDONLY);
      try {
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(temporary, target);
    }
    syncDirectory(dirname(target));
  }
  if (conflicts.length)
    throw new Error(
      `Transaction recovery needs inspection at ${conflicts.join(", ")}`,
    );
}

function cleanJournal(directory: string, manifest: Manifest): void {
  for (const [index, file] of manifest.files.entries()) {
    const temporary = join(
      dirname(join(manifest.project.path, file.path)),
      `.scully-stage-${directory.split("/").at(-1)}-${index}`,
    );
    if (existsSync(temporary)) unlinkSync(temporary);
  }
  for (const name of ["manifest-next.json", "manifest.json"])
    if (existsSync(join(directory, name))) unlinkSync(join(directory, name));
  rmdirSync(directory);
}

export function recoverFileTransactions(root: string): void {
  if (!existsSync(root)) return;
  for (const name of readdirSync(root)) {
    if (!/^[0-9a-f-]{36}$/.test(name)) continue;
    const directory = join(root, name);
    const entry = lstatSync(directory);
    if (!entry.isDirectory() || entry.isSymbolicLink())
      throw new Error("Invalid file transaction journal");
    if (!existsSync(join(directory, "manifest.json"))) {
      if (existsSync(join(directory, "manifest-next.json")))
        unlinkSync(join(directory, "manifest-next.json"));
      rmdirSync(directory);
      continue;
    }
    const manifest = JSON.parse(
      readFileSync(join(directory, "manifest.json"), "utf8"),
    ) as Manifest;
    if (
      manifest.version !== 1 ||
      !Array.isArray(manifest.files) ||
      manifest.files.length < 2 ||
      manifest.files.length > 8
    )
      throw new Error("Invalid file transaction journal");
    verifyProjectRoot(manifest.project);
    const paths = new Set<string>();
    for (const file of manifest.files) {
      safePath(file.path);
      if (file.path.split("/").some(blockedProjectPart))
        throw new Error("Invalid file transaction journal");
      if (paths.has(file.path.toLowerCase()))
        throw new Error("Invalid file transaction journal");
      paths.add(file.path.toLowerCase());
      if (
        typeof file.content !== "string" ||
        (file.before !== null && typeof file.before !== "string")
      )
        throw new Error("Invalid file transaction journal");
    }
    if (manifest.state === "pending") restore(manifest);
    else if (manifest.state !== "committed")
      throw new Error("Invalid file transaction state");
    cleanJournal(directory, manifest);
  }
}

export function writeProjectTransaction(
  binding: ProjectWorkspace,
  files: DraftFile[],
  journalRoot: string,
  backupRoot: string,
  beforePromote: (index: number) => void = () => {},
): void {
  validateDrafts(binding, files);
  const id = randomUUID();
  const directory = join(journalRoot, id);
  const manifest: Manifest = {
    version: 1,
    project: binding,
    state: "pending",
    files,
  };
  let committed = false;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const createdParents: string[] = [];
  try {
    saveManifest(directory, manifest);
    for (const file of files) {
      if (file.before === null) continue;
      const backup = join(backupRoot, "originals", file.path);
      mkdirSync(dirname(backup), { recursive: true, mode: 0o700 });
      writeFileSync(backup, file.before, { flag: "wx", mode: 0o600 });
      const backupFd = openSync(backup, constants.O_RDONLY);
      try {
        fsyncSync(backupFd);
      } finally {
        closeSync(backupFd);
      }
      syncDirectory(dirname(backup));
    }
    for (const [index, file] of files.entries()) {
      createParents(binding.path, file.path, createdParents);
      const target = join(binding.path, file.path);
      const temporary = join(dirname(target), `.scully-stage-${id}-${index}`);
      const mode =
        file.before === null ? 0o600 : lstatSync(target).mode & 0o777;
      writeFileSync(temporary, file.content, { flag: "wx", mode });
      chmodSync(temporary, mode);
      const fd = openSync(temporary, constants.O_RDONLY);
      try {
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    }
    for (const [index, file] of files.entries()) {
      beforePromote(index);
      if (inspectProjectFile(binding, file.path) !== file.before)
        throw new Error(`Project changed before writing ${file.path}`);
      const target = join(binding.path, file.path);
      const temporary = join(dirname(target), `.scully-stage-${id}-${index}`);
      if (file.before === null) {
        linkSync(temporary, target);
        unlinkSync(temporary);
      } else renameSync(temporary, target);
      syncDirectory(dirname(target));
    }
    manifest.state = "committed";
    saveManifest(directory, manifest);
    committed = true;
  } catch (error) {
    if (committed)
      throw new Error("File transaction committed; cleanup needs recovery", {
        cause: error,
      });
    manifest.state = "pending";
    try {
      restore(manifest);
      cleanJournal(directory, manifest);
      removeEmptyParents(createdParents);
    } catch (recoveryError) {
      throw new Error(
        `File transaction needs recovery: ${recoveryError instanceof Error ? recoveryError.message : "unknown error"}`,
        { cause: error },
      );
    }
    throw error;
  }
  try {
    cleanJournal(directory, manifest);
  } catch {
    // The committed marker is durable. Restart cleanup can remove this journal.
  }
}
