import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

if (process.platform !== "darwin") {
  process.stdout.write("SKIP: macOS terminal crash smoke is unavailable.\n");
  process.exit(0);
}

const root = await mkdtemp(join(tmpdir(), "scully-terminal-crash-"));
const project = join(root, "project");
const marker = join(project, "running.json");
const descendantMarker = join(project, "descendant.json");
const supervisorMarker = join(project, "supervisor.pid");
const modulePath = join(root, "pearl-terminal.mjs");
const supervisorPath = join(
  process.cwd(),
  "src/main/pearl-terminal-supervisor.cjs",
);
await mkdir(project);

const waitFor = async (condition, description, timeout = 6000) => {
  const deadline = Date.now() + timeout;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${description}`);
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
};
const isRunning = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

let launcher;
let running;
try {
  await build({
    entryPoints: ["src/main/pearl-terminal.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: modulePath,
  });
  const command = [
    "const fs=require('node:fs');",
    `fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify({command:process.pid}));`,
    "setInterval(()=>{},1000);",
  ].join("");
  const launcherScript = [
    `import {ManagedTerminal} from ${JSON.stringify(pathToFileURL(modulePath).href)};`,
    `const state={id:'crash',revision:0,command:'node',args:['-e',${JSON.stringify(command)}],status:'running',startedAt:new Date().toISOString(),output:'',truncated:false};`,
    `new ManagedTerminal(state,process.execPath,${JSON.stringify(project)},()=>{process.stdout.write(state.output)},${JSON.stringify(supervisorPath)});`,
    "setInterval(()=>{},1000);",
  ].join("");
  launcher = spawn(
    process.execPath,
    ["--input-type=module", "-e", launcherScript],
    {
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let errors = "";
  launcher.stderr.on("data", (chunk) => (errors += chunk));
  launcher.stdout.on("data", (chunk) => (errors += chunk));
  await waitFor(async () => {
    try {
      running = JSON.parse(await readFile(marker, "utf8"));
      return true;
    } catch {
      if (launcher.exitCode !== null) throw new Error(errors);
      return false;
    }
  }, "command to start").catch((error) => {
    throw new Error(`${error.message}\n${errors}`);
  });
  assert.equal(isRunning(running.command), true);

  launcher.kill("SIGKILL");
  await new Promise((resolve) => launcher.once("close", resolve));
  await waitFor(
    () => !isRunning(running.command),
    "crashed app command to stop",
  );
  await waitFor(
    async () =>
      (await readdir(project)).every(
        (name) => !name.startsWith(".scully-command-"),
      ),
    "crashed app terminal scratch to be removed",
  );
  process.stdout.write("PASS: abrupt app exit stops the terminal command.\n");

  const treeCommand = [
    "const fs=require('node:fs');",
    "const {spawn}=require('node:child_process');",
    "const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});",
    `fs.writeFileSync(${JSON.stringify(descendantMarker)},JSON.stringify({command:process.pid,descendant:child.pid}));`,
    "setInterval(()=>{},1000);",
  ].join("");
  const treeLauncher = [
    "import {fork} from 'node:child_process';",
    "import {writeFileSync} from 'node:fs';",
    `const helper=fork(${JSON.stringify(supervisorPath)},[],{execPath:process.execPath,execArgv:[],cwd:${JSON.stringify(project)},env:{ELECTRON_RUN_AS_NODE:'1'},stdio:['ignore','pipe','pipe','ipc']});`,
    `writeFileSync(${JSON.stringify(supervisorMarker)},String(helper.pid));`,
    `helper.send({type:'start',launch:{executable:process.execPath,args:['-e',${JSON.stringify(treeCommand)}],env:{PATH:process.env.PATH||'/usr/bin:/bin'}},project:${JSON.stringify(project)},scratch:${JSON.stringify(join(project, ".scully-command-tree"))}});`,
    "setInterval(()=>{},1000);",
  ].join("");
  launcher = spawn(
    process.execPath,
    ["--input-type=module", "-e", treeLauncher],
    {
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let treeErrors = "";
  launcher.stderr.on("data", (chunk) => (treeErrors += chunk));
  await waitFor(async () => {
    try {
      running = JSON.parse(await readFile(descendantMarker, "utf8"));
      return true;
    } catch {
      if (launcher.exitCode !== null) throw new Error(treeErrors);
      return false;
    }
  }, "command tree to start").catch((error) => {
    throw new Error(`${error.message}\n${treeErrors}`);
  });
  assert.equal(isRunning(running.command), true);
  assert.equal(isRunning(running.descendant), true);
  const supervisorPid = Number(await readFile(supervisorMarker, "utf8"));
  launcher.kill("SIGKILL");
  await new Promise((resolve) => launcher.once("close", resolve));
  await waitFor(
    () => !isRunning(running.command) && !isRunning(running.descendant),
    "crashed app command tree to stop",
  );
  await waitFor(
    () => !isRunning(supervisorPid),
    "crashed app terminal supervisor to exit",
  );
  process.stdout.write(
    "PASS: abrupt app exit stops the terminal command and descendant.\n",
  );
} finally {
  if (launcher && launcher.exitCode === null) launcher.kill("SIGKILL");
  for (const pid of [running?.command, running?.descendant]) {
    if (pid && isRunning(pid)) process.kill(pid, "SIGKILL");
  }
  await rm(root, { recursive: true, force: true });
}
