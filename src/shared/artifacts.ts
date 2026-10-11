export type ArtifactKind = "drafts" | "executions" | "applications";
export type ArtifactCategory = {
  kind: ArtifactKind;
  status: "complete" | "missing" | "partial" | "unavailable";
  items: number;
  files: number;
  logicalBytes: number;
  scannedEntries: number;
  skipped: number;
};
export type ArtifactInventory = {
  checkedAt: string;
  categories: ArtifactCategory[];
  executionCopyLinks: {
    status: "complete" | "missing" | "partial" | "unavailable";
    matchingSavedRuns: number;
    unassigned: number | null;
    scanned: number;
  };
};
