// @vitest-environment node
import { afterEach, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  withProjectPreview,
  type PreviewLauncher,
} from "../src/main/pearl-preview";
const roots: string[] = [];
const project = () => {
  const root = mkdtempSync(join(tmpdir(), "pearl-preview-test-"));
  roots.push(root);
  return root;
};
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
const launch: PreviewLauncher = (command, args, cwd, _scratch, port) =>
  spawn(command, args, {
    cwd,
    detached: true,
    env: { PORT: String(port), HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
const server =
  "require('http').createServer((req,res)=>res.end(process.env.HOST)).listen(Number(process.env.PORT),process.env.HOST)";
it("inspects only its fresh local server and stops the process after inspection", async () => {
  const cwd = project();
  let target = "";
  const result = await withProjectPreview(
    process.execPath,
    ["-e", server],
    cwd,
    async (origin) => {
      target = origin;
      return { text: await (await fetch(origin)).text() };
    },
    undefined,
    { launch },
  );
  expect(result.text).toBe("127.0.0.1");
  await expect(fetch(target)).rejects.toThrow();
  expect(readdirSync(cwd)).toEqual([]);
});
it("returns startup failure and bounded output instead of inspecting another service", async () => {
  await expect(
    withProjectPreview(
      process.execPath,
      ["-e", "console.error('broken');process.exit(2)"],
      project(),
      async () => {
        throw new Error("must not inspect");
      },
      undefined,
      { launch },
    ),
  ).rejects.toThrow("broken");
});
it("stops a server when the browser fails", async () => {
  let target = "";
  await expect(
    withProjectPreview(
      process.execPath,
      ["-e", server],
      project(),
      async (origin) => {
        target = origin;
        throw new Error("browser failure");
      },
      undefined,
      { launch },
    ),
  ).rejects.toThrow("browser failure");
  await expect(fetch(target)).rejects.toThrow();
});
it("cancels stalled startup and leaves no scratch files", async () => {
  const cwd = project();
  await expect(
    withProjectPreview(
      process.execPath,
      ["-e", "setInterval(()=>{},1000)"],
      cwd,
      async () => ({}),
      undefined,
      { launch, timeoutMs: 100 },
    ),
  ).rejects.toThrow();
  expect(readdirSync(cwd)).toEqual([]);
});
