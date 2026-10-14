import { parseTeammate, type Teammate } from "./contracts";
import type { FixedRoster } from "./fixed-teams";

export type SavedTeam = {
  id: string;
  familyId?: string;
  kind?: "library" | "snapshot";
  deletedAt?: string | null;
  name: string;
  version: number;
  createdAt: string;
  members: Teammate[];
  roster?: FixedRoster;
};

export type SaveTeamInput = Pick<SavedTeam, "name" | "members"> & {
  expectedDefaultTeamId?: string;
  saveMode?: "overwrite" | "new";
};

export function runRole(member: Teammate): NonNullable<Teammate["runRole"]> {
  return (
    member.runRole ||
    (member.id === "maya"
      ? "builder"
      : member.id === "ellis"
        ? "auditor"
        : member.id === "jun"
          ? "tester"
          : "reserve")
  );
}

export function parseSaveTeam(value: unknown): SaveTeamInput {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid team configuration");
  const input = value as Record<string, unknown>;
  if (
    typeof input.name !== "string" ||
    !input.name.trim() ||
    input.name.length > 80 ||
    /[\x00-\x1f\x7f]/.test(input.name)
  )
    throw new Error("Enter a team name (up to 80 characters)");
  if (
    !Array.isArray(input.members) ||
    input.members.length < 2 ||
    input.members.length > 6
  )
    throw new Error("Choose two to six team members");
  const members = input.members.map(parseTeammate);
  const ids = new Set(members.map((member) => member.id));
  if (ids.size !== members.length)
    throw new Error("Each team member needs a unique ID");
  for (const role of ["builder", "auditor"] as const)
    if (members.filter((member) => runRole(member) === role).length !== 1)
      throw new Error(`Choose exactly one ${role} for automatic runs`);
  if (members.filter((member) => runRole(member) === "tester").length > 1)
    throw new Error("Choose at most one tester for automatic runs");
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
    name: input.name.trim(),
    members,
    expectedDefaultTeamId: input.expectedDefaultTeamId as string | undefined,
    saveMode: input.saveMode as SaveTeamInput["saveMode"],
  };
}
