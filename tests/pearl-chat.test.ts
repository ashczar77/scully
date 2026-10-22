// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { roomChat } from "../src/main/pearl-chat-view";
import { PearlChatStore } from "../src/main/pearl-chat-store";
import { PearlChatManager } from "../src/main/pearl-chat-manager";
import type { startProjectPreview } from "../src/main/pearl-preview";
import type { PearlBrowser } from "../src/main/pearl-browser";
import { PearlWebAccess, type PearlWebProvider } from "../src/main/pearl-web";
import type { CommandRunner } from "../src/main/pearl-command-sandbox";
import type { PearlModel, PearlModelResult } from "../src/engine/pearl-model";
import {
  currentTurnEvidence,
  needsPostEditBrowserCheck,
  type PearlChat,
  type PearlMessage,
} from "../src/shared/pearl-chat";

const roots: string[] = [];
const stores: PearlChatStore[] = [];
const executeFixtureCommand = promisify(execFile);
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function fixture(
  responses: PearlModelResult[],
  browser?: PearlBrowser,
  previewStarter?: typeof startProjectPreview,
  web?: PearlWebAccess,
  webEnabled: () => boolean = () => true,
) {
  const root = mkdtempSync(join(tmpdir(), "scully-pearl-"));
  roots.push(root);
  const data = join(root, "data");
  const project = join(root, "project");
  mkdirSync(data);
  mkdirSync(project);
  const store = new PearlChatStore(join(data, "workspace.sqlite"));
  stores.push(store);
  const complete = vi.fn(
    async (_input: Parameters<PearlModel["complete"]>[0]) => {
      const next = responses.shift();
      if (!next) throw new Error("No model fixture response");
      return next;
    },
  );
  const manager = new PearlChatManager(
    store,
    data,
    () => ({ key: "fixture-key", model: "fixture-model", outputTokens: 8192 }),
    () => {},
    { complete },
    undefined,
    browser,
    (async (command, args, cwd, signal) =>
      executeFixtureCommand(command, args, {
        cwd,
        signal,
        timeout: 60_000,
        maxBuffer: 200_000,
        env: { PATH: process.env.PATH || "/usr/bin:/bin", HOME: cwd },
      })) satisfies CommandRunner,
    previewStarter,
    web,
    webEnabled,
  );
  return { root, data, project, store, manager, complete };
}

it("lets an ordinary Room chat search and read a public result without project access", async () => {
  const provider: PearlWebProvider = {
    search: vi.fn(async () => [
      {
        title: "Release notes",
        url: "https://example.org/releases",
        excerpt: "Version 2 is available.",
      },
    ]),
    read: vi.fn(async () => "Version 2 was released on Tuesday."),
  };
  const f = fixture(
    [
      tool("search_web", { query: "Example release date" }, "search"),
      tool("read_web_result", { resultId: "1" }, "read"),
      reply(
        "Version 2 was released on Tuesday. [Release notes](https://example.org/releases)",
      ),
    ],
    undefined,
    undefined,
    new PearlWebAccess(provider),
  );
  const chat = f.manager.openNewChat();
  await f.manager.send(chat.id, "When did Example 2 release?");
  const done = await settled(f.store, chat.id);
  expect(done.status).toBe("idle");
  expect(done.project).toBeUndefined();
  expect(provider.search).toHaveBeenCalledWith(
    "Example release date",
    expect.any(AbortSignal),
  );
  expect(provider.read).toHaveBeenCalledWith(
    "https://example.org/releases",
    "Example release date",
    expect.any(AbortSignal),
  );
  expect(
    done.messages.find(
      (message) => message.toolName === "search_web" && message.role === "tool",
    )?.text,
  ).toContain("Release notes");
  expect(done.messages.at(-1)?.text).toContain("https://example.org/releases");
  expect(f.complete.mock.calls[0][0].allowedTools).toContain("search_web");
  expect(f.complete.mock.calls[0][0].allowedTools).not.toContain("read_file");
});

it("does not expose web tools when search is disconnected", async () => {
  const provider: PearlWebProvider = {
    search: vi.fn(async () => []),
    read: vi.fn(async () => ""),
  };
  const f = fixture(
    [
      tool("search_web", { query: "current news" }),
      reply("Web search is unavailable."),
    ],
    undefined,
    undefined,
    new PearlWebAccess(provider),
    () => false,
  );
  const chat = f.manager.openNewChat();
  await f.manager.send(chat.id, "What is current news?");
  const done = await settled(f.store, chat.id);
  expect(
    done.messages.some((message) => message.text.includes("Action rejected")),
  ).toBe(true);
  expect(provider.search).not.toHaveBeenCalled();
  expect(f.complete.mock.calls[0][0].allowedTools).not.toContain("search_web");
});
async function settled(store: PearlChatStore, id: string) {
  await vi.waitFor(() => expect(store.get(id).status).not.toBe("running"));
  return store.get(id);
}
const reply = (text: string): PearlModelResult => ({ kind: "reply", text });
const tool = (
  name: string,
  input: object,
  id = "call-1",
): PearlModelResult => ({
  kind: "tool",
  text: "",
  call: { id, name, arguments: JSON.stringify(input) },
});

it("reuses one pristine new chat across repeated requests and restart", () => {
  const f = fixture([]);
  const first = f.manager.openNewChat();
  const again = f.manager.openNewChat();
  expect(again.id).toBe(first.id);
  expect(f.manager.list()).toHaveLength(1);

  const secondStore = new PearlChatStore(join(f.data, "workspace.sqlite"));
  stores.push(secondStore);
  const resumed = new PearlChatManager(
    secondStore,
    f.data,
    () => null,
    () => {},
  );
  expect(resumed.openNewChat().id).toBe(first.id);
  expect(resumed.list()).toHaveLength(1);
});

it("keeps a chat with messages or a selected project when opening a new chat", () => {
  const f = fixture([]);
  const completed = f.manager.create();
  completed.messages.push({
    id: "user-message",
    role: "user",
    text: "A saved request",
    at: completed.createdAt,
  });
  f.store.save(completed);
  const projectDraft = f.manager.create();
  f.manager.chooseProject(projectDraft.id, f.project);
  const fresh = f.manager.openNewChat();
  expect(fresh.id).not.toBe(completed.id);
  expect(fresh.id).not.toBe(projectDraft.id);
  expect(f.manager.list()).toHaveLength(3);
});

it("shows at most one pristine draft from older data without deleting the others", () => {
  const f = fixture([]);
  const oldDraft = f.manager.create();
  const newerDraft = f.manager.create();
  const secondStore = new PearlChatStore(join(f.data, "workspace.sqlite"));
  stores.push(secondStore);
  const resumed = new PearlChatManager(
    secondStore,
    f.data,
    () => null,
    () => {},
  );
  expect(
    resumed.list().filter((chat) => chat.title === "New chat"),
  ).toHaveLength(1);
  expect(resumed.openNewChat().id).toBe(newerDraft.id);
  expect(resumed.list("archived").map((chat) => chat.id)).toContain(
    oldDraft.id,
  );
  expect(secondStore.get(oldDraft.id).messages).toEqual([]);
  resumed.restore(oldDraft.id);
  expect(resumed.list().map((chat) => chat.id)).toEqual([oldDraft.id]);
  expect(resumed.list("archived").map((chat) => chat.id)).toContain(
    newerDraft.id,
  );
});

it("archives and restores a saved chat without losing its messages", () => {
  const f = fixture([]);
  const chat = f.manager.create();
  chat.messages.push({
    id: "saved-message",
    role: "user",
    text: "Keep this history",
    at: chat.createdAt,
  });
  f.store.save(chat);
  f.manager.archive(chat.id);
  expect(f.manager.list()).toEqual([]);
  expect(f.manager.list("archived").map((item) => item.id)).toEqual([chat.id]);
  expect(() => f.manager.send(chat.id, "Another message")).toThrow(/archived/i);
  f.manager.restore(chat.id);
  expect(f.manager.list().map((item) => item.id)).toEqual([chat.id]);
  expect(f.manager.get(chat.id).messages[0].text).toBe("Keep this history");
});

it("moves chats to Trash, restores them, and deletes permanently only from Trash", () => {
  const f = fixture([]);
  const chat = f.manager.create();
  expect(() => f.manager.deletePermanently(chat.id)).toThrow(/Trash/i);
  f.manager.trash(chat.id);
  expect(f.manager.list()).toEqual([]);
  expect(f.manager.list("trash").map((item) => item.id)).toEqual([chat.id]);
  expect(() => f.manager.send(chat.id, "Forged send")).toThrow(/Trash/i);
  f.manager.restore(chat.id);
  expect(f.manager.list().map((item) => item.id)).toEqual([chat.id]);
  f.manager.trash(chat.id);
  f.manager.deletePermanently(chat.id);
  expect(() => f.manager.get(chat.id)).toThrow("Chat not found");
});

it("does not move a running or approval-pending chat out of the Room", () => {
  const f = fixture([]);
  const chat = f.manager.create();
  chat.status = "running";
  f.store.save(chat);
  expect(() => f.manager.archive(chat.id)).toThrow(/current action/i);
  expect(() => f.manager.trash(chat.id)).toThrow(/current action/i);
  chat.status = "awaiting_approval";
  f.store.save(chat);
  expect(() => f.manager.archive(chat.id)).toThrow(/current action/i);
  expect(() => f.manager.trash(chat.id)).toThrow(/current action/i);
  chat.lifecycle = "trash";
  f.store.save(chat);
  expect(() => f.manager.restore(chat.id)).toThrow(/current action/i);
  expect(() => f.manager.deletePermanently(chat.id)).toThrow(/current action/i);
});

it("records a structured batch, applies permitted project actions, and replays one assistant action group", async () => {
  const f = fixture([
    {
      kind: "actions",
      text: "",
      calls: [
        { id: "read-1", name: "read_file", arguments: '{"path":"note.txt"}' },
        { id: "map-1", name: "project_map", arguments: "{}" },
      ],
    },
    reply("I read the note and mapped the project."),
  ]);
  writeFileSync(join(f.project, "note.txt"), "hello");
  const chat = f.manager.create();
  f.manager.chooseProject(chat.id, f.project);
  f.manager.approveProject(chat.id, true);
  f.manager.send(chat.id, "Inspect this project");
  const done = await settled(f.store, chat.id);
  expect(done.status).toBe("idle");
  expect(
    done.messages
      .filter((item) => item.role === "tool")
      .map((item) => item.toolCallId),
  ).toEqual(["read-1", "map-1"]);
  expect(done.messages.find((item) => item.toolCalls)?.toolCalls).toHaveLength(
    2,
  );
  const replay = f.complete.mock.calls[1][0].messages;
  expect(
    replay.find((item) => item.toolCalls)?.toolCalls?.map((call) => call.id),
  ).toEqual(["read-1", "map-1"]);
});

it("offers browser observations only for an approved project and rejects invalid steps before launch", async () => {
  const check = vi.fn(
    async (_project: unknown, _path: string, _steps: unknown[]) => ({
      title: "Reading List",
      initialVisibleText: "Two books",
      visibleText: "Two books",
      controls: [],
      hiddenViolations: [],
      errors: [],
      blockedExternalRequests: 0,
      completedSteps: 1,
    }),
  );
  const f = fixture(
    [
      tool("browser_check", { path: "index.html" }),
      reply("I need project approval."),
      tool("browser_check", {
        path: "index.html",
        steps: [{ action: "evaluate", value: "alert(1)" }],
      }),
      tool("browser_check", { path: ".env" }, "browser-private"),
      tool(
        "browser_check",
        {
          path: "index.html",
          steps: [{ action: "press", key: "Enter" }],
        },
        "browser-2",
      ),
      reply("The browser showed two books."),
    ],
    { check },
  );
  const chat = f.manager.create();
  f.manager.send(chat.id, "Check the page");
  await settled(f.store, chat.id);
  expect(check).not.toHaveBeenCalled();

  writeFileSync(join(f.project, "index.html"), "<p>Two books</p>");
  f.manager.chooseProject(chat.id, f.project);
  f.manager.approveProject(chat.id, true);
  f.manager.send(chat.id, "Check the page now");
  const done = await settled(f.store, chat.id);
  expect(check).toHaveBeenCalledOnce();
  expect(check.mock.calls[0][1]).toBe("index.html");
  expect(check.mock.calls[0][2]).toEqual([{ action: "press", key: "Enter" }]);
  expect(
    done.messages.some(
      (message) =>
        message.role === "tool" &&
        message.text.includes("Invalid browser action"),
    ),
  ).toBe(true);
  expect(
    done.messages.some(
      (message) => message.role === "tool" && message.text.includes("private"),
    ),
  ).toBe(true);
  expect(
    done.messages.some(
      (message) =>
        message.role === "tool" && message.text.includes("Two books"),
    ),
  ).toBe(true);
});

