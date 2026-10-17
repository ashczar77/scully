import { characterById } from "./character-catalog";
import type { Teammate } from "./contracts";
import { runRole } from "./teams";

export type CoreLineup = {
  builderId: string;
  auditorId: string;
  testerId: string | null;
};

export type CoreLineupProposal = CoreLineup & {
  reason: string;
  fallback: boolean;
};

export function defaultCoreLineup(team: readonly Teammate[]): CoreLineup {
  const builderId = team.find((member) => runRole(member) === "builder")?.id;
  const auditorId = team.find((member) => runRole(member) === "auditor")?.id;
  const testerId =
    team.find((member) => runRole(member) === "tester")?.id || null;
  if (!builderId || !auditorId)
    throw new Error("A saved builder and independent auditor are required");
  return { builderId, auditorId, testerId };
}

export function parseCoreLineup(
  value: unknown,
  team: readonly Teammate[],
): CoreLineup {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid work lineup");
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some(
      (key) => !["builderId", "auditorId", "testerId"].includes(key),
    )
  )
    throw new Error("Invalid work lineup fields");
  const available = new Set(team.map((member) => member.id));
  const role = (id: unknown, expected: "builder" | "auditor" | "tester") =>
    typeof id === "string" &&
    available.has(id) &&
    characterById(id)?.role === expected;
  if (
    !role(input.builderId, "builder") ||
    !role(input.auditorId, "auditor") ||
    (input.testerId !== null && !role(input.testerId, "tester"))
  )
    throw new Error("Choose saved team members with the matching roles");
  return {
    builderId: input.builderId as string,
    auditorId: input.auditorId as string,
    testerId: input.testerId as string | null,
  };
}

export function parseCoreProposal(
  value: unknown,
  team: readonly Teammate[],
): CoreLineupProposal {
  const fallback = defaultCoreLineup(team);
  try {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Invalid work recommendation");
    const input = value as Record<string, unknown>;
    const { builderId, auditorId, testerId } = parseCoreLineup(
      {
        builderId: input.builderId,
        auditorId: input.auditorId,
        testerId: input.testerId,
      },
      team,
    );
    if (
      typeof input.reason !== "string" ||
      !input.reason.trim() ||
      input.reason.length > 360 ||
      /[\x00-\x1f\x7f]/.test(input.reason)
    )
      throw new Error("Invalid work recommendation reason");
    return {
      builderId,
      auditorId,
      testerId,
      reason: input.reason.trim(),
      fallback: false,
    };
  } catch {
    return {
      ...fallback,
      reason: "The saved team is the starting lineup for this plan.",
      fallback: true,
    };
  }
}

export function applyCoreLineup(
  team: Teammate[],
  value: CoreLineup,
): Teammate[] {
  const selected = parseCoreLineup(
    {
      builderId: value.builderId,
      auditorId: value.auditorId,
      testerId: value.testerId,
    },
    team,
  );
  return team.map((member) => ({
    ...member,
    runRole:
      member.id === selected.builderId
        ? "builder"
        : member.id === selected.auditorId
          ? "auditor"
          : member.id === selected.testerId
            ? "tester"
            : "reserve",
  }));
}
