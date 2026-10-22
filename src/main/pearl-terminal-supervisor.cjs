"use strict";

const pty = require("node-pty");
const { rmSync } = require("node:fs");
const { basename, dirname } = require("node:path");

let command;
let scratch;
let project;
let started = false;
let stopping = false;
let closed = false;
let reaper;

function signalGroup(signal) {
  if (!command?.pid) return;
  try {
    process.kill(-command.pid, signal);
  } catch {
    try {
      command.kill();
    } catch {
      // The process has already exited.
    }
  }
}

function cleanScratch() {
  if (!scratch || dirname(scratch) !== project) return;
  if (!basename(scratch).startsWith(".scully-command-")) return;
  try {
    rmSync(scratch, { recursive: true, force: true });
  } catch {
    // Process cleanup must still finish if a temporary file cannot be removed.
  }
}

function stop() {
  if (!command || stopping || closed) return;
  stopping = true;
  signalGroup("SIGKILL");
  reaper = setTimeout(() => {
    signalGroup("SIGKILL");
    process.exit(1);
  }, 1000);
}

function report(message) {
  if (!process.connected) return;
  try {
    process.send(message);
  } catch {
    stop();
  }
}

process.on("message", (message) => {
  if (!message || typeof message !== "object") return;
  if (message.type === "stop") {
    stop();
    return;
  }
  if (message.type === "input") {
    if (
      command &&
      !stopping &&
      typeof message.value === "string" &&
      message.value.length > 0 &&
      Buffer.byteLength(message.value, "utf8") <= 4096
    )
      command.write(message.value);
    return;
  }
  if (message.type === "resize") {
    if (
      command &&
      !stopping &&
      Number.isSafeInteger(message.cols) &&
      Number.isSafeInteger(message.rows) &&
      message.cols >= 20 &&
      message.cols <= 300 &&
      message.rows >= 5 &&
      message.rows <= 120
    ) {
      try {
        command.resize(message.cols, message.rows);
      } catch (error) {
        report({ type: "error", message: String(error) });
      }
    }
    return;
  }
  if (message.type !== "start" || started || !process.connected) return;
  started = true;
  const launch = message.launch;
  project = message.project;
  scratch = message.scratch;
  if (
    !launch ||
    typeof launch.executable !== "string" ||
    !Array.isArray(launch.args) ||
    !launch.args.every((arg) => typeof arg === "string") ||
    !launch.env ||
    typeof project !== "string" ||
    typeof scratch !== "string"
  ) {
    process.exitCode = 1;
    process.disconnect();
    return;
  }
  try {
    command = pty.spawn(launch.executable, launch.args, {
      cwd: project,
      env: launch.env,
      name: "xterm-256color",
      cols: 80,
      rows: 24,
    });
  } catch (error) {
    report({ type: "error", message: String(error) });
    process.exitCode = 1;
    process.disconnect();
    return;
  }
  report({ type: "started", pid: command.pid || null });
  command.onData((data) => {
    if (!process.stdout.write(data)) {
      command.pause();
      process.stdout.once("drain", () => {
        if (!stopping && !closed) command.resume();
      });
    }
  });
  command.onExit(({ exitCode }) => {
    // A command can leave descendants behind after its direct child exits.
    signalGroup("SIGKILL");
    closed = true;
    if (reaper) clearTimeout(reaper);
    cleanScratch();
    report({ type: "exit", code: exitCode });
    process.disconnect();
  });
});

process.on("disconnect", stop);
process.stdout.on("error", stop);
process.stderr.on("error", stop);
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
process.on("uncaughtException", () => {
  signalGroup("SIGKILL");
  cleanScratch();
  process.exit(1);
});
process.on("exit", () => {
  if (!closed) signalGroup("SIGKILL");
  cleanScratch();
});
