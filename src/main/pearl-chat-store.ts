import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { PearlChat, PearlChatSummary } from "../shared/pearl-chat";

export class PearlChatStore {
  private db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;");
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS pearl_chats (id TEXT PRIMARY KEY, updatedAt TEXT NOT NULL, data TEXT NOT NULL); CREATE INDEX IF NOT EXISTS pearl_chats_updated ON pearl_chats(updatedAt DESC)",
    );
  }
  create(): PearlChat {
    const now = new Date().toISOString();
    const chat: PearlChat = {
      id: randomUUID(),
      title: "New chat",
      createdAt: now,
      updatedAt: now,
      status: "idle",
      messages: [],
      questions: [],
    };
    this.save(chat);
    return chat;
  }
  get(id: unknown): PearlChat {
    if (typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id))
      throw new Error("Invalid chat ID");
    const row = this.db
      .prepare("SELECT data FROM pearl_chats WHERE id=?")
      .get(id) as { data: string } | undefined;
    if (!row) throw new Error("Chat not found");
    return JSON.parse(row.data) as PearlChat;
  }
  list(): PearlChatSummary[] {
    return (
      this.db
        .prepare(
          "SELECT data FROM pearl_chats ORDER BY updatedAt DESC LIMIT 200",
        )
        .all() as { data: string }[]
    ).map(({ data }) => {
      const { id, title, createdAt, updatedAt, status } = JSON.parse(
        data,
      ) as PearlChat;
      return { id, title, createdAt, updatedAt, status };
    });
  }
  all(): PearlChat[] {
    return (
      this.db
        .prepare(
          "SELECT data FROM pearl_chats ORDER BY updatedAt DESC, rowid DESC",
        )
        .all() as { data: string }[]
    ).map(({ data }) => JSON.parse(data) as PearlChat);
  }
  delete(id: unknown): void {
    const chat = this.get(id);
    this.db.prepare("DELETE FROM pearl_chats WHERE id=?").run(chat.id);
  }
  save(chat: PearlChat): PearlChat {
    const previous = this.db
      .prepare("SELECT updatedAt FROM pearl_chats WHERE id=?")
      .get(chat.id) as { updatedAt: string } | undefined;
    chat.updatedAt = new Date(
      Math.max(Date.now(), Date.parse(previous?.updatedAt || "") + 1 || 0),
    ).toISOString();
    this.db
      .prepare(
        "INSERT INTO pearl_chats (id,updatedAt,data) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET updatedAt=excluded.updatedAt,data=excluded.data",
      )
      .run(chat.id, chat.updatedAt, JSON.stringify(chat));
    return chat;
  }
  recover(): void {
    const rows = this.db.prepare("SELECT id FROM pearl_chats").all() as {
      id: string;
    }[];
    for (const { id } of rows) {
      const chat = this.get(id);
      let terminalInterrupted = false;
      for (const terminal of chat.terminals || []) {
        if (terminal.status !== "running") continue;
        terminal.status = "interrupted";
        terminal.revision = (terminal.revision || 0) + 1;
        terminal.endedAt = new Date().toISOString();
        terminalInterrupted = true;
      }
      if (terminalInterrupted && chat.status !== "running") this.save(chat);
      if (chat.status !== "running") continue;
      const lastAction = [...chat.messages]
        .reverse()
        .find(
          (message) =>
            message.role === "assistant" &&
            (message.toolCallId || message.toolCalls?.length),
        );
      const calls = lastAction?.toolCalls?.length
        ? lastAction.toolCalls
        : lastAction?.toolCallId && lastAction.toolName
          ? [{ id: lastAction.toolCallId, name: lastAction.toolName }]
          : [];
      for (const call of calls) {
        if (
          chat.messages.some(
            (message) =>
              message.role === "tool" && message.toolCallId === call.id,
          )
        )
          continue;
        chat.messages.push({
          id: randomUUID(),
          role: "tool",
          toolCallId: call.id,
          toolName: call.name,
          text: "The app closed before this action's result was recorded. Its outcome is unknown. Inspect project state before proposing another edit or command.",
          at: new Date().toISOString(),
        });
      }
      chat.status = "failed";
      chat.error =
        "The app closed during Pearl's turn. Your messages are saved. Continue when ready.";
      this.save(chat);
    }
  }
  close(): void {
    this.db.close();
  }
}
