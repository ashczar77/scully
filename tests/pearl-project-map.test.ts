// @vitest-environment node
import { afterEach, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bindProjectWorkspace } from "../src/main/project-workspace";
import { projectMap } from "../src/main/pearl-project-map";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function project() {
  const root = mkdtempSync(join(tmpdir(), "pearl-map-"));
  roots.push(root);
  const data = join(root, "data");
  const folder = join(root, "project");
  mkdirSync(data);
  mkdirSync(folder);
  return {
    root,
    data,
    folder,
    binding: () => bindProjectWorkspace(folder, "existing", data),
  };
}

it("maps bounded project paths and declarations without exposing source bodies", () => {
  const f = project();
  mkdirSync(join(f.folder, "src"));
  writeFileSync(
    join(f.folder, "src", "app.ts"),
    'export function launchRoom() { return "secret body"; }\nexport class Room {}\n',
  );
  writeFileSync(join(f.folder, ".env"), "NEBIUS_KEY=private");
  const map = projectMap(f.binding());
  expect(map.files).toContain("src/app.ts");
  expect(map.symbols).toContainEqual({
    path: "src/app.ts",
    line: 1,
    name: "launchRoom",
    kind: "function",
  });
  expect(JSON.stringify(map)).not.toContain("secret body");
  expect(JSON.stringify(map)).not.toContain("NEBIUS_KEY");
});

it("honors Git exclusions and never reads a symlinked file", () => {
  const f = project();
  execFileSync("git", ["init", "-q", f.folder]);
  writeFileSync(join(f.folder, ".gitignore"), "ignored.ts\n");
  writeFileSync(join(f.folder, "ignored.ts"), "export function hidden() {}\n");
  writeFileSync(join(f.folder, "visible.ts"), "export function visible() {}\n");
  writeFileSync(join(f.root, "outside.ts"), "export function outside() {}\n");
  symlinkSync(join(f.root, "outside.ts"), join(f.folder, "link.ts"));
  const map = projectMap(f.binding());
  expect(map.files).toContain("visible.ts");
  expect(map.files).not.toContain("ignored.ts");
  expect(map.files).not.toContain("link.ts");
  expect(JSON.stringify(map)).not.toContain("outside");
});

it("does not run a repository-configured Git filesystem monitor", () => {
  const f = project();
  execFileSync("git", ["init", "-q", f.folder]);
  const marker = join(f.root, "monitor-ran");
  const monitor = join(f.root, "monitor.sh");
  writeFileSync(monitor, `#!/bin/sh\nprintf called > '${marker}'\n`);
  chmodSync(monitor, 0o700);
  execFileSync("git", ["-C", f.folder, "config", "core.fsmonitor", monitor]);
  writeFileSync(join(f.folder, "app.ts"), "export function start() {}\n");
  const map = projectMap(f.binding());
  expect(map.files).toContain("app.ts");
  expect(existsSync(marker)).toBe(false);
});

it("bounds traversal when a project has many files", () => {
  const f = project();
  for (let index = 0; index < 520; index++)
    writeFileSync(
      join(f.folder, `file-${String(index).padStart(3, "0")}.ts`),
      "",
    );
  const map = projectMap(f.binding());
  expect(map.files).toHaveLength(500);
  expect(map.truncated).toBe(true);
});

it("keeps listing files after the declaration budget is reached", () => {
  const f = project();
  mkdirSync(join(f.folder, "src"));
  mkdirSync(join(f.folder, "test"));
  writeFileSync(
    join(f.folder, "src", "app.ts"),
    Array.from(
      { length: 125 },
      (_, index) => `export const item${index} = 1;`,
    ).join("\n"),
  );
  writeFileSync(join(f.folder, "test", "app.test.ts"), "test placeholder\n");
  const map = projectMap(f.binding());
  expect(map.symbols).toHaveLength(120);
  expect(map.files).toContain("test/app.test.ts");
  expect(map.truncated).toBe(true);
});

it("omits local variables from the top-level declaration map", () => {
  const f = project();
  writeFileSync(
    join(f.folder, "app.ts"),
    "export function start() {\n  const temporary = 1;\n  return temporary;\n}\nexport const ready = true;\n",
  );
  const map = projectMap(f.binding());
  expect(map.symbols.map((symbol) => symbol.name)).toEqual(["start", "ready"]);
});
