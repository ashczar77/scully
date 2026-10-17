import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import {
  safePath,
  type DraftFile,
  type ProjectWorkspace,
  type SourceFile,
} from "../shared/runs";

export function verifyProjectRoot(binding: ProjectWorkspace) {
  const stat = lstatSync(binding.path);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    realpathSync(binding.path) !== binding.path ||
    stat.dev !== binding.dev ||
    stat.ino !== binding.ino
  )
    throw new Error("Project folder moved or changed. Choose it again.");
}

function inspect(binding: ProjectWorkspace, path: string): string | null {
  safePath(path);
  verifyProjectRoot(binding);
  let current = binding.path;
  const parts = path.split("/");
  for (let i = 0; i < parts.length; i++) {
    const siblings = readdirSync(current);
    if (
      siblings.some(
        (item) =>
          item !== parts[i] && item.toLowerCase() === parts[i].toLowerCase(),
      )
    )
      throw new Error(`Case-conflicting project path: ${path}`);
    if (!siblings.includes(parts[i])) return null;
    current = join(current, parts[i]);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink())
      throw new Error(`Symlink in project path: ${path}`);
    if (i < parts.length - 1) {
      if (!stat.isDirectory())
        throw new Error(`Parent is not a directory: ${path}`);
    } else {
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > 80_000)
        throw new Error(`Unsupported project file: ${path}`);
      return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        readFileSync(current),
      );
    }
  }
  return null;
}

function hasOnlyGitMetadata(path: string) {
  const entries = readdirSync(path);
  if (!entries.length) return true;
  if (entries.length !== 1 || entries[0] !== ".git") return false;
  const marker = lstatSync(join(path, ".git"));
  return marker.isDirectory() || marker.isFile();
}

export function bindProjectWorkspace(
  directory: string,
  kind: ProjectWorkspace["kind"],
  dataRoot: string,
): ProjectWorkspace {
  if (
    typeof directory !== "string" ||
    !directory ||
    !["new", "existing"].includes(kind)
  )
    throw new Error("Choose a project folder");
  const requested = resolve(directory);
  const stat = lstatSync(requested);
  if (stat.isSymbolicLink())
    throw new Error("Choose a real folder, not a symlink");
  const path = realpathSync(requested);
  if (!stat.isDirectory()) throw new Error("Choose a project folder");
  const privateRoot = realpathSync(dataRoot);
  if (path === privateRoot || path.startsWith(privateRoot + sep))
    throw new Error("Application private data cannot be a project folder");
  if (kind === "new" && !hasOnlyGitMetadata(path))
    throw new Error(
      "Choose an empty folder or a new Git repository for this project",
    );
  return { path, kind, dev: stat.dev, ino: stat.ino };
}

export function verifyProjectWorkspace(
  binding: ProjectWorkspace,
  source: SourceFile[],
) {
  verifyProjectRoot(binding);
  if (
    binding.kind === "new" &&
    !source.length &&
    !binding.writtenFiles?.length &&
    !hasOnlyGitMetadata(binding.path)
  )
    throw new Error("New project folder is no longer empty");
  for (const file of source)
    if (inspect(binding, file.path) !== file.content)
      throw new Error(`Project baseline changed at ${file.path}`);
}

function ensureParents(binding: ProjectWorkspace, path: string) {
  let current = binding.path;
  for (const part of path.split("/").slice(0, -1)) {
    current = join(current, part);
    try {
      mkdirSync(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const stat = lstatSync(current);
    if (stat.isSymbolicLink())
      throw new Error(`Symlink in project path: ${path}`);
    if (!stat.isDirectory() || realpathSync(current) !== current)
      throw new Error(`Unsafe parent directory: ${path}`);
  }
}

export function writeProjectWorkspace(
  binding: ProjectWorkspace,
  drafts: DraftFile[],
  onWritten: (path: string) => void = () => {},
  backupRoot?: string,
) {
  verifyProjectRoot(binding);
  for (const file of drafts)
    if (inspect(binding, file.path) !== file.before)
      throw new Error(
        `Project baseline changed at ${file.path}; nothing was written`,
      );
  if (backupRoot) {
    mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
    for (const file of drafts) {
      if (file.before === null) continue;
      const backup = join(backupRoot, "originals", file.path);
      mkdirSync(dirname(backup), { recursive: true, mode: 0o700 });
      writeFileSync(backup, file.before, { flag: "wx", mode: 0o600 });
    }
  }
  for (const file of drafts) {
    verifyProjectRoot(binding);
    ensureParents(binding, file.path);
    if (inspect(binding, file.path) !== file.before)
      throw new Error(`Project changed before writing ${file.path}`);
    const target = join(binding.path, file.path);
    const fd = openSync(
      target,
      file.before === null
        ? constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
        : constants.O_RDWR | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1)
        throw new Error(`Unsupported project file: ${file.path}`);
      if (
        file.before !== null &&
        !readFileSync(fd).equals(Buffer.from(file.before))
      )
        throw new Error(`Project changed before writing ${file.path}`);
      const bytes = Buffer.from(file.content);
      let offset = 0;
      while (offset < bytes.length) {
        const count = writeSync(
          fd,
          bytes,
          offset,
          bytes.length - offset,
          offset,
        );
        if (!count) throw new Error(`Write made no progress: ${file.path}`);
        offset += count;
      }
      ftruncateSync(fd, bytes.length);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    onWritten(file.path);
  }
}