it("stops a running browser check through the active Pearl turn", async () => {
  const check = vi.fn(
    async (
      _project: unknown,
      _path: string,
      _steps: unknown[],
      signal?: AbortSignal,
    ) =>
      new Promise<never>((_resolve, reject) => {
        signal?.addEventListener(
          "abort",
          () => reject(new Error("Browser check stopped")),
          { once: true },
        );
      }),
  );
  const f = fixture([tool("browser_check", { path: "index.html" })], { check });
  const chat = f.manager.create();
  writeFileSync(join(f.project, "index.html"), "<p>Page</p>");
  f.manager.chooseProject(chat.id, f.project);
  f.manager.approveProject(chat.id, true);
  f.manager.send(chat.id, "Check the page");
  await vi.waitFor(() => expect(check).toHaveBeenCalledOnce());
  f.manager.stop(chat.id);
  const stopped = await settled(f.store, chat.id);
  expect(check.mock.calls[0][3]?.aborted).toBe(true);
  expect(stopped.status).toBe("failed");
  expect(stopped.error).toBe("Stopped by user");
});

it("retries a provider context rejection with a smaller conversation window", async () => {
  const f = fixture([reply("I can continue with the recent context.")]);
  f.complete.mockRejectedValueOnce(
    new Error("Provider request failed (400; context)"),
  );
  const chat = f.manager.create();
  for (let index = 0; index < 8; index++)
    chat.messages.push({
      id: `history-${index}`,
      role: index % 2 ? "assistant" : "user",
      text: `${index} ${"context ".repeat(1500)}`,
      at: "now",
    });
  f.store.save(chat);
  f.manager.send(chat.id, "Continue this work");
  const done = await settled(f.store, chat.id);
  expect(done.status).toBe("idle");
  expect(f.complete).toHaveBeenCalledTimes(2);
  const first = f.complete.mock.calls[0][0].messages;
  const second = f.complete.mock.calls[1][0].messages;
  expect(second.length).toBeLessThan(first.length);
  expect(second.at(-1)?.text).toBe("Continue this work");
});

it("retains the active user request when a long tool trajectory fills the context window", () => {
  const f = fixture([]);
  const chat = f.manager.create();
  chat.activeUserMessageId = "current-request";
  chat.messages.push({
    id: "current-request",
    role: "user",
    text: "Build a browser app and keep keyboard support.",
    at: "now",
  });
  for (let index = 0; index < 35; index++) {
    chat.messages.push({
      id: `action-${index}`,
      role: "assistant",
      text: "",
      at: "now",
      toolCallId: `call-${index}`,
      toolName: "read_file",
      arguments: '{"path":"large.txt"}',
    });
    chat.messages.push({
      id: `result-${index}`,
      role: "tool",
      text: `Read ${index}: ${"source ".repeat(500)}`,
      at: "now",
      toolCallId: `call-${index}`,
      toolName: "read_file",
    });
  }
  const context = (
    f.manager as unknown as {
      context: (chat: PearlChat, maxChars: number) => PearlMessage[];
    }
  ).context(chat, 24_000);
  expect(
    context.some((message) => message.text.includes("keep keyboard support")),
  ).toBe(true);
  expect(context.at(-1)?.role).toBe("tool");
});

it("retains earlier user requirements and later corrections across a long action history", () => {
  const f = fixture([]);
  const chat = f.manager.create();
  chat.messages.push({
    id: "original",
    role: "user",
    text: "Build a reading app that works in the browser.",
    at: "now",
  });
  chat.messages.push({
    id: "correction",
    role: "user",
    text: "Changed requirement: it must work across devices.",
    at: "now",
  });
  chat.messages.push({
    id: "current",
    role: "user",
    text: "Please implement it.",
    at: "now",
  });
  chat.activeUserMessageId = "current";
  for (let index = 0; index < 40; index++)
    chat.messages.push({
      id: `result-${index}`,
      role: "tool",
      text: `${index}: ${"source ".repeat(500)}`,
      at: "now",
      toolCallId: `call-${index}`,
      toolName: "read_file",
    });
  const context = (
    f.manager as unknown as {
      context: (chat: PearlChat, maxChars: number) => PearlMessage[];
    }
  ).context(chat, 24_000);
  expect(context.map((message) => message.text).join("\n")).toContain(
    "works in the browser",
  );
  expect(context.map((message) => message.text).join("\n")).toContain(
    "work across devices",
  );
  expect(context.map((message) => message.text).join("\n")).toContain(
    "Please implement it",
  );
  expect(
    context.reduce(
      (total, message) =>
        total + message.text.length + (message.arguments?.length || 0),
      0,
    ),
  ).toBeLessThanOrEqual(24_000);
});

it("retains Pearl's earlier stated approach after long coding tool output", () => {
  const f = fixture([]);
  const chat = f.manager.create();
  chat.messages.push(
    {
      id: "scope",
      role: "user",
      text: "Build a shared app across devices.",
      at: "now",
    },
    {
      id: "approach",
      role: "assistant",
      text: "I recommend a hosted web server with a relational database, because members need access from separate devices.",
      at: "now",
    },
    {
      id: "go",
      role: "user",
      text: "Implement the approach you just described.",
      at: "now",
    },
  );
  chat.activeUserMessageId = "go";
  for (let index = 0; index < 40; index++)
    chat.messages.push({
      id: `output-${index}`,
      role: "tool",
      text: `${index}: ${"source ".repeat(500)}`,
      at: "now",
      toolCallId: `call-${index}`,
      toolName: "read_file",
    });
  const context = (
    f.manager as unknown as {
      context: (chat: PearlChat, maxChars: number) => PearlMessage[];
    }
  ).context(chat, 24_000);
  const body = context.map((message) => message.text).join("\n");
  expect(body).toContain("hosted web server with a relational database");
  expect(body).toContain("not user approval");
  expect(body).toContain("Implement the approach you just described");
  expect(
    context.reduce(
      (total, message) =>
        total + message.text.length + (message.arguments?.length || 0),
      0,
    ),
  ).toBeLessThanOrEqual(24_000);
});

it("keeps anchored requirements within the retry context budget", () => {
  const f = fixture([]);
  const chat = f.manager.create();
  chat.messages.push(
    {
      id: "original-budget",
      role: "user",
      text: `Build a browser app. ${"Original scope. ".repeat(115)}`,
      at: "now",
    },
    {
      id: "correction-budget",
      role: "user",
      text: `Changed requirement: share across devices. ${"Keep this correction. ".repeat(80)}`,
      at: "now",
    },
    {
      id: "current-budget",
      role: "user",
      text: `Implement the changed requirement now. ${"Current task. ".repeat(130)}`,
      at: "now",
    },
  );
  chat.activeUserMessageId = "current-budget";
  for (let index = 0; index < 40; index++)
    chat.messages.push({
      id: `reply-${index}`,
      role: "assistant",
      text: `Observation ${index}: ${"work ".repeat(210)}`,
      at: "now",
    });
  const context = (
    f.manager as unknown as {
      context: (chat: PearlChat, maxChars: number) => PearlMessage[];
    }
  ).context(chat, 24_000);
  const body = context.map((message) => message.text).join("\n");
  expect(body).toContain("Build a browser app");
  expect(body).toContain("share across devices");
  expect(body).toContain("Implement the changed requirement now");
  expect(
    context.reduce(
      (total, message) =>
        total + message.text.length + (message.arguments?.length || 0),
      0,
    ),
  ).toBeLessThanOrEqual(24_000);
});

it("retains the active request if budget trimming removes its original message", () => {
  const f = fixture([]);
  const chat = f.manager.create();
  chat.messages.push(
    {
      id: "original-trim",
      role: "user",
      text: `Original product scope. ${"Scope detail. ".repeat(120)}`,
      at: "now",
    },
    {
      id: "correction-trim",
      role: "user",
      text: `Changed product scope. ${"Correction detail. ".repeat(90)}`,
      at: "now",
    },
    {
      id: "active-trim",
      role: "user",
      text: `Implement the active request. ${"Active detail. ".repeat(120)}`,
      at: "now",
    },
  );
  chat.activeUserMessageId = "active-trim";
  for (let index = 0; index < 9; index++)
    chat.messages.push({
      id: `work-${index}`,
      role: "assistant",
      text: `Action ${index}: ${"result ".repeat(320)}`,
      at: "now",
    });
  const context = (
    f.manager as unknown as {
      context: (chat: PearlChat, maxChars: number) => PearlMessage[];
    }
  ).context(chat, 24_000);
  const body = context.map((message) => message.text).join("\n");
  expect(body).toContain("Implement the active request");
  expect(body).toContain("Changed product scope");
  expect(body).toContain("Original product scope");
  expect(
    context.reduce(
      (total, message) =>
        total + message.text.length + (message.arguments?.length || 0),
      0,
    ),
  ).toBeLessThanOrEqual(24_000);
});

it("rejects a batch containing a command without applying its file edit or granting approval", async () => {
  const f = fixture([
    {
      kind: "actions",
      text: "",
      calls: [
        {
          id: "write-1",
          name: "create_file",
          arguments: '{"path":"unsafe.txt","content":"should not appear"}',
        },
        {
          id: "command-1",
          name: "run_command",
          arguments: '{"command":"node","args":["--version"]}',
        },
      ],
    },
    reply("I will request the actions separately."),
  ]);
  const chat = f.manager.create();
  f.manager.chooseProject(chat.id, f.project);
  f.manager.approveProject(chat.id, true);
  f.manager.send(chat.id, "Create and check a file");
  const done = await settled(f.store, chat.id);
  expect(done.status).toBe("idle");
  expect(done.pendingTool).toBeUndefined();
  expect(readdirSync(f.project)).not.toContain("unsafe.txt");
  expect(
    done.messages
      .filter((item) => item.role === "tool")
      .map((item) => item.text),
  ).toEqual([
    expect.stringContaining("not applied"),
    expect.stringContaining("not applied"),
  ]);
});

it.each(["ask_user", "run_command"])(
  "saves a plan before a final %s action without crossing its decision boundary",
  async (name) => {
    const f = fixture([
      {
        kind: "actions",
        text: "",
        calls: [
          {
            id: "plan",
            name: "update_plan",
            arguments: JSON.stringify({
              expectedRevision: 0,
              objective: "Plan the workspace",
              approach: "Confirm the audience before implementation",
              requirements: ["Plan the workspace"],
              steps: [{ text: "Confirm the audience", status: "in_progress" }],
            }),
          },
          {
            id: "decision",
            name,
            arguments: JSON.stringify(
              name === "ask_user"
                ? { topic: "audience", question: "Who should have access?" }
                : { command: "node", args: ["--version"] },
            ),
          },
        ],
      },
    ]);
    const chat = f.manager.create();
    if (name === "run_command") {
      f.manager.chooseProject(chat.id, f.project);
      f.manager.approveProject(chat.id, true);
    }
    f.manager.send(chat.id, "Plan the workspace");
    const saved = await settled(f.store, chat.id);
    expect(saved.work?.revision).toBe(1);
    expect(f.complete).toHaveBeenCalledTimes(1);
    if (name === "ask_user") {
      expect(saved.status).toBe("idle");
      expect(saved.questions[0].status).toBe("pending");
      expect(
        saved.messages.filter((message) => message.role === "tool"),
      ).toHaveLength(2);
    } else {
      expect(saved.status).toBe("awaiting_approval");
      expect(saved.pendingTool?.id).toBe("decision");
      expect(currentTurnEvidence(saved).commandsCompleted).toBe(0);
      expect(
        saved.messages.filter((message) => message.role === "tool"),
      ).toHaveLength(1);
    }
  },
);

it("rejects a plan after a pausing action so no trailing action can be lost", async () => {
  const f = fixture([
    {
      kind: "actions",
      text: "",
      calls: [
        {
          id: "question",
          name: "ask_user",
          arguments:
            '{"topic":"audience","question":"Who should have access?"}',
        },
        {
          id: "plan",
          name: "update_plan",
          arguments: '{"expectedRevision":0}',
        },
      ],
    },
    reply("I need to ask the question separately."),
  ]);
  const chat = f.manager.create();
  f.manager.send(chat.id, "Plan the workspace");
  const saved = await settled(f.store, chat.id);
  expect(saved.questions).toHaveLength(0);
  expect(saved.work).toBeUndefined();
  expect(
    saved.messages
      .filter((message) => message.role === "tool")
      .every((message) => message.text.startsWith("Action not applied")),
  ).toBe(true);
});

