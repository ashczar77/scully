// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PearlChat } from "../src/shared/pearl-chat";
import {
  currentTurnEvidence,
  needsPostEditCheck,
} from "../src/shared/pearl-chat";
import { bindProjectWorkspace } from "../src/main/project-workspace";
import { PearlSandboxService } from "../src/main/pearl-sandbox";
import { PearlChatManager } from "../src/main/pearl-chat-manager";
import { PearlChatStore } from "../src/main/pearl-chat-store";
import type { sandboxClient } from "../src/engine/sandbox";
import {
  SandboxRequestError,
  SandboxWorkspaceMissingError,
} from "../src/engine/sandbox";
import type { CollaborationWorkspace } from "../src/main/collaboration-workspace";
import type { PearlModel } from "../src/engine/pearl-model";
import { PearlWebAccess, type PearlWebProvider } from "../src/main/pearl-web";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "scully-sandbox-"));
  roots.push(root);
  const data = join(root, "data");
  const project = join(root, "project");
  mkdirSync(data);
  mkdirSync(project);
  writeFileSync(join(project, "main.ts"), "export const value = 1;\n");
  writeFileSync(join(project, ".env"), "TOKEN=private");
  const binding = bindProjectWorkspace(project, "existing", data);
  const chat = {
    id: randomUUID(),
    status: "idle",
    questions: [],
    messages: [],
    project: { ...binding, approved: true },
    readRevisions: {},
  } as unknown as PearlChat;
  const images = new Map<string, Record<string, string>>();
  const base = randomUUID();
  images.set(base, {});
  const client = {
    images: async () => ({
      images: [{ uuid: base, tag: "test" }],
      limited: false,
    }),
    listFiles: async (id: string, directory = "/workspace") =>
      Object.keys(images.get(id) || {})
        .filter((path) =>
          directory === "/workspace"
            ? !path.includes("/")
            : path.startsWith(`${directory.slice(11)}/`),
        )
        .map((name) => ({
          name,
          directory: false,
          regular: true,
          symlink: false,
          size: 1,
        })),
    downloadFile: async (id: string, path: string) => {
      const value = images.get(id)?.[path];
      if (value === undefined) throw new Error("missing remote file");
      return value;
    },
  } as unknown as ReturnType<typeof sandboxClient>;
  const workspace = {
    prepare: async (
      files: { path: string; content: string }[],
      imageId: string,
    ) => {
      const next = randomUUID();
      images.set(next, {
        ...images.get(imageId),
        ...Object.fromEntries(files.map((file) => [file.path, file.content])),
      });
      return next;
    },
    write: async (imageId: string, path: string, content: string) => {
      const next = randomUUID();
      images.set(next, { ...images.get(imageId), [path]: content });
      return next;
    },
    check: async () => ({
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      passed: true,
      unknown: false,
    }),
  } as unknown as CollaborationWorkspace;
  const service = new PearlSandboxService(
    data,
    (() => client) as typeof sandboxClient,
    () => workspace,
  );
  service.configure("test-key", "test-project");
  return { chat, service, project, data, base, images, client, workspace };
}

it("requires explicit upload review and excludes private paths", async () => {
  const f = fixture();
  await f.service.images();
  f.service.prepare(f.chat, f.base);
  expect(f.chat.sandbox?.manifest.map((file) => file.path)).toEqual([
    "main.ts",
  ]);
  expect(f.chat.sandbox?.excluded).not.toContain(".env");
  expect(f.images.get(f.base)).toEqual({});
  await f.service.start(f.chat, () => {});
  expect(f.chat.sandbox?.status).toBe("ready");
  expect(readFileSync(join(f.project, "main.ts"), "utf8")).toContain(
    "value = 1",
  );
});

it("lists approved Sandbox files in pages and rejects invalid offsets", async () => {
  const f = fixture();
  for (let index = 0; index < 502; index++)
    writeFileSync(
      join(f.project, `file-${String(index).padStart(3, "0")}.txt`),
      "x",
    );
  await f.service.images();
  f.service.prepare(f.chat, f.base);
  await f.service.start(f.chat, () => {});
  const first = await f.service.list(f.chat, "", 0);
  expect(first.entries).toHaveLength(500);
  expect(first.nextOffset).toBe(500);
  const second = await f.service.list(f.chat, "", 500);
  expect(second.entries.map((entry) => entry.name)).toEqual([
    "file-500.txt",
    "file-501.txt",
    "main.ts",
  ]);
  expect(second.nextOffset).toBeNull();
  await expect(f.service.list(f.chat, "", -1)).rejects.toThrow(/offset/);
  await expect(f.service.list(f.chat, ".env", 0)).rejects.toThrow();
});

