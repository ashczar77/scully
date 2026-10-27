import { _electron as electron } from "playwright";
import { extractFile, listPackage, statFile } from "@electron/asar";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { resolve } from "node:path";
import { mkdir, readFile, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
await mkdir("test-results", { recursive: true });
const bundle = resolve("out/Scully-darwin-arm64/Scully.app");
assert.deepEqual(
  await readFile(`${bundle}/Contents/Resources/electron.icns`),
  await readFile("assets/branding/scully.icns"),
);
const entries = listPackage(`${bundle}/Contents/Resources/app.asar`);
assert(entries.some((p) => p.endsWith("/main.cjs")));
assert(entries.some((p) => p.endsWith("/pearl-terminal-supervisor.cjs")));
const mainBundle = extractFile(
  `${bundle}/Contents/Resources/app.asar`,
  "dist/main.cjs",
).toString();
assert(!mainBundle.includes("Live test request budget"));
assert(!mainBundle.includes("SCULLY_LIVE_MAX_REQUESTS"));
assert(!entries.some((p) => p.endsWith("/worker.cjs")));
assert(entries.some((p) => p.endsWith("/branding/scully.png")));
assert(entries.some((p) => p.endsWith("/fonts/ChelseaMarket-OFL.txt")));
assert(entries.some((p) => /\/index-[^/]+\.js$/.test(p)));
assert(
  !entries.some((p) => /\/(\.env|AGENTS\.md|.*\.local\.md)(\/|$)/.test(p)),
);
assert(
  !entries.some(
    (path) =>
      path.startsWith("/node_modules/") &&
      statFile(`${bundle}/Contents/Resources/app.asar`, path.slice(1)).size !==
        undefined &&
      !/^\/node_modules\/(node-pty|node-addon-api|pdfjs-dist|@napi-rs)(\/|$)/.test(
        path,
      ),
  ),
);
const unpacked = `${bundle}/Contents/Resources/app.asar.unpacked/node_modules/node-pty`;
assert((await stat(`${unpacked}/build/Release/pty.node`)).isFile());
const helper = await stat(`${unpacked}/build/Release/spawn-helper`);
assert(helper.isFile());
assert(helper.mode & 0o111);
assert(
  entries.some((path) => path.endsWith("/pdfjs-dist/legacy/build/pdf.mjs")),
);
assert(entries.some((path) => path.endsWith("/@napi-rs/canvas/index.js")));
assert(
  (
    await stat(
      `${bundle}/Contents/Resources/app.asar.unpacked/node_modules/@napi-rs/canvas-darwin-arm64/skia.darwin-arm64.node`,
    )
  ).isFile(),
);
const state = await mkdtemp(join(tmpdir(), "scully-package-test-"));
function samplePdf() {
  const stream =
    "BT /F1 14 Tf 50 150 Td (Packaged document extraction works) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length + 1} >>\nstream\n${stream}\nendstream`,
  ];
  let body = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const start = Buffer.byteLength(body);
  body += `xref\n0 6\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(body).toString("base64");
}
let app;
let supervisor;
let commandPid;
try {
  const marker = join(state, "packaged-terminal.pid");
  supervisor = fork(
    `${bundle}/Contents/Resources/app.asar/dist/pearl-terminal-supervisor.cjs`,
    [],
    {
      execPath: `${bundle}/Contents/MacOS/scully`,
      execArgv: [],
      cwd: state,
      env: { ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  let supervisorError = "";
  let terminalOutput = "";
  supervisor.stderr.on("data", (chunk) => (supervisorError += chunk));
  supervisor.stdout.on("data", (chunk) => (terminalOutput += chunk));
  supervisor.send({
    type: "start",
    launch: {
      executable: process.execPath,
      args: [
        "-e",
        `process.stdin.setRawMode(true);require('node:fs').writeFileSync(${JSON.stringify(marker)},String(process.pid));process.stdout.write('READY:'+process.stdin.isTTY+','+process.stdout.isTTY+'\\n');process.stdin.on('data',x=>process.stdout.write('KEY:'+x.toString('hex')+'\\n'));process.on('SIGWINCH',()=>process.stdout.write('SIZE:'+process.stdout.columns+'x'+process.stdout.rows+'\\n'))`,
      ],
      env: {},
    },
    project: state,
    scratch: join(state, ".scully-command-package"),
  });
  const deadline = Date.now() + 5000;
  while (!commandPid) {
    try {
      commandPid = Number(await readFile(marker, "utf8"));
    } catch {
      if (Date.now() > deadline)
        throw new Error(`Packaged terminal did not start: ${supervisorError}`);
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  }
  const untilOutput = async (expected) => {
    const outputDeadline = Date.now() + 5000;
    while (!terminalOutput.includes(expected)) {
      if (Date.now() > outputDeadline)
        throw new Error(
          `Packaged PTY output missing ${expected}: ${terminalOutput} ${supervisorError}`,
        );
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  };
  await untilOutput("READY:true,true");
  supervisor.send({ type: "input", value: "\x1b[A" });
  await untilOutput("KEY:1b5b41");
  supervisor.send({ type: "resize", cols: 95, rows: 32 });
  await untilOutput("SIZE:95x32");
  supervisor.disconnect();
  const stopDeadline = Date.now() + 5000;
  let commandRunning = true;
  while (commandRunning && Date.now() < stopDeadline) {
    try {
      process.kill(commandPid, 0);
    } catch {
      commandRunning = false;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  assert.equal(
    commandRunning,
    false,
    "packaged supervisor stopped its command",
  );

  app = await electron.launch({
    executablePath: `${bundle}/Contents/MacOS/scully`,
    args: [`--user-data-dir=${state}`],
    timeout: 30000,
  });
  const page = await app.firstWindow();
  await page
    .getByRole("heading", { name: "What can I help you with?" })
    .waitFor();
  await page.getByRole("textbox", { name: "Message Pearl" }).waitFor();
  assert.equal(
    await page.evaluate(
      async () => (await window.scully.listPearlChats()).length,
    ),
    0,
  );
  assert.equal(await page.getByRole("button", { name: "New chat" }).count(), 1);
  for (let i = 0; i < 3; i++) await page.locator(".pearl-new").click();
  assert.equal(
    await page.evaluate(
      async () => (await window.scully.listPearlChats()).length,
    ),
    1,
  );
  assert.equal(
    await page.evaluate(async (base64) => {
      const [chat] = await window.scully.listPearlChats();
      const updated = await window.scully.preparePearlAttachment(chat.id, {
        name: "sample.pdf",
        base64,
      });
      return updated.pendingAttachments?.[0]?.kind;
    }, samplePdf()),
    "pdf",
  );
  assert.equal(
    await page.evaluate(() => {
      const shell = document
        .querySelector(".pearl-shell")
        .getBoundingClientRect();
      const header = document
        .querySelector(".pearl-header")
        .getBoundingClientRect();
      const rail = document
        .querySelector(".pearl-rail")
        .getBoundingClientRect();
      return (
        Math.abs(header.left - shell.left) < 1 &&
        Math.abs(header.right - shell.right) < 1 &&
        Math.abs(rail.top - header.bottom) < 1
      );
    }),
    true,
  );
  await page.waitForFunction(() =>
    [
      ...document.querySelectorAll(".pearl-brand img, .pearl-welcome-mark"),
    ].every((image) => image.complete && image.naturalWidth > 0),
  );
  assert.equal(
    await page.evaluate(async () => {
      await document.fonts.load('21px "Chelsea Market"');
      return document.fonts.check('21px "Chelsea Market"');
    }),
    true,
  );
  assert.equal(
    await page.getByRole("button", { name: "Task", exact: true }).count(),
    0,
  );
  assert.equal(
    await page.getByRole("button", { name: "Send message" }).isDisabled(),
    false,
  );
  await page.getByRole("button", { name: "Remove sample.pdf" }).click();
  assert.equal(
    await page.getByRole("button", { name: "Send message" }).isDisabled(),
    true,
  );
  await page.screenshot({
    path: "test-results/packaged-room.png",
    fullPage: true,
  });
  console.log(
    "PASS: unsigned macOS ARM64 package launches; PTY helper runs; archive excludes credentials, local notes and unrelated dependencies.",
  );
} finally {
  if (supervisor) supervisor.kill("SIGKILL");
  if (commandPid) {
    try {
      process.kill(commandPid, "SIGKILL");
    } catch {
      // The packaged supervisor stopped the command.
    }
  }
  if (app) await app.close();
  await rm(state, { recursive: true, force: true });
}
