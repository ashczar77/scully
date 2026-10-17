// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { initializeGit, readGitHistory } from "../src/main/git-history";

function git(folder: string, ...args: string[]) {
  execFileSync("git", ["-C", folder, ...args], { stdio: "pipe" });
}

it("shows a setup state until Git is initialized in the selected folder", () => {
  const root = mkdtempSync(join(tmpdir(), "scully-git-history-"));
  try {
    expect(readGitHistory(root)).toEqual({ state: "no-repository" });
    const initialized = initializeGit(root);
    expect(initialized.state).toBe("ready");
    if (initialized.state === "ready") expect(initialized.commits).toEqual([]);
    expect(() => initializeGit(root)).toThrow(/already set up/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("reads real commits and uncommitted changes without using a parent repository", () => {
  const root = mkdtempSync(join(tmpdir(), "scully-git-history-"));
  try {
    git(root, "init", "--quiet");
    git(root, "config", "user.name", "Test User");
    git(root, "config", "user.email", "test@example.invalid");
    writeFileSync(join(root, "app.ts"), "first");
    git(root, "add", "app.ts");
    git(root, "commit", "--quiet", "-m", "First app commit");
    writeFileSync(join(root, "app.ts"), "changed");
    const result = readGitHistory(root);
    expect(result.state).toBe("ready");
    if (result.state === "ready") {
      expect(result.commits[0].subject).toBe("First app commit");
      expect(result.commits[0].author).toBe("Test User");
      expect(result.changes).toEqual([{ status: " M", path: "app.ts" }]);
    }
    const nested = join(root, "nested");
    mkdirSync(nested);
    expect(readGitHistory(nested)).toEqual({ state: "no-repository" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