it("searches unchanged snapshot text locally and reads changed remote files", async () => {
  const f = fixture();
  await f.service.images();
  f.service.prepare(f.chat, f.base);
  await f.service.start(f.chat, () => {});
  const download = vi.spyOn(f.client, "downloadFile");
  const unchanged = await f.service.search(f.chat, "", "value");
  expect(unchanged.matches).toEqual([
    { path: "main.ts", line: 1, text: "export const value = 1;" },
  ]);
  expect(download).not.toHaveBeenCalled();
  const read = await f.service.read(f.chat, "main.ts");
  await f.service.write(
    f.chat,
    "main.ts",
    "export const value = 2;\n",
    read.sha256,
    () => {},
  );
  download.mockClear();
  const changed = await f.service.search(f.chat, "", "value = 2");
  expect(changed.matches).toEqual([
    { path: "main.ts", line: 1, text: "export const value = 2;" },
  ]);
  expect(download).toHaveBeenCalledWith(
    f.chat.sandbox?.branches[0].headImage,
    "main.ts",
  );
});

it("inspects the saved remote branch without granting sync review or trusting a changed remote file", async () => {
  const f = fixture();
  await f.service.images();
  f.service.prepare(f.chat, f.base);
  await f.service.start(f.chat, () => {});
  const initial = f.service.snapshotView(f.chat);
  expect(initial.files).toEqual([
    { path: "main.ts", changed: false, sha256: expect.any(String) },
  ]);
  expect((await f.service.inspectFile(f.chat, "main.ts")).after).toBe(
    "export const value = 1;\n",
  );
  expect(f.chat.sandbox?.pendingSync).toBeUndefined();
  await expect(
    f.service.inspectFile(f.chat, "../private.txt"),
  ).rejects.toThrow();
  await expect(f.service.inspectFile(f.chat, ".env")).rejects.toThrow();
  f.chat.project!.approved = false;
  await expect(f.service.inspectFile(f.chat, "main.ts")).rejects.toThrow(
    /Approve the project folder/,
  );
  f.chat.project!.approved = true;
  const selected = f.chat.sandbox!.branches[0];
  f.images.get(selected.headImage)!["main.ts"] = "remote tamper";
  await expect(f.service.inspectFile(f.chat, "main.ts")).rejects.toThrow(
    /differs from the saved branch revision/,
  );
  expect(f.chat.sandbox?.pendingSync).toBeUndefined();
});

it("keeps saved Sandbox inspection available during Pearl's turn without allowing mutations", async () => {
  const f = fixture();
  const store = new PearlChatStore(join(f.data, "chats.sqlite"));
  try {
    const manager = new PearlChatManager(
      store,
      f.data,
      () => null,
      () => {},
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      f.service,
    );
    await f.service.images();
    f.service.prepare(f.chat, f.base);
    await f.service.start(f.chat, () => {});
    f.chat.status = "running";
    store.save(f.chat);

    expect(manager.sandboxSnapshot(f.chat.id).files).toEqual([
      { path: "main.ts", changed: false, sha256: expect.any(String) },
    ]);
    await expect(
      manager.inspectSandboxFile(f.chat.id, "main.ts"),
    ).resolves.toMatchObject({
      after: "export const value = 1;\n",
    });
    await expect(
      manager.inspectSandboxFile(f.chat.id, ".env"),
    ).rejects.toThrow();
    expect(() => manager.forkSandbox(f.chat.id, "blocked")).toThrow(
      /Wait for Pearl's current action/,
    );
    f.chat.project!.approved = false;
    store.save(f.chat);
    expect(() => manager.sandboxSnapshot(f.chat.id)).toThrow(
      /Approve the project folder/,
    );
  } finally {
    store.close();
  }
});

it("does not query a stale Sandbox after the selected project changes", async () => {
  const f = fixture();
  await f.service.images();
  f.service.prepare(f.chat, f.base);
  const other = join(f.project, "..", "other-project");
  mkdirSync(other);
  writeFileSync(join(other, "main.ts"), "export const other = true;\n");
  f.chat.project = {
    ...bindProjectWorkspace(other, "existing", f.data),
    approved: true,
  };
  expect(() => f.service.snapshotView(f.chat)).not.toThrow();
  expect(f.service.snapshotView(f.chat).files).toEqual([]);
});

