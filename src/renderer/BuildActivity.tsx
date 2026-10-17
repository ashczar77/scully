import type { Run } from "../shared/runs";

export function BuildActivity({ run }: { run: Run }) {
  const started = [
    "building",
    "auditing",
    "complete",
    "failed",
    "conflicted",
  ].includes(run.status);
  if (!started) return null;
  const executions = run.executions || [];
  const assignments = run.coordination?.assignments || [];
  return (
    <section
      className="settings-card build-activity"
      aria-label="Build activity"
    >
      <h3>Build activity</h3>
      <p className="muted">
        {run.status === "building"
          ? "Private drafts are in progress."
          : run.status === "auditing"
            ? "The combined private draft is under review."
            : run.status === "failed"
              ? "This attempt stopped before integration or after a review failure."
              : "Review the stage history and any approved command output below."}
      </p>
      {assignments.length > 0 && (
        <ul className="build-assignment-list">
          {assignments.map((assignment) => (
            <li key={assignment.owner}>
              <strong>
                {run.teamSnapshot?.members.find(
                  (person) => person.id === assignment.owner,
                )?.name || assignment.owner}
              </strong>
              {" · "}
              {assignment.status}
              {assignment.status === "failed" && assignment.summary && (
                <span>: {assignment.summary}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="build-event-log" role="log" aria-label="Build stage log">
        {run.events.map((entry, index) => (
          <p key={index}>
            <time dateTime={entry.at}>
              {new Date(entry.at).toLocaleTimeString()}
            </time>{" "}
            <strong>
              {entry.actorName ||
                (entry.actor === "system" ? "Scully" : entry.actor)}
            </strong>
            : {entry.text}
          </p>
        ))}
      </div>
      <h4>Model requests</h4>
      {run.diagnostics?.length ? (
        <ul className="build-request-list">
          {run.diagnostics.map((request, index) => (
            <li key={index}>
              <strong>{request.stage}</strong>: {request.outcome}
              {request.httpStatus !== null
                ? `, HTTP ${request.httpStatus}`
                : ""}
              {` (${request.durationMs} ms)`}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No model request diagnostics were recorded.</p>
      )}
      <h4>Terminal output</h4>
      {executions.length ? (
        executions.map((execution) => (
          <article key={execution.id} className="build-execution">
            <strong>
              {execution.executable} · {execution.status}
            </strong>
            <pre>
              {execution.output || execution.error || "No output was captured."}
            </pre>
          </article>
        ))
      ) : (
        <p className="muted">
          No commands have run. Proposed checks require separate approval.
        </p>
      )}
    </section>
  );
}
