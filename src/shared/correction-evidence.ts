import {
  assessLocalCriterion,
  type CriterionObservation,
} from "./check-criteria";
import type { CommandSpec } from "./commands";
import type { Run } from "./runs";

export type CorrectionComparison = {
  status: "unavailable" | "awaiting_execution" | "compared";
  detail: string;
  baseline?: CriterionObservation;
  candidate?: CriterionObservation;
};

function content(run: Run, path: string) {
  return (
    run.drafts.find((file) => file.path === path) ||
    run.files.find((file) => file.path === path)
  )?.content;
}

function spec(command: CommandSpec): CommandSpec {
  return {
    executable: command.executable,
    args: command.args,
    cwd: command.cwd,
    reason: command.reason,
    timeoutSeconds: command.timeoutSeconds,
  };
}

export function compareCorrection(
  parent: Run | undefined,
  child: Run,
): CorrectionComparison {
  const recheck = child.correction?.recheck;
  const selectedFinding =
    parent?.specialistAudits?.[child.correction?.auditIndex || 0]?.findings[
      child.correction?.findingIndex || 0
    ];
  if (!recheck)
    return {
      status: "unavailable",
      detail: "No single failed, focused local check was eligible for replay.",
    };
  if (
    !parent ||
    parent.id !== recheck.parentRunId ||
    child.correction?.parentId !== parent.id ||
    child.taskId !== parent.taskId ||
    child.correction.parentRevision !==
      parent.specialistAudits?.[child.correction.auditIndex]?.revision ||
    parent.coordination?.integratedRevision !==
      child.correction.parentRevision ||
    parent.coordination.auditedRevision !== child.correction.parentRevision ||
    selectedFinding?.path !== child.correction.finding.path ||
    selectedFinding.detail !== child.correction.finding.detail ||
    selectedFinding.severity !== child.correction.finding.severity
  )
    return {
      status: "unavailable",
      detail: "The original run is unavailable for comparison.",
    };
  if (["prepared", "planned", "building"].includes(child.status))
    return {
      status: "awaiting_execution",
      detail:
        "The original failed check is reserved for this corrective attempt. It will only be proposed if its test file stays unchanged.",
    };
  if (child.status !== "complete")
    return {
      status: "unavailable",
      detail: "The corrective draft did not complete.",
    };
  const original = parent.commands?.find(
    (command) => command.id === recheck.parentCommandId,
  );
  const baseline = parent.executions?.find(
    (execution) => execution.id === recheck.parentExecutionId,
  );
  const replay = child.commands?.filter(
    (command) => command.recheckOf?.parentCommandId === recheck.parentCommandId,
  );
  if (
    !original ||
    !baseline ||
    baseline.runId !== parent.id ||
    !replay ||
    replay.length !== 1 ||
    original.revision !== recheck.parentCommandRevision ||
    original.findingLink?.auditIndex !== child.correction?.auditIndex ||
    original.findingLink?.findingIndex !== child.correction?.findingIndex ||
    JSON.stringify(original.findingLink?.criterion) !==
      JSON.stringify(recheck.criterion) ||
    JSON.stringify(spec(original)) !== JSON.stringify(recheck.command) ||
    JSON.stringify(spec(replay[0])) !== JSON.stringify(recheck.command) ||
    JSON.stringify(replay[0].recheckOf) !==
      JSON.stringify({
        parentRunId: recheck.parentRunId,
        parentCommandId: recheck.parentCommandId,
        parentExecutionId: recheck.parentExecutionId,
        parentCommandRevision: recheck.parentCommandRevision,
        testPath: recheck.testPath,
        testSha256: recheck.testSha256,
        criterion: recheck.criterion,
      }) ||
    content(parent, recheck.testPath) === undefined ||
    content(parent, recheck.testPath) !== content(child, recheck.testPath)
  )
    return {
      status: "unavailable",
      detail:
        "The original check, replay proposal, or test content no longer matches the recorded lineage.",
    };
  const before = assessLocalCriterion(original, baseline);
  if (before.status !== "not_met")
    return {
      status: "unavailable",
      detail: "The recorded baseline did not fail its proposed criterion.",
    };
  const results = (child.executions || []).filter(
    (execution) => execution.commandId === replay[0].id,
  );
  if (!results.length)
    return {
      status: "awaiting_execution",
      detail:
        "The unchanged check is proposed but has not run on the correction. Review and approve the exact command to compare outcomes.",
      baseline: before,
    };
  if (results.length !== 1)
    return {
      status: "unavailable",
      detail:
        "More than one replay result exists. Review each execution separately; no result was selected automatically.",
    };
  const after = assessLocalCriterion(replay[0], results[0]);
  if (results[0].runId !== child.id || after.status === "unavailable")
    return {
      status: "unavailable",
      detail:
        "The corrective execution has no matching run identity or completed outcome suitable for this criterion.",
      baseline: before,
      candidate: after,
    };
  return {
    status: "compared",
    detail:
      "Same check and unchanged test content across two revisions. A matching outcome is evidence, not proof that the finding is resolved.",
    baseline: before,
    candidate: after,
  };
}