it("clears a prepared upload when the chat selects a different project", async () => {
  const f = fixture();
  const store = new PearlChatStore(join(f.data, "project-change.sqlite"));
  try {
    const manager = new PearlChatManager(
      store,
      f.data,
      () => null,
      () => {},
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      f.service,
    );
    await f.service.images();
    f.service.prepare(f.chat, f.base);
    store.save(f.chat);
    const other = join(f.project, "..", "replacement-project");
    mkdirSync(other);
    const changed = manager.chooseProject(f.chat.id, other);
    expect(changed.sandbox).toBeUndefined();
    expect(changed.project?.approved).toBe(false);
    manager.approveProject(f.chat.id, true);
    expect(manager.sandboxSnapshot(f.chat.id).files).toEqual([]);
  } finally {
    store.close();
  }
});

it("rejects unlisted images and keeps secret or linked files out of the snapshot", async () => {
  const f = fixture();
  writeFileSync(
    join(f.project, "private.txt"),
    "api_key='abcdefghijklmnop123456'\n",
  );
  symlinkSync(join(f.project, "main.ts"), join(f.project, "linked.ts"));
  await f.service.images();
  expect(() => f.service.prepare(f.chat, randomUUID())).toThrow(
    /current Sandbox catalog/,
  );
  f.service.prepare(f.chat, f.base);
  expect(f.chat.sandbox?.manifest.map((file) => file.path)).toEqual([
    "main.ts",
  ]);
  expect(f.chat.sandbox?.excluded).toContain("private.txt");
  expect(f.images.get(f.base)).toEqual({});
});

it("includes ordinary filenames with spaces in the remote review", async () => {
  const f = fixture();
  writeFileSync(
    join(f.project, "space name.ts"),
    "export const valid = true;\n",
  );
  await f.service.images();
  f.service.prepare(f.chat, f.base);
  expect(f.chat.sandbox?.manifest.map((file) => file.path)).toEqual([
    "main.ts",
    "space name.ts",
  ]);
  expect(f.chat.sandbox?.excluded).not.toContain("space name.ts");
});

it("includes source files larger than one megabyte and tracked configuration files", async () => {
  const f = fixture();
  writeFileSync(join(f.project, "large.ts"), "x".repeat(1_200_000));
  writeFileSync(join(f.project, ".prettierrc"), "{}\n");
  await f.service.images();
  f.service.prepare(f.chat, f.base);
  expect(f.chat.sandbox?.manifest.map((file) => file.path)).toEqual([
    ".prettierrc",
    "large.ts",
    "main.ts",
  ]);
  await f.service.start(f.chat, () => {});
  expect((await f.service.read(f.chat, "large.ts")).content).toHaveLength(
    1_200_000,
  );
});

it("prepares a project with more than five hundred source files", async () => {
  const f = fixture();
  for (let index = 0; index < 501; index++)
    writeFileSync(
      join(f.project, `file-${index}.ts`),
      `export const n = ${index};\n`,
    );
  await f.service.images();
  f.service.prepare(f.chat, f.base);
  expect(f.chat.sandbox?.manifest).toHaveLength(502);
});

it("recovers an uncertain workspace initialization before retrying upload", async () => {
  const f = fixture();
  const operation = randomUUID();
  const initialized = randomUUID();
  f.client.listFiles = async (image) => {
    if (image === f.base) throw new SandboxWorkspaceMissingError();
    return [];
  };
  f.workspace.prepare = async (_files, _image, _actor, _revision, publish) => {
    publish({
      id: randomUUID(),
      actor: "pearl",
      stage: "bootstrap",
      inputRevision: "reviewed",
      status: "submitted",
      remoteId: operation,
      resultImageId: null,
      at: new Date().toISOString(),
    });
    throw new SandboxRequestError(false);
  };
  f.client.status = async () =>
    ({
      terminal: true,
      commandPassed: true,
      resultImage: initialized,
    }) as Awaited<ReturnType<typeof f.client.status>>;
  f.client.inspectImage = async () => {};
  await f.service.images();
  f.service.prepare(f.chat, f.base);
  await expect(f.service.start(f.chat, () => {})).rejects.toThrow(
    /status could not be read/,
  );
  expect(f.chat.sandbox?.status).toBe("uncertain");
  await f.service.reconcile(f.chat);
  expect(f.chat.sandbox?.status).toBe("prepared");
  expect(f.chat.sandbox?.baseImage).toBe(initialized);
});

