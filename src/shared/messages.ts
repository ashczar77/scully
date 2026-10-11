export type TeamMessageInput = { text: string; intent: "continue" | "replan" };
export type TeamMessage = TeamMessageInput & { id: string; at: string };
export type ReplyRecipient = Pick<
  import("./contracts").Teammate,
  "id" | "name" | "role" | "instructions"
>;
export type ReplyReview = {
  duringWork?: boolean;
  recipient?: ReplyRecipient;
  token: string;
  runId: string;
  messageId: string;
  context: string;
  revision: string;
  expiresAt: number;
  model: string;
  outputTokens: number;
};
export type TeamReply = {
  duringWork?: boolean;
  recipient?: ReplyRecipient;
  id: string;
  messageId: string;
  revision: string;
  status: "answering" | "answered" | "failed";
  answer: string;
  at: string;
  requestStartedAt?: string;
};
export function parseAnswer(value: unknown): string {
  const v = value as { answer?: unknown };
  if (
    !v ||
    typeof v.answer !== "string" ||
    !v.answer.trim() ||
    v.answer.length > 12000
  )
    throw new Error("Invalid answer response");
  return v.answer;
}
export function parseMessage(value: unknown): TeamMessageInput {
  const v = value as TeamMessageInput;
  if (
    !v ||
    typeof v.text !== "string" ||
    !v.text.trim() ||
    v.text.length > 2000 ||
    /[\x00-\x08\x0b-\x1f\x7f]/.test(v.text) ||
    !["continue", "replan"].includes(v.intent)
  )
    throw new Error(
      "Enter a message up to 2,000 characters and choose how to proceed",
    );
  return { text: v.text.trim(), intent: v.intent };
}