it("rejects duplicate action IDs before any batch side effect", async () => {
  const f = fixture([
    {
      kind: "actions",
      text: "",
      calls: [
        {
          id: "same",
          name: "create_file",
          arguments: '{"path":"a.txt","content":"a"}',
        },
        {
          id: "same",
          name: "create_file",
          arguments: '{"path":"b.txt","content":"b"}',
        },
      ],
    },
  ]);
  const chat = f.manager.create();
  f.manager.chooseProject(chat.id, f.project);
  f.manager.approveProject(chat.id, true);
  f.manager.send(chat.id, "Create files");
  const done = await settled(f.store, chat.id);
  expect(done.status).toBe("failed");
  expect(done.error).toContain("Invalid proposed action");
  expect(readdirSync(f.project)).toEqual([]);
});

it("marks every missing result in an interrupted action batch as unknown on restart", () => {
  const f = fixture([]);
  const chat = f.manager.create();
  chat.status = "running";
  chat.messages.push({
    id: "batch",
    role: "assistant",
    text: "",
    at: "now",
    toolCalls: [
      { id: "first", name: "read_file", arguments: '{"path":"a.txt"}' },
      {
        id: "second",
        name: "create_file",
        arguments: '{"path":"b.txt","content":"b"}',
      },
    ],
  });
  chat.messages.push({
    id: "first-result",
    role: "tool",
    text: "read completed",
    at: "now",
    toolCallId: "first",
    toolName: "read_file",
  });
  f.store.save(chat);
  f.store.recover();
  const recovered = f.store.get(chat.id);
  expect(recovered.status).toBe("failed");
  expect(
    recovered.messages.find(
      (item) => item.role === "tool" && item.toolCallId === "second",
    )?.text,
  ).toContain("outcome is unknown");
  expect(
    recovered.messages.filter(
      (item) => item.role === "tool" && item.toolCallId === "first",
    ),
  ).toHaveLength(1);
});

it("keeps ordinary and changed-requirement conversation in one durable chat", async () => {
  const f = fixture([
    reply("We can plan that."),
    reply("A pineapple is a fruit."),
    reply("The changed scope needs a new approach."),
  ]);
  const chat = f.manager.create();
  f.manager.send(chat.id, "Plan a reading list");
  await settled(f.store, chat.id);
  expect(f.complete.mock.calls[0][0].allowedTools).toContain("ask_user");
  expect(f.complete.mock.calls[0][0].allowedTools).not.toContain("read_file");
  f.manager.send(chat.id, "What is a pineapple?");
  await settled(f.store, chat.id);
  f.manager.send(chat.id, "Actually, add sharing across devices.");
  const done = await settled(f.store, chat.id);
  expect(
    done.messages
      .filter((message) => message.role === "user")
      .map((message) => message.text),
  ).toEqual([
    "Plan a reading list",
    "What is a pineapple?",
    "Actually, add sharing across devices.",
  ]);
  expect(
    done.messages
      .filter((message) => message.role === "assistant")
      .map((message) => message.text),
  ).toEqual([
    "We can plan that.",
    "A pineapple is a fruit.",
    "The changed scope needs a new approach.",
  ]);
  expect(f.store.get(chat.id).messages).toHaveLength(6);
});

it("publishes a transient reply draft and persists only a completed reply", async () => {
  const f = fixture([]);
  const snapshots: PearlChat[] = [];
  const manager = new PearlChatManager(
    f.store,
    f.data,
    () => ({ key: "fixture-key", model: "fixture-model", outputTokens: 8192 }),
    (chat) => snapshots.push(chat),
    {
      complete: async ({ onDelta }) => {
        onDelta?.("Pearl is ");
        onDelta?.("answering.");
        return reply("Pearl is answering.");
      },
    },
  );
  const chat = manager.create();
  manager.send(chat.id, "Hello");
  const done = await settled(f.store, chat.id);
  expect(
    snapshots.some((item) => item.streamingText?.startsWith("Pearl is ")),
  ).toBe(true);
  expect(done.streamingText).toBeUndefined();
  expect(done.messages.at(-1)?.text).toBe("Pearl is answering.");
  expect(snapshots.at(-1)?.streamingText).toBeUndefined();
});

it("binds a linked answer to its pending question and rejects duplicates", async () => {
  const f = fixture([
    tool("ask_user", {
      topic: "visibility",
      question: "Who can see the list?",
      options: ["Only me", "Friends"],
    }),
    reply("Pineapple is a fruit. The sharing choice remains open."),
    reply("Friends can see it."),
  ]);
  const chat = f.manager.create();
  f.manager.send(chat.id, "Plan a list");
  const asked = await settled(f.store, chat.id);
  const question = asked.questions[0];
  expect(question.status).toBe("pending");
  f.manager.send(chat.id, "What is a pineapple?");
  expect((await settled(f.store, chat.id)).questions[0].status).toBe("pending");
  expect(f.complete.mock.calls[1]?.[0].system).toContain(question.id);
  expect(f.complete.mock.calls[1]?.[0].allowedTools).toContain(
    "answer_question",
  );
  expect(f.complete.mock.calls[1]?.[0].allowedTools).not.toContain("ask_user");
  f.manager.answerQuestion(chat.id, question.id, "Friends");
  const answered = await settled(f.store, chat.id);
  expect(f.complete.mock.calls[2]?.[0].allowedTools).toContain("ask_user");
  expect(f.complete.mock.calls[2]?.[0].allowedTools).not.toContain(
    "answer_question",
  );
  expect(answered.questions[0].answer).toBe("Friends");
  expect(
    answered.messages.some(
      (message) =>
        message.questionId === question.id && message.text === "Friends",
    ),
  ).toBe(true);
  expect(() =>
    f.manager.answerQuestion(chat.id, question.id, "Only me"),
  ).toThrow("no longer current");
  const reopened = new PearlChatStore(join(f.data, "workspace.sqlite"));
  stores.push(reopened);
  expect(reopened.get(chat.id).questions[0].status).toBe("answered");
});

it.each(["current", "legacy"])(
  "retains a %s pending question once in context and restores it only after native history is trimmed",
  async (version) => {
    const f = fixture([
      tool("ask_user", {
        topic: "audience",
        question: "Who may use this workspace?",
      }),
      reply(
        "A rainbow comes from light refracting and reflecting in droplets.",
      ),
      reply("The pending audience decision remains available."),
    ]);
    const chat = f.manager.create();
    f.manager.send(chat.id, "Plan a workspace");
    const asked = await settled(f.store, chat.id);
    const question = asked.questions[0];
    if (version === "legacy") {
      delete question.askedByToolCallId;
      f.store.save(asked);
    }
    f.manager.send(chat.id, "How does a rainbow form?");
    await settled(f.store, chat.id);
    const input = f.complete.mock.calls[1][0];
    expect(
      input.messages.some((message) =>
        message.id.startsWith("history-question-"),
      ),
    ).toBe(false);
    expect(JSON.stringify(input.messages).split(question.text)).toHaveLength(2);
    expect(f.store.get(chat.id).questions[0].status).toBe("pending");

    const saved = f.store.get(chat.id);
    for (let index = 0; index < 6; index++)
      saved.messages.push({
        id: `filler-${index}`,
        role: "assistant",
        text: "x".repeat(18_000),
        at: new Date().toISOString(),
      });
    f.store.save(saved);
    f.manager.send(chat.id, "Return to the workspace discussion");
    await settled(f.store, chat.id);
    const truncated = f.complete.mock.calls[2][0];
    expect(
      truncated.messages.filter(
        (message) => message.id === `history-question-${question.id}`,
      ),
    ).toHaveLength(1);
    expect(truncated.system).toContain(question.id);
  },
);

it("carries a durable linked answer through restart and context truncation without raising its authority", async () => {
  const f = fixture([
    tool("ask_user", {
      topic: "audience",
      question: "Who may use this workspace?",
      options: ["Only me", "Invited people"],
    }),
    reply("I will account for invited people."),
    reply("The earlier audience choice still applies."),
  ]);
  const chat = f.manager.create();
  f.manager.send(chat.id, "Plan a workspace");
  const question = (await settled(f.store, chat.id)).questions[0];
  f.manager.answerQuestion(
    chat.id,
    question.id,
    "Invited people, with view-only access",
  );
  await settled(f.store, chat.id);

  const reopened = new PearlChatStore(join(f.data, "workspace.sqlite"));
  stores.push(reopened);
  const historical = reopened.get(chat.id);
  for (let index = 0; index < 6; index++) {
    historical.messages.push({
      id: `filler-${index}`,
      role: "assistant",
      text: "x".repeat(18_000),
      at: new Date().toISOString(),
    });
  }
  reopened.save(historical);
  const resumed = new PearlChatManager(
    reopened,
    f.data,
    () => ({ key: "fixture-key", model: "fixture-model", outputTokens: 8192 }),
    () => {},
    { complete: f.complete },
  );
  resumed.send(chat.id, "Continue the plan");
  await settled(reopened, chat.id);
  const input = f.complete.mock.calls.at(-1)?.[0];
  expect(
    input?.messages.find((message) =>
      message.text.includes("Invited people, with view-only access"),
    )?.role,
  ).toBe("user");
  expect(
    input?.messages.find((message) =>
      message.text.includes("Who may use this workspace?"),
    )?.role,
  ).toBe("assistant");
  expect(input?.system).not.toContain("Invited people, with view-only access");
});

it("can link a clear ordinary chat answer without treating a digression as an answer", async () => {
  const responses: PearlModelResult[] = [
    tool("ask_user", {
      topic: "visibility",
      question: "Who can see it?",
      options: ["Only me", "Friends"],
    }),
    reply("A pineapple is a fruit."),
  ];
  const f = fixture(responses);
  const chat = f.manager.create();
  f.manager.send(chat.id, "Plan visibility");
  const question = (await settled(f.store, chat.id)).questions[0];
  f.manager.send(chat.id, "What is a pineapple?");
  expect((await settled(f.store, chat.id)).questions[0].status).toBe("pending");
  responses.push(
    tool("answer_question", { questionId: question.id }, "call-2"),
    reply("Friends can see it."),
  );
  f.manager.send(chat.id, "Friends should see it");
  const done = await settled(f.store, chat.id);
  expect(done.questions[0].status).toBe("answered");
  expect(done.questions[0].answer).toBe("Friends should see it");
  expect(
    done.messages.find(
      (message) => message.id === done.questions[0].answeredByMessageId,
    )?.text,
  ).toBe("Friends should see it");
  expect(
    done.messages.find(
      (message) => message.id === done.questions[0].answeredByMessageId,
    )?.questionId,
  ).toBe(question.id);
  expect(
    f.complete.mock.calls
      .at(-1)?.[0]
      .messages.find((message) =>
        message.text.includes("Friends should see it"),
      )?.questionId,
  ).toBe(question.id);
});

it("requires an explicit lineage and reason to reopen an answered topic", async () => {
  const responses: PearlModelResult[] = [
    tool("ask_user", {
      topic: "visibility-setting",
      question: "Who can see this?",
      options: ["Only me", "Friends"],
    }),
    reply("I recorded your answer."),
  ];
  const f = fixture(responses);
  const chat = f.manager.create();
  f.manager.send(chat.id, "Plan visibility");
  const original = (await settled(f.store, chat.id)).questions[0];
  expect(original.topic).toBe("visibility_setting");
  f.manager.answerQuestion(chat.id, original.id, "Only me");
  await settled(f.store, chat.id);
  responses.push(
    tool(
      "ask_user",
      {
        topic: "visibility_setting",
        question: "Who can see this now?",
        options: ["Only me", "Friends"],
      },
      "call-2",
    ),
    reply("I should not reopen that choice without a reason."),
  );
  f.manager.send(chat.id, "Continue our discussion");
  const rejected = await settled(f.store, chat.id);
  expect(rejected.questions).toHaveLength(1);
  expect(
    rejected.messages.filter((message) => message.role === "tool").at(-1)?.text,
  ).toContain("prior question ID");
  responses.push(
    tool(
      "ask_user",
      {
        topic: "visibility-setting",
        question: "Can friends now see it?",
        options: ["Only me", "Friends"],
        reopenQuestionId: original.id,
        reopenReason: "The user added sharing across devices.",
      },
      "call-3",
    ),
  );
  f.manager.send(chat.id, "Now add sharing across devices");
  const reopened = await settled(f.store, chat.id);
  expect(reopened.questions[0].status).toBe("superseded");
  expect(reopened.questions[0].answer).toBe("Only me");
  expect(reopened.questions[1].reopenedFrom).toBe(original.id);
  expect(reopened.questions[1].status).toBe("pending");
  expect(() =>
    f.manager.answerQuestion(chat.id, original.id, "Friends"),
  ).toThrow("no longer current");
});

