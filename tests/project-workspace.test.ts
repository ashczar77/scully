// @vitest-environment node
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  bindProjectWorkspace,
  verifyProjectWorkspace,
  writeProjectWorkspace,
} from "../src/main/project-workspace";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "scully-project-workspace-"));
  const privateRoot = join(root, "private");
  const project = join(root, "project");
  mkdirSync(privateRoot);
  mkdirSync(project);
  return { root, privateRoot, project };
}

it("binds an empty project folder and writes generated files there", () => {
  const f = fixture();
  try {
    const binding = bindProjectWorkspace(f.project, "new", f.privateRoot);
    mkdirSync(join(f.project, ".git"));
    verifyProjectWorkspace(binding, []);
    const written: string[] = [];
    writeProjectWorkspace(
      binding,
      [
        {
          path: "src/app.ts",
          content: "export const ready = true",
          before: null,
        },
      ],
      (writtenPath) => written.push(writtenPath),
    );
    expect(written).toEqual(["src/app.ts"]);
    expect(readFileSync(join(f.project, "src", "app.ts"), "utf8")).toBe(
      "export const ready = true",
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

it("rejects nonempty new folders, private app data, and symlink destinations", () => {
  const f = fixture();
  try {
    writeFileSync(join(f.project, "keep.txt"), "keep");
    expect(() => bindProjectWorkspace(f.project, "new", f.privateRoot)).toThrow(
      /empty/i,
    );
    expect(() =>
      bindProjectWorkspace(f.privateRoot, "new", f.privateRoot),
    ).toThrow(/private|application/i);
    symlinkSync(f.project, join(f.root, "link"));
    expect(() =>
      bindProjectWorkspace(join(f.root, "link"), "existing", f.privateRoot),
    ).toThrow(/symlink/i);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

it("refuses stale source content and symlink parents without changing other files", () => {
  const f = fixture();
  try {
    writeFileSync(join(f.project, "app.ts"), "user edit");
    const binding = bindProjectWorkspace(f.project, "existing", f.privateRoot);
    expect(() =>
      verifyProjectWorkspace(binding, [{ path: "app.ts", content: "old" }]),
    ).toThrow(/changed|baseline|conflict/i);
    expect(() =>
      writeProjectWorkspace(binding, [
        { path: "app.ts", content: "generated", before: "old" },
      ]),
    ).toThrow(/changed|baseline|conflict/i);
    expect(readFileSync(join(f.project, "app.ts"), "utf8")).toBe("user edit");
    mkdirSync(join(f.root, "outside"));
    symlinkSync(join(f.root, "outside"), join(f.project, "src"));
    expect(() =>
      writeProjectWorkspace(binding, [
        { path: "src/app.ts", content: "bad", before: null },
      ]),
    ).toThrow(/symlink/i);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
