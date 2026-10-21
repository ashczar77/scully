import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowRight,
  Code2,
  MessageSquare,
  SearchCheck,
  Send,
  Settings2,
  TestTube2,
} from "lucide-react";
import type { DesktopAPI, Task, Teammate } from "../shared/contracts";
import type { Run, SessionInfo } from "../shared/runs";
import { LineupProposalPanel } from "./LineupProposalPanel";
import { CopyTextActions, RichText } from "./RichText";
import {
  planQuestions,
  planSummary,
  roomQuestion,
} from "../shared/plan-conversation";
import { AutoGrowTextarea } from "./AutoGrowTextarea";
import { conversationTimeline } from "./conversation-timeline";
import { AgentMessage, ThinkingIndicator, messageTime } from "./AgentMessage";
import { ProjectLocation } from "./ProjectLocation";
import { CollaborativeRoom } from "./CollaborativeRoom";
import { StaffingProposalPanel } from "./StaffingProposalPanel";
import { pendingPlanningQuestions } from "../shared/planning-state";
import type { PlanningQuestionAnswerSet } from "../shared/planning-state";

type ChoiceQuestion = NonNullable<
  Extract<
    ReturnType<typeof conversationTimeline>[number],
    { kind: "plan" }
  >["questionItems"]
>[number];

function PlanningQuestionSet({
  questions,
  active,
  busy,
  onAnswer,
}: {
  questions: ChoiceQuestion[];
  active: boolean;
  busy: boolean;
  onAnswer: (answers: PlanningQuestionAnswerSet) => void;
}) {
  const [choices, setChoices] = useState<
    Record<string, { selected: number | "other" | null; custom: string }>
  >({});
  const [note, setNote] = useState("");
  const pending = questions.filter((question) => question.status === "pending");
  const ready = pending.every((question) => {
    const choice = choices[question.id];
    return (
      choice?.selected !== null &&
      choice?.selected !== undefined &&
      (choice.selected !== "other" || !!choice.custom.trim())
    );
  });
  return (
    <div className="planning-choices">
      {questions.map((question) => {
        const choice = choices[question.id] || { selected: null, custom: "" };
        const update = (
          selected: number | "other" | null,
          custom = choice.custom,
        ) =>
          setChoices((current) => ({
            ...current,
            [question.id]: { selected, custom },
          }));
        return (
          <section
            className="planning-choice"
            aria-label={question.text}
            key={question.id}
          >
            <h4>{question.text}</h4>
            <p className="planning-choice-recommendation">
              Pearl recommends: {question.recommendation}
            </p>
            {question.status === "superseded" ? (
              <p className="planning-choice-status">
                Earlier answer: {question.answer}. This choice was revised.
              </p>
            ) : question.status === "answered" ? (
              <p className="planning-choice-status">
                Answered: {question.answer}
              </p>
            ) : question.status === "withdrawn" ? (
              <p className="planning-choice-status">
                This question was withdrawn.
              </p>
            ) : active ? (
              <div className="planning-choice-options">
                {(question.options || []).map((option, index) => (
                  <label key={`${question.id}:${index}`}>
                    <input
                      type="radio"
                      name={`choice-${question.id}`}
                      checked={choice.selected === index}
                      onChange={() => update(index)}
                    />
                    <span>{option}</span>
                  </label>
                ))}
                <label>
                  <input
                    type="radio"
                    name={`choice-${question.id}`}
                    checked={choice.selected === "other"}
                    onChange={() => update("other")}
                  />
                  <span>Something else</span>
                </label>
                {choice.selected === "other" && (
                  <input
                    className="planning-choice-input"
                    aria-label={`Your answer to ${question.text}`}
                    value={choice.custom}
                    onChange={(event) => update("other", event.target.value)}
                    placeholder="Write your answer"
                    maxLength={1000}
                  />
                )}
              </div>
            ) : null}
          </section>
        );
      })}
      {active && pending.length > 0 && (
        <div className="planning-choice-options">
          <textarea
            className="planning-choice-input"
            aria-label="Additional message"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Anything else to discuss? (optional)"
            maxLength={900}
            rows={2}
          />
          <button
            type="button"
            className="primary-button"
            disabled={busy || !ready}
            onClick={() =>
              onAnswer({
                answers: pending.map((question) => {
                  const choice = choices[question.id];
                  return {
                    questionId: question.id,
                    askedAt: question.askedAt,
                    ...(choice.selected === "other"
                      ? { customAnswer: choice.custom }
                      : { optionIndex: choice.selected as number }),
                  };
                }),
                ...(note.trim() && { note }),
              })
            }
          >
            Send answers
          </button>
        </div>
      )}
    </div>
  );
}