it("reports an incomplete question action as validation failure without changing a prior answer", async () => {
  const responses: PearlModelResult[] = [
    tool("ask_user", {
      topic: "audience",
      question: "Who can see the data?",
      options: ["Only me", "Invited people"],
    }),
    reply("Recorded."),
  ];
  const f = fixture(responses);
  const chat = f.manager.create();
  f.manager.send(chat.id, "Plan access");
  const original = (await settled(f.store, chat.id)).questions[0];
  f.manager.answerQuestion(chat.id, original.id, "Only me");
  await settled(f.store, chat.id);

  responses.push(
    tool("ask_user", {
      topic: "audience",
      options: ["Invited people"],
      reopenQuestionId: original.id,
      reopenReason: "The user changed the access requirement.",
    }),
    reply("I need to correct the question request."),
  );
  f.manager.send(chat.id, "Now let invited people see the data");
  const done = await settled(f.store, chat.id);
  expect(done.questions).toHaveLength(1);
  expect(done.questions[0].status).toBe("answered");
  const rejection = done.messages.find(
    (message) =>
      message.role === "tool" && message.text.startsWith("Question rejected"),
  )?.text;
  expect(rejection).toContain("missing the required question text");
  expect(rejection).toContain("No user decision changed");
});

it("withdraws only the exact pending question after a changed requirement", async () => {
  const responses: PearlModelResult[] = [
    tool("ask_user", {
      topic: "visibility",
      question: "Who can see it?",
      options: ["Only me", "Friends"],
    }),
  ];
  const f = fixture(responses);
  const chat = f.manager.create();
  f.manager.send(chat.id, "Plan visibility");
  const question = (await settled(f.store, chat.id)).questions[0];
  responses.push(
    tool(
      "withdraw_question",
      {
        questionId: question.id,
        reason: "The user changed the sharing requirement.",
      },
      "call-2",
    ),
    reply("That choice is no longer needed."),
  );
  f.manager.send(chat.id, "The scope changed; this choice no longer fits");
  const withdrawn = await settled(f.store, chat.id);
  expect(withdrawn.questions[0].status).toBe("withdrawn");
  expect(() =>
    f.manager.answerQuestion(chat.id, question.id, "Friends"),
  ).toThrow("no longer current");
});

it("requires project approval and rejects a stale edit revision", async () => {
  const hash = createHash("sha256").update("old").digest("hex");
  const f = fixture([
    tool("read_file", { path: "note.txt" }),
    reply("I need project access."),
    tool("read_file", { path: "note.txt" }, "call-2"),
    reply("I read the file."),
    tool(
      "write_file",
      { path: "note.txt", content: "new", expectedSha256: hash },
      "call-3",
    ),
    reply("The file changed; I need to reread it."),
  ]);
  writeFileSync(join(f.project, "note.txt"), "old");
  const chat = f.manager.create();
  f.manager.chooseProject(chat.id, f.project);
  f.manager.send(chat.id, "Read note.txt");
  const denied = await settled(f.store, chat.id);
  expect(
    denied.messages.find((message) => message.role === "tool")?.text,
  ).toContain("approve a project");
  f.manager.approveProject(chat.id, true);
  f.manager.send(chat.id, "Read note.txt again");
  await settled(f.store, chat.id);
  writeFileSync(join(f.project, "note.txt"), "changed externally");
  f.manager.send(chat.id, "Change note.txt");
  const stale = await settled(f.store, chat.id);
  expect(
    stale.messages.filter((message) => message.role === "tool").at(-1)?.text,
  ).toContain("changed since it was read");
  expect(readFileSync(join(f.project, "note.txt"), "utf8")).toBe(
    "changed externally",
  );
});

it("writes a revision-bound file with a backup and pauses commands for one-use review", async () => {
  const hash = createHash("sha256").update("old").digest("hex");
  const f = fixture([
    tool("read_file", { path: "note.txt" }),
    reply("I read the file."),
    tool(
      "write_file",
      {
        path: "note.txt",
        content: "new",
        expectedSha256: hash,
      },
      "call-2",
    ),
    reply("Updated note.txt."),
    tool("run_command", { command: "npm", args: ["test"] }, "call-3"),
    reply("The command was denied."),
  ]);
  writeFileSync(join(f.project, "note.txt"), "old");
  const chat = f.manager.create();
  f.manager.chooseProject(chat.id, f.project);
  f.manager.approveProject(chat.id, true);
  f.manager.send(chat.id, "Read note.txt");
  await settled(f.store, chat.id);
  f.manager.send(chat.id, "Update note.txt");
  const pending = await settled(f.store, chat.id);
  expect(readFileSync(join(f.project, "note.txt"), "utf8")).toBe("new");
  const backupFolders = readdirSync(join(f.data, "pearl-backups", chat.id));
  expect(
    readFileSync(
      join(
        f.data,
        "pearl-backups",
        chat.id,
        backupFolders[0],
        "originals",
        "note.txt",
      ),
      "utf8",
    ),
  ).toBe("old");
  expect(pending.status).toBe("awaiting_approval");
  expect(readFileSync(join(f.project, "note.txt"), "utf8")).toBe("new");
  f.manager.decideTool(chat.id, "call-3", false);
  expect(() => f.manager.decideTool(chat.id, "call-3", true)).toThrow(
    "no longer current",
  );
  const done = await settled(f.store, chat.id);
  expect(
    done.messages.find(
      (message) => message.role === "tool" && message.toolCallId === "call-3",
    )?.text,
  ).toContain("denied");
});

it.each([false, true])(
  "does not re-offer the same command after a denial until a new user message (batched: %s)",
  async (batched) => {
    const responses: PearlModelResult[] = [
      batched
        ? {
            kind: "actions",
            text: "",
            calls: [
              {
                id: "plan",
                name: "update_plan",
                arguments: JSON.stringify({
                  expectedRevision: 0,
                  objective: "Check Node",
                  approach: "Review the version command",
                  requirements: ["Check Node"],
                  steps: [{ text: "Check version", status: "in_progress" }],
                }),
              },
              {
                id: "call-1",
                name: "run_command",
                arguments: '{"command":"node","args":["--version"]}',
              },
            ],
          }
        : tool("run_command", { command: "node", args: ["--version"] }),
      tool("run_command", { command: "node", args: ["--version"] }, "call-2"),
      reply("The command was denied; I will wait for a new request."),
    ];
    const f = fixture(responses);
    const chat = f.manager.create();
    f.manager.chooseProject(chat.id, f.project);
    f.manager.approveProject(chat.id, true);
    f.manager.send(chat.id, "Check Node");
    const pending = await settled(f.store, chat.id);
    expect(pending.status).toBe("awaiting_approval");
    f.manager.decideTool(chat.id, pending.pendingTool!.id, false);
    const done = await settled(f.store, chat.id);
    expect(done.status).toBe("idle");
    expect(done.pendingTool).toBeUndefined();
    expect(
      done.messages.find(
        (message) => message.role === "tool" && message.toolCallId === "call-2",
      )?.text,
    ).toContain("same denied command");
    responses.push(
      tool("run_command", { command: "node", args: ["--version"] }, "call-3"),
    );
    f.manager.send(chat.id, "Please check Node now");
    const reopened = await settled(f.store, chat.id);
    expect(reopened.status).toBe("awaiting_approval");
  },
);

it("can review a different safe check after denying preliminary commands", async () => {
  const f = fixture([
    tool("run_command", { command: "node", args: ["--version"] }),
    tool("run_command", { command: "node", args: ["-e", "1"] }, "call-2"),
    tool(
      "run_command",
      { command: "node", args: ["--test", "test.js"] },
      "call-3",
    ),
    reply("The corrected check passed."),
  ]);
  writeFileSync(
    join(f.project, "test.js"),
    "const { test } = require('node:test'); test('works', () => {});\n",
  );
  const chat = f.manager.create();
  f.manager.chooseProject(chat.id, f.project);
  f.manager.approveProject(chat.id, true);
  f.manager.send(chat.id, "Check the project");
  const first = await settled(f.store, chat.id);
  expect(first.pendingTool?.id).toBe("call-1");
  f.manager.decideTool(chat.id, "call-1", false);
  await vi.waitFor(() =>
    expect(f.store.get(chat.id).pendingTool?.id).toBe("call-2"),
  );
  f.manager.decideTool(chat.id, "call-2", false);
  await vi.waitFor(() =>
    expect(f.store.get(chat.id).pendingTool?.id).toBe("call-3"),
  );
  f.manager.decideTool(chat.id, "call-3", true);
  const done = await settled(f.store, chat.id);
  expect(done.status).toBe("idle");
  expect(
    JSON.parse(
      done.messages.find(
        (message) => message.role === "tool" && message.toolCallId === "call-3",
      )!.text,
    ).exitCode,
  ).toBe(0);
});

it("bounds repeated distinct command reviews within one user turn", async () => {
  const f = fixture([
    ...Array.from({ length: 6 }, (_, index) =>
      tool(
        "run_command",
        { command: "node", args: ["-e", String(index)] },
        `call-${index + 1}`,
      ),
    ),
    reply("I will wait for a new user message."),
  ]);
  const chat = f.manager.create();
  f.manager.chooseProject(chat.id, f.project);
  f.manager.approveProject(chat.id, true);
  f.manager.send(chat.id, "Check commands");
  for (let index = 1; index <= 5; index++) {
    await vi.waitFor(() =>
      expect(f.store.get(chat.id).pendingTool?.id).toBe(`call-${index}`),
    );
    f.manager.decideTool(chat.id, `call-${index}`, false);
  }
  const done = await settled(f.store, chat.id);
  expect(done.status).toBe("idle");
  expect(done.pendingTool).toBeUndefined();
  expect(
    done.messages.find(
      (message) => message.role === "tool" && message.toolCallId === "call-6",
    )?.text,
  ).toContain("review limit reached");
});

it("searches project text and makes a precise revision-bound edit", async () => {
  const original = "alpha\nspecial line\nomega\n";
  const hash = createHash("sha256").update(original).digest("hex");
  const f = fixture([
    tool("search_text", { path: "", query: "special" }),
    reply("I found one match."),
    tool("read_file", { path: "note.txt" }, "call-2"),
    reply("I read the file."),
    tool(
      "replace_in_file",
      {
        path: "note.txt",
        oldText: "special line",
        newText: "updated line",
        expectedSha256: hash,
      },
      "call-3",
    ),
    reply("I updated that line."),
  ]);
  writeFileSync(join(f.project, "note.txt"), original);
  writeFileSync(join(f.project, ".env"), "special secret");
  writeFileSync(join(f.root, "outside.txt"), "special private");
  symlinkSync(join(f.root, "outside.txt"), join(f.project, "outside.txt"));
  const chat = f.manager.create();
  f.manager.chooseProject(chat.id, f.project);
  f.manager.approveProject(chat.id, true);
  f.manager.send(chat.id, "Find special in this project");
  const searched = await settled(f.store, chat.id);
  const result = JSON.parse(
    searched.messages.find((message) => message.role === "tool")!.text,
  );
  expect(result.matches).toEqual([
    { path: "note.txt", line: 2, text: "special line" },
  ]);
  f.manager.send(chat.id, "Read note.txt");
  await settled(f.store, chat.id);
  f.manager.send(chat.id, "Change only that line");
  await settled(f.store, chat.id);
  expect(readFileSync(join(f.project, "note.txt"), "utf8")).toBe(
    "alpha\nupdated line\nomega\n",
  );
  const backups = readdirSync(join(f.data, "pearl-backups", chat.id));
  expect(backups).toHaveLength(1);
});

it("searches a single approved file without treating it as a directory", async () => {
  const f = fixture([
    tool("search_text", { path: "note.txt", query: "needle" }),
    reply("Found the line."),
  ]);
  writeFileSync(join(f.project, "note.txt"), "one\nneedle here\nthree\n");
  const chat = f.manager.create();
  f.manager.chooseProject(chat.id, f.project);
  f.manager.approveProject(chat.id, true);
  f.manager.send(chat.id, "Find needle in note.txt");
  const done = await settled(f.store, chat.id);
  expect(
    JSON.parse(done.messages.find((item) => item.role === "tool")!.text)
      .matches,
  ).toEqual([{ path: "note.txt", line: 2, text: "needle here" }]);
});

it("offers a project map only after folder approval and returns a bounded observation", async () => {
  const f = fixture([
    tool("project_map", {}),
    reply("The project has a Room entry point."),
  ]);
  writeFileSync(join(f.project, "app.ts"), "export function enterRoom() {}\n");
  const chat = f.manager.create();
  f.manager.chooseProject(chat.id, f.project);
  expect(f.complete).not.toHaveBeenCalled();
  f.manager.approveProject(chat.id, true);
  f.manager.send(chat.id, "Find the project entry point");
  const done = await settled(f.store, chat.id);
  expect(f.complete.mock.calls[0][0].allowedTools).toContain("project_map");
  const observation = JSON.parse(
    done.messages.find((message) => message.role === "tool")!.text,
  );
  expect(observation.files).toContain("app.ts");
  expect(observation.symbols).toContainEqual({
    path: "app.ts",
    line: 1,
    name: "enterRoom",
    kind: "function",
  });
});

