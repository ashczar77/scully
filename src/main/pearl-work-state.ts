import type { PearlChat, PearlWorkState } from "../shared/pearl-chat";

function bounded(value: unknown, maximum: number): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maximum ||
    /[\x00-\x08\x0b-\x1f\x7f]/.test(value)
  )
    throw new Error("Invalid work state text");
  return value.trim();
}

export function updateWorkState(
  chat: PearlChat,
  input: Record<string, unknown>,
): PearlWorkState {
  if (input.expectedRevision !== (chat.work?.revision || 0))
    throw new Error(
      `Work state changed: current revision is ${chat.work?.revision || 0}. Retry using that expectedRevision; the rejected update was not applied.`,
    );
  input = {
    objective: chat.work?.objective,
    approach: chat.work?.approach,
    requirements: chat.work?.requirements.map(
      (requirement) => requirement.quote,
    ),
    steps: chat.work?.steps,
    ...input,
  };
  const source = chat.messages.find(
    (message) =>
      message.id === chat.activeUserMessageId && message.role === "user",
  );
  if (!source) throw new Error("Work state needs a user request");
  if (
    !Array.isArray(input.requirements) ||
    input.requirements.length > 30 ||
    !Array.isArray(input.steps) ||
    !input.steps.length ||
    input.steps.length > 20
  )
    throw new Error("Invalid work state lists");
  const requirements = input.requirements.map((value, index) => {
    const quote = bounded(value, 1000);
    const source = [...chat.messages]
      .reverse()
      .find(
        (message) => message.role === "user" && message.text.includes(quote),
      );
    if (!source)
      throw new Error(
        `Requirement ${index + 1} must come verbatim from a user message, including punctuation. Put recommendations in approach.`,
      );
    return { quote, sourceUserMessageId: source.id };
  });
  const steps = input.steps.map((value) => {
    if (
      !value ||
      typeof value !== "object" ||
      !["pending", "in_progress", "completed"].includes(value.status)
    )
      throw new Error("Invalid work step");
    return {
      text: bounded(value.text, 500),
      status: value.status as PearlWorkState["steps"][number]["status"],
    };
  });
  if (steps.filter((step) => step.status === "in_progress").length > 1)
    throw new Error("Keep one current work step");
  return {
    revision: (chat.work?.revision || 0) + 1,
    sourceUserMessageId: source.id,
    objective: bounded(input.objective, 1500),
    approach: bounded(input.approach, 3000),
    requirements,
    steps,
  };
}
