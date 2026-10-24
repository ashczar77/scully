// @vitest-environment node
import { expect, it } from "vitest";
import {
  compactToolHistory,
  contextCharacterBudget,
} from "../src/main/pearl-context";
import type { PearlMessage } from "../src/shared/pearl-chat";
const older: PearlMessage[] = [
  {
    id: "user",
    role: "user",
    text: "Keep my original requirements",
    at: "now",
  },
  {
    id: "write",
    role: "assistant",
    text: "Implementing the agreed approach",
    toolCallId: "call",
    toolName: "create_file",
    arguments: JSON.stringify({
      path: "app.js",
      content: "source ".repeat(10000),
    }),
    at: "now",
  },
  {
    id: "result",
    role: "tool",
    toolCallId: "call",
    toolName: "create_file",
    text: JSON.stringify({
      path: "app.js",
      sha256: "a".repeat(64),
      written: true,
    }),
    at: "now",
  },
];
const recent: PearlMessage[] = Array.from({ length: 20 }, (_, i) => ({
  id: `recent-${i}`,
  role: "user",
  text: `Recent message ${i}`,
  at: "now",
}));
it("replaces only old completed file groups and preserves requirements and revision evidence", () => {
  const messages = [...older, ...recent],
    before = JSON.stringify(messages);
  const compacted = compactToolHistory(messages);
  expect(JSON.stringify(messages)).toBe(before);
  expect(compacted[0]).toEqual(older[0]);
  expect(compacted[1].text).toContain("source bodies omitted");
  expect(compacted[1].text).toContain("a".repeat(64));
  expect(compacted[1].toolCallId).toBeUndefined();
  expect(compacted[2]).toEqual(recent[0]);
  expect(JSON.stringify(compacted).length).toBeLessThan(5000);
});
it("compacts an old completed multi-file transaction without losing file revisions", () => {
  const messages: PearlMessage[] = [
    older[0],
    {
      ...older[1],
      toolName: "edit_files",
      arguments: JSON.stringify({
        files: [{ path: "one.txt", content: "source ".repeat(10000) }],
      }),
    },
    {
      ...older[2],
      toolName: "edit_files",
      text: JSON.stringify({
        written: true,
        revisions: [
          { path: "one.txt", sha256: "a".repeat(64) },
          { path: "two.txt", sha256: "b".repeat(64) },
        ],
      }),
    },
    ...recent,
  ];
  const compacted = compactToolHistory(messages);
  expect(compacted[1].text).toContain("one.txt");
  expect(compacted[1].text).toContain("b".repeat(64));
  expect(JSON.stringify(compacted)).not.toContain("source source source");
});
it("preserves recent source, incomplete tool groups and failed results", () => {
  expect(compactToolHistory(older)).toEqual(older);
  const missing = [...older.slice(0, 2), ...recent];
  expect(compactToolHistory(missing)).toEqual(missing);
  const failed = [
    older[0],
    older[1],
    { ...older[2], text: "Action failed: file exists" },
    ...recent,
  ];
  expect(compactToolHistory(failed)).toEqual(failed);
});
it("never splits a mixed tool batch or leaves an orphan observation", () => {
  const batch: PearlMessage = {
    id: "batch",
    role: "assistant",
    text: "",
    toolCalls: [
      { id: "read", name: "read_file", arguments: '{"path":"app.js"}' },
      { id: "map", name: "project_map", arguments: "{}" },
    ],
    at: "now",
  };
  const messages = [
    batch,
    { ...older[2], toolCallId: "read" },
    { ...older[2], toolCallId: "map" },
    ...recent,
  ];
  expect(compactToolHistory(messages)).toEqual(messages);
});

it("retains the newest read of every file instead of evicting sources after a few actions", () => {
  const reads: PearlMessage[] = Array.from({ length: 14 }, (_, i) => [
    {
      id: `a${i}`,
      role: "assistant" as const,
      text: "",
      at: "now",
      toolCallId: `read${i}`,
      toolName: "read_file",
      arguments: JSON.stringify({ path: `file${i}.js` }),
    },
    {
      id: `r${i}`,
      role: "tool" as const,
      text: JSON.stringify({
        path: `file${i}.js`,
        sha256: "a".repeat(64),
        content: `source ${i}`,
      }),
      at: "now",
      toolCallId: `read${i}`,
      toolName: "read_file",
    },
  ]).flat();
  expect(compactToolHistory(reads)).toEqual(reads);
});

it("uses a conservative context allowance for the configured model and reduces it on retry", () => {
  expect(contextCharacterBudget("zai-org/GLM-5.3-Flash")).toBe(320_000);
  expect(contextCharacterBudget("zai-org/GLM-5.3-Flash", true)).toBe(80_000);
  expect(contextCharacterBudget("unknown")).toBe(80_000);
  expect(contextCharacterBudget("unknown", true)).toBe(24_000);
});

it("keeps retained provider continuation attached to its original action group", () => {
  const messages = [
    older[0],
    {
      ...older[1],
      providerContinuation: {
        model: "model",
        reasoningContent: "opaque continuation",
      },
    },
    older[2],
    ...recent,
  ];
  expect(compactToolHistory(messages)).toEqual(messages);
});
