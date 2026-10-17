import { characterById, type CharacterId } from "./character-catalog";
import type { CoreLineup, CoreLineupProposal } from "./core-lineup";

export type SpecialistPhase =
  "planning" | "building" | "verification" | "release";
export type SpecialistSuggestion = {
  id: CharacterId;
  phase: SpecialistPhase;
  reason: string;
};
export type LineupProposal = {
  planRevision: string;
  suggestions: SpecialistSuggestion[];
  discardedInvalid: boolean;
  core?: CoreLineupProposal;
};
export type SpecialistLineupEntry = {
  id: CharacterId;
  phase: SpecialistPhase;
  purpose: string;
};
export type ApprovedSpecialistLineup = {
  planRevision: string;
  entries: SpecialistLineupEntry[];
  core?: CoreLineup;
  approvedAt: string;
};

export function parseSpecialistLineup(value: unknown): SpecialistLineupEntry[] {
  if (!Array.isArray(value) || value.length > 3)
    throw new Error("Choose at most three specialists");
  const seen = new Set<string>();
  return value.map((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
      throw new Error("Invalid specialist lineup");
    const { id, phase, purpose } = candidate as Record<string, unknown>;
    if (
      typeof id !== "string" ||
      characterById(id)?.role !== "specialist" ||
      seen.has(id)
    )
      throw new Error("Choose unique catalog specialists only");
    if (typeof phase !== "string" || !phases.has(phase as SpecialistPhase))
      throw new Error("Invalid specialist phase");
    if (
      typeof purpose !== "string" ||
      !purpose.trim() ||
      purpose.length > 240 ||
      /[\x00-\x1f\x7f]/.test(purpose)
    )
      throw new Error(
        "Enter a short specialist purpose without control characters",
      );
    seen.add(id);
    return {
      id: id as CharacterId,
      phase: phase as SpecialistPhase,
      purpose: purpose.trim(),
    };
  });
}

const phases = new Set<SpecialistPhase>([
  "planning",
  "building",
  "verification",
  "release",
]);

// Model suggestions are untrusted advice. Invalid entries never become a
// dispatch, and a valid plan survives malformed optional suggestions.
export function parseSpecialistSuggestions(value: unknown): {
  suggestions: SpecialistSuggestion[];
  discardedInvalid: boolean;
} {
  if (!Array.isArray(value)) return { suggestions: [], discardedInvalid: true };
  const suggestions: SpecialistSuggestion[] = [];
  const seen = new Set<string>();
  let discardedInvalid = value.length > 3;
  for (const candidate of value.slice(0, 3)) {
    if (
      !candidate ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) {
      discardedInvalid = true;
      continue;
    }
    const { id, phase, reason } = candidate as Record<string, unknown>;
    if (
      typeof id !== "string" ||
      characterById(id)?.role !== "specialist" ||
      seen.has(id) ||
      typeof phase !== "string" ||
      !phases.has(phase as SpecialistPhase) ||
      typeof reason !== "string" ||
      !reason.trim() ||
      reason.length > 240 ||
      /[\x00-\x1f\x7f]/.test(reason)
    ) {
      discardedInvalid = true;
      continue;
    }
    seen.add(id);
    suggestions.push({
      id: id as CharacterId,
      phase: phase as SpecialistPhase,
      reason: reason.trim(),
    });
  }
  return { suggestions, discardedInvalid };
}
