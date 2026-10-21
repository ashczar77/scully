import { build } from "esbuild";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import electron from "electron";
const root = await realpath(await mkdtemp(join(tmpdir(), "pearl-keyboard-")));
try {
  await writeFile(
    join(root, "index.html"),
    '<!doctype html><title>Keyboard</title><input id=entry><p id=keys></p><script>document.querySelector("#entry").addEventListener("keydown",event=>{event.preventDefault();document.querySelector("#keys").textContent+=event.key+"|"})</script>',
  );
  const outfile = join(root, "probe.cjs");
  const keys = [
    "ArrowDown",
    "ArrowUp",
    "ArrowLeft",
    "ArrowRight",
    "Escape",
    "Tab",
    "Backspace",
    "Delete",
    "Enter",
    "+",
    "/",
  ];
  await build({
    stdin: {
      contents: `import {app} from 'electron';import assert from 'node:assert/strict';import {statSync} from 'node:fs';import {IsolatedPearlBrowser} from ${JSON.stringify(resolve("src/main/pearl-browser.ts"))};app.on('window-all-closed',()=>{});app.whenReady().then(async()=>{const browser=new IsolatedPearlBrowser();const result=await browser.check({path:${JSON.stringify(root)},dev:statSync(${JSON.stringify(root)}).dev,ino:statSync(${JSON.stringify(root)}).ino},'index.html',${JSON.stringify(keys.map((key) => ({ action: "press", selector: "#entry", key })))});assert.equal(result.errors.length,0);assert.equal(result.visibleText,${JSON.stringify(keys.join("|") + "|")});console.log('PASS: native browser key events match the requested keys.');app.exit(0)}).catch(error=>{console.error(error);app.exit(1)});`,
      resolveDir: process.cwd(),
      loader: "ts",
    },
    outfile,
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["electron"],
  });
  const result = await promisify(execFile)(electron, [outfile], {
    timeout: 30_000,
    maxBuffer: 100_000,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "" },
  });
  assert.match(result.stdout, /PASS:/);
  process.stdout.write(result.stdout);
} finally {
  await rm(root, { recursive: true, force: true });
}
