import { useEffect, useState } from "react";
import type { Run, RunAPI } from "../shared/runs";
import type { ReplyReview, TeamReply } from "../shared/messages";
import { initialTeam, type Teammate } from "../shared/contracts";

function ReplyWait({ reply }: { reply: TeamReply }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!reply.requestStartedAt) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [reply.requestStartedAt]);
  if (!reply.requestStartedAt) return <p>Starting read-only reply worker...</p>;
  const start = Date.parse(reply.requestStartedAt);
  const seconds = Number.isFinite(start)
    ? Math.max(0, Math.floor((now - start) / 1000))
    : 0;
  return (
    <p>
      {reply.recipient?.name || "Read-only teammate"}: preparing an answer{" "}
      <span aria-live="off">({seconds}s waiting)</span>. Elapsed time is
      measured locally; the answer appears when the request completes.
    </p>
  );
}
export function TeamMessages({
  run,
  api,
  team = initialTeam,
}: {
  run: Run;
  api: RunAPI;
  team?: Teammate[];
}) {
  const [recipientId, setRecipientId] = useState<string | undefined>();
  const [text, setText] = useState("");
  const [intent, setIntent] = useState<"continue" | "replan">("continue");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [review, setReview] = useState<ReplyReview | null>(null);
  const [approved, setApproved] = useState(false);
  const pending = run.replies?.some((r) => r.status === "answering");
  async function action(work: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reply action failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings-card" aria-label="Team messages">
      <h3>Message the team</h3>
      <fieldset disabled={busy || pending}>
        <legend>Who should answer your saved question?</legend>
        {[
          {
            id: undefined,
            name: "General reply",
            role: "No specific teammate",
          },
          ...team,
        ].map((person) => (
          <label key={person.id || "general"}>
            <input
              type="radio"
              name={`reply-recipient-${run.id}`}
              checked={recipientId === person.id}
              onChange={() => {
                setRecipientId(person.id);
                setReview(null);
                setApproved(false);
              }}
            />
            {person.name} · {person.role}
          </label>
        ))}
      </fieldset>
      <p>
        One selected perspective, not a team vote. All teammates use the
        configured model. Choosing a recipient does not send anything or
        redirect active work.
      </p>
      {(run.messages || []).map((m) => (
        <article key={m.id}>
          <strong>
            You ·{" "}
            {m.intent === "continue"
              ? run.replies?.some((r) => r.messageId === m.id)
                ? "reply requested"
                : "recorded note, not sent to agents"
              : "redirection for revised plan"}
          </strong>
          <p>{m.text}</p>
          {(run.replies || [])
            .filter((r) => r.messageId === m.id)
            .map((r) => (
              <div key={r.id}>
                <strong>
                  {r.recipient
                    ? `${r.recipient.name} · ${r.recipient.role}`
                    : "Read-only teammate reply"}{" "}
                  · {r.status}
                </strong>
                {r.status === "answering" ? (
                  <ReplyWait reply={r} />
                ) : (
                  <p style={{ whiteSpace: "pre-wrap" }}>{r.answer}</p>
                )}
                <small>
                  Snapshot {r.revision.slice(0, 12)}. No plan or code changes.
                  {r.duringWork &&
                    " Captured during work; later progress is not included."}
                </small>
                {r.status === "answering" && (
                  <button
                    disabled={busy}
                    onClick={() => void action(() => api.stopReply(run.id))}
                  >
                    Stop reply
                  </button>
                )}
              </div>
            ))}
          {m.intent === "continue" && !run.redirectedTo && (
            <button
              disabled={
                busy ||
                pending ||
                ![
                  "prepared",
                  "planned",
                  "complete",
                  "planning",
                  "building",
                  "auditing",
                ].includes(run.status) ||
                (run.replies?.length || 0) >= 3
              }
              onClick={() =>
                void action(async () => {
                  setReview(null);
                  setApproved(false);
                  setReview(await api.reviewReply(run.id, m.id, recipientId));
                })
              }
            >
              Review reply upload
            </button>
          )}
        </article>
      ))}
      {review && review.runId === run.id && (
        <section aria-label="Reply upload review">
          <h4>Approve one read-only reply</h4>
          {review.duringWork && (
            <p>
              Work continues while you review and while the reply is prepared.
              Only this frozen snapshot is uploaded, not later progress. The
              answer may already be out of date.
            </p>
          )}
          <p>
            Reply from:{" "}
            {review.recipient
              ? `${review.recipient.name} · ${review.recipient.role}`
              : "General engineering perspective"}
          </p>
          <p>
            One request to {review.model}, capped at {review.outputTokens}{" "}
            output tokens. Uses provider credits. Up to three attempts per run.
            This fixed snapshot excludes command output and other notes. The
            answer cannot change instructions or grant permissions.
          </p>
          <details>
            <summary>Exact upload snapshot</summary>
            <pre>{review.context}</pre>
          </details>
          <label>
            <input
              type="checkbox"
              checked={approved}
              onChange={(e) => setApproved(e.target.checked)}
            />
            Approve uploading this snapshot for one reply
          </label>
          <button
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
            Request read-only reply
          </button>
          <button
            onClick={() => {
              setReview(null);
              setApproved(false);
            }}
          >
            Cancel reply review
          </button>
        </section>
      )}
      {run.redirectedTo ? (
        <p>
          This run was superseded by {run.redirectedTo.slice(0, 8)}. Use
          Previous runs to open the revised attempt. Old work cannot be executed
          or applied.
        </p>
      ) : (
        <>
          <label>
            Team message
            <textarea
              className="ownership-input"
              rows={3}
              maxLength={2000}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <label>
            <input
              type="radio"
              checked={intent === "continue"}
              onChange={() => setIntent("continue")}
            />
            Continue current work unchanged; save this note locally
          </label>
          <label>
            <input
              type="radio"
              checked={intent === "replan"}
              onChange={() => setIntent("replan")}
            />
            Stop local coordination and prepare a revised plan
          </label>
          <p>
            {intent === "continue"
              ? "Notes are recorded, not answered or injected into active work. No upload occurs. To change instructions, choose a revised plan."
              : "Old work stays available but becomes ineligible for execution or application. A separate attempt will include your redirection, previous plan and draft for review before upload. Remote requests may still finish or consume credits. Running local checks must be stopped separately first."}
          </p>
          <button
            className="primary"
            disabled={busy || !text.trim()}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await api.sendTeamMessage(run.id, { text, intent });
                setText("");
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "Message could not be saved",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {intent === "continue" ? "Save team note" : "Prepare revised plan"}
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