export function titleFromPrompt(value: string) {
  const clean = value.trim().replace(/\s+/g, " ");
  return (clean.split(/[.!?\n]/)[0] || clean).slice(0, 120).trim();
}

export function RoomConversation({
  api,
  task,
  team,
  draft,
  onDraftChange,
  onCreated,
  onOpenTask,
  onOpenSettings,
  onOpenProfile,
}: {
  api: DesktopAPI;
  task: Task | null;
  team: Teammate[];
  draft: string;
  onDraftChange: (value: string) => void;
  onCreated: (task: Task) => void;
  onOpenTask: () => void;
  onOpenSettings: () => void;
  onOpenProfile?: (id: string) => void;
}) {
  const [run, setRun] = useState<Run | null>(null);
  const [runHistory, setRunHistory] = useState<Run[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [showActivity, setShowActivity] = useState(false);
  const [chooseRecipient, setChooseRecipient] = useState(false);
  const [showLineupReview, setShowLineupReview] = useState(false);
  const [replyingQuestionId, setReplyingQuestionId] = useState<string | null>(
    null,
  );
  const [revisePlan, setRevisePlan] = useState(false);
  const timelineRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  useEffect(() => {
    setRun(null);
    setRunHistory([]);
    stickToBottom.current = true;
    setChooseRecipient(false);
    setShowLineupReview(false);
    setReplyingQuestionId(null);
    setRevisePlan(false);
    setLoaded(false);
    if (!task) {
      setLoaded(true);
      return;
    }
    let live = true;
    const off = api.onRun((next) => {
      if (live && next.taskId === task.id) {
        setRunHistory((previous) => {
          const found = previous.findIndex((item) => item.id === next.id);
          if (found < 0) return [next, ...previous];
          const updated = [...previous];
          updated[found] = next;
          return updated;
        });
        setRun((current) =>
          !current ||
          current.id === next.id ||
          next.redirection?.parentId === current.id
            ? next
            : current,
        );
      }
    });
    void api
      .runs(task.id)
      .then((runs) => {
        if (!live) return;
        setRun(runs[0] || null);
        setRunHistory(runs);
        setLoaded(true);
      })
      .catch(() => {
        if (live) {
          setError("Could not load this task's conversation.");
          setLoaded(true);
        }
      });
    return () => {
      live = false;
      off();
    };
  }, [api, task?.id]);
  useEffect(() => {
    let live = true;
    void api
      .session()
      .then((value) => {
        if (live) {
          setSession(value);
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [api, task?.id]);
  const unanswered = useMemo(() => {
    if (!run) return null;
    return (
      [...(run.messages || [])].reverse().find(
        (message, reverseIndex) =>
          message.intent === "continue" &&
          // The first message creates the task. Planning already uses it.
          !(
            reverseIndex === (run.messages?.length || 0) - 1 &&
            message.text === task?.description
          ) &&
          !(run.replies || []).some((reply) => reply.messageId === message.id),
      ) || null
    );
  }, [run, task?.description]);
  async function action(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The action failed. No retry was made.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    if (run && replyingQuestionId) {
      await action(async () => {
        const updated = await api.answerBuildQuestion(
          run.id,
          replyingQuestionId,
          text,
        );
        setRun(updated);
        setRunHistory((previous) =>
          previous.map((item) => (item.id === updated.id ? updated : item)),
        );
        setReplyingQuestionId(null);
        onDraftChange("");
      });
      return;
    }
    if (
      run?.status === "planned" &&
      (run.planning || task?.mode === "plan") &&
      !(run.planning
        ? pendingPlanningQuestions(run.planning).length
        : planQuestions(run.plan).length)
    ) {
      await action(async () => {
        if (
          revisePlan ||
          (run.planning?.planReview && !run.planning.proposal)
        ) {
          const updated = await api.sendPlanningMessage(run.id, text);
          setRun(updated);
          setRevisePlan(false);
          onDraftChange("");
          return;
        }
        const result = await api.sendConversationMessage(run.id, text, "pearl");
        setRun(result.run);
        setRunHistory((previous) =>
          previous.map((item) =>
            item.id === result.run.id ? result.run : item,
          ),
        );
        onDraftChange("");
      });
      return;
    }
    if (
      !task ||
      !run ||
      ((run.planning || task.mode === "plan") &&
        (["prepared", "planned"].includes(run.status) ||
          (run.status === "failed" && !run.plan)))
    ) {
      await action(async () => {
        if (!session?.configured)
          throw new Error("Connect Nebius to talk with Pearl.");
        let current = run;
        if (!task) {
          if (text.length > 2000)
            throw new Error(
              "The first message can contain up to 2,000 characters.",
            );
          const created = await api.createTask({
            title: titleFromPrompt(text),
            description: text,
            mode: "plan",
          });
          onCreated(created);
          current = await api.prepareRun(created.id, null, [], "direct");
        } else if (!current) {
          current = await api.prepareRun(task.id, null, [], "direct");
        }
        if (!current) throw new Error("Could not prepare this task");
        const started = await api.sendPlanningMessage(current.id, text);
        setRun(started);
        if (task) setRunHistory(await api.runs(task.id));
        onDraftChange("");
      });
      return;
    }
    await action(async () => {
      if (!run) throw new Error("Could not prepare this task");
      const result = await api.sendConversationMessage(run.id, text);
      setRun(result.run);
      setRunHistory((previous) =>
        previous.map((item) => (item.id === result.run.id ? result.run : item)),
      );
      setChooseRecipient(result.needsChoice);
      onDraftChange("");
    });
  }
  async function answerPlanningQuestions(answerSet: PlanningQuestionAnswerSet) {
    if (!run || !task) return;
    await action(async () => {
      const started = await api.answerPlanningQuestions(run.id, answerSet);
      setRun(started);
      setRunHistory(await api.runs(task.id));
    });
  }
  const pendingReply = run?.replies?.some(
    (reply) => reply.status === "answering",
  );
  const canMessage = !run || !run.redirectedTo;
  const outstandingChoices = run?.plan
    ? run.planning
      ? pendingPlanningQuestions(run.planning).map((question) => question.text)
      : planQuestions(run.plan)
    : [];
  const timeline = useMemo(
    () =>
      conversationTimeline(
        runHistory.length ? runHistory : run ? [run] : [],
        task,
      ),
    [runHistory, run, task],
  );
  useLayoutEffect(() => {
    const element = timelineRef.current;
    if (element && stickToBottom.current)
      element.scrollTop = element.scrollHeight;
  }, [timeline.length, run?.status]);
  if (run?.collaboration) {
    return (
      <CollaborativeRoom
        api={api}
        run={run}
        team={team}
        onRun={setRun}
        onOpenProfile={onOpenProfile}
      />
    );
  }
  return (
    <section
      className={`room-conversation ${task ? "" : "room-new-task"}`}
      aria-label="Task conversation"
    >
      <div className="room-chat-header">
        <div>
          <span className="eyebrow">TEAM CONVERSATION</span>
          <h2>{task?.title || "What would you like to build?"}</h2>
          <p>
            {task
              ? "Pearl coordinates the conversation and brings in the right teammate."
              : "Describe your idea. Pearl will start the conversation in a new private task."}
          </p>
        </div>
        {task && (
          <div className="room-header-actions">
            <button className="secondary" onClick={onOpenTask}>
              <Settings2 size={15} /> Task details
            </button>
          </div>
        )}
      </div>
      {!loaded && <p role="status">Opening conversation...</p>}
      <div
        ref={timelineRef}
        className="room-chat-timeline"
        role="log"
        aria-label="Team conversation"
        aria-relevant="additions"
        aria-atomic="false"
        onScroll={(event) => {
          const element = event.currentTarget;
          stickToBottom.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <
            72;
        }}
      >
        {task && !run && loaded && (
          <p className="room-chat-note">
            This task has no prepared workspace. Send a message to start a
            private new project, or open Task details to choose existing files.
          </p>
        )}
        {timeline.map((entry) => {
          if (entry.kind === "user")
            return (
              <article className="chat-user-message" key={entry.key}>
                <div className="chat-user-meta">
                  <strong>You</strong>
                  {messageTime(entry.at) && (
                    <time dateTime={entry.at}>{messageTime(entry.at)}</time>
                  )}
                </div>
                <div className="chat-bubble chat-user">
                  <p>{entry.text}</p>
                </div>
              </article>
            );
          if (entry.kind === "reply")
            return (
              <AgentMessage
                key={entry.key}
                name={entry.reply.recipient?.name || "Teammate"}
                person={
                  entry.person ||
                  team.find((member) => member.id === entry.reply.recipient?.id)
                }
                at={entry.at}
                onOpenProfile={onOpenProfile}
                status={entry.reply.status === "answering"}
              >
                {entry.reply.status === "answering" ? (
                  <ThinkingIndicator label="Thinking through your question" />
                ) : (
                  <>
                    <RichText text={entry.reply.answer} />
                    <CopyTextActions
                      text={entry.reply.answer}
                      copyText={api.copyText}
                    />
                  </>
                )}
                {entry.reply.status === "answering" && run && (
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() =>
                      void action(async () =>
                        setRun(await api.stopReply(run.id)),
                      )
                    }
                  >
                    Stop reply
                  </button>
                )}
              </AgentMessage>
            );
          if (entry.kind === "progress") {
            const person =
              entry.person ||
              team.find((member) => member.id === entry.event.actor);
            return (
              <AgentMessage
                key={entry.key}
                name={
                  person?.name || entry.event.actorName || entry.event.actor
                }
                person={person}
                at={entry.at}
                onOpenProfile={onOpenProfile}
              >
                <RichText text={entry.event.text} />
                {entry.event.questionId &&
                  run?.pendingQuestions?.some(
                    (question) =>
                      question.id === entry.event.questionId &&
                      !question.answer,
                  ) && (
                    <button
                      type="button"
                      className="chat-question-reply text-button"
                      onClick={() => {
                        setReplyingQuestionId(entry.event.questionId!);
                        document.getElementById("room-message")?.focus();
                      }}
                    >
                      Reply to {person?.name || "teammate"}
                    </button>
                  )}
              </AgentMessage>
            );
          }
          const questions = entry.questions || planQuestions(entry.plan);
          const structuredQuestions = entry.questionItems || [];
          const showSeparateQuestions = !!entry.questions || !entry.reply;
          return (
            <AgentMessage
              key={entry.key}
              name="Pearl"
              person={
                entry.person || team.find((member) => member.id === "pearl")
              }
              className="chat-plan"
              at={entry.at}
              onOpenProfile={onOpenProfile}
            >
              <RichText text={entry.reply || planSummary(entry.plan)} />
              {structuredQuestions.length > 0 ? (
                <PlanningQuestionSet
                  questions={structuredQuestions}
                  active={run?.status === "planned" && !run.redirectedTo}
                  busy={busy}
                  onAnswer={answerPlanningQuestions}
                />
              ) : showSeparateQuestions && questions.length > 0 ? (
                <ol className="plan-questions">
                  {questions.map((question) => (
                    <li key={question}>{roomQuestion(question)}</li>
                  ))}
                </ol>
              ) : null}
              {entry.plan && !entry.draft ? (
                <div className="chat-plan-actions">
                  <button
                    type="button"
                    className="text-button"
                    onClick={onOpenTask}
                  >
                    View full analysis <ArrowRight size={14} />
                  </button>
                </div>
              ) : null}
            </AgentMessage>
          );
        })}
        {run &&
          ["planning", "building", "auditing"].includes(run.status) &&
          (run.inFlightRequests?.length
            ? run.inFlightRequests
            : run.status === "planning"
              ? [
                  {
                    id: "planning",
                    actor: "pearl",
                    name: "propose_plan" as const,
                    startedAt: "",
                  },
                ]
              : []
          ).map((request) => {
            const person = team.find((member) => member.id === request.actor);
            return (
              <AgentMessage
                key={request.id}
                name={person?.name || request.actor}
                person={person}
                at={request.startedAt}
                onOpenProfile={onOpenProfile}
                status
                className="chat-agent-thinking"
              >
                <ThinkingIndicator
                  label={`${person?.name || request.actor} is ${request.name === "propose_files" ? "preparing a draft" : request.name === "audit_files" || request.name === "audit_chunk" ? "reviewing the draft" : "thinking"}`}
                />
              </AgentMessage>
            );
          })}
        {run?.status === "failed" && (
          <article className="chat-alert" role="alert">
            <strong>
              {task?.mode === "plan" && !run.plan
                ? "Pearl couldn't finish this planning turn"
                : "This attempt stopped"}
            </strong>
            <p>{run.error || "The request failed. No retry was made."}</p>
            {!run.executions?.length && <p>No commands ran in this attempt.</p>}
            <details>
              <summary>Technical details</summary>
              <p>
                Stage:{" "}
                {task?.mode === "plan" && !run.plan ? "planning" : "build"}.
                Model requests used: {run.calls}.
                {run.diagnostics?.length
                  ? ` Last model request: ${run.diagnostics.at(-1)!.outcome}; finish reason: ${run.diagnostics.at(-1)!.finishReason}.`
                  : " No provider diagnostic was recorded for this failure."}
              </p>
              {run.failureCode === "planning_validation" && (
                <p>
                  Scully rejected Pearl's planning response after bounded
                  repair. Your answer is saved, and no build commands ran.
                </p>
              )}
            </details>
            {task?.mode === "plan" && !run.plan ? (
              <div className="chat-confirm-actions">
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      const retried = await api.retryPlanning(run.id);
                      setRun(retried);
                      setRunHistory(await api.runs(task.id));
                    })
                  }
                >
                  Ask Pearl to try again
                </button>
                <span>
                  You can also explain what Pearl missed in the composer.
                </span>
              </div>
            ) : (
              <button className="secondary" onClick={onOpenTask}>
                Review attempt and prepare another
              </button>
            )}
          </article>
        )}
        {run?.status === "conflicted" && (
          <article className="chat-alert" role="alert">
            <strong>The team could not combine these drafts</strong>
            <p>
              {run.coordination?.conflicts
                ?.map((item) => `${item.path}: ${item.detail}`)
                .join(" ") ||
                "The proposed files overlap. No combined changes were written."}
            </p>
            <p>Ask Pearl about the conflict or review the attempt in Task.</p>
            <button className="secondary" onClick={onOpenTask}>
              Review attempt
            </button>
          </article>
        )}
        {run?.status === "awaiting_input" &&
          !!run.pendingQuestions?.length &&
          run.pendingQuestions.every((question) => !!question.answer) && (
            <article className="chat-alert" role="status">
              <strong>Answers received</strong>
              <p>
                The approved request limit needs enough room for the remaining
                writer and review calls before the build can continue.
              </p>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void action(async () =>
                    setRun(await api.startRun(run.id, true)),
                  )
                }
              >
                Continue build
              </button>
              <button
                type="button"
                className="text-button"
                onClick={onOpenTask}
              >
                Review request limit in Task
              </button>
            </article>
          )}
        {run?.status === "planned" &&
          run.plan &&
          run.planning?.planReview &&
          !run.planning.planReview.approvedAt &&
          !run.planning.proposal && (
            <section
              className="chat-plan-review"
              aria-label="Plan awaiting approval"
            >
              <h3>Review Pearl's plan</h3>
              <p>
                Read the full plan and discuss any changes before confirming it.
              </p>
              <button
                type="button"
                className="text-button"
                onClick={onOpenTask}
              >
                View full plan <ArrowRight size={14} />
              </button>
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    const started = await api.approvePlanningPlan(
                      run.id,
                      run.planning!.planReview!.revision,
                      true,
                    );
                    setRun(started);
                    if (task) setRunHistory(await api.runs(task.id));
                  })
                }
              >
                Approve plan and ask Pearl to propose a team
              </button>
            </section>
          )}
        {run?.status === "planned" &&
          run.planning?.proposal &&
          outstandingChoices.length === 0 && (
            <AgentMessage
              name="Pearl"
              person={team.find((member) => member.id === "pearl")}
              at={run.events.find((event) => event.text === run.plan)?.at}
              onOpenProfile={onOpenProfile}
              className="chat-team-proposal"
            >
              <StaffingProposalPanel
                planning={run.planning}
                team={run.teamSnapshot?.members || team}
                busy={busy}
                onApprove={() =>
                  void action(async () => {
                    setRun(
                      await api.approveLineup(
                        run.id,
                        run.planning!.proposal!.planRevision,
                        run.planning!.proposal!.assignments,
                        true,
                      ),
                    );
                  })
                }
              />
              <ProjectLocation api={api} run={run} onUpdated={setRun} />
            </AgentMessage>
          )}
        {run?.status === "planned" &&
          !run.planning &&
          outstandingChoices.length === 0 &&
          run.lineupProposal &&
          run.teamSnapshot && (
            <AgentMessage
              name="Pearl"
              person={team.find((member) => member.id === "pearl")}
              at={run.events.find((event) => event.text === run.plan)?.at}
              onOpenProfile={onOpenProfile}
              className="chat-team-proposal"
            >
              <p>
                The plan is ready. Here is the team I think fits the work best.
              </p>
              <div className="chat-team-roles">
                {(
                  [
                    [
                      "Build",
                      run.lineupProposal.core?.builderId,
                      Code2,
                      "Implements the app and brings the work together",
                    ],
                    [
                      "Test",
                      run.lineupProposal.core?.testerId,
                      TestTube2,
                      "Checks the behavior and writes focused tests",
                    ],
                    [
                      "Review",
                      run.lineupProposal.core?.auditorId,
                      SearchCheck,
                      "Reviews the combined result independently",
                    ],
                  ] as const
                )
                  .filter(([, id]) => id)
                  .map(([role, id, Icon, description]) => (
                    <div className="chat-team-role" key={role}>
                      <Icon size={18} aria-hidden="true" />
                      <div>
                        <strong>{role}</strong>
                        <span>{description}</span>
                      </div>
                      <b>
                        {run.teamSnapshot!.members.find(
                          (member) => member.id === id,
                        )?.name || id}
                      </b>
                    </div>
                  ))}
              </div>
              {!!run.lineupProposal.suggestions.length && (
                <p className="chat-team-specialists">
                  Also suggested:{" "}
                  {run.lineupProposal.suggestions
                    .map(
                      ({ id }) =>
                        run.teamSnapshot!.members.find(
                          (member) => member.id === id,
                        )?.name || id,
                    )
                    .join(", ")}
                  . Review these before approving.
                </p>
              )}
              <ProjectLocation api={api} run={run} onUpdated={setRun} />
              {run.approvedLineup?.planRevision ===
              run.lineupProposal.planRevision ? (
                <p className="chat-team-approved">Team approved.</p>
              ) : (
                <div className="chat-confirm-actions">
                  {!run.lineupProposal.suggestions.length && (
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() =>
                        void action(async () => {
                          setRun(
                            await api.approveLineup(
                              run.id,
                              run.lineupProposal!.planRevision,
                              [],
                              true,
                              run.lineupProposal!.core
                                ? {
                                    builderId:
                                      run.lineupProposal!.core!.builderId,
                                    auditorId:
                                      run.lineupProposal!.core!.auditorId,
                                    testerId:
                                      run.lineupProposal!.core!.testerId,
                                  }
                                : undefined,
                            ),
                          );
                        })
                      }
                    >
                      Approve team
                    </button>
                  )}
                  <button
                    className="text-button"
                    onClick={() => setShowLineupReview((value) => !value)}
                  >
                    {showLineupReview
                      ? "Hide choices"
                      : run.lineupProposal.suggestions.length
                        ? "Review team and specialists"
                        : "Adjust team"}
                  </button>
                </div>
              )}
              {showLineupReview && (
                <LineupProposalPanel
                  proposal={run.lineupProposal}
                  team={run.teamSnapshot.members}
                  approvedLineup={run.approvedLineup}
                  busy={busy}
                  onApprove={(entries, core) =>
                    void action(async () => {
                      setRun(
                        await api.approveLineup(
                          run.id,
                          run.lineupProposal!.planRevision,
                          entries,
                          true,
                          core,
                        ),
                      );
                      setShowLineupReview(false);
                    })
                  }
                />
              )}
            </AgentMessage>
          )}
        {run?.status === "planned" &&
          outstandingChoices.length === 0 &&
          (run.planning
            ? !!run.planning.approved
            : !run.lineupProposal ||
              run.approvedLineup?.planRevision ===
                run.lineupProposal.planRevision) && (
            <AgentMessage
              name="Pearl"
              person={team.find((member) => member.id === "pearl")}
              at={run.events.find((event) => event.text === run.plan)?.at}
              onOpenProfile={onOpenProfile}
              className="chat-approval"
            >
              <h3>Ready for the team to build?</h3>
              <p>
                Review the selected folder, teammate permissions, execution
                environment, upload manifest, and checks in Task before the team
                starts.
              </p>
              <ProjectLocation api={api} run={run} onUpdated={setRun} />
              <button className="primary" onClick={onOpenTask}>
                Review project scope <ArrowRight size={15} />
              </button>
            </AgentMessage>
          )}
        {run && unanswered && chooseRecipient && !pendingReply && (
          <article className="chat-recipient-choice">
            <strong>Pearl</strong>
            <p>
              This could fit more than one specialty. Who would you like to hear
              from?
            </p>
            <div>
              {(run.teamSnapshot?.members || team).map((member) => (
                <button
                  className="secondary"
                  key={member.id}
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      const answered = await api.answerConversationMessage(
                        run.id,
                        unanswered.id,
                        member.id,
                      );
                      setRun(answered);
                      setRunHistory((previous) =>
                        previous.map((item) =>
                          item.id === answered.id ? answered : item,
                        ),
                      );
                      setChooseRecipient(false);
                    })
                  }
                >
                  {member.name} · {member.role}
                </button>
              ))}
            </div>
          </article>
        )}
        {run &&
          ["planning", "building", "auditing"].includes(run.status) &&
          !run.redirectedTo && (
            <section
              className="room-interruption"
              aria-label="Active work controls"
            >
              <p>
                Pearl and the team are working. You can pause before the next
                request.
              </p>
              {!run.requestPause ||
              ["resumed", "not_reached", "stopped", "interrupted"].includes(
                run.requestPause.status,
              ) ? (
                <button
                  className="secondary"
                  disabled={busy || (run.requestPause?.attempts || 0) >= 3}
                  onClick={() =>
                    void action(async () => {
                      setRun(await api.requestRunPause(run.id));
                    })
                  }
                >
                  Pause before next request
                </button>
              ) : null}
              {run.requestPause?.status === "requested" && (
                <p role="status">
                  Pause requested. The current request may still finish.
                </p>
              )}
              {run.requestPause?.status === "paused" && (
                <>
                  <p role="status">Paused before the next request.</p>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        setRun(
                          await api.resumeRunPause(
                            run.id,
                            run.requestPause!.id,
                          ),
                        );
                      })
                    }
                  >
                    Continue current work
                  </button>
                </>
              )}
            </section>
          )}
        {run && (
          <div className="room-activity-toggle">
            <button
              className="text-button"
              onClick={() => setShowActivity((value) => !value)}
              aria-expanded={showActivity}
            >
              {showActivity ? "Hide" : "Show"} full activity (
              {run.events.length} events)
            </button>
            {showActivity && (
              <div className="room-full-activity">
                {run.events.map((event, index) => (
                  <p key={index}>
                    <strong>{event.actorName || event.actor}</strong>{" "}
                    {event.text}
                  </p>
                ))}
                <details>
                  <summary>Request diagnostics</summary>
                  {(run.diagnostics || []).length ? (
                    run.diagnostics!.map((item, index) => (
                      <pre key={index}>{JSON.stringify(item, null, 2)}</pre>
                    ))
                  ) : (
                    <p>No request diagnostics recorded yet.</p>
                  )}
                </details>
              </div>
            )}
          </div>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
      <form className="room-composer" onSubmit={(event) => void send(event)}>
        {run?.status === "planned" &&
          task?.mode === "plan" &&
          (run.planning
            ? !!run.planning.proposal &&
              !pendingPlanningQuestions(run.planning).length
            : !planQuestions(run.plan).length) && (
            <label>
              <input
                type="checkbox"
                checked={revisePlan}
                onChange={(event) => setRevisePlan(event.target.checked)}
              />{" "}
              Revise the plan with this message
            </label>
          )}
        {replyingQuestionId && run && (
          <div className="room-reply-context">
            <span>
              Replying to{" "}
              {team.find(
                (person) =>
                  person.id ===
                  run.pendingQuestions?.find(
                    (question) => question.id === replyingQuestionId,
                  )?.actor,
              )?.name || "teammate"}
            </span>
            <button
              type="button"
              className="text-button"
              onClick={() => setReplyingQuestionId(null)}
            >
              Cancel reply
            </button>
          </div>
        )}
        <label className="visually-hidden" htmlFor="room-message">
          {task ? "Message your team" : "Start a task"}
        </label>
        <AutoGrowTextarea
          id="room-message"
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
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
          maxLength={2000}
          placeholder={
            task
              ? "Ask a question, share an idea, or tag a teammate such as @Sloane"
              : "Tell Pearl what you want to build..."
          }
          disabled={busy || (task !== null && !canMessage)}
        />
        <div className="room-composer-footer">
          {!session?.configured && (
            <button
              type="button"
              className="text-button"
              onClick={onOpenSettings}
            >
              Connect Nebius
            </button>
          )}
          <button
            className="primary"
            disabled={busy || !draft.trim() || (task !== null && !canMessage)}
            type="submit"
          >
            <Send size={15} /> Send
          </button>
        </div>
      </form>
    </section>
  );
}