it("creates a new file but refuses to overwrite an existing path", async () => {
  const f = fixture([
    tool("create_file", { path: "new.txt", content: "new content" }),
    tool(
      "complete_work",
      { status: "unverified", summary: "Created it without a command check." },
      "finish-1",
    ),
    tool("create_file", { path: "new.txt", content: "replacement" }, "call-2"),
    reply("I need to read the existing file before editing."),
  ]);
  const chat = f.manager.create();
  f.manager.chooseProject(chat.id, f.project);
  f.manager.approveProject(chat.id, true);
  f.manager.send(chat.id, "Create new.txt");
  const created = await settled(f.store, chat.id);
  expect(created.messages.at(-1)?.evidence).toEqual({
    projectApproved: true,
    filesWritten: 1,
    uiFilesWritten: 0,
    commandsCompleted: 0,
    browserChecks: 0,
    successfulCommandAfterLatestWrite: false,
    successfulBrowserAfterLatestUiWrite: false,
  });
  expect(readFileSync(join(f.project, "new.txt"), "utf8")).toBe("new content");
  f.manager.send(chat.id, "Create it again");
  const done = await settled(f.store, chat.id);
  expect(
    done.messages.filter((message) => message.role === "tool").at(-1)?.text,
  ).toContain("already exists");
  expect(readFileSync(join(f.project, "new.txt"), "utf8")).toBe("new content");
});

it("distinguishes a successful command before an edit from one after it", () => {
  const f = fixture([]);
  const chat = f.manager.create();
  chat.activeUserMessageId = "user";
  chat.messages.push({
    id: "user",
    role: "user",
    text: "Change the file",
    at: "now",
  });
  chat.messages.push({
    id: "first-check",
    role: "tool",
    text: '{"exitCode":0}',
    toolName: "run_command",
    at: "now",
  });
  chat.messages.push({
    id: "write",
    role: "tool",
    text: '{"path":"note.txt","written":true}',
    toolName: "write_file",
    at: "now",
  });
  expect(currentTurnEvidence(chat).successfulCommandAfterLatestWrite).toBe(
    false,
  );
  chat.messages.push({
    id: "second-check",
    role: "tool",
    text: '{"exitCode":0}',
    toolName: "run_command",
    at: "now",
  });
  expect(currentTurnEvidence(chat).successfulCommandAfterLatestWrite).toBe(
    true,
  );
});

it.each(["style.css", "app.js", "server.js"])(
  "invalidates browser evidence after a subsequent %s change",
  (path) => {
    const f = fixture([]);
    const chat = f.manager.create();
    chat.activeUserMessageId = "user";
    chat.messages.push({
      id: "user",
      role: "user",
      text: "Build the UI",
      at: "now",
    });
    chat.messages.push({
      id: "html-write",
      role: "tool",
      toolName: "create_file",
      text: '{"path":"index.html","written":true}',
      at: "now",
    });
    chat.messages.push({
      id: "command-check",
      role: "tool",
      toolName: "run_command",
      text: '{"exitCode":0}',
      at: "now",
    });
    expect(needsPostEditBrowserCheck(chat)).toBe(true);
    expect(currentTurnEvidence(chat).successfulBrowserAfterLatestUiWrite).toBe(
      false,
    );
    chat.messages.push({
      id: "broken-browser",
      role: "tool",
      toolName: "browser_check",
      text: '{"visibleText":"Page","errors":[],"hiddenViolations":[{"tag":"form","id":"book-form"}],"blockedExternalRequests":0}',
      at: "now",
    });
    expect(needsPostEditBrowserCheck(chat)).toBe(true);
    chat.messages.push({
      id: "clean-browser",
      role: "tool",
      toolName: "browser_check",
      text: '{"visibleText":"Page","errors":[],"hiddenViolations":[],"blockedExternalRequests":0}',
      at: "now",
    });
    expect(needsPostEditBrowserCheck(chat)).toBe(false);
    expect(currentTurnEvidence(chat).successfulBrowserAfterLatestUiWrite).toBe(
      true,
    );
    chat.messages.push({
      id: "css-write",
      role: "tool",
      toolName: "create_file",
      text: JSON.stringify({ path, written: true }),
      at: "now",
    });
    expect(needsPostEditBrowserCheck(chat)).toBe(true);
  },
);

it("does not call a failed browser verification done just because command tests passed without edits", async () => {
  const check = vi.fn(async () => ({
    title: "App",
    visibleText: "Broken app",
    initialVisibleText: "Broken app",
    controls: [],
    hiddenViolations: [],
    errors: ["Submission failed"],
    blockedExternalRequests: 0,
    completedSteps: 0,
  }));
  const f = fixture(
    [
      tool("browser_check", { path: "index.html" }, "browser"),
      tool("run_command", { command: "node", args: ["--version"] }, "check"),
      tool(
        "complete_work",
        { status: "done", summary: "Everything passed." },
        "false-done",
      ),
      tool(
        "complete_work",
        {
          status: "unverified",
          summary: "The command ran, but browser submission failed.",
        },
        "honest-result",
      ),
    ],
    { check },
  );
  writeFileSync(join(f.project, "index.html"), "<!doctype html><p>App</p>");
  const chat = f.manager.create();
  f.manager.chooseProject(chat.id, f.project);
  f.manager.approveProject(chat.id, true);
  f.manager.send(chat.id, "Verify submission in the existing app");
  await settled(f.store, chat.id);
  f.manager.decideTool(chat.id, "check", true);
  const done = await settled(f.store, chat.id);
  expect(done.messages.at(-1)?.completion?.status).toBe("unverified");
  expect(
    done.messages.find(
      (message) =>
        message.role === "tool" && message.toolCallId === "false-done",
    )?.text,
  ).toContain("Completion rejected");
});

it("explains a missing file path and can recover on the next action", async () => {
  const f = fixture([
    tool("create_file", { name: "app.js", content: "first" }),
    tool("create_file", { path: "app.js", content: "second" }, "call-2"),
    reply("Created app.js after correcting the action arguments."),
  ]);
  const chat = f.manager.create();
  f.manager.chooseProject(chat.id, f.project);
  f.manager.approveProject(chat.id, true);
  f.manager.send(chat.id, "Create app.js");
  const done = await settled(f.store, chat.id);
  const observations = done.messages.filter((item) => item.role === "tool");
  expect(observations[0].text).toContain("Missing required path");
  expect(observations[0].text).toContain("no file was created");
  expect(JSON.parse(observations[1].text).written).toBe(true);
  expect(readFileSync(join(f.project, "app.js"), "utf8")).toBe("second");
});

it("rejects a precise edit after the file changes externally", async () => {
  const original = "one two one";
  const hash = createHash("sha256").update(original).digest("hex");
  const f = fixture([
    tool("read_file", { path: "note.txt" }),
    reply("I read it."),
    tool(
      "replace_in_file",
      {
        path: "note.txt",
        oldText: "one",
        newText: "three",
        expectedSha256: hash,
      },
      "call-2",
    ),
    reply("I need to reread before editing."),
  ]);
  writeFileSync(join(f.project, "note.txt"), original);
  const chat = f.manager.create();
  f.manager.chooseProject(chat.id, f.project);
  f.manager.approveProject(chat.id, true);
  f.manager.send(chat.id, "Read note.txt");
  await settled(f.store, chat.id);
  writeFileSync(join(f.project, "note.txt"), "one two changed");
  f.manager.send(chat.id, "Make the edit");
  const done = await settled(f.store, chat.id);
  expect(
    done.messages.filter((message) => message.role === "tool").at(-1)?.text,
  ).toContain("changed since it was read");
  expect(readFileSync(join(f.project, "note.txt"), "utf8")).toBe(
    "one two changed",
  );
});

it("rejects whole-file replacement when the prior read was truncated", async () => {
  const original = "a".repeat(100_001);
  const hash = createHash("sha256").update(original).digest("hex");
  const f = fixture([
    tool("read_file", { path: "large.txt" }),
    reply("I saw only part of this file."),
    tool(
      "write_file",
      { path: "large.txt", content: "replacement", expectedSha256: hash },
      "call-2",
    ),
    reply("I need a precise edit."),
  ]);
  writeFileSync(join(f.project, "large.txt"), original);
  const chat = f.manager.create();
  f.manager.chooseProject(chat.id, f.project);
  f.manager.approveProject(chat.id, true);
  f.manager.send(chat.id, "Read the large file");
  const read = await settled(f.store, chat.id);
  expect(
    JSON.parse(read.messages.find((message) => message.role === "tool")!.text)
      .truncated,
  ).toBe(true);
  f.manager.send(chat.id, "Replace it");
  const done = await settled(f.store, chat.id);
  expect(
    done.messages.filter((message) => message.role === "tool").at(-1)?.text,
  ).toContain("too large to read in full");
  expect(readFileSync(join(f.project, "large.txt"), "utf8")).toBe(original);
});

it("rejects private paths, traversal and symlinked project reads", async () => {
  const f = fixture([
    tool("read_file", { path: ".env" }),
    reply("That path is unavailable."),
    tool("read_file", { path: "../secret.txt" }, "call-2"),
    reply("That path is outside the project."),
    tool("list_files", { path: "link" }, "call-3"),
    reply("That directory is a symlink."),
  ]);
  writeFileSync(join(f.root, "secret.txt"), "private");
  symlinkSync(f.root, join(f.project, "link"));
  const chat = f.manager.create();
  f.manager.chooseProject(chat.id, f.project);
  f.manager.approveProject(chat.id, true);
  for (const prompt of ["Read .env", "Read outside", "List link"]) {
    f.manager.send(chat.id, prompt);
    await settled(f.store, chat.id);
  }
  const observations = f.store
    .get(chat.id)
    .messages.filter((message) => message.role === "tool")
    .map((message) => message.text);
  expect(observations[0]).toContain("Unsafe or private file path");
  expect(observations[1]).toContain("Unsafe or private file path");
  expect(observations[2]).toContain("Invalid directory");
});

it("accepts common root notation only for bounded project listing", async () => {
  const f = fixture([
    tool("list_files", { path: "." }),
    reply("Listed the project."),
    tool("list_files", { path: "/" }, "call-2"),
    reply("Listed the project again."),
    tool("list_files", { path: "/tmp" }, "call-3"),
    reply("That absolute path is unavailable."),
  ]);
  writeFileSync(join(f.project, "note.txt"), "visible");
  const chat = f.manager.create();
  f.manager.chooseProject(chat.id, f.project);
  f.manager.approveProject(chat.id, true);
  for (const prompt of ["List dot", "List slash", "List outside"]) {
    f.manager.send(chat.id, prompt);
    await settled(f.store, chat.id);
  }
  const observations = f.store
    .get(chat.id)
    .messages.filter((message) => message.role === "tool")
    .map((message) => message.text);
  expect(JSON.parse(observations[0])).toEqual([
    { name: "note.txt", type: "file" },
  ]);
  expect(JSON.parse(observations[1])).toEqual(JSON.parse(observations[0]));
  expect(observations[2]).toContain("Unsafe or private file path");
});

it("does not carry file-read authority into another approved project", async () => {
  const hash = createHash("sha256").update("old").digest("hex");
  const f = fixture([
    tool("read_file", { path: "note.txt" }),
    reply("I read it."),
    tool(
      "write_file",
      { path: "note.txt", content: "new", expectedSha256: hash },
      "call-2",
    ),
    reply("I must inspect this project first."),
  ]);
  writeFileSync(join(f.project, "note.txt"), "old");
  const other = join(f.root, "other-project");
  mkdirSync(other);
  writeFileSync(join(other, "note.txt"), "old");
  const chat = f.manager.create();
  f.manager.chooseProject(chat.id, f.project);
  f.manager.approveProject(chat.id, true);
  f.manager.send(chat.id, "Read note.txt");
  await settled(f.store, chat.id);
  f.manager.chooseProject(chat.id, other);
  f.manager.approveProject(chat.id, true);
  f.manager.send(chat.id, "Edit note.txt");
  const result = await settled(f.store, chat.id);
  expect(
    result.messages.filter((message) => message.role === "tool").at(-1)?.text,
  ).toContain("Read this file");
  expect(readFileSync(join(other, "note.txt"), "utf8")).toBe("old");
});

it("does not execute a command if its reviewed executable revision changes", async () => {
  const f = fixture([
    tool("run_command", { command: "node", args: ["--version"] }),
  ]);
  const chat = f.manager.create();
  f.manager.chooseProject(chat.id, f.project);
  f.manager.approveProject(chat.id, true);
  f.manager.send(chat.id, "Check the Node version");
  const pending = await settled(f.store, chat.id);
  expect(pending.status).toBe("awaiting_approval");
  expect(pending.pendingTool?.executable?.path).toBeTruthy();
  pending.pendingTool!.executable!.mtimeMs = -1;
  f.store.save(pending);
  f.manager.decideTool(chat.id, pending.pendingTool!.id, true);
  await vi.waitFor(() => expect(f.store.get(chat.id).status).toBe("failed"));
  expect(f.store.get(chat.id).error).toContain("changed since approval");
});

