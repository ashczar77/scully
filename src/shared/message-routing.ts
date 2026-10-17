import { characterById } from "./character-catalog";
import type { Teammate } from "./contracts";

export type MessageRoutingSettings = {
  unclear: "pearl" | "ask";
  specialistConsultation: "automatic" | "ask";
};
export const defaultMessageRoutingSettings: MessageRoutingSettings = {
  unclear: "pearl",
  specialistConsultation: "automatic",
};

export function parseMessageRoutingSettings(
  value: unknown,
): MessageRoutingSettings {
  if (
    !value ||
    typeof value !== "object" ||
    !["pearl", "ask"].includes((value as MessageRoutingSettings).unclear) ||
    !["automatic", "ask"].includes(
      (value as MessageRoutingSettings).specialistConsultation,
    )
  )
    throw new Error("Choose how unclear questions are routed");
  return {
    unclear: (value as MessageRoutingSettings).unclear,
    specialistConsultation: (value as MessageRoutingSettings)
      .specialistConsultation,
  };
}

const topicWords: Record<string, RegExp> = {
  "interface-design":
    /\b(ui|ux|layout|visual|screen|design|typography|spacing|navigation)\b/i,
  accessibility:
    /\b(accessibility|keyboard|screen reader|contrast|wcag|aria)\b/i,
  "system-design":
    /\b(architecture|schema|scalability|performance|latency|contract|trade.?off)\b/i,
  "documentation-communications":
    /\b(documentation|docs|email|stakeholder|policy|terms|announcement)\b/i,
  "preventive-security":
    /\b(security|authentication|authorization|auth|session|secret|permission|threat)\b/i,
  "penetration-testing":
    /\b(pen.?test|exploit|attack|vulnerability|injection)\b/i,
  "source-research":
    /\b(research|source|evidence|citation|literature|compare studies)\b/i,
  "release-reliability":
    /\b(release|deploy|rollback|recovery|availability|incident|uptime)\b/i,
  "product-testing": /\b(tests?|qa|regression|reproduce|edge case|bugs?)\b/i,
  "independent-audit":
    /\b(audit|code review|review findings|standards|code smell)\b/i,
  "full-stack-build":
    /\b(implement|build|code|api|database|frontend|backend)\b/i,
};

export function messageMatchesTeammateTopic(text: string, member: Teammate) {
  return !!characterById(member.id)?.modules.some((module) =>
    topicWords[module]?.test(text),
  );
}

export function routeTeamMessage(
  text: string,
  members: Teammate[],
  settings: MessageRoutingSettings,
): { recipientId?: string; reason: string; needsChoice: boolean } {
  const names = new Map(
    members.map((member) => [member.name.toLowerCase(), member]),
  );
  const mentions = [...text.matchAll(/(?:^|\s)@([a-z][a-z0-9_-]*)\b/gi)];
  if (mentions.length > 1) throw new Error("Tag one teammate at a time");
  if (mentions.length) {
    const member = names.get(mentions[0][1].toLowerCase());
    if (!member) throw new Error("Tagged teammate is not on this task's team");
    return {
      recipientId: member.id,
      reason: `You tagged ${member.name}.`,
      needsChoice: false,
    };
  }
  const matches = members.filter((member) =>
    messageMatchesTeammateTopic(text, member),
  );
  if (matches.length === 1)
    return {
      recipientId: matches[0].id,
      reason: `${matches[0].name} matches the subject of this question.`,
      needsChoice: false,
    };
  const pearl = members.find((member) => member.id === "pearl");
  if (settings.unclear === "pearl" && pearl)
    return {
      recipientId: pearl.id,
      reason:
        "The subject is unclear or spans roles. Pearl will coordinate the answer.",
      needsChoice: false,
    };
  return {
    reason:
      "The subject is unclear or spans roles. Choose a teammate for this reply.",
    needsChoice: true,
  };
}
