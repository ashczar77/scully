import { createHash } from "node:crypto";
import type { Run } from "../shared/runs";
import { parseCommands } from "../shared/commands";
import type { Task } from "../shared/contracts";

export function lineupPlanRevision(
  run: Run,
  task: Pick<Task, "title" | "description">,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        plan: run.plan,
        files: run.files,
        task: { title: task.title, description: task.description },
        roster: run.teamSnapshot?.roster,
      }),
    )
    .digest("hex");
}

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
        ...(run.commands?.some((c) => c.recheckOf)
          ? { rechecks: run.commands.map((c) => c.recheckOf || null) }
          : {}),
      }),
    )
    .digest("hex");
}
