import { createHash } from "node:crypto";
import { lstatSync, opendirSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";
import type {
  ArtifactCategory,
  ArtifactInventory,
  ArtifactKind,
} from "../shared/artifacts";

const kinds: ArtifactKind[] = ["drafts", "executions", "applications"];
const defaultLimit = 2_000;
const maxDepth = 12;
const maxSavedRuns = 2_000;

function missing(error: unknown) {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

function inspectCategory(
  dataRoot: string,
  kind: ArtifactKind,
  limit: number,
): ArtifactCategory {
  const root = join(dataRoot, kind);
  const result: ArtifactCategory = {
    kind,
    status: "complete",
    items: 0,
    files: 0,
    logicalBytes: 0,
    scannedEntries: 0,
    skipped: 0,
  };
  try {
    const stat = lstatSync(root);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      realpathSync(root) !== root
    ) {
      result.status = "unavailable";
      return result;
    }
  } catch (error) {
    result.status = missing(error) ? "missing" : "unavailable";
    return result;
  }
  function walk(directory: string, depth: number) {
    if (depth > maxDepth) {
      result.status = "partial";
      return;
    }
    try {
      const stat = lstatSync(directory);
      const canonical = realpathSync(directory);
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        (canonical !== root && !canonical.startsWith(root + sep))
      ) {
        result.skipped++;
        result.status = "partial";
        return;
      }
      const dir = opendirSync(directory);
      try {
        let entry;
        while ((entry = dir.readSync()) !== null) {
          if (result.scannedEntries >= limit) {
            result.status = "partial";
            break;
          }
          result.scannedEntries++;
          if (depth === 0) result.items++;
          const child = join(directory, entry.name);
          try {
            const childStat = lstatSync(child);
            if (childStat.isSymbolicLink()) {
              result.skipped++;
              result.status = "partial";
            } else if (childStat.isDirectory()) {
              walk(child, depth + 1);
            } else if (childStat.isFile()) {
              result.files++;
              if (Number.isSafeInteger(result.logicalBytes + childStat.size))
                result.logicalBytes += childStat.size;
              else result.status = "partial";
            } else {
              result.skipped++;
              result.status = "partial";
            }
          } catch {
            result.skipped++;
            result.status = "partial";
          }
        }
      } finally {
        dir.closeSync();
      }
    } catch {
      result.status = "partial";
    }
  }
  walk(root, 0);
  return result;
}

function inspectExecutionCopyLinks(
  dataRoot: string,
  limit: number,
  runIds: readonly string[],
  knownRunsComplete: boolean,
): ArtifactInventory["executionCopyLinks"] {
  const root = join(dataRoot, "executions");
  const completeList = knownRunsComplete && runIds.length <= maxSavedRuns;
  const known = new Set(
    runIds
      .slice(0, maxSavedRuns)
      .filter((id) => /^[A-Za-z0-9_-]{1,100}$/.test(id))
      .map((id) => createHash("sha256").update(id).digest("hex")),
  );
  const result: ArtifactInventory["executionCopyLinks"] = {
    status: completeList ? "complete" : "partial",
    matchingSavedRuns: 0,
    unassigned: completeList ? 0 : null,
    scanned: 0,
  };
  try {
    const stat = lstatSync(root);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      realpathSync(root) !== root
    ) {
      result.status = "unavailable";
      result.unassigned = null;
      return result;
    }
  } catch (error) {
    result.status = missing(error) ? "missing" : "unavailable";
    result.unassigned = result.status === "missing" ? 0 : null;
    return result;
  }
  try {
    const dir = opendirSync(root);
    try {
      let entry;
      while ((entry = dir.readSync()) !== null) {
        if (result.scanned >= limit) {
          result.status = "partial";
          break;
        }
        result.scanned++;
        try {
          if (!lstatSync(join(root, entry.name)).isDirectory()) {
            result.status = "partial";
            continue;
          }
          const named = /^check-r-([a-f0-9]{64})-[A-Za-z0-9]{6}$/.exec(
            entry.name,
          );
          if (named && known.has(named[1])) result.matchingSavedRuns++;
          else if (result.unassigned !== null) result.unassigned++;
        } catch {
          result.status = "partial";
        }
      }
    } finally {
      dir.closeSync();
    }
  } catch {
    result.status = "partial";
  }
  return result;
}

// Counts logical file sizes only. Never returns paths or opens file content.
export function inspectLocalArtifacts(
  dataRoot: string,
  entryLimit = defaultLimit,
  runIds: readonly string[] = [],
  knownRunsComplete = false,
): ArtifactInventory {
  const root = realpathSync(dataRoot);
  const limit =
    Number.isSafeInteger(entryLimit) && entryLimit > 0
      ? Math.min(entryLimit, defaultLimit)
      : defaultLimit;
  return {
    checkedAt: new Date().toISOString(),
    categories: kinds.map((kind) => inspectCategory(root, kind, limit)),
    executionCopyLinks: inspectExecutionCopyLinks(
      root,
      limit,
      runIds,
      knownRunsComplete,
    ),
  };
}