it("counts only a successful remote check after the latest Sandbox edit", () => {
  const f = fixture();
  f.chat.activeUserMessageId = "request";
  f.chat.messages = [
    { id: "request", role: "user", text: "edit", at: "now" },
    {
      id: "write",
      role: "tool",
      toolName: "write_file",
      text: JSON.stringify({ path: "main.ts", written: true }),
      at: "now",
    },
    {
      id: "failed",
      role: "tool",
      toolName: "sandbox_run_check",
      text: JSON.stringify({ exitCode: 1 }),
      at: "now",
    },
  ];
  expect(currentTurnEvidence(f.chat).successfulCommandAfterLatestWrite).toBe(
    false,
  );
  f.chat.sandbox = { active: true } as PearlChat["sandbox"];
  expect(currentTurnEvidence(f.chat).executionMode).toBe("sandbox");
  expect(needsPostEditCheck(f.chat)).toBe(true);
  f.chat.messages.push({
    id: "passed",
    role: "tool",
    toolName: "sandbox_run_check",
    text: JSON.stringify({ exitCode: 0 }),
    at: "now",
  });
  expect(currentTurnEvidence(f.chat).successfulCommandAfterLatestWrite).toBe(
    true,
  );
  expect(needsPostEditCheck(f.chat)).toBe(false);
});

it("exposes remote file and check tools while a Sandbox task is active", async () => {
  const f = fixture();
  const store = new PearlChatStore(join(f.data, "chats.sqlite"));
  try {
    const manager = new PearlChatManager(
      store,
      f.data,
      () => null,
      () => {},
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      f.service,
    );
    await f.service.images();
    f.service.prepare(f.chat, f.base);
    await f.service.start(f.chat, () => {});
    const names = (
      manager as unknown as { allowedTools: (chat: PearlChat) => string[] }
    ).allowedTools(f.chat);
    expect(names).toContain("sandbox_run_check");
    expect(names).toContain("sandbox_fork");
    expect(names).toContain("write_file");
    expect(names).not.toContain("run_command");
    expect(names).not.toContain("edit_files");
    expect(names).not.toContain("start_terminal");
    expect(names).not.toContain("browser_check");
  } finally {
    store.close();
  }
});

it("can search current public information in Sandbox without sending project files", async () => {
  const f = fixture();
  const store = new PearlChatStore(join(f.data, "sandbox-web.sqlite"));
  const provider: PearlWebProvider = {
    search: vi.fn(async () => [
      {
        title: "Current forecast",
        url: "https://example.org/weather",
        excerpt: "Current conditions are clear.",
      },
    ]),
    read: vi.fn(async () => "Current conditions are clear."),
  };
  const responses = [
    {
      kind: "tool" as const,
      text: "",
      call: {
        id: "private-search",
        name: "search_web",
        arguments: JSON.stringify({ query: "api_key=private-value" }),
      },
    },
    {
      kind: "tool" as const,
      text: "",
      call: {
        id: "search",
        name: "search_web",
        arguments: JSON.stringify({ query: "New York weather today" }),
      },
    },
    {
      kind: "reply" as const,
      text: "Current conditions are clear. [Forecast](https://example.org/weather)",
    },
  ];
  const complete = vi.fn(
    async (_input: Parameters<PearlModel["complete"]>[0]) => {
      const next = responses.shift();
      if (!next) throw new Error("No model fixture response");
      return next;
    },
  );
  try {
    const manager = new PearlChatManager(
      store,
      f.data,
      () => ({
        key: "fixture-key",
        model: "fixture-model",
        outputTokens: 8192,
      }),
      () => {},
      { complete } as PearlModel,
      undefined,
      undefined,
      undefined,
      undefined,
      new PearlWebAccess(provider),
      () => true,
      undefined,
      undefined,
      undefined,
      f.service,
    );
    await f.service.images();
    f.service.prepare(f.chat, f.base);
    await f.service.start(f.chat, () => {});
    store.save(f.chat);
    manager.send(f.chat.id, "What is the weather today in New York?");
    await vi.waitFor(() => expect(store.get(f.chat.id).status).toBe("idle"));
    expect(complete.mock.calls[0][0].allowedTools).toContain("search_web");
    expect(complete.mock.calls[0][0].allowedTools).not.toContain("run_command");
    expect(provider.search).toHaveBeenCalledWith(
      "New York weather today",
      expect.any(AbortSignal),
    );
    expect(provider.search).toHaveBeenCalledTimes(1);
    expect(
      store
        .get(f.chat.id)
        .messages.some((message) =>
          message.text.includes("Invalid web search query"),
        ),
    ).toBe(true);
    expect(store.get(f.chat.id).messages.at(-1)?.text).toContain(
      "https://example.org/weather",
    );
  } finally {
    store.close();
  }
});

