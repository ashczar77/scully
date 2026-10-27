import { execFile } from "node:child_process";
import {
  constants,
  accessSync,
  mkdtempSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, dirname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

const macProfile = `(version 1)
(allow default)
(deny network*)
(allow network-inbound (local ip "localhost:*"))
(allow network-outbound (remote ip "localhost:*"))
(deny file-read*
  (subpath (param "HOME_ROOT"))
  (subpath "/Volumes")
  (subpath "/private/tmp")
  (subpath "/private/var/folders"))
(allow file-read-metadata)
(allow file-read*
  (subpath (param "PROJECT"))
  (subpath (param "EXEC_ROOT"))
  (subpath (param "NODE_ROOT")))
(deny file-write*)
(allow file-write* (subpath (param "PROJECT")))`;

function runtimeRoot(executable: string, home: string): string {
  // Runtime libraries can live beside bin/, but an executable near the root
  // or home must never turn that dependency allowance into private-file access.
  const containsHome = (candidate: string) =>
    candidate === sep || candidate === home || home.startsWith(candidate + sep);
  const directory = dirname(executable);
  const parent = dirname(directory);
  return containsHome(parent)
    ? containsHome(directory)
      ? executable
      : directory
    : parent;
}

function nodeRoot(pathValue: string, home: string): string {
  for (const directory of pathValue.split(delimiter)) {
    if (!directory) continue;
    try {
      const candidate = realpathSync(resolve(directory, "node"));
      accessSync(candidate, constants.X_OK);
      return runtimeRoot(candidate, home);
    } catch {
      // Try the next installed Node executable.
    }
  }
  return runtimeRoot(realpathSync(process.execPath), home);
}

export function containerCommandImage(command: string): string {
  const name = basename(command)
    .replace(/\.(exe|cmd|bat)$/i, "")
    .toLowerCase();
  if (
    [
      "node",
      "npm",
      "npx",
      "pnpm",
      "yarn",
      "corepack",
      "git",
      "sh",
      "bash",
    ].includes(name)
  )
    return "node:22-bookworm";
  if (["python", "python3", "pip", "pip3", "uv"].includes(name))
    return "python:3.13-slim";
  if (["mvn", "mvnw"].includes(name)) return "maven:3.9-eclipse-temurin-21";
  if (["gradle", "gradlew"].includes(name)) return "gradle:8-jdk21";
  if (["java", "javac"].includes(name)) return "eclipse-temurin:21-jdk";
  if (["go", "gofmt"].includes(name)) return "golang:1.24";
  if (["cargo", "rustc", "rustfmt"].includes(name)) return "rust:1.88";
  if (["ruby", "gem", "bundle"].includes(name)) return "ruby:3.4";
  if (["php", "composer"].includes(name)) return "composer:2";
  throw new Error(`No isolated command runtime is configured for ${name}`);
}

export function dockerExecutable(
  project: string,
  platform: NodeJS.Platform = process.platform,
  pathValue: string = process.env.PATH || "",
): string {
  const projectRoot = realpathSync(project);
  const docker = pathValue
    .split(delimiter)
    .filter(
      (directory) =>
        directory &&
        resolve(directory) !== projectRoot &&
        !resolve(directory).startsWith(projectRoot + sep),
    )
    .map((directory) =>
      resolve(directory, platform === "win32" ? "docker.exe" : "docker"),
    )
    .find((candidate) => {
      try {
        accessSync(candidate, constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });
  if (!docker)
    throw new Error(
      "Command isolation requires a local Docker engine and a cached runtime image",
    );
  const resolved = realpathSync(docker);
  if (resolved === projectRoot || resolved.startsWith(projectRoot + sep))
    throw new Error("Docker executable must be outside the project");
  return resolved;
}

export type IsolatedCommand = {
  executable: string;
  args: string[];
  env: Record<string, string>;
};

export function isolatedCommand(
  command: string,
  args: string[],
  project: string,
  scratch: string,
  options: {
    platform?: NodeJS.Platform;
    home?: string;
    path?: string;
    network?: boolean;
    dockerPath?: string;
  } = {},
): IsolatedCommand {
  const platform = options.platform || process.platform;
  if (platform === "linux" || platform === "win32") {
    const pathValue = options.path ?? process.env.PATH ?? "";
    const projectRoot = realpathSync(project);
    if (projectRoot.includes(",") || /[\x00-\x1f]/.test(projectRoot))
      throw new Error("Project path cannot be mounted safely in Docker");
    const docker =
      options.dockerPath || dockerExecutable(project, platform, pathValue);
    const name = basename(command).replace(/\.(exe|cmd|bat)$/i, "");
    const image = containerCommandImage(command);
    const scratchName = basename(scratch);
    const uid = typeof process.getuid === "function" ? process.getuid() : 1000;
    const gid = typeof process.getgid === "function" ? process.getgid() : 1000;
    return {
      executable: docker,
      args: [
        "-H",
        platform === "win32"
          ? "npipe:////./pipe/docker_engine"
          : "unix:///var/run/docker.sock",
        "run",
        "--rm",
        options.network ? "--pull=missing" : "--pull=never",
        "--read-only",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--pids-limit=128",
        "--memory=2g",
        "--tmpfs",
        "/tmp:rw,nosuid,nodev,size=64m",
        "--network",
        options.network ? "bridge" : "none",
        "--user",
        `${uid}:${gid}`,
        "--mount",
        `type=bind,source=${projectRoot},target=/workspace`,
        "--workdir",
        "/workspace",
        "--env",
        `HOME=/workspace/${scratchName}`,
        "--env",
        `TMPDIR=/workspace/${scratchName}`,
        "--env",
        `npm_config_cache=/workspace/${scratchName}/npm-cache`,
        "--entrypoint",
        name,
        image,
        ...args,
      ],
      env: { PATH: pathValue, HOME: scratch },
    };
  }
  if (platform !== "darwin")
    throw new Error("Command isolation is unavailable on this platform");
  const projectRoot = realpathSync(project);
  const commandPath = realpathSync(command);
  const home = realpathSync(options.home || homedir());
  const pathValue = options.path ?? process.env.PATH ?? "/usr/bin:/bin";
  return {
    executable: "/usr/bin/sandbox-exec",
    args: [
      "-p",
      options.network ? macProfile.replace("(deny network*)", "") : macProfile,
      "-D",
      `HOME_ROOT=${home}`,
      "-D",
      `PROJECT=${projectRoot}`,
      "-D",
      `EXEC_ROOT=${runtimeRoot(commandPath, home)}`,
      "-D",
      `NODE_ROOT=${nodeRoot(pathValue, home)}`,
      commandPath,
      ...args,
    ],
    env: {
      PATH: pathValue,
      HOME: scratch,
      TMPDIR: scratch,
      TMP: scratch,
      TEMP: scratch,
      XDG_CACHE_HOME: scratch,
      npm_config_cache: join(scratch, "npm-cache"),
      LANG: "C.UTF-8",
    },
  };
}

export type CommandRunner = (
  command: string,
  args: string[],
  project: string,
  signal?: AbortSignal,
  network?: boolean,
  dockerPath?: string,
) => Promise<{ stdout: string; stderr: string }>;

export const runIsolatedCommand: CommandRunner = async (
  command,
  args,
  project,
  signal,
  network = false,
  dockerPath,
) => {
  const scratch = mkdtempSync(join(project, ".scully-command-"));
  try {
    const launch = isolatedCommand(command, args, project, scratch, {
      network,
      dockerPath,
    });
    return await execute(launch.executable, launch.args, {
      cwd: project,
      env: launch.env,
      timeout: network ? 600_000 : 60_000,
      maxBuffer: network ? 1_000_000 : 200_000,
      signal,
    });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
};
