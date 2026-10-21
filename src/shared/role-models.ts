import { characterById, characterCatalog } from "./character-catalog";
import { starterModelOptions } from "./model-options";
import { runRole } from "./teams";
import type { Teammate } from "./contracts";

export type RoleModelSettings = {
  pearl: string;
  builder: string;
  tester: string;
  auditor: string;
  specialists: Record<string, string>;
  thinking?: Record<string, "off" | "on">;
};

export const defaultRoleModelSettings: RoleModelSettings = {
  pearl: starterModelOptions[0].id,
  builder: starterModelOptions[1].id,
  tester: starterModelOptions[1].id,
  auditor: starterModelOptions[1].id,
  specialists: Object.fromEntries(
    characterCatalog
      .filter((member) => member.role === "specialist")
      .map((member) => [member.id, starterModelOptions[1].id]),
  ),
  thinking: {},
};

export function parseRoleModelSettings(value: unknown): RoleModelSettings {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid teammate model settings");
  const row = value as Record<string, unknown>;
  const keys = Object.keys(defaultRoleModelSettings);
  if (Object.keys(row).some((key) => !keys.includes(key)))
    throw new Error("Unknown teammate model setting");
  const specialists = row.specialists;
  if (
    !specialists ||
    typeof specialists !== "object" ||
    Array.isArray(specialists)
  )
    throw new Error("Invalid specialist model settings");
  const specialistIds = Object.keys(defaultRoleModelSettings.specialists);
  if (Object.keys(specialists).some((id) => !specialistIds.includes(id)))
    throw new Error("Unknown specialist");
  const valid = (model: unknown) =>
    typeof model === "string" && /^[\w./:-]{1,160}$/.test(model);
  for (const key of ["pearl", "builder", "tester", "auditor"])
    if (!valid(row[key])) throw new Error(`Invalid ${key} model`);
  for (const id of specialistIds)
    if (!valid((specialists as Record<string, unknown>)[id]))
      throw new Error(`Invalid ${id} model`);
  if (row.thinking !== undefined) {
    if (
      !row.thinking ||
      typeof row.thinking !== "object" ||
      Array.isArray(row.thinking)
    )
      throw new Error("Invalid thinking settings");
    const allowed = new Set([
      "pearl",
      "builder",
      "tester",
      "auditor",
      ...specialistIds,
    ]);
    for (const [id, preset] of Object.entries(row.thinking))
      if (!allowed.has(id) || !["off", "on"].includes(preset as string))
        throw new Error("Invalid thinking preset");
  }
  return value as RoleModelSettings;
}

export function modelForActor(
  settings: RoleModelSettings | undefined,
  actor: string | undefined,
  team: Teammate[],
  fallback: string,
): string {
  if (!settings || !actor) return fallback;
  if (actor === "pearl") return settings.pearl;
  if (settings.specialists[actor]) return settings.specialists[actor];
  const catalogRole = characterById(actor)?.role;
  if (
    catalogRole === "builder" ||
    catalogRole === "tester" ||
    catalogRole === "auditor"
  )
    return settings[catalogRole];
  const member = team.find((item) => item.id === actor);
  if (!member) return fallback;
  const role = runRole(member);
  return role === "builder" || role === "tester" || role === "auditor"
    ? settings[role]
    : fallback;
}

export function thinkingForActor(
  settings: RoleModelSettings | undefined,
  actor: string | undefined,
  team: Teammate[],
): "off" | "on" | undefined {
  if (!settings || !actor) return undefined;
  const direct = settings.thinking?.[actor];
  if (direct) return direct;
  const catalogRole = characterById(actor)?.role;
  if (
    catalogRole === "builder" ||
    catalogRole === "tester" ||
    catalogRole === "auditor"
  )
    return settings.thinking?.[catalogRole];
  const member = team.find((item) => item.id === actor);
  if (!member) return undefined;
  const role = runRole(member);
  return role === "builder" || role === "tester" || role === "auditor"
    ? settings.thinking?.[role]
    : undefined;
}
