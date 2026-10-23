// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { fork, type ChildProcess } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PearlChatManager } from "../src/main/pearl-chat-manager";
import { PearlChatStore } from "../src/main/pearl-chat-store";
import { ManagedTerminal } from "../src/main/pearl-terminal";
import type { PearlModel, PearlModelResult } from "../src/engine/pearl-model";
import type { PearlTerminalState } from "../src/shared/pearl-chat";

vi.mock("../src/main/pearl-command-sandbox", () => ({
  isolatedCommand: (
    command: string,
    args: string[],
    _project: string,
    scratch: string,
  ) => ({
    executable: command,
    args,
    env: { PATH: process.env.PATH || "/usr/bin:/bin", HOME: scratch },
  }),
  runIsolatedCommand: vi.fn(),
}));

const roots: string[] = [];
const stores: PearlChatStore[] = [];
const managers: PearlChatManager[] = [];
const terminals: ManagedTerminal[] = [];
afterEach(async () => {
  await Promise.all(terminals.splice(0).map((terminal) => terminal.close()));
  await Promise.all(
    managers.splice(0).map((manager) => manager.closeTerminals()),
  );
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

type Response =
  | PearlModelResult
  | ((
      input: Parameters<PearlModel["complete"]>[0],
    ) => PearlModelResult | Promise<PearlModelResult>);
function fixture(responses: Response[]) {
  const root = mkdtempSync(join(tmpdir(), "scully-terminal-"));
  roots.push(root);
  const data = join(root, "data");
  const project = join(root, "project");
  mkdirSync(data);
  mkdirSync(project);
  const store = new PearlChatStore(join(data, "workspace.sqlite"));
  stores.push(store);
  const manager = new PearlChatManager(
    store,
    data,
    () => ({ key: "fixture", model: "fixture", outputTokens: 8192 }),
    () => {},
    {
      complete: vi.fn(async (input) => {
        const response = responses.shift();
        if (!response) throw new Error("No fixture response");
        return typeof response === "function" ? response(input) : response;
      }),
    },
  );
  managers.push(manager);
  return { data, project, store, manager };
}

function tool(id: string, command: string, args: string[]): PearlModelResult {
  return {
    kind: "tool",
    text: "",
    call: {
      id,
      name: "start_terminal",
      arguments: JSON.stringify({ command, args }),
    },
  };
}

it("requires one-use approval, streams output, accepts user input, and stops the process", async () => {
  const f = fixture([
    tool("terminal-1", "node", [
      "-e",
      "process.stdout.write('READY\\n');process.stdin.on('data',x=>process.stdout.write('ECHO:'+x))",
    ]),
    { kind: "reply", text: "The terminal is ready." },
  ]);
  const chat = f.manager.create();
  f.manager.chooseProject(chat.id, f.project);
  f.manager.approveProject(chat.id, true);
  f.manager.send(chat.id, "Start an interactive process");
  await vi.waitFor(() =>
    expect(f.store.get(chat.id).pendingTool?.id).toBe("terminal-1"),
  );
  expect(f.store.get(chat.id).terminals).toBeUndefined();
  f.manager.decideTool(chat.id, "terminal-1", true);
  await vi.waitFor(() =>
    expect(f.store.get(chat.id).terminals?.[0]?.output).toContain("READY"),
  );
  const id = f.store.get(chat.id).terminals![0].id;
  expect(() => f.manager.decideTool(chat.id, "terminal-1", true)).toThrow();
  f.manager.sendTerminalInput(chat.id, id, "hello\n");
  await vi.waitFor(() =>
    expect(f.store.get(chat.id).terminals?.[0]?.output).toContain("ECHO:hello"),
  );
  expect(() =>
    f.manager.sendTerminalInput(chat.id, id, "X".repeat(4097)),
  ).toThrow("Invalid terminal input");
  const other = f.manager.create();
  f.manager.chooseProject(other.id, f.project);
  f.manager.approveProject(other.id, true);
  expect(() => f.manager.stopTerminal(other.id, id)).toThrow("does not belong");
  expect(() => f.manager.resizeTerminal(other.id, id, 80, 24)).toThrow(
    "does not belong",
  );
  expect(() => f.manager.resizeTerminal(chat.id, id, 0, 24)).toThrow(
    "Invalid terminal size",
  );
  expect(() => f.manager.chooseProject(chat.id, f.project)).toThrow(
    "Stop running terminals",
  );
  f.manager.stopTerminal(chat.id, id);
  await vi.waitFor(() =>
    expect(f.store.get(chat.id).terminals?.[0]?.status).toBe("stopped"),
  );
  expect(() => f.manager.sendTerminalInput(chat.id, id, "again\n")).toThrow(
    "has ended",
  );
});

it("provides a PTY with raw keys and resize", async () => {
  const root = mkdtempSync(join(tmpdir(), "scully-terminal-pty-"));
  roots.push(root);
  const state: PearlTerminalState = {
    id: "pty-test",
    revision: 0,
    command: "node",
    args: [
      "-e",
      "process.stdin.setRawMode(true);process.stdout.write('TTY:'+process.stdin.isTTY+','+process.stdout.isTTY+'\\n');process.stdin.on('data',b=>{process.stdout.write('KEY:'+b.toString('hex')+'\\n');if(b.toString()==='q')process.exit(0)});process.on('SIGWINCH',()=>process.stdout.write('SIZE:'+process.stdout.columns+'x'+process.stdout.rows+'\\n'))",
    ],
    status: "running",
    startedAt: new Date().toISOString(),
    output: "",
    truncated: false,
  };
  const terminal = new ManagedTerminal(state, process.execPath, root, () => {});
  terminals.push(terminal);
  await vi.waitFor(() => expect(state.output).toContain("TTY:true,true"));
  terminal.input("\x1b[A");
  await vi.waitFor(() => expect(state.output).toContain("KEY:1b5b41"));
  terminal.resize(95, 32);
  await vi.waitFor(() => expect(state.output).toContain("SIZE:95x32"));
  terminal.input("q");
  await vi.waitFor(() => expect(state.endedAt).toBeDefined(), {
    timeout: 5000,
  });
  expect(state.exitCode).toBe(0);
});

it.skipIf(process.platform !== "darwin")(
  "draws a short pager page from the top and retains its output",
  async () => {
    const root = mkdtempSync(join(tmpdir(), "scully-terminal-pager-"));
    roots.push(root);
    writeFileSync(
      join(root, "sample.txt"),
      "First line\nSecond line\nThird line\n",
    );
    const state: PearlTerminalState = {
      id: "pager-test",
      revision: 0,
      command: "node",
      args: [],
      status: "running",
      startedAt: new Date().toISOString(),
      output: "",
      truncated: false,
    };
    const terminal = new ManagedTerminal(
      state,
      process.execPath,
      root,
      () => {},
    );
    terminals.push(terminal);
    await vi.waitFor(() =>
      expect(state.output).toContain("Welcome to Node.js"),
    );
    terminal.resize(95, 39);
    for (let index = 0; index < 3; index++) {
      const priorPages = (state.output.match(/sample\.txt \(END\)/g) || [])
        .length;
      const priorExits = (state.output.match(/status:/g) || []).length;
      terminal.input(
        "require('node:child_process').spawnSync('less', ['sample.txt'], {stdio:'inherit'})\r",
      );
      await vi.waitFor(() =>
        expect(
          (state.output.match(/sample\.txt \(END\)/g) || []).length,
        ).toBeGreaterThan(priorPages),
      );
      terminal.input("q");
      await vi.waitFor(() =>
        expect((state.output.match(/status:/g) || []).length).toBeGreaterThan(
          priorExits,
        ),
      );
    }
    const lastPage = state.output.slice(
      state.output.lastIndexOf("\x1b[?1049h"),
    );
    const beforeFile = lastPage.slice(0, lastPage.indexOf("First line"));
    expect(beforeFile).toMatch(/\x1b\[(?:H|2J|1;1H)/);
    expect(state.truncated).toBe(false);
    expect(state.output).toContain("First line");
  },
);

it("retains a moderate terminal session without a trim notice", async () => {
  const root = mkdtempSync(join(tmpdir(), "scully-terminal-moderate-"));
  roots.push(root);
  const state: PearlTerminalState = {
    id: "moderate-test",
    revision: 0,
    command: "node",
    args: [
      "-e",
      "process.stdout.write('X'.repeat(64000));process.stdin.resume()",
    ],
    status: "running",
    startedAt: new Date().toISOString(),
    output: "",
    truncated: false,
  };
  const terminal = new ManagedTerminal(state, process.execPath, root, () => {});
  terminals.push(terminal);
  await vi.waitFor(() =>
    expect(state.output.length).toBeGreaterThanOrEqual(64_000),
  );
  expect(state.truncated).toBe(false);
  expect(state.outputStart ?? 0).toBe(0);
});

it("lets Pearl inspect and stop only a session from its approved chat", async () => {
  const f = fixture([
    tool("start", "node", [
      "-e",
      "process.stdout.write('RUNNING');setInterval(()=>{},1000)",
    ]),
    (input) => {
      const result = input.messages.find(
        (message) =>
          message.role === "tool" && message.toolName === "start_terminal",
      );
      const terminalId = JSON.parse(result!.text).terminalId;
      return {
        kind: "tool",
        text: "",
        call: {
          id: "read",
          name: "read_terminal",
          arguments: JSON.stringify({ terminalId }),
        },
      };
    },
    (input) => {
      const result = input.messages.find(
        (message) =>
          message.role === "tool" && message.toolName === "start_terminal",
      );
      const terminalId = JSON.parse(result!.text).terminalId;
      return {
        kind: "tool",
        text: "",
        call: {
          id: "stop",
          name: "stop_terminal",
          arguments: JSON.stringify({ terminalId }),
        },
      };
    },
    { kind: "reply", text: "I stopped the process." },
  ]);
  const chat = f.manager.create();
  f.manager.chooseProject(chat.id, f.project);
  f.manager.approveProject(chat.id, true);
  f.manager.send(chat.id, "Start, inspect, and stop a background process");
  await vi.waitFor(() =>
    expect(f.store.get(chat.id).pendingTool?.id).toBe("start"),
  );
  f.manager.decideTool(chat.id, "start", true);
  await vi.waitFor(() => expect(f.store.get(chat.id).status).toBe("idle"), {
    timeout: 5000,
  });
  const saved = f.store.get(chat.id);
  expect(saved.terminals?.[0]?.status).toBe("stopped");
  expect(
    JSON.parse(
      saved.messages.find(
        (message) => message.toolCallId === "read" && message.role === "tool",
      )!.text,
    ),
  ).toMatchObject({ status: "running" });
  expect(saved.messages.at(-1)?.text).toBe("I stopped the process.");
});

it("denial starts no process and restart marks a previously running terminal interrupted", async () => {
  const f = fixture([
    tool("terminal-2", "node", ["-e", "setInterval(()=>{},1000)"]),
    { kind: "reply", text: "The command was denied." },
  ]);
  const chat = f.manager.create();
  f.manager.chooseProject(chat.id, f.project);
  f.manager.approveProject(chat.id, true);
  f.manager.send(chat.id, "Start a terminal");
  await vi.waitFor(() =>
    expect(f.store.get(chat.id).pendingTool?.id).toBe("terminal-2"),
  );
  f.manager.decideTool(chat.id, "terminal-2", false);
  await vi.waitFor(() => expect(f.store.get(chat.id).status).toBe("idle"));
  expect(f.store.get(chat.id).terminals).toBeUndefined();
  const saved = f.store.get(chat.id);
  saved.terminals = [
    {
      id: "00000000-0000-0000-0000-000000000001",
      revision: 0,
      command: "node",
      args: [],
      status: "running",
      startedAt: new Date().toISOString(),
      output: "prior output",
      truncated: false,
    },
  ];
  f.store.save(saved);
  f.store.recover();
  expect(f.store.get(chat.id).terminals?.[0]).toMatchObject({
    status: "interrupted",
    output: "prior output",
  });
});

it("bounds retained output without stopping a flooding process", async () => {
  const root = mkdtempSync(join(tmpdir(), "scully-terminal-output-"));
  roots.push(root);
  const state: PearlTerminalState = {
    id: "output-test",
    revision: 0,
    command: "node",
    args: [
      "-e",
      "process.stdout.write('X'.repeat(2100000));process.stdin.on('data',x=>process.stdout.write('ECHO:'+x))",
    ],
    status: "running",
    startedAt: new Date().toISOString(),
    output: "",
    truncated: false,
  };
  const terminal = new ManagedTerminal(state, process.execPath, root, () => {});
  terminals.push(terminal);
  await vi.waitFor(() => expect(state.truncated).toBe(true), {
    timeout: 5000,
  });
  expect(state.status).toBe("running");
  expect(state.output.length).toBeLessThanOrEqual(128_000);
  terminal.input("hello\n");
  await vi.waitFor(() => expect(state.output).toContain("ECHO:hello"));
  terminal.stop();
  await vi.waitFor(() => expect(state.endedAt).toBeDefined());
});

it("keeps Unicode intact when trimming terminal output", async () => {
  const root = mkdtempSync(join(tmpdir(), "scully-terminal-unicode-"));
  roots.push(root);
  const state: PearlTerminalState = {
    id: "unicode-test",
    revision: 0,
    command: "node",
    args: [
      "-e",
      "process.stdout.write('😀'.repeat(80000));setInterval(()=>{},1000)",
    ],
    status: "running",
    startedAt: new Date().toISOString(),
    output: "",
    truncated: false,
  };
  const terminal = new ManagedTerminal(state, process.execPath, root, () => {});
  terminals.push(terminal);
  await vi.waitFor(() => expect(state.truncated).toBe(true));
  expect(state.output.length).toBeLessThanOrEqual(128_000);
  expect(state.output).not.toContain("\ufffd");
  expect(state.output.codePointAt(0)).toBe("😀".codePointAt(0));
});

it("keeps an attended terminal running beyond thirty minutes", async () => {
  const root = mkdtempSync(join(tmpdir(), "scully-terminal-lifetime-"));
  roots.push(root);
  const state: PearlTerminalState = {
    id: "lifetime-test",
    revision: 0,
    command: "node",
    args: ["-e", "process.stdout.write('READY');process.stdin.resume()"],
    status: "running",
    startedAt: new Date().toISOString(),
    output: "",
    truncated: false,
  };
  const terminal = new ManagedTerminal(state, process.execPath, root, () => {});
  terminals.push(terminal);
  await vi.waitFor(() => expect(state.output).toContain("READY"));
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    await vi.advanceTimersByTimeAsync(31 * 60_000);
    expect(state.status).toBe("running");
  } finally {
    vi.useRealTimers();
  }
  terminal.stop();
  await vi.waitFor(() => expect(state.endedAt).toBeDefined());
});

it("ends a terminal when its supervisor cannot start", async () => {
  const root = mkdtempSync(join(tmpdir(), "scully-terminal-missing-"));
  roots.push(root);
  const state: PearlTerminalState = {
    id: "missing-supervisor",
    revision: 0,
    command: "node",
    args: ["-e", "setInterval(()=>{},1000)"],
    status: "running",
    startedAt: new Date().toISOString(),
    output: "",
    truncated: false,
  };
  const terminal = new ManagedTerminal(
    state,
    process.execPath,
    root,
    () => {},
    join(root, "missing-supervisor.cjs"),
  );
  terminals.push(terminal);
  await vi.waitFor(() => expect(state.status).toBe("exited"));
  expect(state.output).toContain("Cannot find module");
});

it("kills the command group when the supervisor unexpectedly exits", async () => {
  const root = mkdtempSync(join(tmpdir(), "scully-terminal-helper-"));
  roots.push(root);
  const marker = join(root, "command.pid");
  const state: PearlTerminalState = {
    id: "helper-crash",
    revision: 0,
    command: "node",
    args: [
      "-e",
      `require('node:fs').writeFileSync(${JSON.stringify(marker)},String(process.pid));setInterval(()=>{},1000)`,
    ],
    status: "running",
    startedAt: new Date().toISOString(),
    output: "",
    truncated: false,
  };
  let supervisor: ChildProcess | undefined;
  let commandPid: number | undefined;
  const terminal = new ManagedTerminal(
    state,
    process.execPath,
    root,
    () => {},
    join(process.cwd(), "src/main/pearl-terminal-supervisor.cjs"),
    (...args) => {
      supervisor = fork(...args);
      return supervisor;
    },
  );
  terminals.push(terminal);
  try {
    await vi.waitFor(() => {
      commandPid = Number(readFileSync(marker, "utf8"));
      expect(commandPid).toBeGreaterThan(0);
    });
    supervisor!.kill("SIGKILL");
    await vi.waitFor(() => expect(state.status).toBe("exited"));
    await vi.waitFor(() => {
      expect(() => process.kill(commandPid!, 0)).toThrow();
    });
  } finally {
    if (commandPid) {
      try {
        process.kill(commandPid, "SIGKILL");
      } catch {
        // The command exited as expected.
      }
    }
  }
});

it("allows eight running terminals in one chat and rejects a ninth", async () => {
  const script = ["-e", "setInterval(()=>{},1000)"];
  const f = fixture([
    ...Array.from({ length: 8 }, (_, index) => [
      tool(`terminal-${index}`, "node", script),
      { kind: "reply" as const, text: "Process started." },
    ]).flat(),
    tool("terminal-8", "node", script),
  ]);
  const chat = f.manager.create();
  f.manager.chooseProject(chat.id, f.project);
  f.manager.approveProject(chat.id, true);
  for (let index = 0; index < 8; index++) {
    const callId = `terminal-${index}`;
    const request = `Start process ${index}`;
    f.manager.send(chat.id, request);
    await vi.waitFor(() =>
      expect(f.store.get(chat.id).pendingTool?.id).toBe(callId),
    );
    f.manager.decideTool(chat.id, callId, true);
    await vi.waitFor(() => expect(f.store.get(chat.id).status).toBe("idle"));
  }
  f.manager.send(chat.id, "Start ninth");
  await vi.waitFor(() =>
    expect(f.store.get(chat.id).pendingTool?.id).toBe("terminal-8"),
  );
  f.manager.decideTool(chat.id, "terminal-8", true);
  await vi.waitFor(() => expect(f.store.get(chat.id).status).toBe("failed"));
  expect(f.store.get(chat.id).error).toContain(
    "already has 8 running terminals",
  );
  expect(f.store.get(chat.id).terminals).toHaveLength(8);
}, 30_000);

it("allows sixteen terminals across chats and rejects another", async () => {
  const script = ["-e", "setInterval(()=>{},1000)"];
  const f = fixture([
    ...Array.from({ length: 16 }, (_, index) => [
      tool(`app-terminal-${index}`, "node", script),
      { kind: "reply" as const, text: "Process started." },
    ]).flat(),
    tool("app-terminal-16", "node", script),
  ]);
  const chats = [f.manager.create(), f.manager.create(), f.manager.create()];
  for (const chat of chats) {
    f.manager.chooseProject(chat.id, f.project);
    f.manager.approveProject(chat.id, true);
  }
  for (let index = 0; index < 16; index++) {
    const chat = chats[Math.floor(index / 8)];
    const callId = `app-terminal-${index}`;
    f.manager.send(chat.id, `Start process ${index}`);
    await vi.waitFor(() =>
      expect(f.store.get(chat.id).pendingTool?.id).toBe(callId),
    );
    f.manager.decideTool(chat.id, callId, true);
    await vi.waitFor(() => expect(f.store.get(chat.id).status).toBe("idle"));
  }
  expect(
    chats.slice(0, 2).map((chat) => f.store.get(chat.id).terminals?.length),
  ).toEqual([8, 8]);
  f.manager.send(chats[2].id, "Start one more process");
  await vi.waitFor(() =>
    expect(f.store.get(chats[2].id).pendingTool?.id).toBe("app-terminal-16"),
  );
  f.manager.decideTool(chats[2].id, "app-terminal-16", true);
  await vi.waitFor(() =>
    expect(f.store.get(chats[2].id).status).toBe("failed"),
  );
  expect(f.store.get(chats[2].id).error).toContain(
    "already has 16 running terminals",
  );
  expect(f.store.get(chats[2].id).terminals).toBeUndefined();
}, 30_000);

it("retains a running terminal when old session history is trimmed", async () => {
  const script = ["-e", "setInterval(()=>{},1000)"];
  const f = fixture([
    tool("long-running", "node", script),
    { kind: "reply", text: "Process started." },
    tool("newer", "node", script),
    { kind: "reply", text: "Another process started." },
  ]);
  const chat = f.manager.create();
  f.manager.chooseProject(chat.id, f.project);
  f.manager.approveProject(chat.id, true);
  f.manager.send(chat.id, "Start a long running process");
  await vi.waitFor(() =>
    expect(f.store.get(chat.id).pendingTool?.id).toBe("long-running"),
  );
  f.manager.decideTool(chat.id, "long-running", true);
  await vi.waitFor(() => expect(f.store.get(chat.id).status).toBe("idle"));
  const first = f.store.get(chat.id).terminals![0];
  const saved = f.store.get(chat.id);
  saved.terminals!.push(
    ...Array.from({ length: 19 }, (_, index): PearlTerminalState => ({
      id: `00000000-0000-0000-0000-${String(index).padStart(12, "0")}`,
      revision: 1,
      command: "node",
      args: [],
      status: "exited",
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      exitCode: 0,
      output: "",
      truncated: false,
    })),
  );
  f.store.save(saved);
  f.manager.send(chat.id, "Start a second process");
  await vi.waitFor(() =>
    expect(f.store.get(chat.id).pendingTool?.id).toBe("newer"),
  );
  f.manager.decideTool(chat.id, "newer", true);
  await vi.waitFor(() => expect(f.store.get(chat.id).status).toBe("idle"));
  expect(f.store.get(chat.id).terminals).toHaveLength(20);
  expect(f.store.get(chat.id).terminals?.map((item) => item.id)).toContain(
    first.id,
  );
  f.manager.stopTerminal(chat.id, first.id);
}, 10_000);

it("does not lose output or exit state when a model reply saves an older chat snapshot", async () => {
  const f = fixture([
    tool("delayed", "node", [
      "-e",
      "setTimeout(()=>{process.stdout.write('LATE OUTPUT');process.exit(0)},120)",
    ]),
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
      return { kind: "reply", text: "The process ran." };
    },
  ]);
  const chat = f.manager.create();
  f.manager.chooseProject(chat.id, f.project);
  f.manager.approveProject(chat.id, true);
  f.manager.send(chat.id, "Run a short process");
  await vi.waitFor(() =>
    expect(f.store.get(chat.id).pendingTool?.id).toBe("delayed"),
  );
  f.manager.decideTool(chat.id, "delayed", true);
  await vi.waitFor(() => expect(f.store.get(chat.id).status).toBe("idle"), {
    timeout: 5000,
  });
  await vi.waitFor(
    () => expect(f.store.get(chat.id).terminals?.[0]?.status).toBe("exited"),
    { timeout: 5000 },
  );
  const terminal = f.store.get(chat.id).terminals?.[0];
  expect(terminal?.status).toBe("exited");
  expect(terminal?.exitCode).toBe(0);
  expect(terminal?.output).toContain("LATE OUTPUT");
});
