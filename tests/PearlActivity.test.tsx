import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { PearlActivity, roomTimeline } from "../src/renderer/PearlActivity";
import type { PearlMessage } from "../src/shared/pearl-chat";

const at = "2026-10-20T00:00:00.000Z";

it("keeps one nested activity group per user message and leaves Pearl replies in order", () => {
  const messages: PearlMessage[] = [
    { id: "user-1", role: "user", text: "Build this", at },
    {
      id: "call-1",
      role: "assistant",
      text: "I will inspect the project.",
      toolCalls: [
        { id: "map", name: "project_map", arguments: "{}" },
        { id: "read", name: "read_file", arguments: '{"path":"a.txt"}' },
      ],
      at,
    },
    {
      id: "result-1",
      role: "tool",
      text: '{"files":[]}',
      toolName: "project_map",
      toolCallId: "map",
      at,
    },
    {
      id: "result-2",
      role: "tool",
      text: '{"content":"hello"}',
      toolName: "read_file",
      toolCallId: "read",
      at,
    },
    { id: "reply-1", role: "assistant", text: "Here is the result.", at },
    { id: "user-2", role: "user", text: "Change it", at },
    {
      id: "call-2",
      role: "assistant",
      text: "",
      toolName: "apply_patch",
      toolCallId: "patch",
      at,
    },
    {
      id: "result-3",
      role: "tool",
      text: '{"written":true}',
      toolName: "apply_patch",
      toolCallId: "patch",
      at,
    },
    { id: "reply-2", role: "assistant", text: "Changed.", at },
  ];
  const original = JSON.stringify(messages);
  const timeline = roomTimeline(messages);
  expect(timeline.map((item) => item.kind)).toEqual([
    "message",
    "activity",
    "message",
    "message",
    "activity",
    "message",
  ]);
  const groups = timeline.filter((item) => item.kind === "activity");
  expect(groups).toHaveLength(2);
  expect(groups[0].group.actions.map((action) => action.name)).toEqual([
    "project_map",
    "read_file",
  ]);
  expect(groups[0].group.entries[0]).toMatchObject({
    kind: "note",
    text: "I will inspect the project.",
  });
  expect(
    groups[0].group.actions.map((action) => action.results.length),
  ).toEqual([1, 1]);
  expect(groups[1].group.actions.map((action) => action.name)).toEqual([
    "apply_patch",
  ]);
  expect(JSON.stringify(messages)).toBe(original);
});

it("keeps tool-bound progress beside its actions instead of showing orphaned chat bubbles", () => {
  const messages: PearlMessage[] = [
    { id: "user", role: "user", text: "Build the shop", at },
    {
      id: "first",
      role: "assistant",
      text: "Now the four HTML pages:",
      toolCallId: "create-1",
      toolName: "create_file",
      at,
    },
    {
      id: "first-result",
      role: "tool",
      text: '{"written":true}',
      toolCallId: "create-1",
      toolName: "create_file",
      at,
    },
    {
      id: "second",
      role: "assistant",
      text: "Now I will check the storefront in the browser:",
      toolCallId: "browser-1",
      toolName: "browser_check",
      at,
    },
    {
      id: "second-result",
      role: "tool",
      text: '{"title":"Shop","visibleText":"Catalog","controls":[],"hiddenViolations":[],"errors":[]}',
      toolCallId: "browser-1",
      toolName: "browser_check",
      at,
    },
    { id: "answer", role: "assistant", text: "The storefront is ready.", at },
  ];
  const timeline = roomTimeline(messages);
  expect(timeline.map((item) => item.kind)).toEqual([
    "message",
    "activity",
    "message",
  ]);
  const activity = timeline[1];
  if (activity.kind !== "activity") throw new Error("Expected activity");
  render(<PearlActivity group={activity.group} />);
  expect(screen.getByText("Latest: Check in browser")).toBeInTheDocument();
  fireEvent.click(screen.getByText("Activity"));
  const list = document.querySelector(".pearl-activity-list")!;
  expect(list.textContent).toMatch(
    /Now the four HTML pages:.*Create file.*Now I will check the storefront in the browser:.*Check in browser/s,
  );
  expect(timeline[2]).toMatchObject({
    kind: "message",
    message: { text: "The storefront is ready." },
  });
});

it("keeps linked question text visible and hides its internal control action", () => {
  const timeline = roomTimeline([
    { id: "user", role: "user", text: "Help me decide", at },
    {
      id: "question",
      role: "assistant",
      text: "Who should have access?",
      toolName: "ask_user",
      toolCallId: "ask",
      at,
    },
    {
      id: "presented",
      role: "tool",
      text: "Question presented to the user",
      toolName: "ask_user",
      toolCallId: "ask",
      at,
    },
  ]);
  expect(timeline).toHaveLength(2);
  expect(timeline[1]).toMatchObject({
    kind: "message",
    message: { text: "Who should have access?" },
  });
});

it("flags denied commands and browser failures in the collapsed summary", () => {
  const timeline = roomTimeline([
    { id: "user", role: "user", text: "Check it", at },
    {
      id: "denied",
      role: "tool",
      text: "User denied this command. Do not retry it without a new request.",
      toolName: "run_command",
      toolCallId: "command",
      at,
    },
    {
      id: "browser",
      role: "tool",
      text: "Symlink in project path",
      toolName: "browser_check",
      toolCallId: "check",
      at,
    },
  ]);
  const activity = timeline.find((item) => item.kind === "activity");
  expect(activity).toBeDefined();
  if (!activity || activity.kind !== "activity") return;
  render(<PearlActivity group={activity.group} />);
  const details = screen.getByLabelText("Pearl activity");
  expect(details).not.toHaveAttribute("open");
  expect(within(details).getByText("2 issues")).toBeInTheDocument();
  fireEvent.click(within(details).getByText("Activity"));
  expect(within(details).getAllByText(/needs attention/)).toHaveLength(2);
});
