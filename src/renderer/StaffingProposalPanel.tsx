import type { Teammate } from "../shared/contracts";
import type { PlanningState } from "../shared/planning-state";
import { characterById } from "../shared/character-catalog";
import { RichText } from "./RichText";

export function StaffingProposalPanel({
  planning,
  team,
  busy,
  onApprove,
}: {
  planning: PlanningState;
  team: readonly Teammate[];
  busy: boolean;
  onApprove: () => void;
}) {
  const proposal = planning.proposal;
  if (!proposal) return null;
  const selected = new Set(team.map((person) => person.id));
  const approved = planning.approved?.planRevision === proposal.planRevision;
  return (
    <section className="staffing-proposal" aria-label="Proposed assignments">
      <div className="staffing-proposal-heading">
        <div>
          <h3>Proposed team</h3>
          <RichText text={proposal.rationale} />
        </div>
        <span className={approved ? "lineup-status approved" : "lineup-status"}>
          {approved ? "Approved" : "For your review"}
        </span>
      </div>
      <div className="staffing-assignment-list">
        {proposal.assignments.map((assignment) => {
          const person = characterById(assignment.memberId);
          return (
            <article className="staffing-assignment" key={assignment.memberId}>
              <div className="staffing-assignment-title">
                <strong>{person?.name || assignment.memberId}</strong>
                <span>{assignment.role}</span>
                {!selected.has(assignment.memberId) && (
                  <span className="staffing-outside">Add to this task</span>
                )}
              </div>
              <p>{assignment.objective}</p>
              <small>{assignment.evidence}</small>
              <small>Access: {assignment.permissions.join(", ")}</small>
              {!!assignment.dependsOn.length && (
                <small>
                  Needs:{" "}
                  {assignment.dependsOn
                    .map((id) => characterById(id)?.name || id)
                    .join(", ")}
                </small>
              )}
              <small>
                Tools:{" "}
                {assignment.environment.tools.join(", ") || "No runtime tools"}
              </small>
              {!!assignment.environment.checks.length && (
                <small>
                  Checks:{" "}
                  {assignment.environment.checks
                    .map((check) => [check.command, ...check.args].join(" "))
                    .join(", ")}
                </small>
              )}
              <small>{assignment.environment.reason}</small>
            </article>
          );
        })}
      </div>
      {!approved && (
        <div className="staffing-proposal-actions">
          <button
            className="primary"
            type="button"
            disabled={busy}
            onClick={onApprove}
          >
            Approve assignments
          </button>
          <p>
            To change an assignment, tell Pearl what you want adjusted in the
            Room.
          </p>
        </div>
      )}
    </section>
  );
}
