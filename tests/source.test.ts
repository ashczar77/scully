// @vitest-environment node
import { mkdtemp, writeFile, mkdir, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { readSource } from "../src/main/source";
it("snapshots safe text without reading symlinks, hidden files, binary content or obvious secrets", async () => {
  const root = await mkdtemp(join(tmpdir(), "scully-source-"));
  try {
    await mkdir(join(root, "project"));
    await writeFile(join(root, "outside"), "private");
    const p = join(root, "project");
    await writeFile(join(p, "main.py"), 'print("hi")');
    await writeFile(join(p, ".env"), "not sent");
    await writeFile(join(p, "config.txt"), 'token="abcdefghijklmnop123456"');
    await writeFile(join(p, "binary.bin"), Buffer.from([0, 255, 3]));
    await symlink(join(root, "outside"), join(p, "link"));
    const source = await readSource(p);
    expect(source.files).toEqual([{ path: "main.py", content: 'print("hi")' }]);
    expect(source.excluded).toBe(4);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
