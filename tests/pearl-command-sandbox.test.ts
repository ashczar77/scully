// @vitest-environment node
import { expect, it } from "vitest";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isolatedCommand } from "../src/main/pearl-command-sandbox";

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
    }),
  ).toThrow("unavailable");
});
