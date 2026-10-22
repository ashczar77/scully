import { chmod, stat } from "node:fs/promises";
import { join } from "node:path";

if (process.platform === "darwin") {
  const root = join("node_modules", "node-pty");
  const candidates = [
    join(root, "build", "Release", "spawn-helper"),
    join(root, "prebuilds", `darwin-${process.arch}`, "spawn-helper"),
  ];
  let found = false;
  for (const path of candidates) {
    let file;
    try {
      file = await stat(path);
    } catch {
      continue;
    }
    if (!file.isFile()) throw new Error(`Invalid PTY helper: ${path}`);
    await chmod(path, file.mode | 0o111);
    found = true;
  }
  if (!found) throw new Error("PTY helper is missing for this architecture");
}
