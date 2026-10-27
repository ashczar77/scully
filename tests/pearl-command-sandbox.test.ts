// @vitest-environment node
import { expect, it } from "vitest";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  containerCommandImage,
  dockerExecutable,
  isolatedCommand,
  runIsolatedCommand,
} from "../src/main/pearl-command-sandbox";

it("binds an approved executable and project to a constrained macOS process", () => {
  const project = realpathSync(process.cwd());
  const command = realpathSync(process.execPath);
  const scratch = `${project}/.scully-command-fixture`;
  const launch = isolatedCommand(command, ["--version"], project, scratch, {
    platform: "darwin",
    home: homedir(),
    path: process.env.PATH || "/usr/bin:/bin",
  });
  expect(launch.executable).toBe("/usr/bin/sandbox-exec");
  expect(launch.args).toContain(`PROJECT=${project}`);
  expect(launch.args).toContain(`HOME_ROOT=${realpathSync(homedir())}`);
  expect(launch.args).toContain(command);
  expect(launch.args.at(-1)).toBe("--version");
  expect(launch.args[1]).toContain("(deny network*)");
  expect(launch.args[1]).toContain(
    '(allow network-outbound (remote ip "localhost:*"))',
  );
  expect(launch.args[1]).toContain("(deny file-write*)");
  expect(launch.env.HOME).toBe(scratch);
  expect(launch.env.TMPDIR).toBe(scratch);
  expect(Object.keys(launch.env)).not.toContain("NEBIUS_API_KEY");
});

it("fails closed when command isolation is unavailable", () => {
  expect(() =>
    isolatedCommand(process.execPath, [], process.cwd(), process.cwd(), {
      platform: "linux",
      path: "",
    }),
  ).toThrow(/requires a local Docker engine/);
});

it("resolves Docker approval without requiring a host language runtime", () => {
  const root = mkdtempSync(join(tmpdir(), "scully-docker-approval-"));
  const project = join(root, "project");
  const bin = join(root, "bin");
  mkdirSync(project);
  mkdirSync(bin);
  const docker = join(bin, "docker.exe");
  try {
    writeFileSync(docker, "fixture");
    chmodSync(docker, 0o700);
    expect(dockerExecutable(project, "win32", bin)).toBe(realpathSync(docker));
    expect(containerCommandImage("npm.cmd")).toBe("node:22-bookworm");
    expect(containerCommandImage("mvn.bat")).toBe(
      "maven:3.9-eclipse-temurin-21",
    );
    expect(() => containerCommandImage("unknown-command.exe")).toThrow(
      /No isolated command runtime/,
    );
    if (process.platform !== "win32") {
      rmSync(docker);
      symlinkSync(join(project, "fake-docker"), docker);
      writeFileSync(join(project, "fake-docker"), "fixture");
      chmodSync(join(project, "fake-docker"), 0o700);
      expect(() => dockerExecutable(project, "win32", bin)).toThrow(
        /outside the project/,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it.each(["linux", "win32"] as const)(
  "confines %s commands to the project and keeps routine checks offline",
  (platform) => {
    const root = realpathSync(process.cwd());
    const offline = isolatedCommand(
      process.execPath,
      ["--version"],
      root,
      `${root}/scratch`,
      {
        platform,
        dockerPath: "/usr/bin/docker",
        path: "/usr/bin",
      },
    );
    expect(offline.args).toContain("--read-only");
    expect(offline.args).toContain("--cap-drop=ALL");
    expect(offline.args).toContain("none");
    expect(offline.args).toContain(
      `type=bind,source=${root},target=/workspace`,
    );
    expect(offline.args).toContain("--pull=never");
    expect(offline.args).not.toContain("bridge");
    const online = isolatedCommand(
      process.execPath,
      ["install"],
      root,
      `${root}/scratch`,
      {
        platform,
        dockerPath: "/usr/bin/docker",
        network: true,
      },
    );
    expect(online.args).toContain("bridge");
    expect(online.args).toContain("--pull=missing");
    expect(online.args).toContain("node:22-bookworm");
    expect(online.env).not.toHaveProperty("NEBIUS_API_KEY");
  },
);

it("rejects Docker mount syntax in a project path", () => {
  const root = mkdtempSync(join(tmpdir(), "scully,mount-test-"));
  try {
    expect(() =>
      isolatedCommand(process.execPath, [], root, root, {
        platform: "linux",
        dockerPath: "/usr/bin/docker",
        path: "",
      }),
    ).toThrow(/cannot be mounted safely/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("keeps network blocked for checks and permits it only for an approved install launch", () => {
  const root = realpathSync(process.cwd());
  const command = realpathSync(process.execPath);
  const check = isolatedCommand(command, ["--version"], root, root, {
    platform: "darwin",
  });
  const install = isolatedCommand(command, ["--version"], root, root, {
    platform: "darwin",
    network: true,
  });
  expect(check.args[1]).toContain("(deny network*)");
  expect(install.args[1]).not.toContain("(deny network*)");
  expect(install.args[1]).toContain("(deny file-write*)");
});

it.skipIf(process.platform !== "darwin")(
  "runs a reviewed setup command within the project policy",
  async () => {
    const root = mkdtempSync(join(tmpdir(), "scully-install-policy-"));
    try {
      await runIsolatedCommand(
        process.execPath,
        ["-e", "require('fs').writeFileSync('installed.txt', 'ready')"],
        root,
        undefined,
        true,
      );
      expect(readFileSync(join(root, "installed.txt"), "utf8")).toBe("ready");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

it("does not expand runtime dependencies to the filesystem or home root", () => {
  const root = realpathSync(process.cwd());
  const shell = isolatedCommand("/bin/sh", [], root, root, {
    platform: "darwin",
  });
  expect(shell.args).not.toContain("EXEC_ROOT=/");
  const command = realpathSync(process.execPath);
  const home = dirname(dirname(command));
  const local = isolatedCommand(command, [], root, root, {
    platform: "darwin",
    home,
  });
  expect(local.args).not.toContain(`EXEC_ROOT=${home}`);
  expect(local.args).not.toContain(`NODE_ROOT=${home}`);
});
