import React from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { PearlApp } from "../src/renderer/PearlApp";
import type { DesktopAPI } from "../src/shared/contracts";
import type { PearlChat } from "../src/shared/pearl-chat";

it("shows project selection on the landing page and opens the picker for a fresh chat", async () => {
  const created = {
    id: "11111111-1111-1111-1111-111111111111",
    title: "New chat",
    createdAt: "now",
    updatedAt: "now",
    status: "idle",
    questions: [],
    messages: [],
  } as PearlChat;
  const createPearlChat = vi.fn(async () => created);
  const choosePearlProject = vi.fn(
    async () =>
      ({
        ...created,
        project: { path: "/work/demo", dev: 1, ino: 1, approved: false },
      }) as PearlChat,
  );
  const api = {
    listPearlChats: vi.fn(async () => []),
    session: vi.fn(async () => ({ configured: true })),
    createPearlChat,
    choosePearlProject,
    onPearlChatUpdate: vi.fn(() => () => {}),
  } as unknown as DesktopAPI;
  render(<PearlApp api={api} />);
  fireEvent.click(
    screen.getByRole("button", { name: "Choose a project folder" }),
  );
  await waitFor(() =>
    expect(choosePearlProject).toHaveBeenCalledWith(undefined),
  );
  expect(createPearlChat).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: "Change project: demo" }),
  ).toBeInTheDocument();
});

