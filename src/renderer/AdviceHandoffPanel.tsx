import { useEffect, useState } from "react";
import { characterById } from "../shared/character-catalog";
import type { DesktopAPI } from "../shared/contracts";
import type { Run } from "../shared/runs";
import type { AdviceReview } from "../engine/advice-handoff";

export function AdviceHandoffPanel({
  api,
  run,
  onUpdated,
}: {
  api: DesktopAPI;
  run: Run;
  onUpdated: (run: Run) => void;
}) {
  const [review, setReview] = useState<AdviceReview | null>(null);
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setReview(null);
    setApproved(false);
  }, [run.id, run.approvedLineup?.planRevision]);
  if (
    run.status !== "planned" ||
    !run.approvedLineup ||
    run.approvedLineup.planRevision !== run.lineupProposal?.planRevision
  )
    return null;
  const answered = (run.consultations || []).filter(
    (item) =>
      item.phase === "planning" &&
      item.status === "answered" &&
      item.planRevision === run.approvedLineup?.planRevision &&
      run.approvedLineup.entries.some(
        (entry) => entry.id === item.specialistId && entry.phase === "planning",
      ),
  );
  if (!answered.length) return null;
  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (reason) {
      setReview(null);
      setApproved(false);
      setError(reason instanceof Error ? reason.message : "Handoff failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="consultation-panel"
      aria-label="Specialist advice handoff"
    >
      <h4>Share specialist advice with the builders</h4>
      <p>
        Choose which saved advice the builders receive. Each selected item is
        added to their next model request after you separately approve building.
        Open questions remain yours to decide.
      </p>
      {answered.map((item) => {
        const attached = run.approvedAdvice?.some(
          (approval) => approval.consultationId === item.id,
        );
        return (
          <div className="consultation-member" key={item.id}>
            <div className="consultation-heading">
              <div>
                <strong>
                  {characterById(item.specialistId)?.name || item.specialistId}
                </strong>
                <p>{item.purpose}</p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  perform(async () => {
                    if (attached) {
                      onUpdated(await api.removeAdvice(run.id, item.id));
                    } else {
                      setReview(await api.reviewAdvice(run.id, item.id));
                    }
                  })
                }
              >
                {attached ? "Remove from build" : "Review builder handoff"}
              </button>
            </div>
            <p className="muted">
              {attached
                ? "Included in the next builder requests."
                : "Advice stays here until you approve a handoff."}
            </p>
          </div>
        );
      })}
      {review && (
        <div
          className="consultation-review"
          role="group"
          aria-label="Review builder handoff"
        >
          <h5>Approve specialist advice for builders</h5>
          <p>
            This advice contains {review.inputBytes.toLocaleString()} bytes
            before request formatting and will be shared with{" "}
            {review.writerRequests} writer{" "}
            {review.writerRequests === 1 ? "request" : "requests"}. Extra input
            tokens and cost are unknown until measured. It grants no extra
            request or permission.
          </p>
          <details open>
            <summary>Exact specialist advice shared with builders</summary>
            <pre>{review.handoff}</pre>
          </details>
          <label className="consent">
            <input
              type="checkbox"
              checked={approved}
              onChange={(event) => setApproved(event.target.checked)}
            />{" "}
            I approve sharing this advice with the builders.
          </label>
          <div className="consultation-actions">
            <button
              type="button"
              disabled={busy || !approved}
              onClick={() =>
                perform(async () => {
                  onUpdated(await api.approveAdvice(review.token, true));
                  setReview(null);
                  setApproved(false);
                })
              }
            >
              Attach advice
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setReview(null)}
            >
              Cancel handoff
            </button>
          </div>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