it("recovers an interrupted tool call without silently repeating it", () => {
  const f = fixture([]);
  const chat = f.manager.create();
  chat.status = "running";
  chat.messages.push({
    id: "action",
    role: "assistant",
    text: "",
    at: new Date().toISOString(),
    toolCallId: "call-x",
    toolName: "run_command",
    arguments: "{}",
  });
  f.store.save(chat);
  f.store.recover();
  const recovered = f.store.get(chat.id);
  expect(recovered.status).toBe("failed");
  expect(recovered.messages.at(-1)?.text).toContain("outcome is unknown");
});

it("recovers running chats beyond the sidebar history limit", () => {
  const f = fixture([]);
  const ids: string[] = [];
  for (let index = 0; index < 201; index++) {
    const chat = f.manager.create();
    chat.status = "running";
    f.store.save(chat);
    ids.push(chat.id);
  }
  expect(f.store.list()).toHaveLength(200);
  f.store.recover();
  for (const id of ids) expect(f.store.get(id).status).toBe("failed");
});

it("does not start a trimmed provider history with an orphan tool result", () => {
  const f = fixture([]);
  const chat = f.manager.create();
  chat.messages.push(
    {
      id: "tool",
      role: "tool",
      text: "A previous result",
      at: new Date().toISOString(),
      toolCallId: "old-call",
      toolName: "read_file",
    },
    {
      id: "user",
      role: "user",
      text: "Current request",
      at: new Date().toISOString(),
    },
  );
  const context = (
    f.manager as unknown as {
      context: (chat: PearlChat) => PearlMessage[];
    }
  ).context(chat);
  expect(context.map((message) => message.role)).toEqual(["user"]);
});

it("continues productive coding beyond twelve model actions", async () => {
  const responses = Array.from({ length: 12 }, (_, index) =>
    tool("read_file", { path: `source-${index}.txt` }, `call-${index}`),
  );
  responses.push(
    tool("create_file", { path: "result.txt", content: "done" }, "write-call"),
    reply("Created result.txt after inspecting the project."),
    tool(
      "complete_work",
      {
        status: "unverified",
        summary: "Created result.txt; no command check ran.",
      },
      "finish-call",
    ),
  );
  const f = fixture(responses);
  for (let index = 0; index < 12; index++)
    writeFileSync(join(f.project, `source-${index}.txt`), `source-${index}`);
  const chat = f.manager.create();
  f.manager.chooseProject(chat.id, f.project);
  f.manager.approveProject(chat.id, true);
  f.manager.send(chat.id, "Inspect the project");
  const done = await settled(f.store, chat.id);
  expect(done.status).toBe("idle");
  expect(readFileSync(join(f.project, "result.txt"), "utf8")).toBe("done");
  expect(f.complete).toHaveBeenCalledTimes(15);
});

it("continues after an unverified edit to request a real command check", async () => {
  const f = fixture([
    tool("create_file", {
      path: "change.test.js",
      content:
        'import assert from "node:assert/strict"; import test from "node:test"; test("addition", () => assert.equal(1 + 1, 2));\n',
    }),
    reply("The change is complete."),
    tool(
      "run_command",
      { command: "node", args: ["--test", "change.test.js"] },
      "check-1",
    ),
    tool(
      "complete_work",
      { status: "done", summary: "The command completed after the edit." },
      "finish-1",
    ),
  ]);
  const chat = f.manager.create();
  f.manager.chooseProject(chat.id, f.project);
  f.manager.approveProject(chat.id, true);
  f.manager.send(chat.id, "Create and check a file");
  await vi.waitFor(() =>
    expect(f.store.get(chat.id).pendingTool?.id).toBe("check-1"),
  );
  expect(
    f.store
      .get(chat.id)
      .messages.some((message) => message.text === "The change is complete."),
  ).toBe(false);
  f.manager.decideTool(chat.id, "check-1", true);
  const done = await settled(f.store, chat.id);
  expect(done.status).toBe("idle");
  expect(done.messages.at(-1)?.text).toContain("after the edit");
});

it("allows an honest unverified reply after one coding continuation", async () => {
  const f = fixture([
    tool("create_file", { path: "change.txt", content: "change" }),
    reply("The change is complete."),
    tool(
      "complete_work",
      {
        status: "unverified",
        summary: "The file changed, but no command check ran.",
      },
      "finish-1",
    ),
  ]);
  const chat = f.manager.create();
  f.manager.chooseProject(chat.id, f.project);
  f.manager.approveProject(chat.id, true);
  f.manager.send(chat.id, "Create a file");
  const done = await settled(f.store, chat.id);
  expect(done.status).toBe("idle");
  expect(done.messages.at(-1)?.text).toBe(
    "The file changed, but no command check ran.",
  );
  expect(f.complete).toHaveBeenCalledTimes(3);
});

it("requires an evidence-backed completion after project edits", async () => {
  const f = fixture([
    tool("create_file", { path: "change.txt", content: "change" }),
    reply("The task is complete."),
    reply("The task is complete."),
    reply("The task is complete."),
  ]);
  const chat = f.manager.create();
  f.manager.chooseProject(chat.id, f.project);
  f.manager.approveProject(chat.id, true);
  f.manager.send(chat.id, "Create and check a file");
  const paused = await settled(f.store, chat.id);
  expect(paused.status).toBe("paused");
  expect(paused.pauseKind).toBe("completion_missing");
  expect(
    paused.messages.some(
      (message) =>
        message.role === "assistant" &&
        !message.toolName &&
        message.text === "The task is complete.",
    ),
  ).toBe(false);
  expect(f.complete.mock.calls.at(-1)?.[0].system).toContain("complete_work");
});

it("rejects a done claim without a post-edit check and accepts an unverified completion", async () => {
  const f = fixture([
    tool("create_file", { path: "change.txt", content: "change" }),
    tool("complete_work", {
      status: "done",
      summary: "Created change.txt.",
    }),
    tool(
      "complete_work",
      {
        status: "unverified",
        summary: "Created change.txt. A command check has not run.",
      },
      "complete-2",
    ),
  ]);
  const chat = f.manager.create();
  f.manager.chooseProject(chat.id, f.project);
  f.manager.approveProject(chat.id, true);
  f.manager.send(chat.id, "Create a file");
  const done = await settled(f.store, chat.id);
  expect(done.status).toBe("idle");
  expect(
    done.messages.some(
      (message) =>
        message.role === "tool" &&
        message.text.includes("A successful check is required"),
    ),
  ).toBe(true);
  expect(done.messages.at(-1)?.completion?.status).toBe("unverified");
  expect(done.messages.at(-1)?.evidence?.filesWritten).toBe(1);
});

it("rejects UI completion until a clean browser observation follows the edit", async () => {
  const check = vi.fn(
    async (_project: unknown, _path: string, _steps: unknown[]) => ({
      title: "Example",
      initialVisibleText: "Page loaded",
      visibleText: "Page loaded",
      controls: [],
      hiddenViolations: [],
      errors: [],
      blockedExternalRequests: 0,
      completedSteps: 0,
    }),
  );
  const f = fixture(
    [
      tool("create_file", {
        path: "index.html",
        content: "<p>Page loaded</p>",
      }),
      tool("run_command", { command: "node", args: ["--version"] }, "check-1"),
      tool(
        "complete_work",
        { status: "done", summary: "The page is done." },
        "finish-before-browser",
      ),
      tool("browser_check", { path: "index.html" }, "browser-1"),
      tool(
        "complete_work",
        { status: "done", summary: "The checked page is done." },
        "finish-after-browser",
      ),
    ],
    { check },
  );
  const chat = f.manager.create();
  f.manager.chooseProject(chat.id, f.project);
  f.manager.approveProject(chat.id, true);
  f.manager.send(chat.id, "Create a checked page");
  await vi.waitFor(() =>
    expect(f.store.get(chat.id).pendingTool?.id).toBe("check-1"),
  );
  f.manager.decideTool(chat.id, "check-1", true);
  const done = await settled(f.store, chat.id);
  expect(check).toHaveBeenCalledOnce();
  expect(
    done.messages.some(
      (message) =>
        message.role === "tool" &&
        message.text.includes("clean browser observation"),
    ),
  ).toBe(true);
  expect(done.messages.at(-1)?.completion?.status).toBe("done");
  expect(
    done.messages.at(-1)?.evidence?.successfulBrowserAfterLatestUiWrite,
  ).toBe(true);
});

it("rejects done when the completion action lists unfinished requirements", async () => {
  const f = fixture([
    tool("complete_work", {
      status: "done",
      summary: "The first release is complete.",
      remaining: "Sign-in and sharing are unfinished.",
    }),
    tool(
      "complete_work",
      {
        status: "partial",
        summary: "The local reading list slice is checked.",
        remaining: "Sign-in and sharing are unfinished.",
      },
      "complete-2",
    ),
  ]);
  const chat = f.manager.create();
  f.manager.chooseProject(chat.id, f.project);
  f.manager.approveProject(chat.id, true);
  f.manager.send(chat.id, "Finish the coding slice");
  const done = await settled(f.store, chat.id);
  expect(
    done.messages.some(
      (message) =>
        message.role === "tool" &&
        message.text.includes("cannot be done while work remains"),
    ),
  ).toBe(true);
  expect(done.messages.at(-1)?.completion?.status).toBe("partial");
  expect(done.messages.at(-1)?.completion?.remaining).toContain("sharing");
});

it("explains completion field errors without inventing unfinished product work", async () => {
  const f = fixture([
    tool("run_command", { command: "node", args: ["--version"] }, "check"),
    tool(
      "complete_work",
      {
        status: "done",
        summary: "Verified.",
        remaining: "None. All requested work is verified.",
      },
      "invalid",
    ),
    tool(
      "complete_work",
      { status: "done", summary: "Verified." },
      "corrected",
    ),
  ]);
  const chat = f.manager.create();
  f.manager.chooseProject(chat.id, f.project);
  f.manager.approveProject(chat.id, true);
  f.manager.send(chat.id, "Verify the installed runtime");
  await vi.waitFor(() =>
    expect(f.store.get(chat.id).pendingTool?.id).toBe("check"),
  );
  f.manager.decideTool(chat.id, "check", true);
  const done = await settled(f.store, chat.id);
  const rejection = done.messages.find(
    (m) => m.role === "tool" && m.toolCallId === "invalid",
  );
  expect(rejection?.text).toContain("omit the remaining field");
  expect(rejection?.text).toContain(
    "not an assessment of missing product features",
  );
  expect(done.messages.at(-1)?.completion?.status).toBe("done");
});

it("rejects a forged completion before project approval", async () => {
  const f = fixture([
    tool("complete_work", {
      status: "done",
      summary: "I changed the project.",
    }),
    reply("I do not have project access."),
  ]);
  const chat = f.manager.create();
  f.manager.send(chat.id, "Change my project");
  const done = await settled(f.store, chat.id);
  expect(done.status).toBe("idle");
  expect(done.messages.at(-1)?.completion).toBeUndefined();
  expect(
    done.messages.find(
      (message) =>
        message.role === "tool" && message.toolName === "complete_work",
    )?.text,
  ).toContain("Action rejected");
});

it("applies a revision-checked multi-edit patch and records its exact hunks", async () => {
  const original = "alpha\nbeta\ngamma\n";
  const expectedSha256 = createHash("sha256").update(original).digest("hex");
  const f = fixture([
    tool("read_file", { path: "note.txt" }, "read-1"),
    tool(
      "apply_patch",
      {
        path: "note.txt",
        expectedSha256,
        edits: [
          { oldText: "alpha", newText: "first" },
          { oldText: "gamma", newText: "last" },
        ],
      },
      "patch-1",
    ),
    tool(
      "complete_work",
      { status: "unverified", summary: "Updated note.txt." },
      "finish-1",
    ),
  ]);
  writeFileSync(join(f.project, "note.txt"), original);
  const chat = f.manager.create();
  f.manager.chooseProject(chat.id, f.project);
  f.manager.approveProject(chat.id, true);
  f.manager.send(chat.id, "Update the first and last lines");
  const done = await settled(f.store, chat.id);
  expect(done.status).toBe("idle");
  expect(readFileSync(join(f.project, "note.txt"), "utf8")).toBe(
    "first\nbeta\nlast\n",
  );
  const patchResult = done.messages.find(
    (message) => message.role === "tool" && message.toolCallId === "patch-1",
  );
  expect(JSON.parse(patchResult!.text).hunks).toEqual([
    { line: 1, removed: "alpha", added: "first" },
    { line: 3, removed: "gamma", added: "last" },
  ]);
  expect(done.messages.at(-1)?.evidence?.filesWritten).toBe(1);
});

