import { createHash } from "node:crypto";
import { createReadStream, constants } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { safePath, type Run } from "../shared/runs";

export async function fileHash(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
export function runtimePath() {
  return (process.env.PATH || "")
    .split(delimiter)
    .filter((p) => isAbsolute(p))
    .join(delimiter);
}
export async function resolveExecutable(name: string, path = runtimePath()) {
  for (const directory of path.split(delimiter).filter((p) => isAbsolute(p))) {
    const candidate = join(
      directory,
      process.platform === "win32" && !name.endsWith(".exe")
        ? `${name}.exe`
        : name,
    );
    try {
      const canonical = await realpath(candidate);
      if (!(await lstat(canonical)).isFile()) continue;
      if (
        process.platform === "win32" &&
        !canonical.toLowerCase().endsWith(".exe")
      )
        continue;
      await access(canonical, constants.X_OK);
      return canonical;
    } catch {
      /* Try the next absolute PATH entry. Never install a runtime. */
    }
  }
  throw new Error(
    `Executable ${name} was not found on the app's PATH. No runtime was installed. Windows requires a direct .exe, not a shell shim.`,
  );
}
export function snapshotFiles(run: Run) {
  const files = new Map(run.files.map((f) => [f.path, f.content]));
  for (const f of run.drafts) files.set(f.path, f.content);
  if (!files.size || files.size > 112)
    throw new Error("Invalid execution snapshot");
  const names: string[] = [];
  let size = 0;
  for (const [path, content] of files) {
    safePath(path);
    const folded = path.toLowerCase();
    if (
      names.some(
        (n) =>
          n === folded ||
          n.startsWith(folded + "/") ||
          folded.startsWith(n + "/"),
      )
    )
      throw new Error("Conflicting snapshot paths");
    names.push(folded);
    if (typeof content !== "string")
      throw new Error("Invalid snapshot content");
    size += Buffer.byteLength(content);
  }
  if (size > 80_000) throw new Error("Execution snapshot exceeds 80 KB");
  return files;
}
export async function createWorkspace(
  dataRoot: string,
  files: Map<string, string>,
  runId: string,
) {
  if (typeof runId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(runId))
    throw new Error("Invalid run ID");
  const root = join(await realpath(dataRoot), "executions");
  await mkdir(root, { recursive: true, mode: 0o700 });
  if ((await lstat(root)).isSymbolicLink() || (await realpath(root)) !== root)
    throw new Error("Execution root must not be a symlink");
  // A stable opaque prefix links future copies to their run, including denied reviews.
  const owner = createHash("sha256").update(runId).digest("hex");
  const workspace = await mkdtemp(join(root, `check-r-${owner}-`));
  for (const [path, content] of files) {
    await mkdir(dirname(join(workspace, path)), {
      recursive: true,
      mode: 0o700,
    });
    await writeFile(join(workspace, path), content, {
      flag: "wx",
      mode: 0o600,
    });
  }
  return workspace;
}
export async function verifyWorkspace(
  root: string,
  files: Map<string, string>,
  cwd: string,
) {
  if ((await lstat(root)).isSymbolicLink() || (await realpath(root)) !== root)
    throw new Error("Workspace changed");
  const expectedDirs = new Set<string>([""]);
  for (const path of files.keys()) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++)
      expectedDirs.add(parts.slice(0, i).join("/"));
  }
  if (!expectedDirs.has(cwd === "." ? "" : cwd))
    throw new Error("Working directory is not in this snapshot");
  let seen = 0;
  async function walk(relative: string) {
    for (const entry of await readdir(join(root, relative), {
      withFileTypes: true,
    })) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink())
        throw new Error("Workspace contains a symlink");
      if (entry.isDirectory() && expectedDirs.has(path)) await walk(path);
      else if (entry.isFile() && files.has(path)) {
        const full = join(root, path);
        if ((await lstat(full)).size !== Buffer.byteLength(files.get(path)!))
          throw new Error("Workspace changed");
        if ((await readFile(full, "utf8")) !== files.get(path))
          throw new Error("Workspace changed");
        seen++;
      } else throw new Error("Workspace contains unexpected entries");
    }
  }
  await walk("");
  if (seen !== files.size) throw new Error("Workspace files are missing");
  return resolve(root, cwd);
}
