import { useState } from "react";
import type { CloudExecution } from "../shared/cloud";
import type { CommandProposal } from "../shared/commands";
import { assessCloudCriterion } from "../shared/check-criteria";

type Candidate = {
  execution: CloudExecution;
  number: number;
  command?: CommandProposal;
};

export function comparisonGroups(
  executions: CloudExecution[],
  commands: CommandProposal[],
): Candidate[][] {
  const groups = new Map<string, Candidate[]>();
  for (const [index, execution] of executions.entries()) {
    if (
      execution.status !== "complete" ||
      !execution.operationId ||
      !execution.projectId ||
      !execution.revision ||
      !execution.image
    )
      continue;
    const source = JSON.stringify([
      execution.projectId,
      execution.revision,
      execution.image,
    ]);
    const group = groups.get(source) || [];
    group.push({
      execution,
      number: index + 1,
      command: commands.find(
        (command) =>
          command.id === execution.commandId &&
          command.revision === execution.revision,
      ),
    });
    groups.set(source, group);
  }
  return [...groups.values()].filter((group) => group.length >= 2);
}

const previewLimit = 2_000;

function uploadedFiles(execution: CloudExecution): string {
  return JSON.stringify(
    [...(execution.files || [])]
      .map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }))
      .sort((a, b) => a.path.localeCompare(b.path)),
  );
}

export function invocationDifferences(
  left: CloudExecution,
  right: CloudExecution,
): string[] {
  const differences: string[] = [];
  if (left.executable !== right.executable) differences.push("executable");
  if (JSON.stringify(left.args) !== JSON.stringify(right.args))
    differences.push("arguments");
  if (left.cwd !== right.cwd) differences.push("working directory");
  if (left.timeoutSeconds !== right.timeoutSeconds) differences.push("timeout");
  if (uploadedFiles(left) !== uploadedFiles(right))
    differences.push("uploaded files");
  return differences;
}

function outputPreview(output: string): string {
  if (!output) return "No standard output captured.";
  if (output.length <= previewLimit) return output;
  return `${output.slice(0, previewLimit)}\n[Comparison preview ends here. Open the individual check for more captured output.]`;
}

function CheckOutput({
  candidate,
  side,
}: {
  candidate: Candidate;
  side: "A" | "B";
}) {
  const { execution, number, command } = candidate;
  const observation =
    command?.findingLink?.criterion && assessCloudCriterion(command, execution);
  return (
    <article className="cloud-compare-result">
      <h5>
        {side}: check {number}
      </h5>
      <p>Command: {command?.executable || execution.executable}</p>
      <p>
        Service status: {execution.remoteStatus || "unknown"}. Process exit:{" "}
        {execution.exitCode ?? "unavailable"}.
      </p>
      {command?.findingLink?.expected && (
        <p className="muted">
          Proposed expected observation: {command.findingLink.expected}
        </p>
      )}
      {observation && (
        <p className="muted">
          Proposed criterion {observation.status}: {observation.detail}
        </p>
      )}
      <pre aria-label={`Check ${number} captured stdout`}>
        {outputPreview(execution.stdout)}
      </pre>
      {execution.stderr && (
        <pre aria-label={`Check ${number} captured stderr`}>
          {outputPreview(execution.stderr)}
        </pre>
      )}
    </article>
  );
}

function ComparisonGroup({ candidates }: { candidates: Candidate[] }) {
  const [leftId, setLeftId] = useState(candidates[0].execution.id);
  const [rightId, setRightId] = useState(candidates[1].execution.id);
  const left =
    candidates.find(({ execution }) => execution.id === leftId) ||
    candidates[0];
  const right =
    candidates.find(({ execution }) => execution.id === rightId) ||
    candidates[1];
  const differences = invocationDifferences(left.execution, right.execution);
  const confirmedOutcomes =
    left.execution.remoteStatus === "SUCCESS" &&
    right.execution.remoteStatus === "SUCCESS" &&
    typeof left.execution.exitCode === "number" &&
    typeof right.execution.exitCode === "number";

  function choose(side: "A" | "B", id: string) {
    if (side === "A") {
      if (id === rightId) setRightId(leftId);
      setLeftId(id);
    } else {
      if (id === leftId) setLeftId(rightId);
      setRightId(id);
    }
  }

  return (
    <div className="cloud-compare-group">
      <p>
        Same starting environment:{" "}
        {left.execution.imageTag || left.execution.image}
      </p>
      <div
        className="cloud-compare-options"
        role="group"
        aria-label="Choose checks to compare"
      >
        {candidates.map(({ execution, number }) => (
          <div className="cloud-compare-option" key={execution.id}>
            <span>Check {number}</span>
            <button
              type="button"
              className="secondary"
              aria-pressed={left.execution.id === execution.id}
              aria-label={`Set check ${number} as A`}
              onClick={() => choose("A", execution.id)}
            >
              A
            </button>
            <button
              type="button"
              className="secondary"
              aria-pressed={right.execution.id === execution.id}
              aria-label={`Set check ${number} as B`}
              onClick={() => choose("B", execution.id)}
            >
              B
            </button>
          </div>
        ))}
      </div>
      {differences.length ? (
        <p className="muted">
          Different check invocation: {differences.join(", ")}. Outputs are
          shown side by side, but are not compared as a like-for-like result.
        </p>
      ) : !confirmedOutcomes ? (
        <p className="muted">
          The invocation matches, but at least one check lacks a successful
          service result and confirmed process exit. Captured output is shown
          without a like-for-like outcome comparison.
        </p>
      ) : (
        <p className="muted">
          Same command, arguments, working directory, timeout and uploaded
          files. Recorded stdout{" "}
          {left.execution.stdout === right.execution.stdout
            ? "matches"
            : "differs"}
          ; recorded stderr{" "}
          {left.execution.stderr === right.execution.stderr
            ? "matches"
            : "differs"}
          . Process exit: {left.execution.exitCode ?? "unavailable"} to{" "}
          {right.execution.exitCode ?? "unavailable"}. These are observations,
          not a correctness verdict.
        </p>
      )}
      <div className="cloud-compare-results">
        <CheckOutput candidate={left} side="A" />
        <CheckOutput candidate={right} side="B" />
      </div>
    </div>
  );
}

export function CloudComparison({
  executions,
  commands,
}: {
  executions: CloudExecution[];
  commands: CommandProposal[];
}) {
  const groups = comparisonGroups(executions, commands);
  if (groups.length === 0) return null;
  return (
    <section className="cloud-comparison" aria-label="Experiment comparison">
      <h4>Compare sandbox checks</h4>
      <p className="muted">
        Only completed checks from the same project, draft revision, and
        starting image are grouped. Service output may be truncated. Matching
        text or a zero exit code does not prove the approach works.
      </p>
      {groups.map((group) => (
        <ComparisonGroup
          key={`${group[0].execution.projectId}:${group[0].execution.revision}:${group[0].execution.image}`}
          candidates={group}
        />
      ))}
    </section>
  );
}
