import type { CloudExecution } from "./cloud";
import type { CheckCriterion, CommandProposal } from "./commands";
import type { ExecutionResult } from "./execution";

export type CriterionObservation = {
  status: "met" | "not_met" | "unavailable" | "not_specified";
  detail: string;
};

function assess(
  criterion: CheckCriterion | undefined,
  complete: boolean,
  exitCode: number | null,
  output: string[],
  outputComplete: boolean,
): CriterionObservation {
  if (!criterion)
    return {
      status: "not_specified",
      detail: "No machine-checkable criterion was proposed for this check.",
    };
  if (!complete || typeof exitCode !== "number")
    return {
      status: "unavailable",
      detail:
        "A completed process outcome is not available for this criterion.",
    };
  if (exitCode !== criterion.exitCode)
    return {
      status: "not_met",
      detail: `Recorded exit ${exitCode} differs from proposed exit ${criterion.exitCode}.`,
    };
  if (criterion.outputIncludes) {
    if (!outputComplete)
      return {
        status: "unavailable",
        detail:
          "The output-dependent criterion cannot be evaluated from incomplete capture.",
      };
    if (!output.some((stream) => stream.includes(criterion.outputIncludes!)))
      return {
        status: "not_met",
        detail:
          "The proposed literal text was not found in the recorded output.",
      };
  }
  return {
    status: "met",
    detail:
      "Recorded exit and any required output marker match the proposed criterion. This does not validate the test itself.",
  };
}

export function assessLocalCriterion(
  command: CommandProposal,
  execution: ExecutionResult,
): CriterionObservation {
  const bound =
    command.id === execution.commandId &&
    command.revision === execution.revision;
  return assess(
    command.findingLink?.criterion || command.recheckOf?.criterion,
    bound && execution.status === "exited" && !execution.signal,
    execution.exitCode,
    [execution.output],
    execution.status === "exited",
  );
}

export function assessCloudCriterion(
  command: CommandProposal,
  execution: CloudExecution,
): CriterionObservation {
  const bound =
    command.id === execution.commandId &&
    command.revision === execution.revision;
  return assess(
    command.findingLink?.criterion,
    bound &&
      !!execution.operationId &&
      execution.status === "complete" &&
      execution.remoteStatus === "SUCCESS" &&
      execution.timedOut === false &&
      execution.signal === null,
    execution.exitCode,
    [execution.stdout, execution.stderr],
    execution.outputTruncated === false,
  );
}
