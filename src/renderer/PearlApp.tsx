import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  Archive,
  Folder,
  MessageSquareText,
  MoreHorizontal,
  Plus,
  Send,
  Settings2,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import type { DesktopAPI } from "../shared/contracts";
import type { PearlChat, PearlChatSummary } from "../shared/pearl-chat";
import { RichText } from "./RichText";
import { PearlActivity, roomTimeline } from "./PearlActivity";
import { PearlMessageFrame } from "./PearlMessageFrame";
import scullyLogo from "../../assets/branding/scully-friendly-nerd-transparent-v1.png";
import pearlPortrait from "../../assets/team-portrait-coordinator-v1.png";
import "./pearl.css";

const PearlTerminalView = lazy(async () => ({
  default: (await import("./PearlTerminalView")).PearlTerminalView,
}));

export function PearlApp({
  api: optionalApi = window.scully,
}: {
  api?: DesktopAPI;
}) {
  const api = optionalApi!;
  const [chats, setChats] = useState<PearlChatSummary[]>([]);
  const [archivedChats, setArchivedChats] = useState<PearlChatSummary[]>([]);
  const [trashedChats, setTrashedChats] = useState<PearlChatSummary[]>([]);
  const [chat, setChat] = useState<PearlChat | null>(null);
  const [draft, setDraft] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [panel, setPanel] = useState<
    "chats" | "archived" | "trash" | "settings" | null
  >("chats");
  const [menuId, setMenuId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [webKey, setWebKey] = useState("");
  const [webConfigured, setWebConfigured] = useState(false);
  const [model, setModel] = useState("zai-org/GLM-5.3-Flash");
  const [configured, setConfigured] = useState(false);
  const activeId = useRef<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const composerInput = useRef<HTMLTextAreaElement>(null);
  async function refreshChats() {
    const [active, archived, trash] = await Promise.all([
      api.listPearlChats(),
      api.listPearlChats("archived"),
      api.listPearlChats("trash"),
    ]);
    setChats(active);
    setArchivedChats(archived);
    setTrashedChats(trash);
  }
  useEffect(() => {
    let live = true;
    void Promise.all([
      api.session(),
      api.webSearchInfo?.() ?? Promise.resolve({ configured: false }),
      refreshChats(),
    ])
      .then(([session, web]) => {
        if (!live) return;
        setConfigured(session.configured);
        setWebConfigured(web.configured);
        if (session.model) setModel(session.model);
      })
      .catch((cause) => {
        if (live) setError(String(cause));
      });
    const off = api.onPearlChatUpdate((updated) => {
      if (activeId.current === updated.id) setChat(updated);
      void refreshChats().catch(() => {});
    });
    return () => {
      live = false;
      off();
    };
  }, [api]);
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [chat?.messages.length, chat?.status, chat?.streamingText?.length]);
  useLayoutEffect(() => {
    const input = composerInput.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 210)}px`;
  }, [draft]);
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
    setPanel("chats");
    await action(refreshChats);
    setDraft("");
  }
  async function open(id: string) {
    const selected = await action(() => api.getPearlChat(id));
    if (!selected) return;
    activeId.current = id;
    setChat(selected);
    setDraft("");
  }
  async function changeLifecycle(
    id: string,
    operation: "archive" | "trash" | "restore" | "delete",
  ) {
    const changed = await action(async () => {
      switch (operation) {
        case "archive":
          return api.archivePearlChat(id);
        case "trash":
          return api.trashPearlChat(id);
        case "restore":
          return api.restorePearlChat(id);
        case "delete":
          await api.deletePearlChatPermanently(id);
          return null;
      }
    });
    if (changed === undefined) return;
    setMenuId(null);
    setConfirmDeleteId(null);
    if (activeId.current === id) {
      activeId.current = operation === "restore" ? id : null;
      setChat(operation === "restore" ? changed : null);
      setDraft("");
    }
    if (operation === "restore") setPanel("chats");
    await action(refreshChats);
  }
  async function send(event?: FormEvent) {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || busy || chat?.lifecycle) return;
    let current = chat;
    if (!current) {
      current = (await action(() => api.createPearlChat())) || null;
      if (!current) return;
      activeId.current = current.id;
      setChat(current);
      setPanel("chats");
    }
    const result = await action(() =>
      mutateChat(() => api.sendPearlMessage(current!.id, text)),
    );
    if (result) {
      setDraft("");
    }
  }
  function chatList(
    items: PearlChatSummary[],
    scope: "chats" | "archived" | "trash",
  ) {
    return (
      <nav
        aria-label={
          scope === "chats"
            ? "Chats"
            : scope === "archived"
              ? "Archived chats"
              : "Trash chats"
        }
        className="pearl-chat-list"
      >
        {items.length === 0 && (
          <p className="pearl-list-empty">
            {scope === "archived"
              ? "No archived chats"
              : scope === "trash"
                ? "Trash is empty"
                : "No chats yet"}
          </p>
        )}
        {items.map((item) => (
          <div key={item.id} className="pearl-chat-row">
            <button
              className={
                chat?.id === item.id
                  ? "selected pearl-chat-title"
                  : "pearl-chat-title"
              }
              onClick={() => void open(item.id)}
              title={item.title}
            >
              <span>{item.title}</span>
            </button>
            <button
              className="pearl-chat-options"
              aria-label={`Options for ${item.title}`}
              aria-expanded={menuId === item.id}
              onClick={() => {
                setMenuId(menuId === item.id ? null : item.id);
                setConfirmDeleteId(null);
              }}
            >
              <MoreHorizontal size={16} aria-hidden="true" />
            </button>
            {menuId === item.id && (
              <div className="pearl-chat-menu">
                {scope === "chats" && (
                  <button
                    onClick={() => void changeLifecycle(item.id, "archive")}
                  >
                    Archive
                  </button>
                )}
                {scope !== "chats" && (
                  <button
                    onClick={() => void changeLifecycle(item.id, "restore")}
                  >
                    Restore
                  </button>
                )}
                {scope !== "trash" && (
                  <button
                    onClick={() => void changeLifecycle(item.id, "trash")}
                  >
                    Move to Trash
                  </button>
                )}
                {scope === "trash" &&
                  (confirmDeleteId === item.id ? (
                    <div className="pearl-delete-confirm">
                      <p>Delete this chat permanently?</p>
                      <button
                        onClick={() => {
                          setConfirmDeleteId(null);
                          setMenuId(null);
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => void changeLifecycle(item.id, "delete")}
                      >
                        Confirm deletion
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmDeleteId(item.id)}>
                      Delete permanently
                    </button>
                  ))}
              </div>
            )}
          </div>
        ))}
      </nav>
    );
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
      <header className="pearl-header">
        <div className="pearl-brand">
          <img src={scullyLogo} alt="Scully alien head" />
          <strong>Scully</strong>
        </div>
        <div className="pearl-header-context">
          <h2 title={chat?.title || "Room"}>{chat?.title || "Room"}</h2>
        </div>
        {chat && !chat.lifecycle && (
          <button
            className="pearl-project-button pearl-project-icon"
            aria-label={
              chat.project
                ? `Change project: ${chat.project.path.split("/").at(-1)}`
                : "Choose project"
            }
            title={
              chat.project
                ? chat.project.path.split("/").at(-1)
                : "Choose project"
            }
            onClick={() =>
              void action(async () => {
                const updated = await api.choosePearlProject(chat.id);
                if (updated) setChat(updated);
              })
            }
          >
            <Folder size={18} aria-hidden="true" />
          </button>
        )}
      </header>
      <div className="pearl-workspace">
        <nav className="pearl-rail" aria-label="Workspace panels">
          <button
            aria-label="Chats"
            aria-expanded={panel === "chats"}
            aria-controls={panel === "chats" ? "pearl-chats-panel" : undefined}
            className={panel === "chats" ? "active" : ""}
            title="Chats"
            onClick={() => setPanel(panel === "chats" ? null : "chats")}
          >
            <MessageSquareText size={19} aria-hidden="true" />
          </button>
          <button
            aria-label="Archived"
            aria-expanded={panel === "archived"}
            aria-controls={
              panel === "archived" ? "pearl-archived-panel" : undefined
            }
            className={panel === "archived" ? "active" : ""}
            title="Archived"
            onClick={() => setPanel(panel === "archived" ? null : "archived")}
          >
            <Archive size={19} aria-hidden="true" />
          </button>
          <button
            aria-label="Trash"
            aria-expanded={panel === "trash"}
            aria-controls={panel === "trash" ? "pearl-trash-panel" : undefined}
            className={panel === "trash" ? "active" : ""}
            title="Trash"
            onClick={() => setPanel(panel === "trash" ? null : "trash")}
          >
            <Trash2 size={19} aria-hidden="true" />
          </button>
          <button
            aria-label="Settings"
            aria-expanded={panel === "settings"}
            aria-controls={
              panel === "settings" ? "pearl-settings-panel" : undefined
            }
            className={
              panel === "settings"
                ? "active pearl-rail-settings"
                : "pearl-rail-settings"
            }
            title="Settings"
            onClick={() => setPanel(panel === "settings" ? null : "settings")}
          >
            <Settings2 size={19} aria-hidden="true" />
          </button>
        </nav>
        {panel === "chats" && (
          <aside
            className="pearl-sidebar"
            id="pearl-chats-panel"
            aria-label="Chats panel"
          >
            <button className="pearl-new" onClick={() => void create()}>
              <Plus size={17} /> New chat
            </button>
            <div className="pearl-sidebar-heading">Chats</div>
            {chatList(chats, "chats")}
          </aside>
        )}
        {panel === "archived" && (
          <aside
            className="pearl-sidebar"
            id="pearl-archived-panel"
            aria-label="Archived panel"
          >
            <div className="pearl-sidebar-heading">Archived</div>
            {chatList(archivedChats, "archived")}
          </aside>
        )}
        {panel === "trash" && (
          <aside
            className="pearl-sidebar"
            id="pearl-trash-panel"
            aria-label="Trash panel"
          >
            <div className="pearl-sidebar-heading">Trash</div>
            {chatList(trashedChats, "trash")}
          </aside>
        )}
        {panel === "settings" && (
          <aside
            className="pearl-sidebar pearl-settings-panel"
            id="pearl-settings-panel"
            aria-label="Settings panel"
          >
            <h2>Settings</h2>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void action(async () => {
                  await api.configureSession({
                    key,
                    model,
                    outputTokens: 16384,
                  });
                  setConfigured(true);
                  setKey("");
                  setPanel("chats");
                });
              }}
            >
              <h3>Nebius connection</h3>
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
              <button>Connect</button>
            </form>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void action(async () => {
                  const status = await api.configureWebSearch(webKey);
                  setWebConfigured(status.configured);
                  setWebKey("");
                });
              }}
            >
              <h3>Web search</h3>
              <p>
                {webConfigured
                  ? "Connected for this app session."
                  : "Connect Tavily to let Pearl search public web sources."}
              </p>
              <p>
                Pearl may send short search queries and selected public result
                URLs to Tavily. Search results are saved in the chat. The key is
                kept in memory until the app closes.
              </p>
              <label>
                Tavily API key
                <input
                  type="password"
                  value={webKey}
                  onChange={(event) => setWebKey(event.target.value)}
                  required
                />
              </label>
              <button type="submit">Connect web search</button>
              {webConfigured && (
                <button
                  type="button"
                  onClick={() =>
                    void action(async () => {
                      const status = await api.disconnectWebSearch();
                      setWebConfigured(status.configured);
                    })
                  }
                >
                  Disconnect web search
                </button>
              )}
            </form>
          </aside>
        )}
        <main className="pearl-main">
          <div
            className="pearl-scroll"
            role="log"
            aria-label="Pearl conversation"
          >
            {!chat?.messages.length && (
              <div className="pearl-welcome">
                <img
                  src={pearlPortrait}
                  alt=""
                  className="pearl-welcome-mark"
                />
                <h1>What can I help you with?</h1>
                <p>
                  Ask a question, discuss an idea, or choose a project and build
                  with Pearl.
                </p>
                {!configured && (
                  <button
                    className="pearl-project-button"
                    onClick={() => setPanel("settings")}
                  >
                    Connect Nebius
                  </button>
                )}
              </div>
            )}
            <div className="pearl-messages">
              {chat?.lifecycle && (
                <section
                  className="pearl-card pearl-read-only"
                  aria-label="Chat state"
                >
                  <div>
                    <strong>
                      {chat.lifecycle === "archived"
                        ? "Archived chat"
                        : "Chat in Trash"}
                    </strong>
                    <p>Restore this chat to continue the conversation.</p>
                    <button
                      onClick={() => void changeLifecycle(chat.id, "restore")}
                    >
                      Restore chat
                    </button>
                  </div>
                </section>
              )}
              {roomTimeline(chat?.messages || []).map((entry) => {
                if (entry.kind === "activity")
                  return (
                    <PearlActivity key={entry.group.id} group={entry.group} />
                  );
                const item = entry.message;
                if (entry.progress)
                  return (
                    <PearlMessageFrame
                      key={item.id}
                      role="assistant"
                      at={item.at}
                      progress
                    >
                      <RichText text={item.text} readableProse />
                    </PearlMessageFrame>
                  );
                return (
                  <PearlMessageFrame
                    key={item.id}
                    role={item.role}
                    at={item.at}
                  >
                    <RichText
                      text={item.text}
                      readableProse={item.role === "assistant"}
                    />
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
                  </PearlMessageFrame>
                );
              })}
              {chat?.status === "running" &&
                !chat.lifecycle &&
                chat.streamingText && (
                  <PearlMessageFrame role="assistant" draft>
                    <RichText text={chat.streamingText} />
                  </PearlMessageFrame>
                )}
              {chat?.status === "running" && !chat.lifecycle && (
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
              {chat?.project && !chat.project.approved && !chat.lifecycle && (
                <section className="pearl-card" aria-label="Project approval">
                  <ShieldCheck size={20} />
                  <div>
                    <strong>Approve this project</strong>
                    <p>
                      Pearl may read and edit UTF-8 files inside{" "}
                      <code>{chat.project.path}</code>. Commands ask for
                      separate approval. Changes are checked against the file
                      revision and backed up.
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
              {chat?.terminals?.map((terminal) => (
                <details
                  className="pearl-card pearl-terminal"
                  key={terminal.id}
                  open={terminal.status === "running" ? true : undefined}
                >
                  <summary>
                    Terminal: {terminal.command} ({terminal.status})
                  </summary>
                  {terminal.status === "running" && !chat.lifecycle && (
                    <div className="pearl-terminal-controls">
                      <span>Click the terminal to type.</span>
                      <button
                        onClick={() =>
                          void action(() =>
                            mutateChat(() =>
                              api.stopPearlTerminal(chat.id, terminal.id),
                            ),
                          )
                        }
                      >
                        Stop terminal
                      </button>
                    </div>
                  )}
                  <Suspense fallback={<p>Opening terminal...</p>}>
                    <PearlTerminalView
                      api={api}
                      chatId={chat.id}
                      terminal={terminal}
                    />
                  </Suspense>
                  {terminal.truncated && <p>Earlier output was trimmed.</p>}
                </details>
              ))}
              {chat?.pendingTool && !chat.lifecycle && (
                <section className="pearl-card" aria-label="Command approval">
                  <ShieldCheck size={20} />
                  <div>
                    <strong>Approve command?</strong>
                    <p>
                      {chat.pendingTool.name === "preview_app"
                        ? "Start the project server and an isolated browser for this turn, up to ten minutes. Pearl can continue interacting with it; form actions can change project data. Stop ends the preview."
                        : chat.pendingTool.name === "start_terminal"
                          ? "Start this command in an interactive terminal until you stop it or close the app. Only you can type into it; your input can run further commands inside the project sandbox."
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
              {pendingQuestion && !chat?.lifecycle && (
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
              {(chat?.status === "failed" || chat?.status === "paused") &&
                !chat.lifecycle && (
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
          <form
            className="pearl-composer"
            onSubmit={(event) => void send(event)}
          >
            <textarea
              ref={composerInput}
              aria-label="Message Pearl"
              value={draft}
              disabled={Boolean(chat?.lifecycle)}
              onKeyDown={composerKey}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Message Pearl"
              rows={2}
            />
            <button
              aria-label="Send message"
              disabled={
                !draft.trim() ||
                Boolean(chat?.lifecycle) ||
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
      </div>
    </div>
  );
}
