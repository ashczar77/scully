// @vitest-environment node
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
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
import {
  recoverFileTransactions,
  writeProjectTransaction,
} from "../src/main/pearl-file-transaction";

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

it("commits two files together and keeps recoverable originals", () => {
  const f = fixture();
  try {
    writeFileSync(join(f.project, "one.txt"), "old");
    const binding = bindProjectWorkspace(f.project, "existing", f.privateRoot);
    writeProjectTransaction(
      binding,
      [
        { path: "one.txt", before: "old", content: "new" },
        { path: "nested/two.txt", before: null, content: "created" },
      ],
      join(f.privateRoot, "journals"),
      join(f.privateRoot, "backups"),
    );
    expect(readFileSync(join(f.project, "one.txt"), "utf8")).toBe("new");
    expect(readFileSync(join(f.project, "nested/two.txt"), "utf8")).toBe(
      "created",
    );
    expect(
      readFileSync(join(f.privateRoot, "backups/originals/one.txt"), "utf8"),
    ).toBe("old");
    expect(readdirSync(join(f.privateRoot, "journals"))).toEqual([]);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

it("rolls back an early promotion when a later file fails", () => {
  const f = fixture();
  try {
    writeFileSync(join(f.project, "one.txt"), "old");
    const binding = bindProjectWorkspace(f.project, "existing", f.privateRoot);
    expect(() =>
      writeProjectTransaction(
        binding,
        [
          { path: "one.txt", before: "old", content: "new" },
          { path: "nested/two.txt", before: null, content: "created" },
        ],
        join(f.privateRoot, "journals"),
        join(f.privateRoot, "backups"),
        (index) => {
          if (index === 1) throw new Error("simulated failure");
        },
      ),
    ).toThrow("simulated failure");
    expect(readFileSync(join(f.project, "one.txt"), "utf8")).toBe("old");
    expect(() => readFileSync(join(f.project, "nested/two.txt"))).toThrow();
    expect(() => readdirSync(join(f.project, "nested"))).toThrow();
    expect(readdirSync(join(f.privateRoot, "journals"))).toEqual([]);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

it("rejects a stale or unsafe second file before changing the first", () => {
  const f = fixture();
  try {
    writeFileSync(join(f.project, "one.txt"), "old");
    const binding = bindProjectWorkspace(f.project, "existing", f.privateRoot);
    expect(() =>
      writeProjectTransaction(
        binding,
        [
          { path: "one.txt", before: "old", content: "new" },
          { path: "nested/two.txt", before: "expected", content: "new" },
        ],
        join(f.privateRoot, "journals"),
        join(f.privateRoot, "backups"),
      ),
    ).toThrow(/baseline/);
    expect(readFileSync(join(f.project, "one.txt"), "utf8")).toBe("old");
    symlinkSync(f.privateRoot, join(f.project, "nested"));
    expect(() =>
      writeProjectTransaction(
        binding,
        [
          { path: "one.txt", before: "old", content: "new" },
          { path: "nested/two.txt", before: null, content: "new" },
        ],
        join(f.privateRoot, "journals"),
        join(f.privateRoot, "backups"),
      ),
    ).toThrow(/symlink/i);
    expect(readFileSync(join(f.project, "one.txt"), "utf8")).toBe("old");
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

it("recovers an interrupted partial file transaction on restart", () => {
  const f = fixture();
  try {
    const binding = bindProjectWorkspace(f.project, "existing", f.privateRoot);
    writeFileSync(join(f.project, "one.txt"), "new");
    const journal = join(
      f.privateRoot,
      "journals",
      "12345678-1234-1234-1234-123456789abc",
    );
    mkdirSync(journal, { recursive: true });
    writeFileSync(
      join(journal, "manifest.json"),
      JSON.stringify({
        version: 1,
        project: binding,
        state: "pending",
        files: [
          { path: "one.txt", before: "old", content: "new" },
          { path: "two.txt", before: null, content: "created" },
        ],
      }),
    );
    recoverFileTransactions(join(f.privateRoot, "journals"));
    expect(readFileSync(join(f.project, "one.txt"), "utf8")).toBe("old");
    expect(() => readFileSync(join(f.project, "two.txt"))).toThrow();
    expect(readdirSync(join(f.privateRoot, "journals"))).toEqual([]);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

it("leaves an externally changed file untouched when recovery conflicts", () => {
  const f = fixture();
  try {
    const binding = bindProjectWorkspace(f.project, "existing", f.privateRoot);
    writeFileSync(join(f.project, "one.txt"), "external");
    const journal = join(
      f.privateRoot,
      "journals",
      "12345678-1234-1234-1234-123456789abc",
    );
    mkdirSync(journal, { recursive: true });
    writeFileSync(
      join(journal, "manifest.json"),
      JSON.stringify({
        version: 1,
        project: binding,
        state: "pending",
        files: [
          { path: "one.txt", before: "old", content: "new" },
          { path: "two.txt", before: null, content: "created" },
        ],
      }),
    );
    expect(() =>
      recoverFileTransactions(join(f.privateRoot, "journals")),
    ).toThrow(/needs inspection/);
    expect(readFileSync(join(f.project, "one.txt"), "utf8")).toBe("external");
    expect(readdirSync(join(f.privateRoot, "journals"))).toHaveLength(1);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

it("rejects a journal that attempts to recover a private project path", () => {
  const f = fixture();
  try {
    const binding = bindProjectWorkspace(f.project, "existing", f.privateRoot);
    writeFileSync(join(f.project, ".env"), "private");
    const journal = join(
      f.privateRoot,
      "journals",
      "12345678-1234-1234-1234-123456789abc",
    );
    mkdirSync(journal, { recursive: true });
    writeFileSync(
      join(journal, "manifest.json"),
      JSON.stringify({
        version: 1,
        project: binding,
        state: "pending",
        files: [
          { path: ".env", before: "old", content: "private" },
          { path: "other.txt", before: null, content: "new" },
        ],
      }),
    );
    expect(() =>
      recoverFileTransactions(join(f.privateRoot, "journals")),
    ).toThrow(/private file path|Invalid file transaction journal/);
    expect(readFileSync(join(f.project, ".env"), "utf8")).toBe("private");
    expect(readdirSync(join(f.privateRoot, "journals"))).toHaveLength(1);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
