import { execFile } from "node:child_process";
import {
  constants,
  accessSync,
  mkdtempSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve, sep } from "node:path";
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
  } = {},
): IsolatedCommand {
  if ((options.platform || process.platform) !== "darwin")
    throw new Error("Command isolation is unavailable on this platform");
  const projectRoot = realpathSync(project);
  const commandPath = realpathSync(command);
  const home = realpathSync(options.home || homedir());
  const pathValue = options.path ?? process.env.PATH ?? "/usr/bin:/bin";
  return {
    executable: "/usr/bin/sandbox-exec",
    args: [
      "-p",
      macProfile,
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
) => Promise<{ stdout: string; stderr: string }>;

export const runIsolatedCommand: CommandRunner = async (
  command,
  args,
  project,
  signal,
) => {
  const scratch = mkdtempSync(join(project, ".scully-command-"));
  try {
    const launch = isolatedCommand(command, args, project, scratch);
    return await execute(launch.executable, launch.args, {
      cwd: project,
      env: launch.env,
      timeout: 60_000,
      maxBuffer: 200_000,
      signal,
    });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
};
