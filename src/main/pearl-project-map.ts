import { execFileSync } from "node:child_process";
import { lstatSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import type { ProjectWorkspace } from "../shared/runs";
import { safePath } from "../shared/runs";
import { inspectProjectFile, verifyProjectRoot } from "./project-workspace";

export const blockedProjectPart = (part: string) =>
  part === ".git" ||
  part === "node_modules" ||
  part === ".scully" ||
  part === ".env" ||
  part.startsWith(".env.") ||
  /\.(pem|key|p12|pfx)$/i.test(part);

type Symbol = { path: string; line: number; name: string; kind: string };
export type PearlProjectMap = {
  files: string[];
  symbols: Symbol[];
  truncated: boolean;
};

const sourceExtensions = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".go",
  ".h",
  ".hpp",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".m",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".swift",
  ".ts",
  ".tsx",
]);
const declaration =
  /^(?:(?:export|pub|public|private|protected|static|async|default)\s+)*(?:(function|class|interface|type|enum|const|def|fn|func|struct|trait)\s+)([A-Za-z_$][\w$]*)\b/;

function fallbackFiles(binding: ProjectWorkspace): {
  paths: string[];
  truncated: boolean;
} {
  const paths: string[] = [];
  const pending = [""];
  let visited = 0;
  while (pending.length && paths.length <= 500 && visited < 1500) {
    const dir = pending.pop()!;
    visited++;
    for (const name of readdirSync(join(binding.path, dir)).sort()) {
      if (blockedProjectPart(name)) continue;
      const path = dir ? `${dir}/${name}` : name;
      const stat = lstatSync(join(binding.path, path));
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) pending.push(path);
      else if (stat.isFile()) paths.push(path);
      if (paths.length > 500) break;
    }
  }
  return {
    paths: paths.sort(),
    truncated: pending.length > 0 || paths.length > 500 || visited >= 1500,
  };
}

function candidateFiles(binding: ProjectWorkspace): {
  paths: string[];
  truncated: boolean;
} {
  try {
    const output = execFileSync(
      "git",
      [
        "--no-optional-locks",
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "submodule.recurse=false",
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "-z",
        "--",
      ],
      {
        cwd: binding.path,
        timeout: 3000,
        maxBuffer: 8_000_000,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          PATH: process.env.PATH || "/usr/bin:/bin",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_COUNT: "0",
          GIT_OPTIONAL_LOCKS: "0",
          GIT_TERMINAL_PROMPT: "0",
          GIT_NO_LAZY_FETCH: "1",
        },
      },
    );
    const paths = output.split("\0").filter(Boolean).sort();
    return { paths, truncated: paths.length > 500 };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stderr?: Buffer };
    if (
      failure.code === "ENOENT" ||
      String(failure.stderr || "").includes("not a git repository")
    )
      return fallbackFiles(binding);
    throw new Error("Project map could not list Git files");
  }
}

export function projectMap(binding: ProjectWorkspace): PearlProjectMap {
  verifyProjectRoot(binding);
  const candidates = candidateFiles(binding);
  const files: string[] = [];
  const symbols: Symbol[] = [];
  let inspectedBytes = 0;
  let truncated = candidates.truncated;
  for (const path of candidates.paths) {
    if (files.length >= 500) {
      truncated = true;
      break;
    }
    if (
      path.split("/").some(blockedProjectPart) ||
      /[\x00-\x1f\x7f]/.test(path)
    )
      continue;
    try {
      safePath(path);
      const stat = lstatSync(join(binding.path, path));
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      files.push(path);
      if (
        !sourceExtensions.has(extname(path).toLowerCase()) ||
        stat.size > 100_000 ||
        inspectedBytes >= 500_000 ||
        symbols.length >= 120
      )
        continue;
      const content = inspectProjectFile(binding, path);
      if (content === null) continue;
      inspectedBytes += content.length;
      for (const [index, line] of content.split("\n").entries()) {
        const match = declaration.exec(line);
        if (match)
          symbols.push({
            path,
            line: index + 1,
            kind: match[1],
            name: match[2],
          });
        if (symbols.length >= 120) {
          truncated = true;
          break;
        }
      }
    } catch {
      continue;
    }
  }
  return { files, symbols, truncated };
}
