import { useEffect, useState } from "react";
import { characterById, characterCatalog } from "../shared/character-catalog";
import type { Teammate } from "../shared/contracts";
import type {
  ApprovedSpecialistLineup,
  LineupProposal,
  SpecialistLineupEntry,
  SpecialistPhase,
} from "../shared/lineup-proposal";

const phases: SpecialistPhase[] = [
  "planning",
  "building",
  "verification",
  "release",
];
const specialists = characterCatalog.filter(
  (person) => person.role === "specialist",
);

export function LineupProposalPanel({
  proposal,
  team,
  approvedLineup,
  onApprove,
  onDraftChange,
  busy = false,
}: {
  proposal: LineupProposal;
  team: readonly Teammate[];
  approvedLineup?: ApprovedSpecialistLineup;
  onApprove?: (entries: SpecialistLineupEntry[]) => void;
  onDraftChange?: (dirty: boolean) => void;
  busy?: boolean;
}) {
  const [entries, setEntries] = useState<SpecialistLineupEntry[]>(
    () =>
      approvedLineup?.entries ||
      proposal.suggestions.map(({ id, phase, reason }) => ({
        id,
        phase,
        purpose: reason,
      })),
  );
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (
      approvedLineup &&
      JSON.stringify(approvedLineup.entries) === JSON.stringify(entries)
    )
      setDirty(false);
  }, [approvedLineup]);
  const memberIds = new Set(team.map((member) => member.id));
  const setDraft = (value: SpecialistLineupEntry[]) => {
    setEntries(value);
    setDirty(true);
    onDraftChange?.(true);
  };
  const current =
    approvedLineup?.planRevision === proposal.planRevision && !dirty;
  return (
    <section className="lineup-proposal" aria-label="Suggested specialists">
      <div className="lineup-heading">
        <div>
          <h4>Specialists for this plan</h4>
          <p>
            Pearl suggested a starting lineup. You can revise it until building
            begins.
          </p>
        </div>
        <span className={current ? "lineup-status approved" : "lineup-status"}>
          {current ? "Approved selection" : "Needs your review"}
        </span>
      </div>
      {entries.length ? (
        <ul>
          {entries.map((entry, index) => (
            <li key={entry.id}>
              <div className="lineup-member-heading">
                <strong>{characterById(entry.id)?.name || entry.id}</strong>
                <small>
                  {memberIds.has(entry.id)
                    ? "On saved team"
                    : "Outside saved team"}
                </small>
                {onApprove && (
                  <button
                    className="lineup-remove"
                    type="button"
                    onClick={() =>
                      setDraft(entries.filter((_, i) => i !== index))
                    }
                  >
                    Remove
                  </button>
                )}
              </div>
              <div
                className="lineup-phases"
                aria-label={`${characterById(entry.id)?.name || entry.id} phase`}
              >
                {phases.map((phase) => (
                  <button
                    key={phase}
                    type="button"
                    className={entry.phase === phase ? "selected" : ""}
                    aria-pressed={entry.phase === phase}
                    disabled={!onApprove}
                    onClick={() =>
                      setDraft(
                        entries.map((item, i) =>
                          i === index ? { ...item, phase } : item,
                        ),
                      )
                    }
                  >
                    {phase}
                  </button>
                ))}
              </div>
              {onApprove ? (
                <label className="lineup-purpose">
                  Purpose for {characterById(entry.id)?.name || entry.id}
                  <textarea
                    value={entry.purpose}
                    maxLength={240}
                    rows={2}
                    onChange={(event) =>
                      setDraft(
                        entries.map((item, i) =>
                          i === index
                            ? { ...item, purpose: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                </label>
              ) : (
                <p>{entry.purpose}</p>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p>
          {proposal.suggestions.length
            ? "No additional specialist selected for this plan."
            : "No additional specialist recommended for this plan."}
        </p>
      )}
      {onApprove && entries.length < 3 && (
        <details className="lineup-add">
          <summary>Add a specialist</summary>
          <div className="lineup-options">
            {specialists
              .filter(
                (person) => !entries.some((item) => item.id === person.id),
              )
              .map((person) => (
                <button
                  key={person.id}
                  type="button"
                  onClick={() =>
                    setDraft([
                      ...entries,
                      { id: person.id, phase: "building", purpose: "" },
                    ])
                  }
                >
                  <strong>{person.name}</strong>
                  <span>{person.specialty}</span>
                </button>
              ))}
          </div>
        </details>
      )}
      {proposal.discardedInvalid && (
        <p role="alert">Some invalid suggestions were discarded.</p>
      )}
      <p className="muted">
        No specialist is dispatched by approving this selection. It makes no
        model request and changes no request ceiling. Each future dispatch needs
        a separate scope, cost and permission review. A planning specialist
        would join a later consultation, not the completed planning request.
      </p>
      {onApprove && (
        <button
          className="secondary"
          type="button"
          disabled={
            busy || current || entries.some((item) => !item.purpose.trim())
          }
          onClick={() => onApprove(entries)}
        >
          {entries.length
            ? "Approve specialist selection"
            : "Approve no specialists"}
        </button>
      )}
    </section>
  );
}
