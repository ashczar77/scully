import { safePath, type SourceFile, type Finding } from "./runs";
export type OwnershipRule = { path: string; directory: boolean; owner: Writer };
export type CoordinationSettings = { ownership: string; chunkReviews: boolean };
export type ChunkReview = {
  owner: Writer;
  revision: string;
  status: "reviewing" | "complete" | "failed";
  summary: string;
  findings: Finding[];
};
export type Writer = "maya" | "jun";
export type Assignment = {
  owner: Writer;
  scope: string;
  status: "waiting" | "working" | "ready" | "failed";
  summary: string;
  files: SourceFile[];
};
export type Coordination = {
  rules?: OwnershipRule[];
  settings?: CoordinationSettings;
  chunkReviews?: ChunkReview[];
  assignments: Assignment[];
  integrator: "maya";
  auditor: "ellis";
  conflicts: { path: string; detail: string }[];
  integratedRevision: string;
  auditedRevision: string;
  metrics: {
    writerWallMs: number;
    integrationMs: number;
    writerTotalMs: number;
  };
};
export function parseCoordinationSettings(value: unknown): {
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
    const match = /^(maya|jun)\s+(.+)$/.exec(line);
    if (!match)
      throw new Error("Use one rule per line: maya path or jun folder/");
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
export function ownerFor(path: string, rules: OwnershipRule[] = []): Writer {
  const match = rules.find(
    (r) =>
      r.path.toLowerCase() === path.toLowerCase() ||
      (r.directory &&
        path.toLowerCase().startsWith(r.path.toLowerCase() + "/")),
  );
  return match?.owner || (isTestPath(path) ? "jun" : "maya");
}
export function isTestPath(path: string) {
  return /(^|\/)(__tests__|tests?|specs?)(\/|$)|(^|\/)test_[^/]+$|(?:[._](?:test|spec)|Test|Tests)\.[^/]+$/i.test(
    path,
  );
}
export function makeCoordination(): Coordination {
  return {
    assignments: [
      {
        owner: "maya",
        scope: "Implementation and supporting files, excluding test paths",
        status: "waiting",
        summary: "",
        files: [],
      },
      {
        owner: "jun",
        scope:
          "Test paths only (test/tests/spec directories or recognised test/spec filenames)",
        status: "waiting",
        summary: "",
        files: [],
      },
    ],
    integrator: "maya",
    auditor: "ellis",
    conflicts: [],
    integratedRevision: "",
    auditedRevision: "",
    metrics: { writerWallMs: 0, integrationMs: 0, writerTotalMs: 0 },
  };
}
export function requestLimit(run: {
  coordination?: Coordination;
  correction?: unknown;
}) {
  if (run.correction) return 2;
  return run.coordination
    ? run.coordination.settings?.chunkReviews
      ? 6
      : 4
    : 3;
}
