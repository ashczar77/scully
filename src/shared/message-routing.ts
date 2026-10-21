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
