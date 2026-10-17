import type { Task, Teammate } from "../shared/contracts";
import type { Run } from "../shared/runs";
import { planQuestions } from "../shared/plan-conversation";

export type ConversationEntry =
  | { kind: "user"; key: string; text: string; at: string }
  | {
      kind: "reply";
      key: string;
      reply: NonNullable<Run["replies"]>[number];
      person?: Teammate;
      at: string;
    }
  | {
      kind: "plan";
      key: string;
      plan: string;
      reply?: string;
      draft: boolean;
      at: string;
      person?: Teammate;
    }
  | {
      kind: "progress";
      key: string;
      event: NonNullable<Run["events"]>[number];
      person?: Teammate;
      at: string;
    };

export function conversationTimeline(
  runsNewestFirst: Run[],
  task: Task | null,
): ConversationEntry[] {
  const timestamp = (value: string | undefined, fallback = "") =>
    value || fallback;
  const seenMessages = new Set<string>();
  const seenReplies = new Set<string>();
  const entries: ConversationEntry[] = [];
  for (const run of [...runsNewestFirst].reverse()) {
    const local: (ConversationEntry & { order: number })[] = [];
    const messages = [
      ...(!run.redirection &&
      task?.description &&
      !run.messages?.some((message) => message.text === task.description)
        ? [
            {
              id: `initial:${run.id}`,
              text: task.description,
              at: task.createdAt,
              intent: "continue" as const,
            },
          ]
        : []),
      ...(run.messages || []),
    ];
    for (const message of messages) {
      if (!message.text || seenMessages.has(message.id)) continue;
      seenMessages.add(message.id);
      local.push({
        kind: "user",
        key: `user:${message.id}`,
        text: message.text,
        at: timestamp(message.at, task?.createdAt),
        order: local.length,
      });
    }
    for (const reply of run.replies || []) {
      if (seenReplies.has(reply.id)) continue;
      seenReplies.add(reply.id);
      local.push({
        kind: "reply",
        key: `reply:${reply.id}`,
        reply,
        person: run.teamSnapshot?.members.find(
          (member) => member.id === reply.recipient?.id,
        ),
        at: timestamp(reply.at, task?.createdAt),
        order: local.length,
      });
    }
    const planEvent = run.events.find((event) => event.text === run.plan);
    if (run.plan) {
      const lastNonRedirect = [...messages]
        .reverse()
        .find((message) => message.intent !== "replan");
      const redirect = messages.find((message) => message.intent === "replan");
      const redirectTime = redirect?.at ? Date.parse(redirect.at) : NaN;
      const fallbackAt = Number.isFinite(redirectTime)
        ? new Date(redirectTime - 1).toISOString()
        : lastNonRedirect?.at || task?.createdAt || "";
      local.push({
        kind: "plan",
        key: `plan:${run.id}`,
        plan: run.plan,
        reply: run.planReply,
        draft: planQuestions(run.plan).length > 0 || !run.approvedLineup,
        person: run.teamSnapshot?.members.find(
          (member) => member.id === "pearl",
        ),
        at: timestamp(planEvent?.at, fallbackAt),
        order: local.length,
      });
    }
    for (const [index, event] of run.events.entries()) {
      if (event.actor === "system" || event.text === run.plan) continue;
      local.push({
        kind: "progress",
        key: `progress:${run.id}:${index}`,
        event,
        person: run.teamSnapshot?.members.find(
          (member) => member.id === event.actor,
        ),
        at: timestamp(event.at, task?.createdAt),
        order: local.length,
      });
    }
    local.sort((a, b) => a.at.localeCompare(b.at) || a.order - b.order);
    entries.push(...local);
  }
  return entries;
}
