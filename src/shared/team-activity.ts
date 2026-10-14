import { initialTeam } from "./contracts";

export type TeamActivityCount = {
  recordedEvents: number;
  runsWithEvents: number;
};
export type TeamActivity = {
  byTeammate: Record<string, TeamActivityCount>;
  scannedRuns: number;
  partial: boolean;
};

const maxRuns = 2000;
const maxEventsPerRun = 2000;

export function summarizeTeamActivity(
  rows: Iterable<{ data: string | null }>,
): TeamActivity {
  const byTeammate: Record<string, TeamActivityCount> = Object.fromEntries(
    initialTeam.map(({ id }) => [id, { recordedEvents: 0, runsWithEvents: 0 }]),
  );
  let partial = false;
  let scannedRuns = 0;
  for (const row of rows) {
    if (scannedRuns === maxRuns) {
      partial = true;
      break;
    }
    scannedRuns++;
    if (row.data === null) {
      partial = true;
      continue;
    }
    let value: unknown;
    try {
      value = JSON.parse(row.data);
    } catch {
      partial = true;
      continue;
    }
    if (!value || typeof value !== "object" || !("events" in value)) {
      partial = true;
      continue;
    }
    const events = value.events;
    if (!Array.isArray(events)) {
      partial = true;
      continue;
    }
    if (events.length > maxEventsPerRun) partial = true;
    const savedTeam = "teamSnapshot" in value ? value.teamSnapshot : null;
    const savedMembers =
      savedTeam &&
      typeof savedTeam === "object" &&
      "members" in savedTeam &&
      Array.isArray(savedTeam.members) &&
      savedTeam.members.length <= 6
        ? savedTeam.members
        : initialTeam;
    const allowed = new Set<string>();
    for (const member of savedMembers) {
      if (
        member &&
        typeof member === "object" &&
        typeof member.id === "string" &&
        /^[a-z][a-z0-9-]{0,63}$/.test(member.id)
      )
        allowed.add(member.id);
    }
    const seen = new Set<string>();
    for (const event of events.slice(0, maxEventsPerRun)) {
      if (
        !event ||
        typeof event !== "object" ||
        typeof event.actor !== "string" ||
        typeof event.text !== "string" ||
        typeof event.at !== "string"
      ) {
        partial = true;
        continue;
      }
      if (!allowed.has(event.actor)) {
        if (event.actor !== "system") partial = true;
        continue;
      }
      if (!byTeammate[event.actor] && Object.keys(byTeammate).length >= 64) {
        partial = true;
        continue;
      }
      const count = (byTeammate[event.actor] ||= {
        recordedEvents: 0,
        runsWithEvents: 0,
      });
      count.recordedEvents++;
      seen.add(event.actor);
    }
    for (const id of seen) byTeammate[id].runsWithEvents++;
  }
  return { byTeammate, scannedRuns, partial };
}
