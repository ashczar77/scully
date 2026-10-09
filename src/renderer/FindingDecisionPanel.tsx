import { useState } from "react";
import {
  decisionCurrent,
  findingEvidence,
  findingKey,
  type FindingDecisionInput,
} from "../shared/audits";
import type { Run, RunAPI } from "../shared/runs";
export function FindingDecisionPanel({
  run,
  api,
  auditIndex,
  findingIndex,
}: {
  run: Run;
  api: RunAPI;
  auditIndex: number;
  findingIndex: number;
}) {
  const [decision, setDecision] =
    useState<FindingDecisionInput["decision"]>("unresolved");
  const [reason, setReason] = useState("");
  const [ids, setIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const audit = run.specialistAudits![auditIndex];
  const finding = audit.findings[findingIndex];
  const history = (run.findingDecisions || []).filter(
    (d) => d.auditIndex === auditIndex && d.findingIndex === findingIndex,
  );
  const latest = history.at(-1);
  const evidence = findingEvidence(run, auditIndex, findingIndex);
  return (
    <section aria-label={`Finding ${findingIndex + 1} decision`}>
      {!run.correction && run.status === "complete" && (
        <>
          <p>
            Prepare one separate corrective attempt for this original run. This
            does not upload anything. Review the new attempt before approving
            its two model requests. No prior execution or apply permission
            transfers.
          </p>
          <button
            className="secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await api.prepareCorrection(
                  run.id,
                  auditIndex,
                  findingIndex,
                  audit.revision,
                  findingKey(finding),
                );
              } catch (e) {
                setError(
                  e instanceof Error
                    ? e.message
                    : "Could not prepare correction",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            Prepare corrective draft
          </button>
        </>
      )}
      <p>
        Decision:{" "}
        {latest && decisionCurrent(run, latest)
          ? `${latest.decision} (user decision)`
          : "unresolved"}
        . No automatic correctness verdict.
      </p>
      {latest && !decisionCurrent(run, latest) && (
        <p role="alert">Previous decision is stale.</p>
      )}
      <details>
        <summary>Review evidence and record a decision</summary>
        <p>
          Resolving requires linked completed evidence and your explanation. An
          exit code alone does not prove a fix. Accepting risk or dismissing is
          a user judgement, not verification.
        </p>
        <fieldset>
          <legend>Finding decision</legend>
          {(
            ["unresolved", "accepted-risk", "dismissed", "resolved"] as const
          ).map((value) => (
            <label key={value}>
              <input
                type="radio"
                checked={decision === value}
                onChange={() => setDecision(value)}
              />
              {value}
            </label>
          ))}
        </fieldset>
        <label>
          Decision reason
          <textarea
            className="ownership-input"
            rows={3}
            maxLength={2000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <p>Link up to three completed checks:</p>
        {evidence.length === 0 && (
          <p>No current completed evidence. Resolution is unavailable.</p>
        )}
        {evidence.map((e) => (
          <label key={e.id}>
            <input
              type="checkbox"
              checked={ids.includes(e.id)}
              onChange={(event) =>
                setIds((old) =>
                  event.target.checked
                    ? [...old, e.id]
                    : old.filter((id) => id !== e.id),
                )
              }
            />
            {e.id.slice(0, 8)} · exit {e.exitCode}
            <pre>{e.output || "(No output)"}</pre>
          </label>
        ))}
        <button
          className="secondary"
          disabled={
            busy ||
            run.status !== "complete" ||
            !reason.trim() ||
            ids.length > 3 ||
            (decision === "resolved" && !ids.length)
          }
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await api.decideFinding(run.id, {
                auditIndex,
                findingIndex,
                revision: audit.revision,
                findingKey: findingKey(finding),
                previousCount: run.findingDecisions?.length || 0,
                decision,
                reason,
                evidenceIds: ids,
              });
              setReason("");
              setIds([]);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Decision failed");
            } finally {
              setBusy(false);
            }
          }}
        >
          Record finding decision
        </button>
      </details>
      {error && <p role="alert">{error}</p>}
      {!!history.length && (
        <details>
          <summary>Decision history ({history.length})</summary>
          {history.map((d, i) => (
            <p key={i}>
              {d.at}: {d.decision}. {d.reason} Linked checks:{" "}
              {d.evidenceIds.join(", ") || "none"}.
            </p>
          ))}
        </details>
      )}
    </section>
  );
}
