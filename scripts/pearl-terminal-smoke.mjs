import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

if (process.platform !== "darwin") {
  process.stdout.write(
    "SKIP: macOS terminal isolation smoke is unavailable.\n",
  );
  process.exit(0);
}
const root = await mkdtemp(join(tmpdir(), "scully-terminal-smoke-"));
const project = join(root, "project");
const outside = join(root, "outside.txt");
const modulePath = join(root, "pearl-terminal.mjs");
await mkdir(project);
await writeFile(outside, "private");
try {
  await build({
    entryPoints: ["src/main/pearl-terminal.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: modulePath,
  });
  const { ManagedTerminal } = await import(pathToFileURL(modulePath).href);
  const state = {
    id: "smoke",
    revision: 0,
    command: "node",
    args: [
      "-e",
      "const fs=require('fs');try{fs.readFileSync('../outside.txt');process.stdout.write('LEAK')}catch(e){process.stdout.write(e.code)};require('net').connect(9,'192.0.2.1').on('connect',()=>process.stdout.write('NETWORK')).on('error',e=>process.stdout.write('NET:'+e.code));process.stdin.on('data',x=>process.stdout.write('ECHO:'+x))",
    ],
    status: "running",
    startedAt: new Date().toISOString(),
    output: "",
    truncated: false,
  };
  const terminal = new ManagedTerminal(
    state,
    process.execPath,
    project,
    () => {},
    join(process.cwd(), "src/main/pearl-terminal-supervisor.cjs"),
  );
  const until = async (condition) => {
    const deadline = Date.now() + 5000;
    while (!condition()) {
      if (Date.now() > deadline)
        throw new Error(`Terminal timed out: ${state.output}`);
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  };
  await until(() => state.output.includes("EPERM"));
  await until(() => state.output.includes("NET:EPERM"));
  assert.equal(state.output.includes("LEAK"), false);
  assert.equal(state.output.includes("NETWORK"), false);
  terminal.input("hello\n");
  await until(() => state.output.includes("ECHO:hello"));
  await terminal.close();
  assert.equal(state.status, "stopped");
  assert.equal(await readFile(outside, "utf8"), "private");
  process.stdout.write(
    "PASS: managed terminal streams input and output, stops, and cannot read outside the project.\n",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