export type ProjectFilePreview = {
  path: string;
  content: string;
  status: "source" | "proposed" | "draft" | "written" | "branch" | "integrated";
  owner?: string;
  revision?: string;
  before?: string | null;
};

export function RoomFiles({
  api,
  task,
  onOpenFile,
}: {
  api: DesktopAPI;
  task: Task;
  onOpenFile?: (file: ProjectFilePreview) => void;
}) {
  const [run, setRun] = useState<Run | null>(null);
  useEffect(() => {
    let live = true;
    const off = api.onRun((next) => {
      if (live && next.taskId === task.id) setRun(next);
    });
    void api
      .runs(task.id)
      .then((items) => {
        if (live) setRun(items[0] || null);
      })
      .catch(() => {});
    return () => {
      live = false;
      off();
    };
  }, [api, task.id]);
  const files: ProjectFilePreview[] = [];
  if (run?.collaboration) {
    const state = run.collaboration;
    const base = state.checkpoints.find((item) => item.id === state.baseId);
    const baseFiles = new Map(
      base?.files.map((file) => [file.path, file.content]) || [],
    );
    for (const file of base?.files || [])
      files.push({
        ...file,
        status: "source",
        owner: "Local project snapshot",
        revision: state.baseId,
      });
    for (const person of state.members) {
      const head = state.checkpoints.find((item) => item.id === person.headId);
      if (!head || head.id === state.baseId) continue;
      for (const file of head.files)
        files.push({
          ...file,
          status: "branch",
          owner: `${person.name} branch`,
          revision: head.id,
          before: baseFiles.get(file.path) ?? null,
        });
    }
    const integrated = state.checkpoints.find(
      (item) => item.id === state.integration.headId,
    );
    if (integrated && integrated.id !== state.baseId)
      for (const file of integrated.files) {
        files.push({
          ...file,
          status: "integrated",
          owner: "Integration workspace",
          revision: integrated.id,
          before: baseFiles.get(file.path) ?? null,
        });
      }
  } else {
    for (const file of run?.files || [])
      files.push({ ...file, status: "source" });
    if (!run?.drafts.length)
      for (const assignment of run?.coordination?.assignments || [])
        for (const file of assignment.files)
          files.push({
            ...file,
            status: "proposed",
            owner:
              run?.teamSnapshot?.members.find(
                (member) => member.id === assignment.owner,
              )?.name || assignment.owner,
          });
    for (const file of run?.drafts || [])
      files.push({
        ...file,
        status: run?.projectWorkspace?.writtenFiles?.includes(file.path)
          ? "written"
          : "draft",
      });
  }
  type Node = {
    folders: Map<string, Node>;
    files: (ProjectFilePreview & { name: string })[];
  };
  const roots = new Map<string, Node>();
  for (const file of files) {
    const { path } = file;
    const parts = path.split("/");
    const group = run?.collaboration ? file.owner || file.status : "Project";
    if (!roots.has(group)) roots.set(group, { folders: new Map(), files: [] });
    let node = roots.get(group)!;
    for (const folder of parts.slice(0, -1)) {
      if (!node.folders.has(folder))
        node.folders.set(folder, { folders: new Map(), files: [] });
      node = node.folders.get(folder)!;
    }
    node.files.push({ name: parts.at(-1) || path, ...file });
  }
  function renderNode(node: Node, prefix = "") {
    return (
      <>
        {[...node.folders.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([name, child]) => (
            <details className="file-folder" open key={`${prefix}${name}`}>
              <summary>{name}</summary>
              <div className="file-folder-children">
                {renderNode(child, `${prefix}${name}/`)}
              </div>
            </details>
          ))}
        {node.files
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((file) => (
            <button
              type="button"
              className="file-entry"
              key={`${file.path}:${file.status}:${file.owner || ""}:${file.revision || ""}`}
              title={file.path}
              onClick={() => onOpenFile?.(file)}
            >
              <span>{file.name}</span>
              <small>
                {file.owner
                  ? run?.collaboration
                    ? `${file.owner} · ${file.status}`
                    : `${file.status} by ${file.owner}`
                  : file.status}
              </small>
            </button>
          ))}
      </>
    );
  }
  return (
    <section className="room-files" aria-label="Project files">
      <div className="section-heading">
        <h2>Project files</h2>
        <span className="tiny-badge">{files.length}</span>
      </div>
      <p className="muted room-files-location">
        {run?.collaboration?.scope.projectPath ||
          run?.projectWorkspace?.path ||
          run?.sourceName ||
          "No project selected"}
      </p>
      {files.length ? (
        <div className="file-tree">
          {[...roots].map(([group, root]) => (
            <section key={group} aria-label={`${group} files`}>
              <h3>{group}</h3>
              {renderNode(root)}
            </section>
          ))}
        </div>
      ) : (
        <div className="files-empty">
          <MessageSquare size={20} />
          <p>
            {run?.projectWorkspace
              ? "This project has no selected files yet. Teammate proposals will appear here as they finish, and combined files will appear after review."
              : "Choose a project folder to see its selected files and the team's proposals."}
          </p>
        </div>
      )}
    </section>
  );
}