it("keeps the selected Sandbox active for follow-up turns in the same chat", async () => {
  const f = fixture();
  const store = new PearlChatStore(join(f.data, "follow-up.sqlite"));
  try {
    const complete = vi.fn(
      async (_input: Parameters<PearlModel["complete"]>[0]) => ({
        kind: "reply" as const,
        text: "The branch is ready.",
      }),
    );
    const manager = new PearlChatManager(
      store,
      f.data,
      () => ({
        key: "fixture-key",
        model: "fixture-model",
        outputTokens: 8192,
      }),
      () => {},
      { complete } as PearlModel,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      f.service,
    );
    await f.service.images();
    f.service.prepare(f.chat, f.base);
    await f.service.start(f.chat, () => {});
    store.save(f.chat);
    manager.send(f.chat.id, "Inspect the branch");
    await vi.waitFor(() => expect(store.get(f.chat.id).status).toBe("idle"));
    expect(store.get(f.chat.id).sandbox?.active).toBe(true);
    manager.send(f.chat.id, "Answer a follow-up about this project");
    await vi.waitFor(() => expect(complete).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(store.get(f.chat.id).status).toBe("idle"));
    expect(complete.mock.calls[1][0].allowedTools).toContain(
      "sandbox_run_check",
    );
  } finally {
    store.close();
  }
});

it("resumes an older synchronized checkpoint only when local files still match", async () => {
  const f = fixture();
  await f.service.images();
  f.service.prepare(f.chat, f.base);
  await f.service.start(f.chat, () => {});
  const branchId = f.chat.sandbox!.activeBranchId!;
  const selected = f.chat.sandbox!.branches[0];
  selected.syncedHead = selected.headImage;
  f.service.leave(f.chat);
  writeFileSync(join(f.project, "main.ts"), "local change\n");
  expect(() => f.service.switchBranch(f.chat, branchId)).toThrow(
    /Local project differs/,
  );
  expect(f.chat.sandbox?.active).toBe(false);
  writeFileSync(join(f.project, "main.ts"), "export const value = 1;\n");
  f.service.switchBranch(f.chat, branchId);
  expect(f.chat.sandbox?.active).toBe(true);
  expect(f.chat.sandbox?.activeBranchId).not.toBe(branchId);
  expect(f.chat.sandbox?.branches[0].syncedHead).toBeUndefined();
});

it("forks independent checkpoints and binds writes and checks to the selected revision", async () => {
  const f = fixture();
  await f.service.images();
  f.service.prepare(f.chat, f.base);
  await f.service.start(f.chat, () => {});
  const original = f.chat.sandbox!.activeBranchId!;
  f.service.fork(f.chat, "experiment");
  const read = await f.service.read(f.chat, "main.ts");
  await f.service.write(
    f.chat,
    "main.ts",
    "export const value = 2;\n",
    read.sha256,
    () => {},
  );
  expect((await f.service.read(f.chat, "main.ts")).content).toContain(
    "value = 2",
  );
  const newHead = f.chat.sandbox!.branches[1].headImage;
  await expect(
    f.service.check(
      f.chat,
      "node",
      ["--version"],
      f.chat.sandbox!.branches[0].headImage,
      () => {},
    ),
  ).rejects.toThrow(/changed/);
  expect(
    (await f.service.check(f.chat, "node", ["--version"], newHead, () => {}))
      .passed,
  ).toBe(true);
  f.service.switchBranch(f.chat, original);
  expect((await f.service.read(f.chat, "main.ts")).content).toContain(
    "value = 1",
  );
  expect(readFileSync(join(f.project, "main.ts"), "utf8")).toContain(
    "value = 1",
  );
});

