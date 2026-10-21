import { useRef, useState, type FormEvent } from "react";
import type { DesktopAPI, Teammate } from "../shared/contracts";
import type { Run } from "../shared/runs";
import { AgentMessage } from "./AgentMessage";
import { AutoGrowTextarea } from "./AutoGrowTextarea";
import { RichText } from "./RichText";
import { characterById } from "../shared/character-catalog";
import { catalogTeammate } from "../shared/fixed-teams";

export function CollaborativeRoom({
  api,
  run,
  team,
  onRun,
  onOpenProfile,
}: {
  api: DesktopAPI;
  run: Run;
  team: Teammate[];
  onRun: (run: Run) => void;
  onOpenProfile?: (id: string) => void;
}) {
  const state = run.collaboration!;
  const [draft, setDraft] = useState("");
  const [recipient, setRecipient] = useState("");
  const [questionId, setQuestionId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [redirect, setRedirect] = useState("");
  const [guidance, setGuidance] = useState("");
  const composer = useRef<HTMLTextAreaElement>(null);
  const openQuestions = state.questions.filter(
    (item) => item.status === "pending" && item.recipient === "user",
  );
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.trim()) return;
    setBusy(true);
    setError("");
    try {
      const next = await api.sendCollaborationMessage(
        run.id,
        draft,
        recipient || undefined,
        questionId || undefined,
      );
      onRun(next.run);
      setDraft("");
      setQuestionId("");
      setRecipient("");
      composer.current?.focus();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Message could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  const teammate = (id: string) =>
    team.find((item) => item.id === id) ||
    (characterById(id)
      ? catalogTeammate(id as Parameters<typeof catalogTeammate>[0])
      : undefined);
  return (
    <section
      className="room-conversation collaborative-room"
      aria-label="Task conversation"
    >
      <div className="room-chat-header">
        <span className="eyebrow">TEAM CONVERSATION</span>
        <h2>{run.taskSnapshot?.title || "Collaborative build"}</h2>
        <p>
          {state.scope.mode === "sandbox"
            ? "Nebius Sandbox branches"
            : "Local-only branches"}{" "}
          · {state.status} · selected folder {state.scope.projectPath}
        </p>
      </div>
      <div className="room-chat-timeline" role="log" aria-label="Team messages">
        {state.events.map((event) => {
          if (event.kind === "activity")
            return (
              <p className="collaboration-activity" key={event.id}>
                <strong>{teammate(event.actor)?.name || event.actor}</strong>{" "}
                {event.text}
              </p>
            );
          const question =
            event.questionId &&
            state.questions.find((item) => item.id === event.questionId);
          const name =
            event.actor === "user"
              ? "You"
              : teammate(event.actor)?.name || event.actor;
          return (
            <AgentMessage
              key={event.id}
              name={name}
              person={teammate(event.actor)}
              at={event.at}
              onOpenProfile={onOpenProfile}
              className={`collaboration-event-${event.kind}`}
            >
              {event.recipient && (
                <p className="collaboration-recipient">
                  To{" "}
                  {event.recipient === "user"
                    ? "you"
                    : teammate(event.recipient)?.name || event.recipient}
                </p>
              )}
              <RichText text={event.text} />
              {question && (
                <span className={`tiny-badge question-${question.status}`}>
                  {question.status === "pending"
                    ? `Question from ${name}`
                    : question.status}
                </span>
              )}
              {event.kind === "diagnostic" && (
                <p className="muted">
                  {event.code} · last verified revision{" "}
                  {event.revision.slice(0, 12)}
                </p>
              )}
              {event.checkpointId && (
                <p className="muted">
                  Checkpoint {event.checkpointId.slice(0, 12)}
                </p>
              )}
            </AgentMessage>
          );
        })}
        {state.events.length === 0 && (
          <p>The team is preparing the first checkpoint.</p>
        )}
        {state.members
          .filter((item) => item.status === "running")
          .map((person) => (
            <p
              className="collaboration-typing"
              key={`working-${person.id}`}
              role="status"
            >
              <strong>{person.name}</strong> is working{" "}
              <span aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            </p>
          ))}
      </div>
      {openQuestions.length > 0 && (
        <div className="room-question-list" aria-label="Questions for you">
          <h3>Questions for you</h3>
          {openQuestions.map((question) => (
            <button
              type="button"
              className="secondary"
              key={question.id}
              onClick={() => {
                setQuestionId(question.id);
                setRecipient(question.owner);
                composer.current?.focus();
              }}
            >
              {teammate(question.owner)?.name || question.owner}:{" "}
              {question.text}
            </button>
          ))}
        </div>
      )}
      {state.members.some((item) => item.status === "paused") && (
        <div className="room-interruption" aria-label="Recovery actions">
          <h3>Paused teammates</h3>
          {state.members
            .filter((item) => item.status === "paused")
            .map((person) => (
              <div key={person.id}>
                <strong>{person.name}</strong> at {person.headId.slice(0, 12)}{" "}
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void api
                      .continueTeammate(run.id, person.id)
                      .then(onRun)
                      .catch((cause) =>
                        setError(
                          cause instanceof Error
                            ? cause.message
                            : "Could not continue.",
                        ),
                      )
                      .finally(() => setBusy(false));
                  }}
                >
                  Continue
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setRedirect(person.id);
                    setGuidance("");
                  }}
                >
                  Redirect
                </button>
              </div>
            ))}
          {redirect && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                setBusy(true);
                void api
                  .continueTeammate(run.id, redirect, guidance)
                  .then((next) => {
                    onRun(next);
                    setRedirect("");
                  })
                  .catch((cause) =>
                    setError(
                      cause instanceof Error
                        ? cause.message
                        : "Could not redirect.",
                    ),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              <label>
                Guidance for {teammate(redirect)?.name || redirect}
                <textarea
                  value={guidance}
                  onChange={(event) => setGuidance(event.target.value)}
                />
              </label>
              <button
                type="submit"
                className="primary"
                disabled={!guidance.trim() || busy}
              >
                Send redirect
              </button>
            </form>
          )}
        </div>
      )}
      <form className="room-composer" onSubmit={(event) => void send(event)}>
        {questionId && (
          <p className="room-reply-context">
            Replying to {teammate(recipient)?.name || recipient}{" "}
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setQuestionId("");
                setRecipient("");
              }}
            >
              Cancel reply
            </button>
          </p>
        )}
        <label htmlFor="collaboration-message">Message the team</label>
        <AutoGrowTextarea
          inputRef={composer}
          id="collaboration-message"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder="Ask a teammate, answer a question, or share a decision"
        />
        <div className="room-composer-footer">
          <label>
            To{" "}
            <select
              value={recipient}
              onChange={(event) => {
                setRecipient(event.target.value);
                setQuestionId("");
              }}
            >
              <option value="">Team</option>
              {state.members.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="primary"
            type="submit"
            disabled={!draft.trim() || busy}
          >
            Send
          </button>
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
