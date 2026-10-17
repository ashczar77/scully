import { useEffect, useState } from "react";
import type { Run, RunAPI } from "../shared/runs";
import type { ReplyReview, TeamReply } from "../shared/messages";
import { initialTeam, type Teammate } from "../shared/contracts";
import { bindRunTeam } from "../engine/character-context";
import { defaultMessageRoutingSettings } from "../shared/message-routing";

function ReplyWait({ reply }: { reply: TeamReply }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!reply.requestStartedAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [reply.requestStartedAt]);
  if (!reply.requestStartedAt) return <p>Starting reply...</p>;
  const start = Date.parse(reply.requestStartedAt);
  const seconds = Number.isFinite(start)
    ? Math.max(0, Math.floor((now - start) / 1000))
    : 0;
  return (
    <p>
      {reply.recipient?.name || "Teammate"} is preparing an answer{" "}
      <span aria-live="off">({seconds}s waiting)</span>.
    </p>
  );
}

export function TeamMessages({
  run,
  api,
  team = initialTeam,
  onOpenSettings = () => {},
}: {
  run: Run;
  api: RunAPI;
  team?: Teammate[];
  onOpenSettings?: () => void;
}) {
  const [text, setText] = useState("");
  const [changeText, setChangeText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [review, setReview] = useState<ReplyReview | null>(null);
  const [approved, setApproved] = useState(false);
  const [choiceFor, setChoiceFor] = useState<string | null>(null);
  const [needsConnection, setNeedsConnection] = useState(false);
  const [routeReason, setRouteReason] = useState("");
  const [routingSettings, setRoutingSettings] = useState(
    defaultMessageRoutingSettings,
  );
  useEffect(() => {
    let live = true;
    void api
      .messageRoutingSettings()
      .then((value) => {
        if (live) setRoutingSettings(value);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [api]);
  const pending = run.replies?.some((reply) => reply.status === "answering");
  const activeWork = ["planning", "building", "auditing"].includes(run.status);
  const pause = run.requestPause;
  const members = bindRunTeam(
    run.teamSnapshot?.members || team,
    run.teamSnapshot?.roster,
  );
  const canAsk =
    ["planned", "complete", "planning", "building", "auditing"].includes(
      run.status,
    ) && !run.redirectedTo;

  async function action(work: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Message action failed");
    } finally {
      setBusy(false);
    }
  }
  async function reviewQuestion(messageId: string) {
    setReview(null);
    setApproved(false);
    setChoiceFor(null);
    setNeedsConnection(false);
    const result = await api.reviewRoutedReply(run.id, messageId);
    setRouteReason(result.routing.reason);
    if (result.review) setReview(result.review);
    else if (result.needsConnection) setNeedsConnection(true);
    else if (result.routing.needsChoice) setChoiceFor(messageId);
  }
  return (
    <section
      className="settings-card team-conversation"
      aria-label="Team conversation"
    >
      <h3>Ask your team</h3>
      <p>
        Ask a question about this task. Scully suggests the teammate best suited
        to answer. Tag someone by name, like @Sloane, to ask them directly.
      </p>
      <div className="message-routing-summary">
        <span>
          Routing: best subject match,{" "}
          {routingSettings.unclear === "pearl"
            ? "Pearl when unclear"
            : "you choose when unclear"}
          . One reviewed reply at a time.
        </span>
        <button type="button" onClick={onOpenSettings}>
          Change in Settings
        </button>
      </div>
      {activeWork && !run.redirectedTo && (
        <section aria-label="Change active work" className="active-work-pause">
          <h4>Need to change work in progress?</h4>
          {!pause ||
          ["resumed", "not_reached", "stopped", "interrupted"].includes(
            pause.status,
          ) ? (
            <>
              <p>
                Questions do not change active work. To change instructions,
                pause before the next request. A request already in progress may
                finish and use credits.
              </p>
              <button
                disabled={busy || (pause?.attempts || 0) >= 3}
                onClick={() => void action(() => api.requestRunPause(run.id))}
              >
                Pause before next request
              </button>
            </>
          ) : null}
          {pause?.status === "requested" && (
            <p role="status">
              Pause requested. Current requests may finish. If work ends first,
              the pause will not be reached.
            </p>
          )}
          {pause?.status === "paused" && (
            <>
              <p role="status">
                Paused before the next request. No new core request will start
                until you continue or prepare a revised plan.
              </p>
              <button
                disabled={busy}
                onClick={() =>
                  void action(() => api.resumeRunPause(run.id, pause.id))
                }
              >
                Continue current work unchanged
              </button>
            </>
          )}
          {pause?.status === "resuming" && (
            <p role="status">Resuming work...</p>
          )}
          {pause?.status === "not_reached" && (
            <p>The run finished before the pause was reached.</p>
          )}
        </section>
      )}
      {run.status === "interrupted" && pause?.status === "interrupted" && (
        <p role="status">
          The app closed during a pause. Prepare a revised plan to continue.
          Remote completion is unconfirmed.
        </p>
      )}
      {canAsk && (
        <div className="team-composer">
          <label htmlFor={`team-question-${run.id}`}>Your message</label>
          <textarea
            id={`team-question-${run.id}`}
            rows={3}
            maxLength={2000}
            value={text}
            placeholder="Ask about the task or tag a teammate, for example @Sloane"
            onChange={(event) => setText(event.target.value)}
          />
          <button
            className="primary"
            disabled={busy || pending || !text.trim()}
            onClick={() =>
              void action(async () => {
                const saved = await api.sendTeamMessage(run.id, {
                  text,
                  intent: "continue",
                });
                setText("");
                const message = saved.messages?.at(-1);
                if (message) await reviewQuestion(message.id);
              })
            }
          >
            Send message
          </button>
          <small>
            Sending first saves the message locally. You review the recipient,
            upload and model request before an answer is requested.
          </small>
        </div>
      )}
      {(run.messages || []).map((message) => (
        <article className="team-message" key={message.id}>
          <strong>
            You{" "}
            {message.intent === "replan"
              ? "· change of direction"
              : "· question"}
          </strong>
          <p>{message.text}</p>
          {(run.replies || [])
            .filter((reply) => reply.messageId === message.id)
            .map((reply) => (
              <div key={reply.id}>
                <strong>
                  {reply.recipient?.name || "Teammate"} · {reply.status}
                </strong>
                {reply.status === "answering" ? (
                  <ReplyWait reply={reply} />
                ) : (
                  <p style={{ whiteSpace: "pre-wrap" }}>{reply.answer}</p>
                )}
                {reply.status === "answering" && (
                  <button
                    disabled={busy}
                    onClick={() => void action(() => api.stopReply(run.id))}
                  >
                    Stop reply
                  </button>
                )}
              </div>
            ))}
          {message.intent === "continue" && canAsk && (
            <button
              disabled={busy || pending || (run.replies?.length || 0) >= 3}
              onClick={() => void action(() => reviewQuestion(message.id))}
            >
              Review answer
            </button>
          )}
        </article>
      ))}
      {choiceFor && (
        <section
          className="reply-routing-choice"
          aria-label="Choose a teammate"
        >
          <h4>Who should answer?</h4>
          <p>{routeReason}</p>
          <div className="reply-choice-list">
            {members.map((member) => (
              <button
                key={member.id}
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    setReview(
                      await api.reviewReply(run.id, choiceFor, member.id),
                    );
                    setChoiceFor(null);
                    setApproved(false);
                  })
                }
              >
                {member.name} · {member.role}
              </button>
            ))}
          </div>
        </section>
      )}
      {needsConnection && (
        <p role="status" className="reply-connection-note">
          {routeReason} Configure a Nebius session in Settings &gt; App &amp;
          connection before reviewing a paid answer.
        </p>
      )}
      {review && review.runId === run.id && (
        <section className="reply-review" aria-label="Reply upload review">
          <h4>Review this answer request</h4>
          <p>{routeReason}</p>
          <p>
            <strong>{review.recipient?.name || "Teammate"}</strong> will answer
            using a saved snapshot of this task. This question will not redirect
            active work.
          </p>
          <p>
            One model request to {review.model}, with up to{" "}
            {review.outputTokens} output tokens. Provider credits apply.
          </p>
          <p>
            Input tokens and total cost are unknown until usage is reported.
          </p>
          {review.duringWork && (
            <p>Work continues. This answer may not include later progress.</p>
          )}
          <details>
            <summary>See exactly what will be uploaded</summary>
            <pre>{review.context}</pre>
          </details>
          <label>
            <input
              type="checkbox"
              checked={approved}
              onChange={(event) => setApproved(event.target.checked)}
            />{" "}
            Approve this upload and one model request
          </label>
          <div className="reply-review-actions">
            <button
              className="primary"
              disabled={busy || !approved}
              onClick={() =>
                void action(async () => {
                  const token = review.token;
                  setReview(null);
                  setApproved(false);
                  await api.answerMessage(token, true);
                })
              }
            >
              Request answer
            </button>
            <button
              onClick={() => {
                setReview(null);
                setApproved(false);
              }}
            >
              Cancel
            </button>
          </div>
        </section>
      )}
      {canAsk && (
        <details className="change-direction">
          <summary>Change the task direction</summary>
          <p>
            This stops the current local coordination and creates a revised
            attempt. Requests already in progress may still finish or use
            credits. The previous attempt stays available for review.
          </p>
          <label>
            New direction
            <textarea
              rows={3}
              maxLength={2000}
              value={changeText}
              onChange={(event) => setChangeText(event.target.value)}
            />
          </label>
          <button
            disabled={busy || !changeText.trim()}
            onClick={() =>
              void action(async () => {
                await api.sendTeamMessage(run.id, {
                  text: changeText,
                  intent: "replan",
                });
                setChangeText("");
              })
            }
          >
            Prepare revised plan
          </button>
        </details>
      )}
      {run.redirectedTo && (
        <p>
          This attempt was superseded. Open the revised attempt from Previous
          runs.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