it("connects a remote MCP server in Settings without displaying its bearer token", async () => {
  const connectRemoteMcp = vi.fn(async () => ({
    connected: true,
    endpoint: "https://example.com/mcp",
    revision: "rev-1",
    tools: [
      {
        name: "sample_lookup",
        description: "Find samples",
        inputSchema: { type: "object" },
      },
    ],
  }));
  const remoteMcpInfo = vi
    .fn()
    .mockResolvedValueOnce({ connected: false, tools: [] })
    .mockResolvedValue({
      connected: true,
      endpoint: "https://example.com/mcp",
      revision: "rev-1",
      tools: [
        {
          name: "sample_lookup",
          description: "Find samples",
          inputSchema: { type: "object" },
        },
      ],
    });
  const api = {
    listPearlChats: vi.fn(async () => []),
    session: vi.fn(async () => ({
      configured: false,
      model: "",
      outputTokens: 2048,
    })),
    webSearchInfo: vi.fn(async () => ({ configured: false })),
    remoteMcpInfo,
    connectRemoteMcp,
    onPearlChatUpdate: vi.fn(() => () => {}),
  } as unknown as DesktopAPI;
  render(<PearlApp api={api} />);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  const panel = screen.getByRole("main");
  fireEvent.click(
    within(panel).getByRole("button", { name: "App & connection" }),
  );
  fireEvent.change(within(panel).getByLabelText("Server endpoint"), {
    target: { value: "https://example.com/mcp" },
  });
  fireEvent.change(within(panel).getByLabelText("Bearer token (optional)"), {
    target: { value: "secret-token" },
  });
  fireEvent.click(
    within(panel).getByRole("button", { name: "Connect remote server" }),
  );
  await waitFor(() =>
    expect(connectRemoteMcp).toHaveBeenCalledWith(
      "https://example.com/mcp",
      "secret-token",
    ),
  );
  await waitFor(() =>
    expect(within(panel).getByLabelText("Bearer token (optional)")).toHaveValue(
      "",
    ),
  );
  expect(screen.queryByText("secret-token")).toBeNull();
  expect(
    within(panel).getByText(/results enter Pearl's chat context/),
  ).toBeInTheDocument();
});

it("explains outbound web queries and keeps the search key out of the Room", async () => {
  const configureWebSearch = vi.fn(async () => ({ configured: true }));
  const api = {
    listPearlChats: vi.fn(async () => []),
    session: vi.fn(async () => ({ configured: true, model: "fixture" })),
    webSearchInfo: vi.fn(async () => ({ configured: false })),
    configureWebSearch,
    disconnectWebSearch: vi.fn(async () => ({ configured: false })),
    onPearlChatUpdate: vi.fn(() => () => {}),
  } as unknown as DesktopAPI;
  render(<PearlApp api={api} />);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  const panel = screen.getByRole("main");
  fireEvent.click(
    within(panel).getByRole("button", { name: "App & connection" }),
  );
  expect(
    within(panel).getByText(/send short search queries/i),
  ).toBeInTheDocument();
  fireEvent.change(within(panel).getByLabelText("Tavily API key"), {
    target: { value: "tvly-fixture-secret" },
  });
  fireEvent.click(
    within(panel).getByRole("button", { name: "Connect web search" }),
  );
  await waitFor(() =>
    expect(configureWebSearch).toHaveBeenCalledWith("tvly-fixture-secret"),
  );
  expect(screen.queryByText("tvly-fixture-secret")).toBeNull();
  expect(within(panel).getByLabelText("Tavily API key")).toHaveValue("");
});

it("requires an explicit fallback selection and identifies fallback replies", async () => {
  const configureSession = vi.fn(async () => ({
    configured: true,
    model: "zai-org/GLM-5.3-Flash",
    fallbackModel: "Qwen/Qwen3-235B-A22B-Instruct-2507",
    outputTokens: 16384,
  }));
  const chat: PearlChat = {
    id: "12345678-1234-1234-1234-123456789abc",
    title: "Simple question",
    createdAt: "2026-10-23T00:00:00.000Z",
    updatedAt: "2026-10-23T00:00:00.000Z",
    status: "idle",
    questions: [],
    messages: [
      {
        id: "user-one",
        role: "user",
        text: "What is 5 + 7?",
        at: "2026-10-23T00:00:00.000Z",
      },
      {
        id: "answer-one",
        role: "assistant",
        text: "12",
        fallbackModel: "Qwen/Qwen3-235B-A22B-Instruct-2507",
        at: "2026-10-23T00:00:01.000Z",
      },
    ],
  };
  const api = {
    listPearlChats: vi.fn(async () => []),
    session: vi.fn(async () => ({
      configured: false,
      model: "",
      outputTokens: 2048,
    })),
    configureSession,
    onPearlChatUpdate: vi.fn(() => () => {}),
    createPearlChat: vi.fn(async () => chat),
  } as unknown as DesktopAPI;
  render(<PearlApp api={api} />);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  const panel = screen.getByRole("main");
  fireEvent.click(
    within(panel).getByRole("button", { name: /Primary model:/ }),
  );
  fireEvent.click(screen.getByRole("option", { name: "GLM 5.3 Flash" }));
  const fallback = within(panel).getByRole("checkbox", {
    name: /Use a fallback/,
  });
  expect(fallback).not.toBeChecked();
  fireEvent.click(fallback);
  fireEvent.click(
    within(panel).getByRole("button", { name: /Fallback model:/ }),
  );
  fireEvent.click(screen.getByRole("option", { name: "Qwen3 235B Instruct" }));
  fireEvent.click(
    within(panel).getByRole("button", { name: "App & connection" }),
  );
  fireEvent.change(within(panel).getByLabelText("Nebius API key"), {
    target: { value: "fixture-key" },
  });
  fireEvent.click(
    within(panel).getByRole("button", { name: "Connect Nebius" }),
  );
  await waitFor(() =>
    expect(configureSession).toHaveBeenCalledWith({
      key: "fixture-key",
      model: "zai-org/GLM-5.3-Flash",
      fallbackModel: "Qwen/Qwen3-235B-A22B-Instruct-2507",
      outputTokens: 16384,
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Chats" }));
  fireEvent.click(screen.getByRole("button", { name: "New chat" }));
  expect(await screen.findByText("12")).toBeInTheDocument();
  expect(
    screen.getByText("Fallback: Qwen/Qwen3-235B-A22B-Instruct-2507"),
  ).toBeInTheDocument();
});

it("switches a connected primary model without asking for the key and rejects an identical fallback", async () => {
  const selectPearlModels = vi.fn(async () => ({
    configured: true,
    model: "Qwen/Qwen3-235B-A22B-Instruct-2507",
    outputTokens: 16384,
  }));
  const api = {
    listPearlChats: vi.fn(async () => []),
    session: vi.fn(async () => ({
      configured: true,
      model: "zai-org/GLM-5.3-Flash",
      fallbackModel: "Qwen/Qwen3-235B-A22B-Instruct-2507",
      outputTokens: 16384,
    })),
    listPearlModels: vi.fn(async () => [
      { id: "zai-org/GLM-5.3-Flash", name: "GLM 5.3 Flash" },
      {
        id: "Qwen/Qwen3-235B-A22B-Instruct-2507",
        name: "Qwen3 235B Instruct",
      },
    ]),
    selectPearlModels,
    onPearlChatUpdate: vi.fn(() => () => {}),
  } as unknown as DesktopAPI;
  render(<PearlApp api={api} />);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  expect(screen.queryByRole("textbox", { name: "Message Pearl" })).toBeNull();
  fireEvent.click(
    await screen.findByRole("button", { name: /Primary model: GLM 5.3 Flash/ }),
  );
  fireEvent.click(screen.getByRole("option", { name: "Qwen3 235B Instruct" }));
  fireEvent.click(screen.getByRole("button", { name: "Save model choice" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Choose a different fallback model",
  );
  expect(selectPearlModels).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox", { name: /Use a fallback/ }));
  fireEvent.click(screen.getByRole("button", { name: "Save model choice" }));
  await waitFor(() =>
    expect(selectPearlModels).toHaveBeenCalledWith({
      model: "Qwen/Qwen3-235B-A22B-Instruct-2507",
    }),
  );
  expect(screen.getByText(/Model choice saved/)).toBeInTheDocument();
  expect(screen.queryByLabelText("Nebius API key")).toBeNull();
});

it("opens a fresh Room chat without task or team controls", async () => {
  const created: PearlChat = {
    id: "12345678-1234-1234-1234-123456789abc",
    title: "New chat",
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
    status: "idle",
    messages: [],
    questions: [],
  };
  let latest = created;
  const sendPearlMessage = vi.fn(async (_id: string, text: string) => {
    latest = {
      ...created,
      status: "failed",
      error: "Provider unavailable",
      messages: [{ id: "message", role: "user", text, at: created.createdAt }],
    };
    return { ...latest, status: "running" as const, error: undefined };
  });
  const api = {
    listPearlChats: vi.fn(async () => []),
    session: vi.fn(async () => ({
      configured: true,
      model: "fixture",
      outputTokens: 8192,
    })),
    onPearlChatUpdate: vi.fn(() => () => {}),
    createPearlChat: vi.fn(async () => created),
    getPearlChat: vi.fn(async () => latest),
    sendPearlMessage,
  } as unknown as DesktopAPI;
  render(<PearlApp api={api} />);
  expect(screen.getByAltText("Scully alien head")).toHaveAttribute(
    "src",
    expect.stringContaining("scully-friendly-nerd-transparent-v1.png"),
  );
  expect(screen.getByRole("heading", { name: "Room" })).toBeInTheDocument();
  expect(
    document.querySelector(".pearl-header .pearl-brand img"),
  ).toBeInTheDocument();
  expect(document.querySelector(".pearl-sidebar .pearl-brand")).toBeNull();
  expect(screen.getByRole("button", { name: "New chat" })).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Task" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText(/team for this task/i)).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "Message Pearl" }), {
    target: { value: "Help me code" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() =>
    expect(sendPearlMessage).toHaveBeenCalledWith(created.id, "Help me code"),
  );
  await waitFor(() =>
    expect(screen.getByText("Help me code")).toBeInTheDocument(),
  );
  const userMessage = screen.getByText("Help me code").closest("article")!;
  expect(userMessage).toHaveClass("user");
  expect(within(userMessage).getByText("You")).toBeInTheDocument();
  expect(
    within(userMessage)
      .getByText("Help me code")
      .closest(".pearl-message-bubble"),
  ).toBeInTheDocument();
  expect(
    within(userMessage).getByText("You").closest(".pearl-message-meta"),
  ).toHaveTextContent(/\d/);
  expect(screen.getByText("Turn interrupted")).toBeInTheDocument();
});

it("recovers the Room from a missed completion update after Continue", async () => {
  const chat: PearlChat = {
    id: "12345678-1234-1234-1234-123456789abc",
    title: "Resume a request",
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
    status: "failed",
    error: "Nebius request timed out after 90 seconds",
    messages: [],
    questions: [],
  };
  let persisted = chat;
  const api = {
    listPearlChats: vi.fn(async () => []),
    session: vi.fn(async () => ({ configured: true, model: "fixture" })),
    onPearlChatUpdate: vi.fn(() => () => {}),
    createPearlChat: vi.fn(async () => chat),
    getPearlChat: vi.fn(async () => persisted),
    retryPearlChat: vi.fn(async () => {
      persisted = {
        ...chat,
        updatedAt: "2026-10-20T00:01:00.000Z",
        status: "running",
        error: undefined,
        retryHint: "provider_connection",
      };
      return persisted;
    }),
  } as unknown as DesktopAPI;
  render(<PearlApp api={api} />);
  fireEvent.click(screen.getByRole("button", { name: "New chat" }));
  fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
  await screen.findByText(/Pearl is retrying from your saved chat/);
  persisted = {
    ...persisted,
    updatedAt: "2026-10-20T00:02:00.000Z",
    status: "failed",
    error: "Nebius did not answer this request within 90 seconds",
  };
  expect(
    await screen.findByText(
      "Nebius did not answer this request within 90 seconds",
      {},
      { timeout: 4000 },
    ),
  ).toBeInTheDocument();
  expect(
    screen.queryByText(/Pearl is retrying from your saved chat/),
  ).toBeNull();
});

it("shows the complete reviewed file diff before applying a transaction", async () => {
  const chat: PearlChat = {
    id: "12345678-1234-1234-1234-123456789abc",
    title: "Two file change",
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
    status: "awaiting_approval",
    messages: [],
    questions: [],
    pendingTool: {
      id: "batch-one",
      name: "edit_files",
      arguments: JSON.stringify({ files: [] }),
      review: {
        files: 2,
        digest: "hash",
        diff: "--- a/one.txt\n+++ b/one.txt\n-old\n+new\n\n--- /dev/null\n+++ b/two.txt\n+created",
      },
    },
  };
  const decidePearlTool = vi.fn(async () => ({
    ...chat,
    pendingTool: undefined,
    status: "running" as const,
  }));
  const api = {
    listPearlChats: vi.fn(async () => []),
    session: vi.fn(async () => ({ configured: true, model: "fixture" })),
    onPearlChatUpdate: vi.fn(() => () => {}),
    createPearlChat: vi.fn(async () => chat),
    decidePearlTool,
  } as unknown as DesktopAPI;
  render(<PearlApp api={api} />);
  fireEvent.click(screen.getByRole("button", { name: "New chat" }));
  const review = await screen.findByRole("region", {
    name: "File transaction review",
  });
  expect(within(review).getByText(/--- a\/one.txt/)).toHaveTextContent(
    "+created",
  );
  expect(
    within(review).getByRole("button", { name: "Apply changes" }),
  ).toBeInTheDocument();
  fireEvent.click(
    within(review).getByRole("button", { name: "Apply changes" }),
  );
  await waitFor(() =>
    expect(decidePearlTool).toHaveBeenCalledWith(chat.id, "batch-one", true),
  );
});

it("keeps one pristine New chat row across repeated clicks", async () => {
  const created: PearlChat = {
    id: "12345678-1234-1234-1234-123456789abc",
    title: "New chat",
    createdAt: "2026-10-22T00:00:00.000Z",
    updatedAt: "2026-10-22T00:00:00.000Z",
    status: "idle",
    messages: [],
    questions: [],
  };
  const api = {
    listPearlChats: vi.fn(async (scope?: string) => (scope ? [] : [created])),
    session: vi.fn(async () => ({ configured: true, model: "fixture" })),
    onPearlChatUpdate: vi.fn(() => () => {}),
    createPearlChat: vi.fn(async () => created),
  } as unknown as DesktopAPI;
  render(<PearlApp api={api} />);
  const newChat = screen.getByRole("button", { name: "New chat" });
  fireEvent.click(newChat);
  await waitFor(() => expect(api.createPearlChat).toHaveBeenCalledTimes(1));
  fireEvent.click(newChat);
  await waitFor(() => expect(api.createPearlChat).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(
      within(screen.getByRole("navigation", { name: "Chats" })).getAllByRole(
        "button",
        { name: "New chat" },
      ),
    ).toHaveLength(1),
  );
});

it("renames a chat through a contained editor with Save, Cancel and recoverable errors", async () => {
  let chat: PearlChat = {
    id: "12345678-1234-1234-1234-123456789abc",
    title: "Change Alpha project to Beta project in README.md",
    createdAt: "2026-10-22T00:00:00.000Z",
    updatedAt: "2026-10-22T00:00:00.000Z",
    status: "idle",
    messages: [],
    questions: [],
  };
  const renamePearlChat = vi.fn(async (_id: string, title: string) => {
    chat = { ...chat, title };
    return chat;
  });
  renamePearlChat.mockRejectedValueOnce(new Error("Storage unavailable"));
  const api = {
    listPearlChats: vi.fn(async (scope?: string) => (scope ? [] : [chat])),
    session: vi.fn(async () => ({ configured: true, model: "fixture" })),
    onPearlChatUpdate: vi.fn(() => () => {}),
    renamePearlChat,
  } as unknown as DesktopAPI;
  render(<PearlApp api={api} />);
  fireEvent.click(
    await screen.findByRole("button", { name: `Options for ${chat.title}` }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Rename" }));
  const title = screen.getByRole("textbox", { name: "Chat title" });
  expect(title).toHaveValue(chat.title);
  expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: `Options for ${chat.title}` }),
  ).toBeNull();
  fireEvent.change(title, { target: { value: "  " } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Enter a chat title");
  expect(renamePearlChat).not.toHaveBeenCalled();
  fireEvent.change(title, { target: { value: "Polished project title" } });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(renamePearlChat).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: `Options for ${chat.title}` }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Rename" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Chat title" }), {
    target: { value: "Polished project title" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(
      screen.getByText("Could not rename this chat. Try again."),
    ).toBeInTheDocument(),
  );
  expect(screen.getByRole("textbox", { name: "Chat title" })).toHaveValue(
    "Polished project title",
  );
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(renamePearlChat).toHaveBeenCalledWith(
      chat.id,
      "Polished project title",
    ),
  );
  await waitFor(() =>
    expect(screen.queryByRole("textbox", { name: "Chat title" })).toBeNull(),
  );
  expect(
    screen.getByRole("button", { name: "Polished project title" }),
  ).toBeInTheDocument();
});

it("archives, restores and permanently deletes a chat only after confirmation", async () => {
  let chat: PearlChat = {
    id: "12345678-1234-1234-1234-123456789abc",
    title: "Shop chat",
    createdAt: "2026-10-22T00:00:00.000Z",
    updatedAt: "2026-10-22T00:00:00.000Z",
    status: "idle",
    messages: [
      {
        id: "one",
        role: "user",
        text: "Build a shop",
        at: "2026-10-22T00:00:00.000Z",
      },
    ],
    questions: [],
  };
  const deletePearlChatPermanently = vi.fn(async () => {
    chat = null as unknown as PearlChat;
  });
  const api = {
    listPearlChats: vi.fn(async (scope?: string) =>
      chat && (chat.lifecycle || "active") === (scope || "active")
        ? [chat]
        : [],
    ),
    session: vi.fn(async () => ({ configured: true, model: "fixture" })),
    onPearlChatUpdate: vi.fn(() => () => {}),
    getPearlChat: vi.fn(async () => chat),
    archivePearlChat: vi.fn(async () => {
      chat = { ...chat, lifecycle: "archived" };
      return chat;
    }),
    restorePearlChat: vi.fn(async () => {
      chat = { ...chat, lifecycle: undefined };
      return chat;
    }),
    deletePearlChatPermanently,
  } as unknown as DesktopAPI;
  render(<PearlApp api={api} />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Options for Shop chat" }),
  );
  fireEvent.click(screen.getByRole("button", { name: /^Archive$/ }));
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Options for Shop chat" }),
    ).not.toBeInTheDocument(),
  );
  fireEvent.click(screen.getByRole("button", { name: /^Archived$/ }));
  expect(screen.queryByRole("button", { name: /^Trash$/ })).toBeNull();
  fireEvent.click(await screen.findByRole("button", { name: "Shop chat" }));
  expect(await screen.findByText("Archived chat")).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Message Pearl" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Restore chat" }));
  await waitFor(() =>
    expect(
      screen.getByRole("complementary", { name: "Chats panel" }),
    ).toBeInTheDocument(),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Options for Shop chat" }),
  );
  fireEvent.click(screen.getByRole("button", { name: /^Archive$/ }));
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Options for Shop chat" }),
    ).not.toBeInTheDocument(),
  );
  fireEvent.click(screen.getByRole("button", { name: /^Archived$/ }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Options for Shop chat" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
  expect(deletePearlChatPermanently).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(deletePearlChatPermanently).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Options for Shop chat" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm deletion" }));
  await waitFor(() =>
    expect(deletePearlChatPermanently).toHaveBeenCalledWith(
      chat?.id || "12345678-1234-1234-1234-123456789abc",
    ),
  );
  await waitFor(() =>
    expect(screen.getByText("No archived chats")).toBeInTheDocument(),
  );
});

