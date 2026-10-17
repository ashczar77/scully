import { safePath, type SourceFile, type Finding } from "./runs";
import { initialTeam, type Teammate } from "./contracts";
import { runRole } from "./teams";
export type OwnershipRule = { path: string; directory: boolean; owner: Writer };
export type CoordinationSettings = { ownership: string; chunkReviews: boolean };
export type ChunkReview = {
  owner: Writer;
  revision: string;
  status: "reviewing" | "complete" | "failed";
  summary: string;
  findings: Finding[];
};
export type Writer = string;
export type Assignment = {
  owner: Writer;
  scope: string;
  status: "waiting" | "working" | "awaiting_input" | "ready" | "failed";
  summary: string;
  files: SourceFile[];
  commands?: import("./commands").CommandSpec[];
};
export type Coordination = {
  rules?: OwnershipRule[];
  settings?: CoordinationSettings;
  chunkReviews?: ChunkReview[];
  assignments: Assignment[];
  integrator: string;
  auditor: string;
  conflicts: { path: string; detail: string }[];
  integratedRevision: string;
  auditedRevision: string;
  metrics: {
    writerWallMs: number;
    integrationMs: number;
    writerTotalMs: number;
  };
};
export function parseCoordinationSettings(
  value: unknown,
  writers: readonly string[] = ["maya", "jun"],
): {
  settings: CoordinationSettings;
  rules: OwnershipRule[];
} {
  const v = value as CoordinationSettings;
  if (
    !v ||
    typeof v.ownership !== "string" ||
    v.ownership.length > 4000 ||
    typeof v.chunkReviews !== "boolean"
  )
    throw new Error("Invalid coordination settings");
  const rules: OwnershipRule[] = [];
  for (const line of v.ownership
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)) {
    const match = /^([a-z][a-z0-9-]{0,63})\s+(.+)$/.exec(line);
    if (!match || !writers.includes(match[1]))
      throw new Error(
        `Use an assigned writer ID followed by a file or folder path: ${writers.join(" or ")}`,
      );
    const directory = match[2].endsWith("/");
    const path = directory ? match[2].slice(0, -1) : match[2];
    safePath(path);
    if (
      rules.some(
        (r) =>
          r.path.toLowerCase() === path.toLowerCase() ||
          r.path.toLowerCase().startsWith(path.toLowerCase() + "/") ||
          path.toLowerCase().startsWith(r.path.toLowerCase() + "/"),
      )
    )
      throw new Error("Ownership rules must not overlap");
    rules.push({ path, directory, owner: match[1] as Writer });
  }
  if (rules.length > 20)
    throw new Error("At most 20 ownership rules are allowed");
  return {
    settings: { ownership: v.ownership.trim(), chunkReviews: v.chunkReviews },
    rules,
  };
}
export function ownerFor(
  path: string,
  rules: OwnershipRule[] = [],
  writers: readonly string[] = ["maya", "jun"],
): Writer {
  const match = rules.find(
    (r) =>
      r.path.toLowerCase() === path.toLowerCase() ||
      (r.directory &&
        path.toLowerCase().startsWith(r.path.toLowerCase() + "/")),
  );
  return (
    match?.owner || (isTestPath(path) && writers[1] ? writers[1] : writers[0])
  );
}
export function isTestPath(path: string) {
  return /(^|\/)(__tests__|tests?|specs?)(\/|$)|(^|\/)test_[^/]+$|(?:[._](?:test|spec)|Test|Tests)\.[^/]+$/i.test(
    path,
  );
}
export function makeCoordination(
  team: readonly Teammate[] = initialTeam,
): Coordination {
  const builder = team.find((member) => runRole(member) === "builder");
  const auditor = team.find((member) => runRole(member) === "auditor");
  const tester = team.find((member) => runRole(member) === "tester");
  if (!builder || !auditor)
    throw new Error("A builder and independent auditor are required");
  return {
    assignments: [
      {
        owner: builder.id,
        scope: tester
          ? "Implementation and supporting files, excluding test paths"
          : "Implementation and test files",
        status: "waiting",
        summary: "",
        files: [],
      },
      ...(tester
        ? [
            {
              owner: tester.id,
              scope:
                "Test paths only (test/tests/spec directories or recognised test/spec filenames)",
              status: "waiting" as const,
              summary: "",
              files: [],
            },
          ]
        : []),
    ],
    integrator: builder.id,
    auditor: auditor.id,
    conflicts: [],
    integratedRevision: "",
    auditedRevision: "",
    metrics: { writerWallMs: 0, integrationMs: 0, writerTotalMs: 0 },
  };
}
export function requestLimit(run: {
  coordination?: Coordination;
  correction?: unknown;
  usagePolicy?: { requestCeiling: number };
  plan?: string;
}) {
  if (run.usagePolicy) return run.usagePolicy.requestCeiling;
  if (run.correction) return 2;
  if (!run.coordination) return 3;
  const writers = run.coordination.assignments.length;
  return (
    (writers === 2 ? 4 : writers + 1 + (run.plan ? 1 : 0)) +
    (run.coordination.settings?.chunkReviews ? writers : 0)
  );
}
