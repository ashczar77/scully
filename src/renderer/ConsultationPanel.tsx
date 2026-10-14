import { useEffect, useState } from "react";
import { characterById } from "../shared/character-catalog";
import type { DesktopAPI } from "../shared/contracts";
import type { ConsultationReview } from "../shared/consultation";
import type { Run } from "../shared/runs";

export function ConsultationPanel({
  api,
  run,
  onUpdated,
}: {
  api: DesktopAPI;
  run: Run;
  onUpdated: (run: Run) => void;
}) {
  const [review, setReview] = useState<ConsultationReview | null>(null);
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setReview(null);
    setApproved(false);
  }, [
    run.id,
    run.status,
    run.approvedLineup?.planRevision,
    run.coordination?.auditedRevision,
  ]);
  const phase = run.status === "planned" ? "planning" : "verification";
  if (
    (run.status !== "planned" && run.status !== "complete") ||
    !run.approvedLineup ||
    run.approvedLineup.planRevision !== run.lineupProposal?.planRevision
  )
    return null;
  const entries = run.approvedLineup.entries.filter(
    (entry) => entry.phase === phase,
  );
  if (!entries.length) return null;
  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (reason) {
      setReview(null);
      setApproved(false);
      setError(
        reason instanceof Error ? reason.message : "Consultation failed",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="consultation-panel"
      aria-label={`${phase === "planning" ? "Planning" : "Draft verification"} consultations`}
    >
      <h4>
        Ask a {phase === "planning" ? "planning" : "verification"} specialist
      </h4>
      <p>
        Each consultation is one additional model request. Advice appears here
        for your review; it does not change the plan, draft or audit decision.
      </p>
      {entries.map((entry) => {
        const existing = run.consultations?.find(
          (item) => item.specialistId === entry.id,
        );
        const name = characterById(entry.id)?.name || entry.id;
        return (
          <div className="consultation-member" key={entry.id}>
            <div className="consultation-heading">
              <div>
                <strong>{name}</strong>
                <p>{entry.purpose}</p>
              </div>
              {!existing && !review && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    perform(async () => {
                      setReview(await api.reviewConsultation(run.id, entry.id));
                    })
                  }
                >
                  Review consultation
                </button>
              )}
            </div>
            {existing?.status === "consulting" && (
              <div role="status">
                {existing.requestStartedAt
                  ? "Specialist request started."
                  : "Specialist request queued."}{" "}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    perform(async () => {
                      onUpdated(await api.stopConsultation(run.id));
                    })
                  }
                >
                  Stop consultation
                </button>
              </div>
            )}
            {existing?.status === "answered" && (
              <div className="consultation-answer">
                <h5>Advice</h5>
                <p>{existing.advice}</p>
                {!!existing.questions.length && (
                  <>
                    <h5>Questions for you</h5>
                    <ul>
                      {existing.questions.map((question, index) => (
                        <li key={index}>{question}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
            {existing?.status === "failed" && (
              <p role="status">{existing.advice}</p>
            )}
          </div>
        );
      })}
      {review && (
        <div
          className="consultation-review"
          role="group"
          aria-label="Review specialist upload"
        >
          <h5>Approve one read-only consultation</h5>
          <p>
            Model: {review.model}. Maximum output:{" "}
            {review.outputTokens.toLocaleString()} tokens. This request is
            outside the saved core request ceiling.
          </p>
          {review.artifactRevision && (
            <p>
              Completed draft revision:{" "}
              <code>{review.artifactRevision.slice(0, 12)}</code>.
            </p>
          )}
          <p>
            {review.projectedNanoUsd === null
              ? "Model cost estimate unavailable. Usage and cost may still be charged."
              : `Model cost planning estimate: $${(review.projectedNanoUsd / 1e9).toFixed(4)}. Input size and actual cost may be higher.`}{" "}
            Other service charges are separate.
          </p>
          <details open>
            <summary>
              {phase === "planning"
                ? "Exact task, purpose and plan sent to the model"
                : "Exact task, plan, draft and audit notes sent to the model"}
            </summary>
            <pre>{review.context}</pre>
          </details>
          <label className="consent">
            <input
              type="checkbox"
              checked={approved}
              onChange={(event) => setApproved(event.target.checked)}
            />{" "}
            I approve this exact upload and additional model request.
          </label>
          <div className="consultation-actions">
            <button
              type="button"
              disabled={busy || !approved}
              onClick={() =>
                perform(async () => {
                  onUpdated(await api.startConsultation(review.token, true));
                  setReview(null);
                  setApproved(false);
                })
              }
            >
              Request consultation
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setReview(null)}
            >
              Cancel review
            </button>
          </div>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
