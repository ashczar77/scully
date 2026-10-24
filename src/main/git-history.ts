import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
  GitHistory,
  GitCommit,
  GitFileChange,
} from "../shared/git-history";
import { safePath } from "../shared/runs";
import { blockedProjectPart } from "./pearl-project-map";

function git(folder: string, args: string[]): string {
  return execFileSync(
    "git",
    [
      "--no-pager",
      "--no-optional-locks",
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "color.ui=never",
      "-C",
      folder,
      ...args,
    ],
    {
      encoding: "utf8",
      timeout: 5000,
      maxBuffer: 2_000_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

function bounded(value: string, length: number) {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, length);
}

export function readGitHistory(folder: string): GitHistory {
  let marker;
  try {
    marker = lstatSync(join(folder, ".git"));
  } catch {
    return { state: "no-repository" };
  }
  if (!marker.isFile() && !marker.isDirectory())
    return { state: "no-repository" };
  try {
    if (
      realpathSync(
        resolve(git(folder, ["rev-parse", "--show-toplevel"]).trim()),
      ) !== realpathSync(resolve(folder))
    )
      return {
        state: "unavailable",
        detail: "The Git root differs from the selected project folder.",
      };
    let branchName = "Detached HEAD";
    try {
      branchName = git(folder, [
        "symbolic-ref",
        "--quiet",
        "--short",
        "HEAD",
      ]).trim();
    } catch {}
    const branch = bounded(branchName, 120);
    const branches = git(folder, [
      "branch",
      "--all",
      "--format=%(refname:short)",
    ])
      .split("\n")
      .filter(Boolean)
      .slice(0, 80)
      .map((value) => bounded(value, 120));
    let rawLog = "";
    try {
      rawLog = git(folder, [
        "log",
        "--all",
        "--topo-order",
        "--max-count=80",
        "-z",
        "--format=%H%x00%P%x00%s%x00%an%x00%aI%x00%D%x00",
      ]);
    } catch {
      // A newly initialized repository has no commit history yet.
    }
    const fields = rawLog.split("\0");
    const commits: GitCommit[] = [];
    for (let index = 0; index + 5 < fields.length; index += 7) {
      const [hash, parents, subject, author, date, refs] = fields.slice(
        index,
        index + 6,
      );
      if (!/^[0-9a-f]{40,64}$/.test(hash || "")) continue;
      commits.push({
        hash,
        parents: parents
          .split(" ")
          .filter((value) => /^[0-9a-f]{40,64}$/.test(value)),
        subject: bounded(subject, 180),
        author: bounded(author, 100),
        date: bounded(date, 45),
        refs: refs
          ? refs
              .split(", ")
              .map((value) => bounded(value, 100))
              .slice(0, 8)
          : [],
      });
    }
    const rawStatus = git(folder, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=normal",
    ]);
    const changes: GitFileChange[] = [];
    const entries = rawStatus.split("\0");
    for (
      let index = 0;
      index < entries.length && changes.length < 200;
      index++
    ) {
      const entry = entries[index];
      if (!entry || entry.length < 4) continue;
      const status = entry.slice(0, 2);
      const path = entry.slice(3);
      changes.push({ status: bounded(status, 2), path: bounded(path, 300) });
      if (status.includes("R") || status.includes("C")) index++;
    }
    return {
      state: "ready",
      branch: branch || "Detached HEAD",
      branches,
      commits,
      changes,
    };
  } catch {
    return {
      state: "unavailable",
      detail: "Git history could not be read from this project folder.",
    };
  }
}

export function initializeGit(folder: string): GitHistory {
  try {
    lstatSync(join(folder, ".git"));
    throw new Error("Git is already set up in this folder");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  git(folder, ["-c", "init.templateDir=/dev/null", "init", "--quiet"]);
  return readGitHistory(folder);
}

export function readPearlGitDiff(
  folder: string,
  path: unknown,
  commit?: unknown,
): string {
  safePath(path);
  if (path.split("/").some(blockedProjectPart))
    throw new Error("That project path is private or unavailable");
  if (
    commit !== undefined &&
    (typeof commit !== "string" || !/^[0-9a-f]{40,64}$/.test(commit))
  )
    throw new Error("Invalid commit");
  const history = readGitHistory(folder);
  if (history.state !== "ready") throw new Error("Git history is unavailable");
  if (
    !commit &&
    history.changes.some((item) => item.path === path && item.status === "??")
  ) {
    const file = join(folder, path);
    let ancestor = folder;
    for (const part of path.split("/")) {
      ancestor = join(ancestor, part);
      const node = lstatSync(ancestor);
      if (node.isSymbolicLink() || (node.isFile() && node.nlink > 1))
        throw new Error("Unsafe project path");
    }
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 512_000)
      return "Untracked binary or large file. Open it from Files if it is readable text.";
    try {
      const value = new TextDecoder("utf-8", { fatal: true }).decode(
        readFileSync(file),
      );
      return `--- /dev/null\n+++ b/${path}\n${value
        .split("\n")
        .map((line) => `+${line}`)
        .join("\n")}`;
    } catch {
      return "Untracked binary file.";
    }
  }
  const args = commit
    ? ["show", "--format=", "--no-ext-diff", "--no-renames", commit, "--", path]
    : ["diff", "HEAD", "--no-ext-diff", "--no-renames", "--", path];
  try {
    return git(folder, args).slice(0, 1_000_000);
  } catch {
    return "Diff unavailable for this file.";
  }
}

export function readPearlGitCommitFiles(
  folder: string,
  commit: unknown,
): GitFileChange[] {
  if (typeof commit !== "string" || !/^[0-9a-f]{40,64}$/.test(commit))
    throw new Error("Invalid commit");
  if (readGitHistory(folder).state !== "ready")
    throw new Error("Git history is unavailable");
  const raw = git(folder, [
    "diff-tree",
    "--root",
    "--no-commit-id",
    "--name-status",
    "-r",
    "-z",
    "--no-renames",
    commit,
  ]);
  const parts = raw.split("\0");
  const files: GitFileChange[] = [];
  for (let i = 0; i + 1 < parts.length && files.length < 300; i += 2) {
    const status = parts[i];
    const path = parts[i + 1];
    try {
      safePath(path);
      if (path.split("/").some(blockedProjectPart)) continue;
      files.push({ status: bounded(status, 2), path });
    } catch {
      /* Do not expose private paths in the browser. */
    }
  }
  return files;
}
