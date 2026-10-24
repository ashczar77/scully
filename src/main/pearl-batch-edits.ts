import { createHash } from "node:crypto";
import type { DraftFile, ProjectWorkspace } from "../shared/runs";
import { safePath } from "../shared/runs";
import { blockedProjectPart } from "./pearl-project-map";
import { applyTextPatch, type PatchHunk, type TextEdit } from "./pearl-patch";
import { inspectProjectFile } from "./project-workspace";

export type PreparedBatch = {
  drafts: DraftFile[];
  review: { diff: string; digest: string; files: number };
  results: { path: string; sha256: string; hunks?: PatchHunk[] }[];
};

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function diff(path: string, before: string | null, after: string): string {
  const removed = before === null ? [] : before.split("\n");
  const added = after.split("\n");
  return [
    `--- ${before === null ? "/dev/null" : `a/${path}`}`,
    `+++ b/${path}`,
    ...removed.map((line) => `-${line}`),
    ...added.map((line) => `+${line}`),
  ].join("\n");
}

export function prepareBatchEdits(
  binding: ProjectWorkspace,
  readRevisions: Record<string, string> | undefined,
  input: unknown,
): PreparedBatch {
  if (
    !input ||
    typeof input !== "object" ||
    !Array.isArray((input as { files?: unknown }).files)
  )
    throw new Error("Invalid file transaction");
  const files = (input as { files: unknown[] }).files;
  if (files.length < 2 || files.length > 8)
    throw new Error("A file transaction needs two to eight files");
  const seen = new Set<string>();
  const drafts: DraftFile[] = [];
  const results: PreparedBatch["results"] = [];
  const previews: string[] = [];
  let total = 0;
  for (const value of files) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Invalid file transaction entry");
    const file = value as Record<string, unknown>;
    safePath(file.path);
    const path = file.path as string;
    if (path.split("/").some(blockedProjectPart))
      throw new Error("That project path is private or unavailable");
    const key = path.toLowerCase();
    if (seen.has(key)) throw new Error("Duplicate transaction path");
    seen.add(key);
    if (!["create", "write", "patch"].includes(file.operation as string))
      throw new Error("Invalid file transaction operation");
    if (
      (file.operation === "create" &&
        (file.expectedSha256 !== undefined || file.edits !== undefined)) ||
      (file.operation === "write" && file.edits !== undefined) ||
      (file.operation === "patch" && file.content !== undefined)
    )
      throw new Error("File transaction entry mixes operations");
    const before = inspectProjectFile(binding, path);
    let content: string;
    let hunks: PatchHunk[] | undefined;
    if (file.operation === "create") {
      if (before !== null) throw new Error(`File already exists: ${path}`);
      if (typeof file.content !== "string")
        throw new Error("Invalid file content");
      content = file.content;
    } else {
      if (before === null) throw new Error(`File does not exist: ${path}`);
      if (
        typeof file.expectedSha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(file.expectedSha256) ||
        readRevisions?.[path] !== file.expectedSha256
      )
        throw new Error(`Read ${path} in this chat before editing it`);
      if (digest(before) !== file.expectedSha256)
        throw new Error(`File changed since it was read: ${path}`);
      if (file.operation === "write") {
        if (typeof file.content !== "string")
          throw new Error("Invalid file content");
        content = file.content;
      } else {
        const patched = applyTextPatch(before, file.edits as TextEdit[]);
        content = patched.content;
        hunks = patched.hunks;
      }
    }
    if (content.length > 1_000_000)
      throw new Error("File content exceeds the write limit");
    if (before === content) throw new Error(`No change proposed for ${path}`);
    total += content.length + (before?.length || 0);
    if (total > 400_000) throw new Error("File transaction exceeds size limit");
    drafts.push({ path, before, content });
    results.push({
      path,
      sha256: digest(content),
      ...(hunks ? { hunks } : {}),
    });
    previews.push(diff(path, before, content));
  }
  for (const path of seen)
    if ([...seen].some((other) => other.startsWith(`${path}/`)))
      throw new Error("Transaction paths overlap");
  const preview = previews.join("\n\n");
  if (preview.length > 800_000)
    throw new Error("Transaction diff exceeds review limit");
  return {
    drafts,
    review: {
      diff: preview,
      digest: digest(JSON.stringify(drafts)),
      files: files.length,
    },
    results,
  };
}