it("refuses a patch with a stale revision without changing the project", async () => {
  const f = fixture([
    tool("read_file", { path: "note.txt" }, "read-1"),
    tool(
      "apply_patch",
      {
        path: "note.txt",
        expectedSha256: "0".repeat(64),
        edits: [{ oldText: "old", newText: "new" }],
      },
      "patch-1",
    ),
    reply("I need to read the current revision again."),
  ]);
  writeFileSync(join(f.project, "note.txt"), "old\n");
  const chat = f.manager.create();
  f.manager.chooseProject(chat.id, f.project);
  f.manager.approveProject(chat.id, true);
  f.manager.send(chat.id, "Update note.txt");
  const done = await settled(f.store, chat.id);
  expect(done.status).toBe("idle");
  expect(readFileSync(join(f.project, "note.txt"), "utf8")).toBe("old\n");
  expect(done.messages.at(-1)?.evidence?.filesWritten).toBe(0);
});

it("refuses a patch through a project symlink", async () => {
  const f = fixture([
    tool(
      "apply_patch",
      {
        path: "outside.txt",
        expectedSha256: "0".repeat(64),
        edits: [{ oldText: "outside", newText: "changed" }],
      },
      "patch-1",
    ),
    reply("The project link is unavailable."),
  ]);
  const outside = join(f.root, "outside.txt");
  writeFileSync(outside, "outside\n");
  symlinkSync(outside, join(f.project, "outside.txt"));
  const chat = f.manager.create();
  f.manager.chooseProject(chat.id, f.project);
  f.manager.approveProject(chat.id, true);
  f.manager.send(chat.id, "Edit the linked file");
  const done = await settled(f.store, chat.id);
  expect(done.status).toBe("idle");
  expect(readFileSync(outside, "utf8")).toBe("outside\n");
  expect(
    done.messages.find(
      (message) => message.role === "tool" && message.toolCallId === "patch-1",
    )?.text,
  ).toContain("Symlink");
});

it("reads a bounded line range while binding edits to the full file revision", async () => {
  const f = fixture([
    tool(
      "read_file",
      { path: "long.txt", startLine: 151, lineCount: 5 },
      "read-1",
    ),
    reply("I inspected the requested lines."),
  ]);
  const original = Array.from(
    { length: 200 },
    (_, index) => `line ${index + 1}`,
  ).join("\n");
  writeFileSync(join(f.project, "long.txt"), original);
  const chat = f.manager.create();
  f.manager.chooseProject(chat.id, f.project);
  f.manager.approveProject(chat.id, true);
  f.manager.send(chat.id, "Inspect lines 151 through 155");
  const done = await settled(f.store, chat.id);
  const observation = JSON.parse(
    done.messages.find(
      (message) => message.role === "tool" && message.toolCallId === "read-1",
    )!.text,
  );
  expect(observation.content).toBe(
    "line 151\nline 152\nline 153\nline 154\nline 155",
  );
  expect(observation.totalLines).toBe(200);
  expect(observation.sha256).toBe(
    createHash("sha256").update(original).digest("hex"),
  );
});

it("rejects an invalid line range without adding a read revision", async () => {
  const f = fixture([
    tool(
      "read_file",
      { path: "note.txt", startLine: 0, lineCount: 5 },
      "read-1",
    ),
    reply("That range is invalid."),
  ]);
  writeFileSync(join(f.project, "note.txt"), "hello\n");
  const chat = f.manager.create();
  f.manager.chooseProject(chat.id, f.project);
  f.manager.approveProject(chat.id, true);
  f.manager.send(chat.id, "Read the file range");
  const done = await settled(f.store, chat.id);
  expect(
    done.messages.find(
      (message) => message.role === "tool" && message.toolCallId === "read-1",
    )?.text,
  ).toContain("Action failed");
  expect(done.readRevisions?.["note.txt"]).toBeUndefined();
});

it("pauses a repeated action loop without calling it a task failure", async () => {
  const responses = Array.from({ length: 4 }, (_, index) =>
    tool("list_files", { path: "" }, `call-${index}`),
  );
  responses.push(reply("I will use a different approach."));
  const f = fixture(responses);
  const chat = f.manager.create();
  f.manager.chooseProject(chat.id, f.project);
  f.manager.approveProject(chat.id, true);
  f.manager.send(chat.id, "Inspect the project");
  const done = await settled(f.store, chat.id);
  expect(done.status).toBe("paused");
  expect(done.pauseKind).toBe("repeated_action");
  expect(done.error).toContain("repeated");
  expect(f.complete).toHaveBeenCalledTimes(4);
  expect(done.messages.at(-1)?.role).toBe("tool");
  f.manager.retry(chat.id);
  const resumed = await settled(f.store, chat.id);
  expect(resumed.status).toBe("idle");
  expect(f.complete.mock.calls[4][0].system).toContain(
    "Do not repeat that action",
  );
});

it("continues useful project inspection beyond the soft step budget", async () => {
  const responses = Array.from({ length: 40 }, (_, index) =>
    tool("read_file", { path: `file-${index}.txt` }, `read-${index}`),
  );
  responses.push(reply("I inspected the project files."));
  const f = fixture(responses);
  for (let index = 0; index < 40; index++)
    writeFileSync(join(f.project, `file-${index}.txt`), `content-${index}`);
  const chat = f.manager.create();
  f.manager.chooseProject(chat.id, f.project);
  f.manager.approveProject(chat.id, true);
  f.manager.send(chat.id, "Inspect all forty files");
  const done = await settled(f.store, chat.id);
  expect(done.status).toBe("idle");
  expect(f.complete).toHaveBeenCalledTimes(41);
  expect(done.messages.at(-1)?.text).toContain("inspected");
});

it("pauses at a hard backstop and resumes from saved actions", async () => {
  const responses = Array.from({ length: 128 }, (_, index) =>
    tool("read_file", { path: `file-${index}.txt` }, `read-${index}`),
  );
  responses.push(reply("The inspection is complete."));
  const f = fixture(responses);
  for (let index = 0; index < 128; index++)
    writeFileSync(join(f.project, `file-${index}.txt`), `content-${index}`);
  const chat = f.manager.create();
  f.manager.chooseProject(chat.id, f.project);
  f.manager.approveProject(chat.id, true);
  f.manager.send(chat.id, "Inspect the project");
  const paused = await settled(f.store, chat.id);
  expect(paused.status).toBe("paused");
  expect(paused.pauseKind).toBe("step_budget");
  expect(paused.error).toContain("Continue");
  expect(f.complete).toHaveBeenCalledTimes(128);
  expect(paused.messages.at(-1)?.role).toBe("tool");
  f.manager.retry(chat.id);
  const done = await settled(f.store, chat.id);
  expect(done.status).toBe("idle");
  expect(done.messages.at(-1)?.text).toBe("The inspection is complete.");
  expect(f.complete).toHaveBeenCalledTimes(129);
  expect(f.complete.mock.calls[128][0].system).toContain(
    "Continue from saved actions",
  );
});

it("stops an in-flight model turn without losing the user's message", async () => {
  const f = fixture([]);
  const manager = new PearlChatManager(
    f.store,
    f.data,
    () => ({ key: "fixture-key", model: "fixture-model", outputTokens: 8192 }),
    () => {},
    {
      complete: ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          );
        }),
    },
  );
  const chat = manager.create();
  manager.send(chat.id, "Please stop this turn");
  manager.stop(chat.id);
  await vi.waitFor(() => expect(f.store.get(chat.id).status).toBe("failed"));
  expect(f.store.get(chat.id).messages[0].text).toBe("Please stop this turn");
  expect(f.store.get(chat.id).error).toBe("Stopped by user");
});

it("continues an incomplete provider response without duplicating the user turn", async () => {
  const f = fixture([]);
  let requests = 0;
  let recoverySystem = "";
  const manager = new PearlChatManager(
    f.store,
    f.data,
    () => ({ key: "fixture-key", model: "fixture-model", outputTokens: 8192 }),
    () => {},
    {
      complete: async ({ system }) => {
        requests++;
        if (requests <= 2)
          throw new Error("Provider response was incomplete (length)");
        recoverySystem = system;
        return reply("I can continue from the saved request.");
      },
    },
  );
  const chat = manager.create();
  manager.send(chat.id, "Build the app");
  const failed = await settled(f.store, chat.id);
  expect(failed.error).toContain("incomplete (length)");
  manager.retry(chat.id);
  const recovered = await settled(f.store, chat.id);
  expect(recovered.status).toBe("idle");
  expect(
    recovered.messages.filter((message) => message.role === "user"),
  ).toHaveLength(1);
  expect(recovered.messages.at(-1)?.text).toContain("continue from the saved");
  expect(recoverySystem).toContain(
    "only one short action, under 4000 characters",
  );
});

it("retries a timed-out provider response once without duplicating the user turn", async () => {
  const f = fixture([]);
  let requests = 0;
  let recoverySystem = "";
  const manager = new PearlChatManager(
    f.store,
    f.data,
    () => ({ key: "fixture-key", model: "fixture-model", outputTokens: 8192 }),
    () => {},
    {
      complete: async ({ system }) => {
        requests++;
        if (requests === 1)
          throw new Error("The operation was aborted due to timeout");
        recoverySystem = system;
        return reply("I can continue with a small action.");
      },
    },
  );
  const chat = manager.create();
  manager.send(chat.id, "Build the app");
  const done = await settled(f.store, chat.id);
  expect(done.status).toBe("idle");
  expect(requests).toBe(2);
  expect(
    done.messages.filter((message) => message.role === "user"),
  ).toHaveLength(1);
  expect(recoverySystem).toContain("no action from it was applied");
});

it("retries a rejected multi-action reply without applying either proposed action", async () => {
  const f = fixture([]);
  let requests = 0;
  const manager = new PearlChatManager(
    f.store,
    f.data,
    () => ({ key: "fixture-key", model: "fixture-model", outputTokens: 8192 }),
    () => {},
    {
      complete: async ({ system }) => {
        requests++;
        if (requests === 1)
          throw new Error("Provider returned multiple actions");
        expect(system).toContain("no action from it was applied");
        return reply("I will take one action at a time.");
      },
    },
  );
  const chat = manager.create();
  manager.send(chat.id, "Inspect the project");
  const done = await settled(f.store, chat.id);
  expect(done.status).toBe("idle");
  expect(requests).toBe(2);
  expect(
    done.messages.filter((message) => message.role === "tool"),
  ).toHaveLength(0);
  expect(
    done.messages.filter((message) => message.role === "user"),
  ).toHaveLength(1);
});

it("recovers once when the provider returns no visible reply", async () => {
  const f = fixture([]);
  let requests = 0;
  const manager = new PearlChatManager(
    f.store,
    f.data,
    () => ({ key: "fixture-key", model: "fixture-model", outputTokens: 8192 }),
    () => {},
    {
      complete: async () => {
        requests++;
        if (requests === 1) throw new Error("Provider reply was empty");
        return reply("Here is the answer.");
      },
    },
  );
  const chat = manager.create();
  manager.send(chat.id, "What is next?");
  const done = await settled(f.store, chat.id);
  expect(done.status).toBe("idle");
  expect(requests).toBe(2);
  expect(
    done.messages.filter((message) => message.role === "user"),
  ).toHaveLength(1);
});

it("does not retain success when a subsequent check fails", () => {
  const f = fixture([]);
  const chat = f.manager.create();
  chat.activeUserMessageId = "request";
  chat.messages = [
    { id: "request", role: "user", text: "Build it", at: "now" },
    {
      id: "write",
      role: "tool",
      toolName: "create_file",
      text: '{"written":true,"path":"app.js"}',
      at: "now",
    },
    {
      id: "pass",
      role: "tool",
      toolName: "run_command",
      text: '{"exitCode":0}',
      at: "now",
    },
    {
      id: "fail",
      role: "tool",
      toolName: "run_command",
      text: '{"exitCode":1}',
      at: "now",
    },
  ];
  expect(currentTurnEvidence(chat).successfulCommandAfterLatestWrite).toBe(
    false,
  );
});

