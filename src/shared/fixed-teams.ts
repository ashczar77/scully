import {
  characterById,
  fixedCastStarterIds,
  playbookModules,
  type CharacterId,
} from "./character-catalog";
import { parsePortraitId } from "./portrait-library";
import type { Teammate } from "./contracts";

export type FixedRoster = {
  memberIds: CharacterId[];
  activeBuilderId: CharacterId;
  activeAuditorId: CharacterId;
  activeTesterId: CharacterId | null;
};

export type SaveFixedTeamInput = FixedRoster & {
  name: string;
  expectedDefaultTeamId?: string;
  saveMode?: "overwrite" | "new";
};

export const starterRoster: FixedRoster = {
  memberIds: [...fixedCastStarterIds],
  activeBuilderId: "maya",
  activeAuditorId: "ellis",
  activeTesterId: "jun",
};

const standalonePortraitNumbers = {
  "assets/team-portrait-coordinator-v1.png": 13,
  "assets/team-portrait-young-1-v1.png": 14,
  "assets/team-portrait-research-v1.png": 15,
  "assets/team-portrait-reliability-v1.png": 16,
} as const;

export function parseFixedRoster(value: unknown): FixedRoster {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid team roster");
  const input = value as Record<string, unknown>;
  if (
    !Array.isArray(input.memberIds) ||
    input.memberIds.length < 3 ||
    input.memberIds.length > 16
  )
    throw new Error("Choose three to sixteen fixed characters");
  const memberIds = input.memberIds.map((id) => {
    if (typeof id !== "string" || !characterById(id))
      throw new Error("Unknown character");
    return id as CharacterId;
  });
  if (new Set(memberIds).size !== memberIds.length)
    throw new Error("Choose each character once");
  if (!memberIds.includes("pearl"))
    throw new Error("Pearl is required in every team");
  const active = (
    key: "activeBuilderId" | "activeAuditorId" | "activeTesterId",
    role: "builder" | "auditor" | "tester",
  ) => {
    const id = input[key];
    if (key === "activeTesterId" && id === null) return null;
    if (
      typeof id !== "string" ||
      !memberIds.includes(id as CharacterId) ||
      characterById(id)?.role !== role
    )
      throw new Error(`Choose an included ${role} for automatic runs`);
    return id as CharacterId;
  };
  return {
    memberIds,
    activeBuilderId: active("activeBuilderId", "builder")!,
    activeAuditorId: active("activeAuditorId", "auditor")!,
    activeTesterId: active("activeTesterId", "tester"),
  };
}

export function parseSaveFixedTeam(value: unknown): SaveFixedTeamInput {
  const roster = parseFixedRoster(value);
  const input = value as Record<string, unknown>;
  if ("members" in input)
    throw new Error("Built-in character profiles cannot be edited");
  if (
    typeof input.name !== "string" ||
    !input.name.trim() ||
    input.name.length > 80 ||
    /[\x00-\x1f\x7f]/.test(input.name)
  )
    throw new Error("Enter a team name (up to 80 characters)");
  if (
    input.expectedDefaultTeamId !== undefined &&
    (typeof input.expectedDefaultTeamId !== "string" ||
      !input.expectedDefaultTeamId ||
      input.expectedDefaultTeamId.length > 100)
  )
    throw new Error("Invalid current team ID");
  if (
    input.saveMode !== undefined &&
    input.saveMode !== "overwrite" &&
    input.saveMode !== "new"
  )
    throw new Error("Invalid team save choice");
  if (input.saveMode && !input.expectedDefaultTeamId)
    throw new Error("Current team ID is required");
  return {
    ...roster,
    name: input.name.trim(),
    expectedDefaultTeamId: input.expectedDefaultTeamId as string | undefined,
    saveMode: input.saveMode as SaveFixedTeamInput["saveMode"],
  };
}

export function catalogTeammate(id: CharacterId): Teammate {
  const character = characterById(id)!;
  const portrait = character.portrait;
  const number =
    portrait.kind === "atlas"
      ? (portrait.atlas - 1) * 3 + portrait.column + 1
      : standalonePortraitNumbers[portrait.path];
  return {
    id,
    runRole: "reserve",
    name: character.name,
    role:
      ("specialty" in character ? character.specialty : undefined) ||
      (character.role === "coordinator"
        ? "Coordinator"
        : character.role[0].toUpperCase() + character.role.slice(1)),
    bio: character.brief,
    instructions: [
      character.brief,
      ...character.modules.map((module) => playbookModules[module]),
    ].join("\n"),
    portraitId: parsePortraitId(`portrait-${String(number).padStart(2, "0")}`),
  };
}

export function rosterMembers(roster: FixedRoster): Teammate[] {
  const valid = parseFixedRoster(roster);
  return valid.memberIds.map((id) => ({
    ...catalogTeammate(id),
    runRole:
      id === valid.activeBuilderId
        ? "builder"
        : id === valid.activeAuditorId
          ? "auditor"
          : id === valid.activeTesterId
            ? "tester"
            : "reserve",
  }));
}
