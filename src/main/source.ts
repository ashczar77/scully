import { readdir, open, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { join, relative, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { safePath, containsSecret, type SourceSelection } from "../shared/runs";
// Text-only, finite, selected-file intake. No project scripts or symlinks run.
export async function readSource(directory: string): Promise<SourceSelection> {
  const root = await realpath(directory);
  const files: SourceSelection["files"] = [];
  let excluded = 0,
    visited = 0,
    total = 0;
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 8) {
      excluded++;
      return;
    }
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (++visited > 1000)
        throw new Error(
          "Project scan exceeds 1000 entries. Choose a smaller source folder.",
        );
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
      const canonical = await realpath(path);
      if (!canonical.startsWith(root + sep) || canonical !== path) {
        excluded++;
        continue;
      }
      if (entry.isDirectory()) {
        await walk(path, depth + 1);
        continue;
      }
      if (!entry.isFile()) {
        excluded++;
        continue;
      }
      const handle = await open(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > 16000 || files.length >= 100) {
          excluded++;
          continue;
        }
        const bytes = Buffer.alloc(16001);
        const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
        if (bytesRead > 16000) {
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
        if (
          content.includes("\0") ||
          containsSecret(content) ||
          total + bytesRead > 32000
        ) {
          excluded++;
          continue;
        }
        total += bytesRead;
        files.push({ path: rel, content });
      } finally {
        await handle.close();
      }
    }
  }
  await walk(root, 0);
  return {
    id: randomUUID(),
    name: root.split(sep).pop() || "Selected project",
    root,
    files,
    excluded,
  };
}
