import { useEffect, useState } from "react";
import { characterById, characterCatalog } from "../shared/character-catalog";
import type { Teammate } from "../shared/contracts";
import type { CoreLineup } from "../shared/core-lineup";
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
  earlyReviews?: boolean;
  onApprove?: (entries: SpecialistLineupEntry[], core?: CoreLineup) => void;
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
  const [core, setCore] = useState<CoreLineup | undefined>(() =>
    proposal.core
      ? {
          builderId: approvedLineup?.core?.builderId || proposal.core.builderId,
          auditorId: approvedLineup?.core?.auditorId || proposal.core.auditorId,
          testerId:
            approvedLineup?.core?.testerId === undefined
              ? proposal.core.testerId
              : approvedLineup.core.testerId,
        }
      : undefined,
  );
  useEffect(() => {
    if (
      approvedLineup &&
      JSON.stringify(approvedLineup.entries) === JSON.stringify(entries) &&
      JSON.stringify(approvedLineup.core) === JSON.stringify(core)
    )
      setDirty(false);
  }, [approvedLineup]);
  const memberIds = new Set(team.map((member) => member.id));
  const setDraft = (value: SpecialistLineupEntry[]) => {
    setEntries(value);
    setDirty(true);
    onDraftChange?.(true);
  };
  const updateCore = (value: CoreLineup) => {
    setCore(value);
    setDirty(true);
    onDraftChange?.(true);
  };
  const current =
    approvedLineup?.planRevision === proposal.planRevision && !dirty;
  return (
    <section
      className="lineup-proposal"
      aria-label={proposal.core ? "Team lineup" : "Suggested specialists"}
    >
      <div className="lineup-heading">
        <div>
          <h4>
            {proposal.core
              ? "Pearl's proposed team"
              : "Specialists for this plan"}
          </h4>
          <p>
            {proposal.core
              ? "Here is who would build, test and review this plan. Does this lineup look right?"
              : "Pearl suggested a starting lineup. You can revise it until building begins."}
          </p>
        </div>
        <span className={current ? "lineup-status approved" : "lineup-status"}>
          {current ? "Approved selection" : "Needs your review"}
        </span>
      </div>
      {proposal.core && core && (
        <div className="core-lineup" aria-label="Proposed work lineup">
          <p>{proposal.core.reason}</p>
          {proposal.core.fallback && (
            <p role="alert">
              Pearl's work recommendation could not be used. These are the saved
              team's starting assignments.
            </p>
          )}
          {(["builder", "tester", "auditor"] as const).map((role) => {
            const key =
              role === "builder"
                ? "builderId"
                : role === "auditor"
                  ? "auditorId"
                  : "testerId";
            const choices = team.filter(
              (member) => characterById(member.id)?.role === role,
            );
            const options =
              role === "tester"
                ? [{ id: "", name: "No tester" }, ...choices]
                : choices;
            return (
              <div className="core-role" key={role}>
                <strong>
                  {role === "tester"
                    ? "Testing"
                    : role === "builder"
                      ? "Building"
                      : "Auditing"}
                </strong>
                <div className="core-options" aria-label={`${role} choices`}>
                  {options.map((member) => {
                    const selected = (core[key] || "") === member.id;
                    return (
                      <button
                        key={member.id || "none"}
                        type="button"
                        aria-pressed={selected}
                        className={selected ? "selected" : ""}
                        disabled={!onApprove}
                        onClick={() =>
                          updateCore({
                            ...core,
                            [key]: member.id || null,
                          })
                        }
                      >
                        {member.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {proposal.core && <h4>Specialists, if useful</h4>}
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
      {onApprove && (
        <button
          className="secondary"
          type="button"
          disabled={
            busy || current || entries.some((item) => !item.purpose.trim())
          }
          onClick={() => (core ? onApprove(entries, core) : onApprove(entries))}
        >
          {proposal.core
            ? "Approve team for this plan"
            : entries.length
              ? "Approve specialist selection"
              : "Approve no specialists"}
        </button>
      )}
    </section>
  );
}
