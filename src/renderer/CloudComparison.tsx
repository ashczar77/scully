import { useState } from "react";
import type { CloudExecution } from "../shared/cloud";
import type { CommandProposal } from "../shared/commands";

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
      <p className="muted">
        Recorded stdout{" "}
        {left.execution.stdout === right.execution.stdout
          ? "matches"
          : "differs"}
        . This compares captured text, not behavior or correctness.
      </p>
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
