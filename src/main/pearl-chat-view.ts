import type { PearlChat } from "../shared/pearl-chat";

// Provider continuation is stored for protocol replay, never sent to the Room.
export function roomChat(chat: PearlChat): PearlChat {
  return {
    ...chat,
    messages: chat.messages.map(
      ({
        providerContinuation: _continuation,
        modelImages: _images,
        ...message
      }) =>
        message.role === "user" && message.displayText !== undefined
          ? { ...message, text: message.displayText }
          : message,
    ),
  };
}

export function roomResult(value: unknown): unknown {
  if (
    value &&
    typeof value === "object" &&
    "messages" in value &&
    Array.isArray(value.messages)
  )
    return roomChat(value as PearlChat);
  return value;
}
