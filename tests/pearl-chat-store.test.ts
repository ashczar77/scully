// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { PearlChatStore } from "../src/main/pearl-chat-store";

it("orders consecutive chat saves so a stale approval snapshot cannot have the same timestamp", () => {
  const root = mkdtempSync(join(tmpdir(), "scully-chat-order-"));
  const store = new PearlChatStore(join(root, "chat.sqlite"));
  try {
    const chat = store.create();
    const before = chat.updatedAt;
    chat.status = "awaiting_approval";
    store.save(chat);
    const pending = chat.updatedAt;
    chat.status = "running";
    chat.pendingTool = undefined;
    store.save(chat);
    expect(pending > before).toBe(true);
    expect(chat.updatedAt > pending).toBe(true);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
