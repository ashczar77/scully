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
  const [answersByConsultation, setAnswersByConsultation] = useState<
    Record<string, string[]>
  >({});
  useEffect(() => {
    setReview(null);
    setApproved(false);
    setAnswersByConsultation({});
  }, [run.id, run.approvedLineup?.planRevision]);
  if (
    run.status !== "planned" ||
    !run.approvedLineup ||
    run.approvedLineup.planRevision !== run.lineupProposal?.planRevision
  )
    return null;
  const answered = (run.consultations || []).filter(
    (item) =>
      (item.phase === "planning" || item.phase === "building") &&
      item.status === "answered" &&
      item.planRevision === run.approvedLineup?.planRevision &&
      run.approvedLineup.entries.some(
        (entry) => entry.id === item.specialistId && entry.phase === item.phase,
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
        const attachment = run.approvedAdvice?.find(
          (approval) => approval.consultationId === item.id,
        );
        const answers = item.questions.map(
          (_, index) => answersByConsultation[item.id]?.[index] || "",
        );
        return (
          <div className="consultation-member" key={item.id}>
            <div className="consultation-heading">
              <div>
                <strong>
                  {characterById(item.specialistId)?.name || item.specialistId}
                </strong>
                <span className="handoff-phase">
                  {item.phase === "building"
                    ? "Pre-build briefing"
                    : "Planning advice"}
                </span>
                <p>{item.purpose}</p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  perform(async () => {
                    if (attachment) {
                      onUpdated(await api.removeAdvice(run.id, item.id));
                    } else {
                      setReview(
                        await api.reviewAdvice(run.id, item.id, answers),
                      );
                    }
                  })
                }
              >
                {attachment ? "Remove from build" : "Review builder handoff"}
              </button>
            </div>
            {!attachment && item.questions.length > 0 && (
              <div className="handoff-questions">
                <h5>Your decisions</h5>
                <p>
                  Answer the specialist's questions that you can decide now.
                  Blank answers remain open for the builders. Answers are saved
                  when you attach this handoff.
                </p>
                {item.questions.map((question, index) => (
                  <label key={index}>
                    <span>{question}</span>
                    <textarea
                      aria-label={`Your answer to: ${question}`}
                      maxLength={1000}
                      rows={2}
                      value={answers[index]}
                      onChange={(event) => {
                        setReview(null);
                        setApproved(false);
                        setAnswersByConsultation((current) => {
                          const next = [...(current[item.id] || answers)];
                          next[index] = event.target.value;
                          return { ...current, [item.id]: next };
                        });
                      }}
                    />
                  </label>
                ))}
              </div>
            )}
            {attachment && item.questions.length > 0 && (
              <div className="handoff-questions">
                <h5>Your saved decisions</h5>
                {item.questions.map((question, index) => (
                  <p key={index}>
                    <strong>{question}</strong>{" "}
                    {attachment.answers?.[index] || "Unanswered"}
                  </p>
                ))}
              </div>
            )}
            <p className="muted">
              {attachment
                ? `Included in the next builder requests. ${attachment.answers?.filter(Boolean).length || 0} user answers saved.`
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
