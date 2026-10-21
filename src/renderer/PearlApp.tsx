import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { FolderOpen, Plus, Send, Settings2, ShieldCheck } from "lucide-react";
import type { DesktopAPI } from "../shared/contracts";
import type { PearlChat, PearlChatSummary } from "../shared/pearl-chat";
import { RichText } from "./RichText";
import "./pearl.css";

function patchPreview(value: string): string | null {
  try {
    const result = JSON.parse(value) as {
      path?: unknown;
      hunks?: { line?: unknown; removed?: unknown; added?: unknown }[];
    };
    if (typeof result.path !== "string" || !Array.isArray(result.hunks))
      return null;
    const lines = result.hunks.map((hunk) => {
      if (
        typeof hunk.line !== "number" ||
        typeof hunk.removed !== "string" ||
        typeof hunk.added !== "string"
      )
        throw new Error("Invalid patch hunk");
      return `@@ ${result.path}:${hunk.line} @@\n${hunk.removed.replace(/^/gmu, "-")}\n${hunk.added.replace(/^/gmu, "+")}`;
    });
    return lines.join("\n");
  } catch {
    return null;
  }
}

function browserPreview(value: string): string | null {
  try {
    const result = JSON.parse(value) as {
      title?: unknown;
      initialVisibleText?: unknown;
      visibleText?: unknown;
      controls?: { tag?: unknown; id?: unknown; label?: unknown }[];
      hiddenViolations?: { tag?: unknown; id?: unknown }[];
      errors?: unknown[];
      blockedExternalRequests?: unknown;
      completedSteps?: unknown;
    };
    if (
      typeof result.title !== "string" ||
      typeof result.visibleText !== "string" ||
      !Array.isArray(result.controls) ||
      !Array.isArray(result.hiddenViolations) ||
      !Array.isArray(result.errors)
    )
      return null;
    const controls = result.controls
      .filter(
        (item) => typeof item.tag === "string" && typeof item.id === "string",
      )
      .map(
        (item) =>
          `${item.tag}${item.id ? ` #${item.id}` : ""}${typeof item.label === "string" && item.label ? `: ${item.label}` : ""}`,
      );
    const hidden = result.hiddenViolations
      .filter(
        (item) => typeof item.tag === "string" && typeof item.id === "string",
      )
      .map((item) => `${item.tag}${item.id ? ` #${item.id}` : ""}`);
    const errors = result.errors.filter(
      (item): item is string => typeof item === "string",
    );
    return [
      `Page: ${result.title}`,
      `Actions completed: ${typeof result.completedSteps === "number" ? result.completedSteps : "unknown"}`,
      `Blocked external requests: ${typeof result.blockedExternalRequests === "number" ? result.blockedExternalRequests : "unknown"}`,
      ...(typeof result.initialVisibleText === "string" &&
      result.initialVisibleText !== result.visibleText
        ? ["Initial visible text:", result.initialVisibleText]
        : []),
      "Final visible text:",
      result.visibleText,
      "Controls:",
      controls.length ? controls.join("\n") : "None observed",
      "Hidden-state violations at any observed point:",
      hidden.length ? hidden.join("\n") : "None observed",
      "Page errors:",
      errors.length ? errors.join("\n") : "None observed",
    ].join("\n");
  } catch {
    return null;
  }
}

export function PearlApp({
  api: optionalApi = window.scully,
}: {
  api?: DesktopAPI;
}) {
  const api = optionalApi!;
  const [chats, setChats] = useState<PearlChatSummary[]>([]);
  const [chat, setChat] = useState<PearlChat | null>(null);
  const [draft, setDraft] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [key, setKey] = useState("");
  const [model, setModel] = useState("zai-org/GLM-5.3-Flash");
  const [configured, setConfigured] = useState(false);
  const activeId = useRef<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    void Promise.all([api.listPearlChats(), api.session()])
      .then(([items, session]) => {
        if (!live) return;
        setChats(items);
        setConfigured(session.configured);
        if (session.model) setModel(session.model);
      })
      .catch((cause) => {
        if (live) setError(String(cause));
      });
    const off = api.onPearlChatUpdate((updated) => {
      if (activeId.current === updated.id) setChat(updated);
      void api
        .listPearlChats()
        .then(setChats)
        .catch(() => {});
    });
    return () => {
      live = false;
      off();
    };
  }, [api]);
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [chat?.messages.length, chat?.status, chat?.streamingText?.length]);
  async function action<T>(work: () => Promise<T>): Promise<T | undefined> {
    setError("");
    setBusy(true);
    try {
      return await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
    return undefined;
  }
  async function mutateChat(
    work: () => Promise<PearlChat>,
  ): Promise<PearlChat> {
    const updated = await work();
    const latest = await api.getPearlChat(updated.id);
    if (activeId.current === updated.id) setChat(latest);
    return latest;
  }
  async function create() {
    const created = await action(() => api.createPearlChat());
    if (!created) return;
    activeId.current = created.id;
    setChat(created);
    setChats(await api.listPearlChats());
    setDraft("");
  }
  async function open(id: string) {
    const selected = await action(() => api.getPearlChat(id));
    if (!selected) return;
    activeId.current = id;
    setChat(selected);
    setDraft("");
  }
  async function send(event?: FormEvent) {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    let current = chat;
    if (!current) {
      current = (await action(() => api.createPearlChat())) || null;
      if (!current) return;
      activeId.current = current.id;
      setChat(current);
    }
    const result = await action(() =>
      mutateChat(() => api.sendPearlMessage(current!.id, text)),
    );
    if (result) {
      setDraft("");
    }
  }
  function composerKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }
  const pendingQuestion = chat?.questions.find(
    (item) => item.status === "pending",
  );
  let command: { command?: string; args?: string[] } | null = null;
  if (chat?.pendingTool) {
    try {
      command = JSON.parse(chat.pendingTool.arguments);
    } catch {
      command = null;
    }
  }
  return (
    <div className="pearl-shell">
      <aside className="pearl-sidebar">
        <div className="pearl-brand">
          <span className="pearl-mark">✦</span>
          <strong>Scully</strong>
        </div>
        <button className="pearl-new" onClick={() => void create()}>
          <Plus size={17} /> New chat
        </button>
        <div className="pearl-sidebar-heading">Chats</div>
        <nav aria-label="Chats" className="pearl-chat-list">
          {chats.map((item) => (
            <button
              key={item.id}
              className={chat?.id === item.id ? "selected" : ""}
              onClick={() => void open(item.id)}
              title={item.title}
            >
              {item.title}
            </button>
          ))}
        </nav>
        <button
          className="pearl-settings-link"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings2 size={17} /> Settings
        </button>
      </aside>
      <main className="pearl-main">
        <header className="pearl-header">
          <div>
            <span className="pearl-name">Pearl</span>
            <small>Chat and coding assistant</small>
          </div>
          {chat && (
            <button
              className="pearl-project-button"
              onClick={() =>
                void action(async () => {
                  const updated = await api.choosePearlProject(chat.id);
                  if (updated) setChat(updated);
                })
              }
            >
              <FolderOpen size={16} />{" "}
              {chat.project
                ? chat.project.path.split("/").at(-1)
                : "Choose project"}
            </button>
          )}
        </header>
        <div
          className="pearl-scroll"
          role="log"
          aria-label="Pearl conversation"
        >
          {!chat?.messages.length && (
            <div className="pearl-welcome">
              <div className="pearl-welcome-mark">✦</div>
              <h1>What can I help you with?</h1>
              <p>
                Ask a question, discuss an idea, or choose a project and build
                with Pearl.
              </p>
              {!configured && (
                <button
                  className="pearl-project-button"
                  onClick={() => setSettingsOpen(true)}
                >
                  Connect Nebius
                </button>
              )}
            </div>
          )}
          <div className="pearl-messages">
            {chat?.messages
              .filter(
                (item) =>
                  !(
                    item.role === "tool" &&
                    [
                      "ask_user",
                      "answer_question",
                      "withdraw_question",
                    ].includes(item.toolName || "")
                  ) &&
                  !(
                    item.role === "assistant" &&
                    [
                      "ask_user",
                      "answer_question",
                      "withdraw_question",
                    ].includes(item.toolName || "") &&
                    !item.text.trim()
                  ),
              )
              .map((item) =>
                item.role === "tool" ? (
                  <details className="pearl-tool" key={item.id}>
                    <summary>{item.toolName} result</summary>
                    <pre>
                      {item.toolName === "apply_patch"
                        ? (patchPreview(item.text) ?? item.text)
                        : ["browser_check", "preview_app"].includes(
                              item.toolName || "",
                            )
                          ? (browserPreview(item.text) ?? item.text)
                          : item.text}
                    </pre>
                  </details>
                ) : item.toolCalls?.length ? (
                  <article key={item.id} className="pearl-message assistant">
                    {item.text.trim() &&
                      !item.toolCalls.some(
                        (call) => call.name === "complete_work",
                      ) && <RichText text={item.text} />}
                    <div className="pearl-action">
                      Pearl requested{" "}
                      {item.toolCalls.map((call) => call.name).join(" and ")}
                    </div>
                  </article>
                ) : item.toolName ? (
                  <article key={item.id} className="pearl-message assistant">
                    {item.text.trim() && item.toolName !== "complete_work" && (
                      <RichText text={item.text} />
                    )}
                    {![
                      "ask_user",
                      "answer_question",
                      "withdraw_question",
                    ].includes(item.toolName) && (
                      <div className="pearl-action">
                        Pearl requested {item.toolName}
                      </div>
                    )}
                  </article>
                ) : (
                  <article
                    key={item.id}
                    className={`pearl-message ${item.role}`}
                  >
                    <span className="pearl-speaker">
                      {item.role === "user" ? "You" : "Pearl"}
                    </span>
                    <RichText text={item.text} />
                    {item.role === "assistant" && item.completion && (
                      <div className="pearl-evidence">
                        Work status: {item.completion.status}.
                        {item.completion.remaining && (
                          <> Remaining: {item.completion.remaining}</>
                        )}
                      </div>
                    )}
                    {item.role === "assistant" &&
                      item.evidence &&
                      (item.evidence.projectApproved ||
                        item.evidence.filesWritten > 0) && (
                        <div className="pearl-evidence">
                          {item.evidence.filesWritten > 0 ? (
                            <>
                              {item.evidence.filesWritten} file
                              {item.evidence.filesWritten === 1 ? "" : "s"}{" "}
                              changed.
                              {item.evidence.commandsCompleted === 0
                                ? " No command checks completed for these changes."
                                : item.evidence
                                      .successfulCommandAfterLatestWrite ===
                                    false
                                  ? " No successful command check after the latest edit; the changes remain unverified."
                                  : ` ${item.evidence.commandsCompleted} command check${item.evidence.commandsCompleted === 1 ? "" : "s"} completed; review the result.`}
                            </>
                          ) : item.evidence.commandsCompleted > 0 ? (
                            `No files changed. ${item.evidence.commandsCompleted} command check${item.evidence.commandsCompleted === 1 ? "" : "s"} completed; review the result.`
                          ) : (
                            "No files changed or command checks completed in this turn."
                          )}
                          {Boolean(item.evidence.uiFilesWritten) && (
                            <span>
                              {item.evidence.successfulBrowserAfterLatestUiWrite
                                ? ` ${item.evidence.browserChecks || 0} browser check${item.evidence.browserChecks === 1 ? "" : "s"} completed after the UI edit; review the result.`
                                : " No clean browser check after the latest UI edit; the UI remains unverified."}
                            </span>
                          )}
                        </div>
                      )}
                  </article>
                ),
              )}
            {chat?.status === "running" && chat.streamingText && (
              <article
                className="pearl-message assistant"
                aria-label="Pearl draft"
              >
                <span className="pearl-speaker">Pearl</span>
                <RichText text={chat.streamingText} />
              </article>
            )}
            {chat?.status === "running" && (
              <div className="pearl-working">
                Pearl is working…{" "}
                <button
                  className="pearl-stop"
                  onClick={() =>
                    void action(() =>
                      mutateChat(() => api.stopPearlChat(chat.id)),
                    )
                  }
                >
                  Stop
                </button>
              </div>
            )}
            {chat?.project && !chat.project.approved && (
              <section className="pearl-card" aria-label="Project approval">
                <ShieldCheck size={20} />
                <div>
                  <strong>Approve this project</strong>
                  <p>
                    Pearl may read and edit UTF-8 files inside{" "}
                    <code>{chat.project.path}</code>. Commands ask for separate
                    approval. Changes are checked against the file revision and
                    backed up.
                  </p>
                  <button
                    onClick={() =>
                      void action(() =>
                        mutateChat(() =>
                          api.approvePearlProject(chat.id, true),
                        ),
                      )
                    }
                  >
                    Allow project access
                  </button>
                  <button
                    className="quiet"
                    onClick={() =>
                      void action(() =>
                        mutateChat(() =>
                          api.approvePearlProject(chat.id, false),
                        ),
                      )
                    }
                  >
                    Cancel
                  </button>
                </div>
              </section>
            )}
            {chat?.work && (
              <details className="pearl-card" aria-label="Working plan">
                <summary>Working plan: {chat.work.objective}</summary>
                <p>{chat.work.approach}</p>
                {chat.work.requirements.length > 0 && (
                  <div>
                    Quoted user requirements
                    <ul>
                      {chat.work.requirements.map((requirement, index) => (
                        <li key={index}>{requirement.quote}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <ul>
                  {chat.work.steps.map((step, index) => (
                    <li key={index}>
                      {step.status === "completed"
                        ? "✓"
                        : step.status === "in_progress"
                          ? "→"
                          : "○"}{" "}
                      {step.text}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {chat?.pendingTool && (
              <section className="pearl-card" aria-label="Command approval">
                <ShieldCheck size={20} />
                <div>
                  <strong>Approve command?</strong>
                  <p>
                    {chat.pendingTool.name === "preview_app"
                      ? "Start the project server and an isolated browser for this turn, up to ten minutes. Pearl can continue interacting with it; form actions can change project data. Stop ends the preview."
                      : "This runs once inside the selected project."}
                  </p>
                  <pre>
                    {command
                      ? JSON.stringify(
                          {
                            executable: chat.pendingTool.executable?.path,
                            argv: [command.command, ...(command.args || [])],
                            ...(chat.pendingTool.name === "preview_app"
                              ? {
                                  browser: JSON.parse(
                                    chat.pendingTool.arguments,
                                  ),
                                }
                              : {}),
                          },
                          null,
                          2,
                        )
                      : chat.pendingTool.arguments}
                  </pre>
                  <button
                    onClick={() =>
                      void action(() =>
                        mutateChat(() =>
                          api.decidePearlTool(
                            chat.id,
                            chat.pendingTool!.id,
                            true,
                          ),
                        ),
                      )
                    }
                  >
                    Run once
                  </button>
                  <button
                    className="quiet"
                    onClick={() =>
                      void action(() =>
                        mutateChat(() =>
                          api.decidePearlTool(
                            chat.id,
                            chat.pendingTool!.id,
                            false,
                          ),
                        ),
                      )
                    }
                  >
                    Deny
                  </button>
                </div>
              </section>
            )}
            {pendingQuestion && (
              <section className="pearl-card" aria-label="Pearl question">
                <div>
                  <strong>{pendingQuestion.text}</strong>
                  {pendingQuestion.recommendation && (
                    <p>{pendingQuestion.recommendation}</p>
                  )}
                  {pendingQuestion.reopenReason && (
                    <p>
                      Revisiting this choice: {pendingQuestion.reopenReason}
                    </p>
                  )}
                  <div className="pearl-options">
                    {pendingQuestion.options.map((option) => (
                      <button
                        key={option}
                        className="quiet"
                        onClick={() => setAnswer(option)}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (!chat) return;
                      void action(async () => {
                        await mutateChat(() =>
                          api.answerPearlQuestion(
                            chat.id,
                            pendingQuestion.id,
                            answer,
                          ),
                        );
                        setAnswer("");
                      });
                    }}
                  >
                    <input
                      aria-label="Answer Pearl"
                      value={answer}
                      onChange={(event) => setAnswer(event.target.value)}
                      placeholder="Choose or write your answer"
                    />
                    <button disabled={!answer.trim()}>Answer</button>
                  </form>
                </div>
              </section>
            )}
            {(chat?.status === "failed" || chat?.status === "paused") && (
              <section
                className={`pearl-card${chat.status === "failed" ? " error" : ""}`}
              >
                <div>
                  <strong>
                    {chat.status === "paused"
                      ? "Work paused"
                      : "Turn interrupted"}
                  </strong>
                  <p>{chat.error}</p>
                  <button
                    onClick={() =>
                      void action(() =>
                        mutateChat(() => api.retryPearlChat(chat.id)),
                      )
                    }
                  >
                    Continue
                  </button>
                </div>
              </section>
            )}
            <div ref={end} />
          </div>
        </div>
        {error && (
          <div className="pearl-error" role="alert">
            {error}
          </div>
        )}
        <form className="pearl-composer" onSubmit={(event) => void send(event)}>
          <textarea
            aria-label="Message Pearl"
            value={draft}
            onKeyDown={composerKey}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Message Pearl"
            rows={2}
          />
          <button
            aria-label="Send message"
            disabled={
              !draft.trim() ||
              chat?.status === "running" ||
              chat?.status === "awaiting_approval" ||
              busy
            }
          >
            <Send size={18} />
          </button>
        </form>
        <div className="pearl-footer">
          Pearl can make mistakes. Review code changes and command requests.
        </div>
      </main>
      {settingsOpen && (
        <div className="pearl-modal-backdrop">
          <form
            className="pearl-modal"
            onSubmit={(event) => {
              event.preventDefault();
              void action(async () => {
                await api.configureSession({ key, model, outputTokens: 16384 });
                setConfigured(true);
                setKey("");
                setSettingsOpen(false);
              });
            }}
          >
            <h2>Nebius connection</h2>
            <p>
              {configured
                ? "Connected for this app session."
                : "Connect a model to chat with Pearl."}
            </p>
            <label>
              API key
              <input
                type="password"
                value={key}
                onChange={(event) => setKey(event.target.value)}
                required
              />
            </label>
            <label>
              Model
              <input
                value={model}
                onChange={(event) => setModel(event.target.value)}
                required
              />
            </label>
            <div>
              <button
                type="button"
                className="quiet"
                onClick={() => setSettingsOpen(false)}
              >
                Cancel
              </button>
              <button>Connect</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