it("requires exact one-use approval for a live browser preview and validates its boundary", async () => {
  const checkLive = vi.fn();
  const check = vi.fn();
  const f = fixture(
    [
      tool("preview_app", {
        command: "node",
        args: ["server.js"],
        path: "//example.com/",
      }),
      tool(
        "preview_app",
        { command: "node", args: ["server.js"], path: "/" },
        "valid-preview",
      ),
      reply(
        "The preview was denied. I have not tested the application in a browser.",
      ),
    ],
    { check, checkLive },
  );
  const chat = f.manager.create();
  f.manager.chooseProject(chat.id, f.project);
  f.manager.approveProject(chat.id, true);
  f.manager.send(chat.id, "Preview the app");
  const pending = await settled(f.store, chat.id);
  expect(pending.status).toBe("awaiting_approval");
  expect(pending.pendingTool?.id).toBe("valid-preview");
  expect(
    pending.messages.some((m) => m.text.includes("Invalid preview path")),
  ).toBe(true);
  expect(checkLive).not.toHaveBeenCalled();
  f.manager.decideTool(chat.id, "valid-preview", false);
  const done = await settled(f.store, chat.id);
  expect(done.status).toBe("idle");
  expect(checkLive).not.toHaveBeenCalled();
  expect(() => f.manager.decideTool(chat.id, "valid-preview", true)).toThrow(
    "no longer current",
  );
});

it("retains a sourced working plan through restart and a long tool trajectory", async () => {
  const f = fixture([
    tool("update_plan", {
      expectedRevision: 0,
      objective: "Build the app",
      approach: "Serve it locally",
      requirements: ["Keep keyboard support."],
      steps: [{ text: "Verify keyboard behavior", status: "pending" }],
    }),
    reply("I have recorded the working plan."),
    reply("Keyboard support remains in scope."),
  ]);
  const chat = f.manager.create();
  f.manager.send(chat.id, "Keep keyboard support.");
  const planned = await settled(f.store, chat.id);
  expect(planned.work?.requirements[0].sourceUserMessageId).toBe(
    planned.activeUserMessageId,
  );
  const reopened = new PearlChatStore(join(f.data, "workspace.sqlite"));
  stores.push(reopened);
  expect(reopened.get(chat.id).work).toEqual(planned.work);
  for (let i = 0; i < 120; i++)
    planned.messages.push({
      id: `past-${i}`,
      role: "assistant",
      text: "Inspection output ".repeat(1000),
      at: "now",
    });
  f.store.save(planned);
  f.manager.send(chat.id, "What requirement are you retaining?");
  await settled(f.store, chat.id);
  expect(f.complete.mock.calls.at(-1)?.[0].system).toContain(
    "Keep keyboard support.",
  );
  expect(f.complete.mock.calls.at(-1)?.[0].system).toContain("not an approval");
});

it("retains repeated-action detection across a resumed stretch of the same request", async () => {
  const f = fixture([
    tool("list_files", { path: "" }, "again"),
    reply("This should not run"),
  ]);
  const chat = f.manager.create();
  f.manager.chooseProject(chat.id, f.project);
  f.manager.approveProject(chat.id, true);
  const saved = f.store.get(chat.id);
  saved.status = "paused";
  saved.activeUserMessageId = "user";
  saved.messages.push({
    id: "user",
    role: "user",
    text: "Inspect this directory",
    at: "now",
  });
  for (let i = 0; i < 3; i++)
    saved.messages.push(
      {
        id: `a${i}`,
        role: "assistant",
        text: "",
        toolName: "list_files",
        toolCallId: `c${i}`,
        arguments: '{"path":""}',
        at: "now",
      },
      {
        id: `t${i}`,
        role: "tool",
        text: "[]",
        toolName: "list_files",
        toolCallId: `c${i}`,
        at: "now",
      },
    );
  f.store.save(saved);
  f.manager.retry(chat.id);
  const paused = await settled(f.store, chat.id);
  expect(paused.pauseKind).toBe("repeated_action");
  expect(f.complete).toHaveBeenCalledTimes(1);
});

it("can verify existing work without manufacturing an unnecessary edit", async () => {
  const f = fixture([
    tool(
      "run_command",
      { command: "node", args: ["--test", "test.js"] },
      "check-only",
    ),
    tool(
      "complete_work",
      {
        status: "done",
        summary:
          "The existing implementation passed its checks. No files needed changing.",
      },
      "finish-check",
    ),
  ]);
  writeFileSync(
    join(f.project, "test.js"),
    "require('node:test')('existing behavior',()=>require('node:assert/strict').equal(2+2,4));",
  );
  const chat = f.manager.create();
  f.manager.chooseProject(chat.id, f.project);
  f.manager.approveProject(chat.id, true);
  f.manager.send(chat.id, "Verify the existing behavior");
  await settled(f.store, chat.id);
  f.manager.decideTool(chat.id, "check-only", true);
  const done = await settled(f.store, chat.id);
  expect(done.messages.at(-1)?.completion?.status).toBe("done");
  expect(done.messages.at(-1)?.evidence?.filesWritten).toBe(0);
  expect(done.messages.at(-1)?.evidence?.commandsCompleted).toBe(1);
});

it("uses one reviewed preview session for subsequent browser actions and closes it on completion", async () => {
  const observation = {
    title: "Preview",
    initialVisibleText: "Sign in",
    visibleText: "Signed in",
    controls: [],
    hiddenViolations: [],
    errors: [],
    blockedExternalRequests: 0,
    completedSteps: 1,
  };
  const close = vi.fn(async () => {});
  const start = vi.fn(async () => ({
    origin: "http://127.0.0.1:12345",
    active: () => true,
    close,
  }));
  const browser = {
    check: vi.fn(),
    checkLive: vi.fn(),
    openLive: vi.fn(async () => observation),
    continueLive: vi.fn(async () => ({
      ...observation,
      visibleText: "Saved entry",
    })),
    closeLive: vi.fn(),
  };
  const f = fixture(
    [
      tool(
        "preview_app",
        { command: "node", args: ["server.js"], path: "/" },
        "start-preview",
      ),
    ],
    browser,
    start,
  );
  const chat = f.manager.create();
  f.manager.chooseProject(chat.id, f.project);
  f.manager.approveProject(chat.id, true);
  f.manager.send(chat.id, "Check the real app");
  await settled(f.store, chat.id);
  expect(start).not.toHaveBeenCalled();
  let previewId = "";
  f.complete
    .mockImplementationOnce(async ({ messages }) => {
      previewId = JSON.parse(
        messages.find(
          (m) => m.role === "tool" && m.toolCallId === "start-preview",
        )!.text,
      ).previewId;
      return tool(
        "browser_check",
        { previewId, steps: [{ action: "click", selector: "#save" }] },
        "continue-preview",
      );
    })
    .mockImplementationOnce(async () => reply("I observed the saved entry."));
  f.manager.decideTool(chat.id, "start-preview", true);
  const done = await settled(f.store, chat.id);
  expect(start).toHaveBeenCalledTimes(1);
  expect(browser.openLive).toHaveBeenCalledTimes(1);
  expect(browser.continueLive).toHaveBeenCalledWith(
    previewId,
    undefined,
    [{ action: "click", selector: "#save" }],
    expect.any(AbortSignal),
  );
  expect(done.status).toBe("idle");
  expect(close).toHaveBeenCalledTimes(1);
  expect(browser.closeLive).toHaveBeenCalledWith(previewId);
});

it("refuses an unknown preview capability instead of accessing a local service", async () => {
  const continueLive = vi.fn();
  const f = fixture(
    [
      tool("browser_check", { previewId: "foreign-session" }),
      reply("That preview is unavailable."),
    ],
    { check: vi.fn(), continueLive },
  );
  const chat = f.manager.create();
  f.manager.chooseProject(chat.id, f.project);
  f.manager.approveProject(chat.id, true);
  f.manager.send(chat.id, "Continue preview");
  const done = await settled(f.store, chat.id);
  expect(continueLive).not.toHaveBeenCalled();
  expect(
    done.messages.some((m) => m.text.includes("does not belong to this chat")),
  ).toBe(true);
});

it("invalidates a running preview after source changes so stale server code cannot count as verification", async () => {
  const observation = {
    title: "App",
    initialVisibleText: "Old",
    visibleText: "Old",
    controls: [],
    hiddenViolations: [],
    errors: [],
    blockedExternalRequests: 0,
    completedSteps: 0,
  };
  const close = vi.fn(async () => {});
  const browser = {
    check: vi.fn(),
    checkLive: vi.fn(),
    openLive: vi.fn(async () => observation),
    continueLive: vi.fn(async () => observation),
    closeLive: vi.fn(),
  };
  const f = fixture(
    [
      tool(
        "preview_app",
        { command: "node", args: ["server.js"], path: "/" },
        "preview",
      ),
    ],
    browser,
    async () => ({
      origin: "http://127.0.0.1:12345",
      active: () => true,
      close,
    }),
  );
  const chat = f.manager.create();
  f.manager.chooseProject(chat.id, f.project);
  f.manager.approveProject(chat.id, true);
  f.manager.send(chat.id, "Repair the server");
  await settled(f.store, chat.id);
  let previewId = "";
  f.complete
    .mockImplementationOnce(async ({ messages }) => {
      previewId = JSON.parse(
        messages.find((m) => m.role === "tool" && m.toolCallId === "preview")!
          .text,
      ).previewId;
      return tool(
        "create_file",
        { path: "server.js", content: "// changed server" },
        "write-server",
      );
    })
    .mockImplementationOnce(async () =>
      tool("browser_check", { previewId }, "stale-preview"),
    )
    .mockImplementationOnce(async () =>
      tool(
        "complete_work",
        {
          status: "unverified",
          summary: "The server changed and needs a new preview.",
          remaining: "Verification",
        },
        "finish",
      ),
    );
  f.manager.decideTool(chat.id, "preview", true);
  const done = await settled(f.store, chat.id);
  expect(browser.continueLive).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledOnce();
  expect(
    done.messages.some(
      (m) =>
        m.toolCallId === "stale-preview" &&
        m.text.includes("Preview session ended"),
    ),
  ).toBe(true);
});

it("recognizes repeated reads when argument key ordering changes", async () => {
  const f = fixture([
    ...Array.from({ length: 4 }, (_, i) =>
      tool(
        "read_file",
        i % 2
          ? { lineCount: 1, startLine: 1, path: "note.txt" }
          : { path: "note.txt", startLine: 1, lineCount: 1 },
        `read-${i}`,
      ),
    ),
    reply("Finished reading"),
  ]);
  writeFileSync(join(f.project, "note.txt"), "unchanged\n");
  const chat = f.manager.create();
  f.manager.chooseProject(chat.id, f.project);
  f.manager.approveProject(chat.id, true);
  f.manager.send(chat.id, "Inspect the note");
  const done = await settled(f.store, chat.id);
  expect(done.status).toBe("paused");
  expect(done.pauseKind).toBe("repeated_action");
  expect(f.complete).toHaveBeenCalledTimes(4);
});

it("persists provider continuation through command approval and restart without exposing it to the Room", async () => {
  const continuation = {
    model: "fixture-model",
    reasoningContent: "opaque continuation\nunchanged",
  };
  const result = {
    ...tool(
      "run_command",
      { command: "node", args: ["--version"] },
      "reviewed",
    ),
    providerContinuation: continuation,
  };
  const f = fixture([result, reply("Version checked.")]);
  const chat = f.manager.create();
  f.manager.chooseProject(chat.id, f.project);
  f.manager.approveProject(chat.id, true);
  f.manager.send(chat.id, "Check the version");
  const waiting = await settled(f.store, chat.id);
  expect(
    waiting.messages.find((m) => m.toolCallId === "reviewed")
      ?.providerContinuation,
  ).toEqual(continuation);
  const reopened = new PearlChatStore(join(f.data, "workspace.sqlite"));
  stores.push(reopened);
  const recovered = reopened.get(chat.id);
  expect(
    recovered.messages.find((m) => m.toolCallId === "reviewed")
      ?.providerContinuation,
  ).toEqual(continuation);
  expect(JSON.stringify(roomChat(recovered))).not.toContain(
    "opaque continuation",
  );
  expect(JSON.stringify(roomChat(recovered))).not.toContain(
    "providerContinuation",
  );
  f.manager.decideTool(chat.id, "reviewed", true);
  await settled(f.store, chat.id);
  expect(
    f.complete.mock.calls[1][0].messages.find(
      (m) => m.toolCallId === "reviewed",
    )?.providerContinuation,
  ).toEqual(continuation);
});

it("identifies a missing patch revision and leaves the file untouched", async () => {
  const f = fixture([
    tool("read_file", { path: "note.txt" }, "read"),
    tool(
      "apply_patch",
      { path: "note.txt", edits: [{ oldText: "before", newText: "after" }] },
      "patch",
    ),
    reply("The patch was not applied."),
  ]);
  writeFileSync(join(f.project, "note.txt"), "before");
  const chat = f.manager.create();
  f.manager.chooseProject(chat.id, f.project);
  f.manager.approveProject(chat.id, true);
  f.manager.send(chat.id, "Edit the note");
  const done = await settled(f.store, chat.id);
  expect(readFileSync(join(f.project, "note.txt"), "utf8")).toBe("before");
  expect(
    done.messages.find((m) => m.role === "tool" && m.toolCallId === "patch")
      ?.text,
  ).toContain("expectedSha256");
});
