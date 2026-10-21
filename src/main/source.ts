import { readdir, open, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, relative, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { safePath, containsSecret, type SourceSelection } from "../shared/runs";

const execute = promisify(execFile);
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024;

// Text-only intake. Git's exclude rules apply to both tracked and untracked files.
export async function readSource(directory: string): Promise<SourceSelection> {
  const root = await realpath(directory);
  const files: SourceSelection["files"] = [];
  let excluded = 0;
  let total = 0;
  const candidates: string[] = [];
  let gitEnumerated = false;
  try {
    const { stdout } = await execute(
      "git",
      ["-C", root, "rev-parse", "--show-toplevel"],
      { timeout: 10_000 },
    );
    if ((await realpath(stdout.trim())) === root) {
      const listed = await execute(
        "git",
        ["-C", root, "ls-files", "-c", "-o", "--exclude-standard", "-z"],
        { timeout: 20_000, encoding: "buffer", maxBuffer: 32 * 1024 * 1024 },
      );
      candidates.push(
        ...Buffer.from(listed.stdout)
          .toString("utf8")
          .split("\0")
          .filter(Boolean),
      );
      gitEnumerated = true;
    }
  } catch {
    // Non-Git folders use the same path and content safety filters.
  }
  if (!gitEnumerated) {
    async function walk(dir: string, depth: number): Promise<void> {
      if (depth > 64)
        throw new Error(
          "Project directory nesting exceeds the safe scan depth",
        );
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        const rel = relative(root, path).split(sep).join("/");
        try {
          safePath(rel);
        } catch {
          excluded++;
          continue;
        }
        if (entry.isSymbolicLink()) {
          excluded++;
          continue;
        }
        if (entry.isDirectory()) await walk(path, depth + 1);
        else if (entry.isFile()) candidates.push(rel);
        else excluded++;
      }
    }
    await walk(root, 0);
  }
  if (candidates.length > 20_000)
    throw new Error(
      "Project has more than 20,000 candidate files. Narrow the selected folder.",
    );
  for (const rel of [...new Set(candidates)].sort()) {
    try {
      safePath(rel);
    } catch {
      excluded++;
      continue;
    }
    const path = join(root, rel);
    let canonical: string;
    try {
      canonical = await realpath(path);
    } catch {
      excluded++;
      continue;
    }
    if (canonical !== path || !canonical.startsWith(root + sep)) {
      excluded++;
      continue;
    }
    let handle;
    try {
      handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch {
      excluded++;
      continue;
    }
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_FILE_BYTES) {
        excluded++;
        continue;
      }
      if (total + stat.size > MAX_SNAPSHOT_BYTES)
        throw new Error(
          "Approved project snapshot would exceed 64 MB. Narrow the project scope.",
        );
      const bytes = Buffer.alloc(stat.size + 1);
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      if (bytesRead !== stat.size || bytesRead > MAX_FILE_BYTES) {
        excluded++;
        continue;
      }
      let content: string;
      try {
        content = new TextDecoder("utf-8", { fatal: true }).decode(
          bytes.subarray(0, bytesRead),
        );
      } catch {
        excluded++;
        continue;
      }
      if (content.includes("\0") || containsSecret(content)) {
        excluded++;
        continue;
      }
      total += bytesRead;
      files.push({ path: rel, content });
    } finally {
      await handle.close();
    }
  }
  return {
    id: randomUUID(),
    name: root.split(sep).pop() || "Selected project",
    root,
    files,
    excluded,
  };
}
