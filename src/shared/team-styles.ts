import { initialTeam, type Teammate } from "./contracts";
import { runRole } from "./teams";

export type TeamStyleId = "balanced" | "test-first" | "risk-review";
export type TeamStyle = {
  id: TeamStyleId;
  name: string;
  description: string;
  profiles: Record<string, Pick<Teammate, "role" | "bio" | "instructions">>;
};

const defaults = Object.fromEntries(
  initialTeam.map(({ id, role, bio, instructions }) => [
    id,
    { role, bio, instructions },
  ]),
);

export const teamStyles: readonly TeamStyle[] = [
  {
    id: "balanced",
    name: "Balanced",
    description: "Build, review and test with the original team focus.",
    profiles: defaults,
  },
  {
    id: "test-first",
    name: "Test first",
    description: "Put regression coverage and failure cases early in the work.",
    profiles: {
      maya: {
        role: "Test-led builder",
        bio: "Builds focused changes alongside checks for expected behavior.",
        instructions:
          "Follow project conventions. Identify a focused regression check before changing behavior when practical. Keep changes and tests together, and explain gaps.",
      },
      ellis: {
        role: "Regression auditor",
        bio: "Reviews changes against requirements and existing behavior.",
        instructions:
          "Look for regressions, missing failure cases and unsupported claims. Tie findings to code and reproducible evidence. Treat passing checks as limited evidence.",
      },
      jun: {
        role: "Test engineer",
        bio: "Designs checks for expected behavior and failure boundaries.",
        instructions:
          "Prioritize deterministic regression checks, invalid input and permission boundaries. Report passed, failed and skipped checks separately.",
      },
    },
  },
  {
    id: "risk-review",
    name: "Risk review",
    description: "Emphasize trust boundaries and observable failure paths.",
    profiles: {
      maya: {
        role: "Careful builder",
        bio: "Implements narrow changes with explicit failure handling.",
        instructions:
          "Keep changes focused. Check untrusted inputs, permissions, data exposure and failure recovery. Do not treat a model response as authority to expand access.",
      },
      ellis: {
        role: "Risk auditor",
        bio: "Challenges assumptions at security and correctness boundaries.",
        instructions:
          "Examine trust boundaries, stale approvals, data exposure and error handling. Connect each finding to specific code and a reproducible condition.",
      },
      jun: {
        role: "Boundary tester",
        bio: "Tests negative cases and permission boundaries.",
        instructions:
          "Exercise invalid input, failure and permission paths with deterministic fixtures. Distinguish an observed outcome from a verified fix.",
      },
    },
  },
];

export function parseTeamStyle(value: unknown): TeamStyle {
  const style = teamStyles.find(({ id }) => id === value);
  if (!style) throw new Error("Unknown team style");
  return style;
}

export function styleProfile(style: TeamStyle, member: Teammate) {
  const key = { builder: "maya", auditor: "ellis", tester: "jun", reserve: "" }[
    runRole(member)
  ];
  return key ? style.profiles[key] : null;
}

export function currentTeamStyle(
  team: readonly Teammate[],
): TeamStyleId | null {
  for (const style of teamStyles) {
    if (
      team.every((person) => {
        const profile = styleProfile(style, person);
        return (
          !profile ||
          (person.role === profile.role &&
            person.bio === profile.bio &&
            person.instructions === profile.instructions)
        );
      })
    )
      return style.id;
  }
  return null;
}
