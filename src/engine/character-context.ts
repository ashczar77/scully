import type { Teammate } from "../shared/contracts";
import { rosterMembers, type FixedRoster } from "../shared/fixed-teams";
import { runRole } from "../shared/teams";

// Saved snapshots preserve identity and history, but cannot supply authority or
// request-time instructions for the immutable fixed cast.
export function bindRunTeam(
  team: Teammate[],
  roster: FixedRoster | undefined,
): Teammate[] {
  if (!roster) return team;
  const expected = rosterMembers(roster);
  if (!team.some((member) => member.id === "pearl"))
    throw new Error("Fixed-cast coordinator is missing");
  if (
    team.length !== expected.length ||
    expected.some(
      (member, index) =>
        team[index]?.id !== member.id ||
        runRole(team[index]) !== member.runRole,
    )
  )
    throw new Error("Run team does not match its fixed-cast roster");
  return team.map((member, index) => ({
    ...member,
    instructions: expected[index].instructions,
  }));
}
