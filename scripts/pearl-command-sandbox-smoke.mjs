import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

if (process.platform !== "darwin") {
  process.stdout.write("SKIP: macOS command isolation smoke is unavailable.\n");
  process.exit(0);
}

const root = await mkdtemp(join(tmpdir(), "scully-command-isolation-"));
const project = join(root, "project");
const outside = join(root, "outside.txt");
const modulePath = join(root, "pearl-command-sandbox.mjs");
await mkdir(project);
await writeFile(join(project, "allowed.txt"), "allowed");
await writeFile(outside, "private");
await symlink(outside, join(project, "linked.txt"));
try {
  await build({
    entryPoints: ["src/main/pearl-command-sandbox.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: modulePath,
  });
  const { runIsolatedCommand } = await import(pathToFileURL(modulePath).href);
  const run = async (source) =>
    (await runIsolatedCommand(process.execPath, ["-e", source], project))
      .stdout;

  assert.equal(
    await run(
      "process.stdout.write(require('fs').readFileSync('allowed.txt','utf8'))",
    ),
    "allowed",
  );
  assert.equal(
    await run(
      "require('fs').writeFileSync('created.txt','created');process.stdout.write('ok')",
    ),
    "ok",
  );
  assert.equal(await readFile(join(project, "created.txt"), "utf8"), "created");
  assert.equal(
    await run(
      "try{require('fs').readFileSync('../outside.txt');process.stdout.write('LEAK')}catch(error){process.stdout.write(error.code)}",
    ),
    "EPERM",
  );
  assert.equal(
    await run(
      "try{require('fs').readFileSync('linked.txt');process.stdout.write('LEAK')}catch(error){process.stdout.write(error.code)}",
    ),
    "EPERM",
  );
  assert.equal(
    await run(
      "try{require('fs').writeFileSync('../outside.txt','changed');process.stdout.write('WRITTEN')}catch(error){process.stdout.write(error.code)}",
    ),
    "EPERM",
  );
  assert.equal(await readFile(outside, "utf8"), "private");
  await assert.rejects(
    runIsolatedCommand("/bin/sh", ["-c", "cat ../outside.txt"], project),
    /Operation not permitted|Permission denied/,
    "A system shell must not widen the filesystem read boundary",
  );

  assert.equal(
    await run(
      "const net=require('net');const server=net.createServer(socket=>socket.end('ok'));server.listen(0,'127.0.0.1',()=>{const client=net.connect(server.address().port,'127.0.0.1');client.on('data',data=>process.stdout.write(data));client.on('end',()=>server.close())})",
    ),
    "ok",
  );
  assert.equal(
    await run(
      "require('net').connect(9,'192.0.2.1').on('connect',()=>process.stdout.write('CONNECTED')).on('error',error=>process.stdout.write(error.code));setTimeout(()=>{},250)",
    ),
    "EPERM",
  );
  process.stdout.write(
    "PASS: approved project access and loopback tests work; outside reads, symlinks, writes and remote network are denied.\n",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