it("recovers an uncertain remote write only after inspecting its saved result", async () => {
  const f = fixture();
  await f.service.images();
  f.service.prepare(f.chat, f.base);
  await f.service.start(f.chat, () => {});
  const before = await f.service.read(f.chat, "main.ts");
  const savedHead = randomUUID();
  const remoteId = randomUUID();
  f.workspace.write = async (
    imageId,
    path,
    content,
    _actor,
    _revision,
    update,
  ) => {
    f.images.set(savedHead, { ...f.images.get(imageId!), [path]: content });
    update({ stage: "upload", status: "submitted", remoteId } as Parameters<
      typeof update
    >[0]);
    throw new SandboxRequestError(false);
  };
  (f.client as unknown as { status: (id: string) => Promise<unknown> }).status =
    async (id) => {
      expect(id).toBe(remoteId);
      return { terminal: true, commandPassed: true, resultImage: savedHead };
    };
  await expect(
    f.service.write(
      f.chat,
      "main.ts",
      "export const value = 4;\n",
      before.sha256,
      () => {},
    ),
  ).rejects.toThrow(/status could not be read/i);
  expect(f.chat.sandbox?.status).toBe("uncertain");
  expect(f.chat.sandbox?.branches[0].headImage).not.toBe(savedHead);
  await f.service.reconcile(f.chat);
  expect(f.chat.sandbox?.status).toBe("ready");
  expect((await f.service.read(f.chat, "main.ts")).content).toContain(
    "value = 4",
  );
  expect(readFileSync(join(f.project, "main.ts"), "utf8")).toContain(
    "value = 1",
  );
});

it("rejects local conflicts and consumes the exact sync approval once", async () => {
  const f = fixture();
  await f.service.images();
  f.service.prepare(f.chat, f.base);
  await f.service.start(f.chat, () => {});
  const before = await f.service.read(f.chat, "main.ts");
  await f.service.write(
    f.chat,
    "main.ts",
    "export const value = 2;\n",
    before.sha256,
    () => {},
  );
  await f.service.reviewSync(f.chat);
  const token = f.chat.sandbox!.pendingSync!.token;
  await expect(f.service.approveSync(f.chat, token)).rejects.toThrow(
    /Open each/,
  );
  await f.service.fileReview(f.chat, "main.ts");
  writeFileSync(join(f.project, "main.ts"), "manual edit\n");
  await expect(f.service.approveSync(f.chat, token)).rejects.toThrow(
    /Local file changed/,
  );
  expect(readFileSync(join(f.project, "main.ts"), "utf8")).toBe(
    "manual edit\n",
  );
  await expect(f.service.approveSync(f.chat, token)).rejects.toThrow(
    /already used/,
  );
});

it("synchronizes only reviewed branch changes and rejects reuse of the approval", async () => {
  const f = fixture();
  await f.service.images();
  f.service.prepare(f.chat, f.base);
  await f.service.start(f.chat, () => {});
  const before = await f.service.read(f.chat, "main.ts");
  await f.service.write(
    f.chat,
    "main.ts",
    "export const value = 3;\n",
    before.sha256,
    () => {},
  );
  f.service.leave(f.chat);
  await f.service.reviewSync(f.chat);
  const token = f.chat.sandbox!.pendingSync!.token;
  await f.service.fileReview(f.chat, "main.ts");
  await f.service.approveSync(f.chat, token);
  expect(readFileSync(join(f.project, "main.ts"), "utf8")).toBe(
    "export const value = 3;\n",
  );
  expect(readFileSync(join(f.project, ".env"), "utf8")).toBe("TOKEN=private");
  await expect(f.service.approveSync(f.chat, token)).rejects.toThrow(
    /already used/,
  );
  expect(f.chat.sandbox?.branches).toHaveLength(1);
  expect(f.chat.sandbox?.active).toBe(false);
  f.service.switchBranch(f.chat, f.chat.sandbox!.activeBranchId);
  const next = await f.service.read(f.chat, "main.ts");
  await f.service.write(
    f.chat,
    "main.ts",
    "export const value = 4;\n",
    next.sha256,
    () => {},
  );
  await f.service.reviewSync(f.chat);
  expect(f.chat.sandbox?.pendingSync?.files).toMatchObject([
    {
      path: "main.ts",
      beforeBytes: Buffer.byteLength("export const value = 3;\n"),
    },
  ]);
});
