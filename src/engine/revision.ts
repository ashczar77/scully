import { createHash } from "node:crypto";
import type { Run } from "../shared/runs";
import { parseCommands } from "../shared/commands";

export function commandRevision(run: Run): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        id: run.id,
        taskId: run.taskId,
        files: run.files,
        drafts: run.drafts,
        plan: run.plan,
        commands: parseCommands(run.commands),
        ...(run.commands?.some((c) => c.findingLink)
          ? { findingLinks: run.commands.map((c) => c.findingLink || null) }
          : {}),
      }),
    )
    .digest("hex");
}