it("dismisses chat action menus on outside click and Escape across chat lists", async () => {
  const makeChat = (id: string, title: string, lifecycle?: "archived") => ({
    id,
    title,
    lifecycle,
    createdAt: "2026-10-22T00:00:00.000Z",
    updatedAt: "2026-10-22T00:00:00.000Z",
    status: "idle" as const,
    messages: [],
    questions: [],
  });
  const active = makeChat(
    "12345678-1234-1234-1234-123456789abc",
    "Active chat",
  );
  const other = makeChat("12345678-1234-1234-1234-123456789abd", "Other chat");
  const archived = makeChat(
    "12345678-1234-1234-1234-123456789abe",
    "Archived chat",
    "archived",
  );
  const deletePermanently = vi.fn(async () => {});
  const api = {
    listPearlChats: vi.fn(async (scope?: string) =>
      scope === "archived" ? [archived] : [active, other],
    ),
    session: vi.fn(async () => ({ configured: true, model: "fixture" })),
    onPearlChatUpdate: vi.fn(() => () => {}),
    deletePearlChatPermanently: deletePermanently,
  } as unknown as DesktopAPI;
  render(<PearlApp api={api} />);

  fireEvent.click(
    await screen.findByRole("button", { name: "Options for Active chat" }),
  );
  expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
  fireEvent.pointerDown(screen.getByRole("heading", { name: "Room" }));
  expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();

  fireEvent.click(
    screen.getByRole("button", { name: "Options for Active chat" }),
  );
  fireEvent.pointerDown(
    screen.getByRole("button", { name: "Options for Other chat" }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Options for Other chat" }),
  );
  expect(
    screen.getByRole("button", { name: "Options for Other chat" }),
  ).toHaveAttribute("aria-expanded", "true");
  expect(
    screen.getByRole("button", { name: "Options for Active chat" }),
  ).toHaveAttribute("aria-expanded", "false");
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Archived" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Options for Archived chat" }),
  );
  expect(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument();
  fireEvent.pointerDown(screen.getByRole("heading", { name: "Room" }));
  expect(screen.queryByRole("button", { name: "Restore" })).toBeNull();

  fireEvent.click(
    screen.getByRole("button", { name: "Options for Archived chat" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
  expect(screen.getByText("Delete this chat permanently?")).toBeInTheDocument();
  fireEvent.pointerDown(screen.getByRole("heading", { name: "Room" }));
  expect(screen.queryByText("Delete this chat permanently?")).toBeNull();
  expect(deletePermanently).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Options for Archived chat" }),
  );
  expect(
    screen.getByRole("button", { name: "Delete permanently" }),
  ).toBeInTheDocument();
});

it("keeps a chat visible when archiving fails", async () => {
  const chat: PearlChat = {
    id: "12345678-1234-1234-1234-123456789abc",
    title: "Keep this chat",
    createdAt: "2026-10-22T00:00:00.000Z",
    updatedAt: "2026-10-22T00:00:00.000Z",
    status: "idle",
    messages: [],
    questions: [],
  };
  const api = {
    listPearlChats: vi.fn(async (scope?: string) => (scope ? [] : [chat])),
    session: vi.fn(async () => ({ configured: true, model: "fixture" })),
    onPearlChatUpdate: vi.fn(() => () => {}),
    archivePearlChat: vi.fn(async () => {
      throw new Error("Storage unavailable");
    }),
  } as unknown as DesktopAPI;
  render(<PearlApp api={api} />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Options for Keep this chat" }),
  );
  fireEvent.click(screen.getByRole("button", { name: /^Archive$/ }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Storage unavailable",
  );
  expect(
    screen.getByRole("button", { name: "Keep this chat" }),
  ).toBeInTheDocument();
});

it("shows Pearl's portrait, sent time and reply inside a chat bubble", async () => {
  const at = "2026-10-20T12:34:00.000Z";
  const chat: PearlChat = {
    id: "12345678-1234-1234-1234-123456789abc",
    title: "Discuss the project",
    createdAt: at,
    updatedAt: at,
    status: "idle",
    messages: [
      { id: "user", role: "user", text: "What changed?", at },
      { id: "reply", role: "assistant", text: "The catalog is ready.", at },
    ],
    questions: [],
  };
  const api = {
    listPearlChats: vi.fn(async () => [chat]),
    session: vi.fn(async () => ({ configured: true, model: "fixture" })),
    onPearlChatUpdate: vi.fn(() => () => {}),
    getPearlChat: vi.fn(async () => chat),
  } as unknown as DesktopAPI;
  render(<PearlApp api={api} />);
  fireEvent.click(await screen.findByRole("button", { name: chat.title }));
  expect(
    await screen.findByRole("heading", { name: chat.title }),
  ).toBeInTheDocument();
  const reply = screen.getByText("The catalog is ready.").closest("article")!;
  expect(reply).toHaveClass("assistant");
  expect(reply.querySelector(".pearl-message-avatar")).toHaveAttribute(
    "src",
    expect.stringContaining("team-portrait-coordinator-v1.png"),
  );
  expect(within(reply).getByText("Pearl")).toBeInTheDocument();
  expect(
    within(reply)
      .getByText("The catalog is ready.")
      .closest(".pearl-message-bubble"),
  ).toBeInTheDocument();
  expect(reply.querySelector("time")).toHaveAttribute("datetime", at);
  expect(
    document.querySelector(".pearl-header .pearl-brand img"),
  ).toBeInTheDocument();
});

it("uses a full-width header and opens one navigation panel at a time", async () => {
  const chat: PearlChat = {
    id: "12345678-1234-1234-1234-123456789abc",
    title: "Shop chat",
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
    status: "idle",
    messages: [],
    questions: [],
    project: { path: "/tmp/shop-project", dev: 1, ino: 2, approved: true },
  };
  const api = {
    listPearlChats: vi.fn(async () => [chat]),
    session: vi.fn(async () => ({ configured: true, model: "fixture" })),
    onPearlChatUpdate: vi.fn(() => () => {}),
    getPearlChat: vi.fn(async () => chat),
    choosePearlProject: vi.fn(async () => chat),
  } as unknown as DesktopAPI;
  render(<PearlApp api={api} />);
  expect(
    document.querySelector(".pearl-shell > .pearl-header"),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Chats" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  expect(
    screen.getByRole("complementary", { name: "Chats panel" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  expect(
    screen.queryByRole("complementary", { name: "Chats panel" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("main")).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "Pearl’s model" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  expect(
    screen.queryByRole("heading", { name: "Pearl’s model" }),
  ).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button", { name: chat.title }));
  const project = await screen.findByRole("button", {
    name: "Change project: shop-project",
  });
  expect(project).toHaveAttribute("title", "shop-project");
  expect(project.textContent).toBe("");
  fireEvent.click(project);
  await waitFor(() =>
    expect(api.choosePearlProject).toHaveBeenCalledWith(chat.id),
  );
});

it("closes side panels when dragged narrow and restores their usable widths", async () => {
  const chat = {
    id: "12345678-1234-1234-1234-123456789abc",
    title: "Resize panels",
    createdAt: "now",
    updatedAt: "now",
    status: "idle",
    messages: [],
    questions: [],
    project: { path: "/tmp/project", dev: 1, ino: 2, approved: true },
  } as PearlChat;
  const api = {
    listPearlChats: vi.fn(async (scope?: string) => (scope ? [] : [chat])),
    session: vi.fn(async () => ({ configured: true, model: "fixture" })),
    onPearlChatUpdate: vi.fn(() => () => {}),
    getPearlChat: vi.fn(async () => chat),
    listPearlProjectFiles: vi.fn(async () => []),
  } as unknown as DesktopAPI;
  render(<PearlApp api={api} />);
  fireEvent.click(await screen.findByRole("button", { name: chat.title }));
  const left = screen.getByRole("separator", { name: "Resize chat list" });
  fireEvent(left, new MouseEvent("pointerdown", { bubbles: true, clientX: 0 }));
  fireEvent(
    window,
    new MouseEvent("pointermove", { bubbles: true, clientX: -200 }),
  );
  expect(screen.getByLabelText("Chats panel")).toHaveClass("is-collapse-ready");
  fireEvent(
    window,
    new MouseEvent("pointerup", { bubbles: true, clientX: -200 }),
  );
  await waitFor(() =>
    expect(screen.queryByLabelText("Chats panel")).toBeNull(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Chats" }));
  expect(screen.getByLabelText("Chats panel")).toHaveStyle({ width: "268px" });
  fireEvent.click(screen.getByRole("button", { name: "Files" }));
  const right = await screen.findByRole("separator", { name: "Resize panel" });
  fireEvent(
    right,
    new MouseEvent("pointerdown", { bubbles: true, clientX: 0 }),
  );
  fireEvent(
    window,
    new MouseEvent("pointermove", { bubbles: true, clientX: 300 }),
  );
  expect(screen.getByRole("complementary", { name: "Files" })).toHaveClass(
    "is-collapse-ready",
  );
  fireEvent(
    window,
    new MouseEvent("pointerup", { bubbles: true, clientX: 300 }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("complementary", { name: "Files" })).toBeNull(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Files" }));
  expect(screen.getByRole("complementary", { name: "Files" })).toHaveStyle({
    width: "420px",
  });
});

it("grows the composer with a draft and shrinks it after clearing", async () => {
  const original = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "scrollHeight",
  );
  Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
    configurable: true,
    get(this: HTMLTextAreaElement) {
      return 48 + (this.value.split("\n").length - 1) * 28;
    },
  });
  try {
    const api = {
      listPearlChats: vi.fn(async () => []),
      session: vi.fn(async () => ({ configured: true, model: "fixture" })),
      onPearlChatUpdate: vi.fn(() => () => {}),
    } as unknown as DesktopAPI;
    render(<PearlApp api={api} />);
    const input = screen.getByRole("textbox", { name: "Message Pearl" });
    expect(input).toHaveStyle({ height: "48px" });
    fireEvent.change(input, { target: { value: "One\nTwo\nThree" } });
    expect(input).toHaveStyle({ height: "104px" });
    fireEvent.change(input, {
      target: { value: Array.from({ length: 20 }, (_, i) => i).join("\n") },
    });
    expect(input).toHaveStyle({ height: "210px" });
    fireEvent.change(input, { target: { value: "" } });
    expect(input).toHaveStyle({ height: "48px" });
  } finally {
    if (original)
      Object.defineProperty(
        HTMLTextAreaElement.prototype,
        "scrollHeight",
        original,
      );
    else
      delete (HTMLTextAreaElement.prototype as { scrollHeight?: number })
        .scrollHeight;
  }
});

it("keeps message input above a compact action toolbar", async () => {
  const api = {
    listPearlChats: vi.fn(async () => []),
    session: vi.fn(async () => ({ configured: true, model: "fixture" })),
    onPearlChatUpdate: vi.fn(() => () => {}),
  } as unknown as DesktopAPI;
  render(<PearlApp api={api} />);
  const input = screen.getByRole("textbox", { name: "Message Pearl" });
  const toolbar = document.querySelector(".pearl-composer-toolbar");
  expect(toolbar).not.toBeNull();
  expect(input.nextElementSibling).toBe(toolbar);
  expect(
    screen.getByRole("button", { name: "Add files (coming soon)" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Permissions (coming soon)" }),
  ).toBeDisabled();
  expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  fireEvent.change(input, { target: { value: "Hello" } });
  expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Choose model" }));
  expect(
    await screen.findByRole("heading", { name: "Settings", level: 1 }),
  ).toBeInTheDocument();
});

it("shows a paused coding turn as resumable work", async () => {
  const chat: PearlChat = {
    id: "12345678-1234-1234-1234-123456789abc",
    title: "Coding chat",
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
    status: "paused",
    error: "The actions are saved. Continue to keep working.",
    pausedDraft: "The task is complete.",
    messages: [],
    questions: [],
  };
  const retryPearlChat = vi.fn(async () => ({
    ...chat,
    status: "running" as const,
    error: undefined,
  }));
  const api = {
    listPearlChats: vi.fn(async () => [chat]),
    session: vi.fn(async () => ({ configured: true, model: "fixture" })),
    onPearlChatUpdate: vi.fn(() => () => {}),
    getPearlChat: vi.fn(async () => chat),
    retryPearlChat,
  } as unknown as DesktopAPI;
  render(<PearlApp api={api} />);
  fireEvent.click(await screen.findByRole("button", { name: "Coding chat" }));
  expect(await screen.findByText("Work paused")).toBeInTheDocument();
  expect(screen.getByText(/actions are saved/)).toBeInTheDocument();
  fireEvent.click(screen.getByText("View Pearl's unverified draft"));
  expect(screen.getByText("The task is complete.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(retryPearlChat).toHaveBeenCalledWith(chat.id));
});

it("explains that Continue retries from the saved chat", async () => {
  const chat: PearlChat = {
    id: "12345678-1234-1234-1234-123456789abc",
    title: "Interrupted chat",
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
    status: "running",
    retryHint: "provider_connection",
    messages: [],
    questions: [],
  };
  const api = {
    listPearlChats: vi.fn(async () => []),
    session: vi.fn(async () => ({ configured: true, model: "fixture" })),
    onPearlChatUpdate: vi.fn(() => () => {}),
    createPearlChat: vi.fn(async () => chat),
  } as unknown as DesktopAPI;
  render(<PearlApp api={api} />);
  fireEvent.click(screen.getByRole("button", { name: "New chat" }));
  expect(
    await screen.findByText(
      /retrying from your saved chat.*waiting for Nebius/i,
    ),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
});

it("shows the backend completion status and remaining work", async () => {
  const chat: PearlChat = {
    id: "12345678-1234-1234-1234-123456789abc",
    title: "New chat",
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
    status: "idle",
    messages: [
      {
        id: "result",
        role: "assistant",
        text: "I added the page.",
        at: "2026-10-20T00:00:00.000Z",
        completion: {
          status: "partial",
          remaining: "The keyboard interaction needs a browser check.",
        },
        evidence: {
          projectApproved: true,
          filesWritten: 1,
          uiFilesWritten: 1,
          commandsCompleted: 0,
          browserChecks: 0,
          successfulCommandAfterLatestWrite: false,
          successfulBrowserAfterLatestUiWrite: false,
        },
      },
    ],
    questions: [],
  };
  const api = {
    listPearlChats: vi.fn(async () => []),
    session: vi.fn(async () => ({ configured: true, model: "fixture" })),
    onPearlChatUpdate: vi.fn(() => () => {}),
    createPearlChat: vi.fn(async () => chat),
  } as unknown as DesktopAPI;
  render(<PearlApp api={api} />);
  fireEvent.click(screen.getByRole("button", { name: "New chat" }));
  expect(await screen.findByText(/Work status: partial/)).toBeInTheDocument();
  expect(screen.getByText(/keyboard interaction needs/)).toBeInTheDocument();
  expect(screen.getByText(/No command checks completed/)).toBeInTheDocument();
  expect(
    screen.getByText(/No clean browser check after the latest UI edit/),
  ).toBeInTheDocument();
});

it("shows an applied patch as a readable diff", async () => {
  const chat: PearlChat = {
    id: "12345678-1234-1234-1234-123456789abc",
    title: "New chat",
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
    status: "idle",
    messages: [
      {
        id: "patch-result",
        role: "tool",
        text: JSON.stringify({
          path: "note.txt",
          written: true,
          hunks: [{ line: 3, removed: "old", added: "new" }],
        }),
        toolName: "apply_patch",
        toolCallId: "patch-1",
        at: "2026-10-20T00:00:00.000Z",
      },
    ],
    questions: [],
  };
  const api = {
    listPearlChats: vi.fn(async () => []),
    session: vi.fn(async () => ({ configured: true, model: "fixture" })),
    onPearlChatUpdate: vi.fn(() => () => {}),
    createPearlChat: vi.fn(async () => chat),
  } as unknown as DesktopAPI;
  render(<PearlApp api={api} />);
  fireEvent.click(screen.getByRole("button", { name: "New chat" }));
  const activity = (await screen.findByText("Activity")).closest("details")!;
  expect(activity).not.toHaveAttribute("open");
  fireEvent.click(within(activity).getByText("Activity"));
  fireEvent.click(within(activity).getByText("Apply patch"));
  fireEvent.click(within(activity).getByText("Result"));
  expect(screen.getByText(/@@ note\.txt:3 @@/)).toHaveTextContent("-old +new");
});

it("shows browser observations and visibility defects in readable form", async () => {
  const chat: PearlChat = {
    id: "12345678-1234-1234-1234-123456789abc",
    title: "New chat",
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
    status: "idle",
    messages: [
      {
        id: "browser-result",
        role: "tool",
        text: JSON.stringify({
          title: "Reading List",
          visibleText: "Add book",
          controls: [
            { tag: "input", id: "title", label: "Title", type: "text" },
          ],
          hiddenViolations: [{ tag: "form", id: "book-form" }],
          errors: ["Page script failed"],
          blockedExternalRequests: 1,
          completedSteps: 2,
        }),
        toolName: "browser_check",
        toolCallId: "browser-1",
        at: "2026-10-20T00:00:00.000Z",
      },
    ],
    questions: [],
  };
  const api = {
    listPearlChats: vi.fn(async () => []),
    session: vi.fn(async () => ({ configured: true, model: "fixture" })),
    onPearlChatUpdate: vi.fn(() => () => {}),
    createPearlChat: vi.fn(async () => chat),
  } as unknown as DesktopAPI;
  render(<PearlApp api={api} />);
  fireEvent.click(screen.getByRole("button", { name: "New chat" }));
  const activity = (await screen.findByText("Activity")).closest("details")!;
  expect(within(activity).getByText("1 issue")).toBeInTheDocument();
  fireEvent.click(within(activity).getByText("Activity"));
  fireEvent.click(
    within(activity.querySelector(".pearl-activity-list")!).getByText(
      /Check in browser/,
    ),
  );
  fireEvent.click(within(activity).getByText("Issue details"));
  expect(screen.getByText(/Page: Reading List/)).toHaveTextContent(
    "form #book-form",
  );
  expect(screen.getByText(/Page: Reading List/)).toHaveTextContent(
    "Page script failed",
  );
});

it("does not show an unverified claim attached to a rejected tool request", async () => {
  const chat: PearlChat = {
    id: "12345678-1234-1234-1234-123456789abc",
    title: "New chat",
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
    status: "idle",
    messages: [
      {
        id: "claim",
        role: "assistant",
        text: "Every test passed and the task is complete.",
        toolName: "complete_work",
        toolCallId: "finish-1",
        at: "2026-10-20T00:00:00.000Z",
      },
      {
        id: "rejection",
        role: "tool",
        text: "Completion rejected: A successful check is required.",
        toolName: "complete_work",
        toolCallId: "finish-1",
        at: "2026-10-20T00:00:00.000Z",
      },
    ],
    questions: [],
  };
  const api = {
    listPearlChats: vi.fn(async () => []),
    session: vi.fn(async () => ({ configured: true, model: "fixture" })),
    onPearlChatUpdate: vi.fn(() => () => {}),
    createPearlChat: vi.fn(async () => chat),
  } as unknown as DesktopAPI;
  render(<PearlApp api={api} />);
  fireEvent.click(screen.getByRole("button", { name: "New chat" }));
  const activity = (await screen.findByText("Activity")).closest("details")!;
  expect(within(activity).getByText("1 issue")).toBeInTheDocument();
  expect(screen.queryByText(/Every test passed/)).not.toBeInTheDocument();
  fireEvent.click(within(activity).getByText("Activity"));
  fireEvent.click(
    within(activity.querySelector(".pearl-activity-list")!).getByText(
      /Finish work/,
    ),
  );
  fireEvent.click(within(activity).getByText("Issue details"));
  expect(screen.getByText(/Completion rejected/)).toBeInTheDocument();
});

it("shows the explanation accompanying a linked question without internal tool narration", async () => {
  const chat: PearlChat = {
    id: "12345678-1234-1234-1234-123456789abc",
    title: "New chat",
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
    status: "idle",
    messages: [
      {
        id: "call",
        role: "assistant",
        text: "I recommend shared storage because everyone needs the same list.",
        at: "2026-10-20T00:00:00.000Z",
        toolName: "ask_user",
        toolCallId: "question-call",
      },
      {
        id: "result",
        role: "tool",
        text: "Question presented to the user",
        at: "2026-10-20T00:00:00.000Z",
        toolName: "ask_user",
        toolCallId: "question-call",
      },
    ],
    questions: [
      {
        id: "question",
        topic: "visibility",
        text: "Who can see the list?",
        options: ["Only me", "Friends"],
        askedAt: "2026-10-20T00:00:00.000Z",
        status: "pending",
      },
    ],
  };
  const api = {
    listPearlChats: vi.fn(async () => []),
    session: vi.fn(async () => ({ configured: true, model: "fixture" })),
    onPearlChatUpdate: vi.fn(() => () => {}),
    createPearlChat: vi.fn(async () => chat),
  } as unknown as DesktopAPI;
  render(<PearlApp api={api} />);
  fireEvent.click(screen.getByRole("button", { name: "New chat" }));
  await waitFor(() =>
    expect(screen.getByText("Who can see the list?")).toBeInTheDocument(),
  );
  expect(
    screen.getByText(
      "I recommend shared storage because everyone needs the same list.",
    ),
  ).toBeInTheDocument();
  expect(
    screen.queryByText(/Pearl requested ask_user/),
  ).not.toBeInTheDocument();
  expect(screen.queryByText(/ask_user result/)).not.toBeInTheDocument();
});

it("shows backend action evidence alongside a coding reply", async () => {
  const chat: PearlChat = {
    id: "12345678-1234-1234-1234-123456789abc",
    title: "New chat",
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
    status: "idle",
    messages: [
      {
        id: "reply",
        role: "assistant",
        text: "I tested the new page.",
        at: "2026-10-20T00:00:00.000Z",
        evidence: { filesWritten: 1, commandsCompleted: 0 },
      },
    ],
    questions: [],
  };
  const api = {
    listPearlChats: vi.fn(async () => []),
    session: vi.fn(async () => ({ configured: true, model: "fixture" })),
    onPearlChatUpdate: vi.fn(() => () => {}),
    createPearlChat: vi.fn(async () => chat),
  } as unknown as DesktopAPI;
  render(<PearlApp api={api} />);
  fireEvent.click(screen.getByRole("button", { name: "New chat" }));
  await waitFor(() =>
    expect(
      screen.getByText(/No command checks completed for these changes/),
    ).toBeInTheDocument(),
  );
});

it("shows when a project reply made no changes or command checks", async () => {
  const chat: PearlChat = {
    id: "12345678-1234-1234-1234-123456789abc",
    title: "New chat",
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
    status: "idle",
    messages: [
      {
        id: "reply",
        role: "assistant",
        text: "I applied the patch.",
        at: "2026-10-20T00:00:00.000Z",
        evidence: {
          projectApproved: true,
          filesWritten: 0,
          commandsCompleted: 0,
        },
      },
    ],
    questions: [],
  };
  const api = {
    listPearlChats: vi.fn(async () => []),
    session: vi.fn(async () => ({ configured: true, model: "fixture" })),
    onPearlChatUpdate: vi.fn(() => () => {}),
    createPearlChat: vi.fn(async () => chat),
  } as unknown as DesktopAPI;
  render(<PearlApp api={api} />);
  fireEvent.click(screen.getByRole("button", { name: "New chat" }));
  await waitFor(() =>
    expect(
      screen.getByText(/No files changed or command checks completed/),
    ).toBeInTheDocument(),
  );
});

it("does not present a pre-edit command as a check of the latest file change", async () => {
  const chat: PearlChat = {
    id: "12345678-1234-1234-1234-123456789abc",
    title: "New chat",
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
    status: "idle",
    messages: [
      {
        id: "reply",
        role: "assistant",
        text: "I changed the file.",
        at: "2026-10-20T00:00:00.000Z",
        evidence: {
          filesWritten: 1,
          commandsCompleted: 1,
          successfulCommandAfterLatestWrite: false,
        },
      },
    ],
    questions: [],
  };
  const api = {
    listPearlChats: vi.fn(async () => []),
    session: vi.fn(async () => ({ configured: true, model: "fixture" })),
    onPearlChatUpdate: vi.fn(() => () => {}),
    createPearlChat: vi.fn(async () => chat),
  } as unknown as DesktopAPI;
  render(<PearlApp api={api} />);
  fireEvent.click(screen.getByRole("button", { name: "New chat" }));
  await waitFor(() =>
    expect(
      screen.getByText(/No successful command check after the latest edit/),
    ).toBeInTheDocument(),
  );
});

it("shows a structured action batch without presenting it as an empty Pearl reply", async () => {
  const chat: PearlChat = {
    id: "12345678-1234-1234-1234-123456789abc",
    title: "New chat",
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
    status: "idle",
    messages: [
      {
        id: "batch",
        role: "assistant",
        text: "",
        at: "2026-10-20T00:00:00.000Z",
        toolCalls: [
          { id: "read", name: "read_file", arguments: '{"path":"note.txt"}' },
          { id: "map", name: "project_map", arguments: "{}" },
        ],
      },
    ],
    questions: [],
  };
  const api = {
    listPearlChats: vi.fn(async () => []),
    session: vi.fn(async () => ({ configured: true, model: "fixture" })),
    onPearlChatUpdate: vi.fn(() => () => {}),
    createPearlChat: vi.fn(async () => chat),
  } as unknown as DesktopAPI;
  render(<PearlApp api={api} />);
  fireEvent.click(screen.getByRole("button", { name: "New chat" }));
  const activity = (await screen.findByText("Activity")).closest("details")!;
  expect(within(activity).getByText("2 other actions")).toBeInTheDocument();
  expect(within(activity).getByText(/Read file/)).toBeInTheDocument();
  expect(
    within(activity.querySelector(".pearl-activity-list")!).getByText(
      /Inspect project/,
    ),
  ).toBeInTheDocument();
  expect(screen.queryByText(/Pearl requested/)).not.toBeInTheDocument();
});

it("shows a running reply draft without treating it as a saved message", async () => {
  const chat: PearlChat = {
    id: "12345678-1234-1234-1234-123456789abc",
    title: "New chat",
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
    status: "running",
    streamingText: "Here is the first part",
    messages: [
      {
        id: "user",
        role: "user",
        text: "Hello",
        at: "2026-10-20T00:00:00.000Z",
      },
    ],
    questions: [],
  };
  const api = {
    listPearlChats: vi.fn(async () => []),
    session: vi.fn(async () => ({ configured: true, model: "fixture" })),
    onPearlChatUpdate: vi.fn(() => () => {}),
    createPearlChat: vi.fn(async () => chat),
  } as unknown as DesktopAPI;
  render(<PearlApp api={api} />);
  fireEvent.click(screen.getByRole("button", { name: "New chat" }));
  await waitFor(() =>
    expect(screen.getByLabelText("Pearl draft")).toHaveTextContent(
      "Here is the first part",
    ),
  );
  expect(chat.messages).toHaveLength(1);
  expect(screen.getByText(/Pearl is working/)).toBeInTheDocument();
});

it("starts a new connection with a responsive selectable primary model", async () => {
  const api = {
    listPearlChats: vi.fn(async () => []),
    session: vi.fn(async () => ({ configured: false })),
    onPearlChatUpdate: vi.fn(() => () => {}),
  } as unknown as DesktopAPI;
  render(<PearlApp api={api} />);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  expect(
    screen.getByRole("button", { name: /Primary model: Qwen3 235B/ }),
  ).toBeInTheDocument();
});
