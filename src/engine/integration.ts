import { createHash } from "node:crypto";
import {
  ownerFor,
  type Assignment,
  type OwnershipRule,
} from "../shared/coordination";
import { safePath, type SourceFile } from "../shared/runs";
export function snapshotRevision(base: SourceFile[], changes: SourceFile[]) {
  const merged = new Map(base.map((f) => [f.path, f.content]));
  for (const f of changes) merged.set(f.path, f.content);
  return createHash("sha256")
    .update(JSON.stringify([...merged].sort(([a], [b]) => a.localeCompare(b))))
    .digest("hex");
}

export function integrate(
  base: SourceFile[],
  assignments: Assignment[],
  rules: OwnershipRule[] = [],
) {
  const conflicts: { path: string; detail: string }[] = [];
  const claimed = new Map<string, string>();
  const files: SourceFile[] = [];
  for (const assignment of assignments) {
    for (const file of assignment.files) {
      safePath(file.path);
      const path = file.path.toLowerCase();
      const previous = [...claimed.keys()].find(
        (p) =>
          p === path || p.startsWith(path + "/") || path.startsWith(p + "/"),
      );
      if (previous)
        conflicts.push({
          path: file.path,
          detail: `Overlapping writers: ${claimed.get(previous)} and ${assignment.owner}. Nothing was integrated.`,
        });
      claimed.set(path, assignment.owner);
      if (ownerFor(file.path, rules) !== assignment.owner)
        conflicts.push({
          path: file.path,
          detail: `${assignment.owner} edited outside the assigned scope. Nothing was integrated.`,
        });
      files.push(file);
    }
  }
  const merged = new Map(base.map((f) => [f.path, f.content]));
  for (const f of files) merged.set(f.path, f.content);
  const names: string[] = [];
  for (const path of merged.keys()) {
    safePath(path);
    const folded = path.toLowerCase();
    if (
      names.some(
        (p) =>
          p === folded ||
          p.startsWith(folded + "/") ||
          folded.startsWith(p + "/"),
      )
    )
      conflicts.push({
        path,
        detail: "Combined output conflicts with the selected snapshot.",
      });
    names.push(folded);
  }
  if (
    files.length > 12 ||
    files.reduce((n, f) => n + Buffer.byteLength(f.content), 0) > 48_000
  )
    conflicts.push({
      path: "(combined draft)",
      detail: "Combined changes exceed the 12-file / 48 KB limit.",
    });
  const revision = snapshotRevision(base, files);
  return {
    files: conflicts.length ? [] : files,
    conflicts,
    revision: conflicts.length ? "" : revision,
  };
}
