// @vitest-environment node
import { expect, it, vi } from "vitest";
import { runPearlAgentTurn } from "../src/main/pearl-agent-runtime";
import type { PearlChat } from "../src/shared/pearl-chat";

it("pauses on elapsed time before requesting another model response", async () => {
  const chat: PearlChat = {
    id: "12345678-1234-1234-1234-123456789abc",
    title: "Chat",
    createdAt: "now",
    updatedAt: "now",
    status: "running",
    messages: [],
    questions: [],
  };
  let elapsed = 0;
  const request = vi.fn(async () => {
    elapsed += 60;
    return {
      kind: "tool" as const,
      text: "",
      call: {
        id: `call-${elapsed}`,
        name: "project_map",
        arguments: "{}",
      },
    };
  });
  const pause = vi.fn((current: PearlChat, reason: string) => {
    current.status = "paused";
    current.error = reason;
  });
  await runPearlAgentTurn(
    {
      load: () => chat,
      allowedTools: () => ["project_map"],
      request,
      recordActions: () => {},
      observe: () => {},
      execute: async (_current, call) => {
        chat.messages.push({
          id: `observation-${call.id}`,
          role: "tool",
          text: `Mapped project at ${elapsed}`,
          at: "now",
          toolCallId: call.id,
        });
        return "continue";
      },
      finish: () => {},
      pause,
      needsCheck: () => false,
      needsCompletion: () => false,
    },
    new AbortController().signal,
    { hardStepLimit: 10, timeBudgetMs: 100, now: () => elapsed },
  );
  expect(request).toHaveBeenCalledTimes(2);
  expect(pause).toHaveBeenCalledTimes(1);
  expect(chat.error).toContain("time budget");
  expect(chat.messages).toHaveLength(2);
});

it("requests fresh verification after a later successful edit", async () => {
  const chat: PearlChat = {
    id: "12345678-1234-1234-1234-123456789abc",
    title: "Chat",
    createdAt: "now",
    updatedAt: "now",
    status: "running",
    messages: [],
    questions: [],
  };
  const responses = [
    {
      kind: "tool" as const,
      text: "",
      call: { id: "first", name: "create_file", arguments: "{}" },
    },
    { kind: "reply" as const, text: "First edit finished." },
    {
      kind: "tool" as const,
      text: "",
      call: { id: "second", name: "create_file", arguments: "{}" },
    },
    { kind: "reply" as const, text: "Second edit finished." },
    { kind: "reply" as const, text: "Both edits remain unverified." },
  ];
  const request = vi.fn(
    async (
      _current: PearlChat,
      _allowed: string[],
      _signal: AbortSignal,
      _suffix?: string,
    ) => responses.shift()!,
  );
  const finish = vi.fn();
  await runPearlAgentTurn(
    {
      load: () => chat,
      allowedTools: () => ["create_file"],
      request,
      recordActions: () => {},
      observe: () => {},
      execute: async (_current, call) => {
        chat.messages.push({
          id: `observation-${call.id}`,
          role: "tool",
          text: JSON.stringify({ path: `${call.id}.txt`, written: true }),
          at: "now",
          toolCallId: call.id,
        });
        return "continue";
      },
      finish,
      pause: () => {},
      needsCheck: () => true,
      needsCompletion: () => false,
    },
    new AbortController().signal,
  );
  expect(request).toHaveBeenCalledTimes(5);
  expect(request.mock.calls[2][3]).toContain("run_command");
  expect(request.mock.calls[4][3]).toContain("run_command");
  expect(finish).toHaveBeenCalledWith(
    chat,
    "Both edits remain unverified.",
    undefined,
  );
});
