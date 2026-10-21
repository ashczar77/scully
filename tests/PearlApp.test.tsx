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
  expect(document.querySelector(".pearl-header img")).toBeNull();
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
  expect(document.querySelector(".pearl-header img")).toBeNull();
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

it("shows a paused coding turn as resumable work", async () => {
  const chat: PearlChat = {
    id: "12345678-1234-1234-1234-123456789abc",
    title: "Coding chat",
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
    status: "paused",
    error: "The actions are saved. Continue to keep working.",
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
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(retryPearlChat).toHaveBeenCalledWith(chat.id));
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
  fireEvent.click(within(activity).getByText(/Check in browser/));
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
  fireEvent.click(within(activity).getByText(/Finish work/));
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
  expect(within(activity).getByText(/Inspect project/)).toBeInTheDocument();
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

it("prefills the model used by the connected Room gate for a new connection", async () => {
  const api = {
    listPearlChats: vi.fn(async () => []),
    session: vi.fn(async () => ({ configured: false })),
    onPearlChatUpdate: vi.fn(() => () => {}),
  } as unknown as DesktopAPI;
  render(<PearlApp api={api} />);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  expect(screen.getByRole("textbox", { name: "Model" })).toHaveValue(
    "zai-org/GLM-5.3-Flash",
  );
});
