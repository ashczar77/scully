import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Archive,
  Files,
  Folder,
  GitBranch,
  MessageSquareText,
  MoreHorizontal,
  Paperclip,
  Plus,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type { DesktopAPI } from "../shared/contracts";
import type { PearlChat, PearlChatSummary } from "../shared/pearl-chat";
import { RichText } from "./RichText";
import { PearlActivity, roomTimeline } from "./PearlActivity";
import { PearlMessageFrame } from "./PearlMessageFrame";
import { PearlSettings } from "./PearlSettings";
import { PearlSandboxPanel } from "./PearlSandboxPanel";
import { PearlWorkspacePanel, type Inspector } from "./PearlWorkspacePanel";
import { PearlSandboxInspector } from "./PearlSandboxInspector";
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
  const [chat, setChat] = useState<PearlChat | null>(null);
  const [draft, setDraft] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [panel, setPanel] = useState<"chats" | "archived" | "settings" | null>(
    "chats",
  );
  const [menuId, setMenuId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [configured, setConfigured] = useState(false);
  const [inspector, setInspector] = useState<Inspector | null>(null);
  const [lastInspector, setLastInspector] = useState<Inspector | null>(null);
  const [lastSidebar, setLastSidebar] = useState<"chats" | "archived" | null>(
    "chats",
  );
  const [inspectorWidth, setInspectorWidth] = useState(420);
  const [sidebarWidth, setSidebarWidth] = useState(268);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState("");
  const activeId = useRef<string | null>(null);
  const openMenuRow = useRef<HTMLDivElement | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const composerInput = useRef<HTMLTextAreaElement>(null);
  const renameInput = useRef<HTMLTextAreaElement>(null);
  const shownSidebar =
    panel === "chats" || panel === "archived" ? panel : lastSidebar;
  const sidebarClosing = panel !== "chats" && panel !== "archived";
  const shownInspector = inspector || lastInspector;
  useEffect(() => {
    if (panel === "chats" || panel === "archived") {
      setLastSidebar(panel);
      return;
    }
    const timer = setTimeout(() => setLastSidebar(null), 220);
    return () => clearTimeout(timer);
  }, [panel]);
  useEffect(() => {
    if (inspector) {
      setLastInspector(inspector);
      return;
    }
    const timer = setTimeout(() => setLastInspector(null), 220);
    return () => clearTimeout(timer);
  }, [inspector]);
  async function refreshChats() {
    const [active, archived] = await Promise.all([
      api.listPearlChats(),
      api.listPearlChats("archived"),
    ]);
    setChats(active);
    setArchivedChats(archived);
  }
  useEffect(() => {
    let live = true;
    void Promise.all([api.session(), refreshChats()])
      .then(([session]) => {
        if (!live) return;
        setConfigured(session.configured);
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
    if (!chat || chat.status !== "running") return;
    const id = chat.id;
    let live = true;
    let reading = false;
    const timer = setInterval(() => {
      if (reading) return;
      reading = true;
      void api
        .getPearlChat(id)
        .then((persisted) => {
          if (!live || activeId.current !== id) return;
          setChat((current) => {
            if (!current || current.id !== id) return current;
            if (
              persisted.status !== current.status ||
              persisted.updatedAt > current.updatedAt
            )
              return persisted;
            return current;
          });
        })
        .catch(() => {
          // The next read can recover a missed update without changing the turn.
        })
        .finally(() => {
          reading = false;
        });
    }, 2000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [api, chat?.id, chat?.status]);
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [chat?.messages.length, chat?.status, chat?.streamingText?.length]);
  useEffect(() => {
    if (!menuId) return;
    function dismissOnOutsidePointer(event: PointerEvent) {
      if (!openMenuRow.current?.contains(event.target as Node)) {
        setMenuId(null);
        setConfirmDeleteId(null);
      }
    }
    function dismissOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      setMenuId(null);
      setConfirmDeleteId(null);
    }
    document.addEventListener("pointerdown", dismissOnOutsidePointer);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOnOutsidePointer);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [menuId]);
  useEffect(() => {
    setMenuId(null);
    setConfirmDeleteId(null);
  }, [panel]);
  useLayoutEffect(() => {
    const input = composerInput.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 210)}px`;
  }, [draft]);
  useLayoutEffect(() => {
    const input = renameInput.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${input.scrollHeight + 2}px`;
  }, [renameId, renameValue, sidebarWidth]);
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
    setMenuId(null);
    setConfirmDeleteId(null);
    const created = await action(() => api.createPearlChat());
    if (!created) return;
    activeId.current = created.id;
    setChat(created);
    setPanel("chats");
    await action(refreshChats);
    setDraft("");
  }
  async function chooseProject() {
    await action(async () => {
      const updated = await api.choosePearlProject(chat?.id);
      if (!updated) return;
      activeId.current = updated.id;
      setChat(updated);
      setPanel("chats");
      await refreshChats();
    });
  }
  async function open(id: string) {
    setMenuId(null);
    setConfirmDeleteId(null);
    const selected = await action(() => api.getPearlChat(id));
    if (!selected) return;
    activeId.current = id;
    setChat(selected);
    setDraft("");
    setInspector(null);
  }
  function openInspector(next: Inspector | null) {
    if (next && window.innerWidth < 1100 && panel !== "settings")
      setPanel(null);
    setInspector(next);
  }
  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = inspectorWidth;
    const move = (next: PointerEvent) =>
      setInspectorWidth(
        Math.max(
          300,
          Math.min(
            850,
            window.innerWidth -
              (panel === "chats" || panel === "archived" ? sidebarWidth : 0) -
              380,
            startWidth + startX - next.clientX,
          ),
        ),
      );
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  }
  function startSidebarResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const move = (next: PointerEvent) =>
      setSidebarWidth(
        Math.max(
          210,
          Math.min(
            460,
            window.innerWidth - (inspector ? inspectorWidth : 0) - 380,
            startWidth + next.clientX - startX,
          ),
        ),
      );
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  }
  async function rename(id: string) {
    const title = renameValue.replace(/\s+/g, " ").trim();
    if (!title) {
      setRenameError("Enter a chat title.");
      return;
    }
    setRenameError("");
    const updated = await action(async () => {
      const updated = await api.renamePearlChat(id, title);
      await refreshChats();
      return updated;
    });
    if (!updated) {
      setRenameError("Could not rename this chat. Try again.");
      return;
    }
    if (activeId.current === id) setChat(updated);
    setRenameId(null);
  }
  async function changeLifecycle(
    id: string,
    operation: "archive" | "restore" | "delete",
  ) {
    const changed = await action(async () => {
      switch (operation) {
        case "archive":
          return api.archivePearlChat(id);
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
  function chatList(items: PearlChatSummary[], scope: "chats" | "archived") {
    return (
      <nav
        aria-label={scope === "chats" ? "Chats" : "Archived chats"}
        className="pearl-chat-list"
      >
        {items.length === 0 && (
          <p className="pearl-list-empty">
            {scope === "archived" ? "No archived chats" : "No chats yet"}
          </p>
        )}
        {items.map((item) => (
          <div
            key={item.id}
            className="pearl-chat-row"
            ref={menuId === item.id ? openMenuRow : undefined}
          >
            {renameId === item.id ? (
              <form
                className="pearl-chat-rename"
                onSubmit={(event) => {
                  event.preventDefault();
                  void rename(item.id);
                }}
              >
                <textarea
                  autoFocus
                  ref={renameInput}
                  aria-label="Chat title"
                  rows={2}
                  maxLength={100}
                  value={renameValue}
                  onChange={(event) => {
                    setRenameValue(event.target.value);
                    setRenameError("");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setRenameId(null);
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void rename(item.id);
                    }
                  }}
                />
                {renameError && <span role="alert">{renameError}</span>}
                <div className="pearl-chat-rename-actions">
                  <button type="submit" disabled={busy}>
                    Save
                  </button>
                  <button type="button" onClick={() => setRenameId(null)}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
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
            )}
            {renameId !== item.id && (
              <button
                className="pearl-chat-options"
                aria-label={`Options for ${item.title}`}
                aria-expanded={menuId === item.id}
                onClick={() => {
                  setMenuId((current) =>
                    current === item.id ? null : item.id,
                  );
                  setConfirmDeleteId(null);
                }}
              >
                <MoreHorizontal size={16} aria-hidden="true" />
              </button>
            )}
            {menuId === item.id && (
              <div className="pearl-chat-menu">
                <button
                  onClick={() => {
                    setRenameId(item.id);
                    setRenameValue(item.title);
                    setRenameError("");
                    setMenuId(null);
                  }}
                >
                  Rename
                </button>
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
                {scope === "archived" &&
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
        <div
          className="pearl-brand"
          style={{
            width:
              panel === "chats" || panel === "archived"
                ? sidebarWidth + 50
                : undefined,
          }}
        >
          <img src={scullyLogo} alt="Scully alien head" />
          <strong>Scully</strong>
        </div>
        <div className="pearl-header-context">
          <h2 title={panel === "settings" ? "Settings" : chat?.title || "Room"}>
            {panel === "settings" ? "Settings" : chat?.title || "Room"}
          </h2>
        </div>
        {panel !== "settings" && !chat?.lifecycle && (
          <button
            className="pearl-project-button pearl-project-icon"
            aria-label={
              chat?.project
                ? `Change project: ${chat.project.path.split("/").at(-1)}`
                : "Choose project"
            }
            title={
              chat?.project
                ? chat.project.path.split("/").at(-1)
                : "Choose project"
            }
            onClick={() => void chooseProject()}
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
            aria-label="Files"
            aria-expanded={inspector?.kind === "files"}
            title="Files"
            className={inspector?.kind === "files" ? "active" : ""}
            onClick={() =>
              openInspector(
                inspector?.kind === "files" ? null : { kind: "files" },
              )
            }
          >
            <Files size={19} aria-hidden="true" />
          </button>
          <button
            aria-label="Git changes"
            aria-expanded={inspector?.kind === "git"}
            title="Git changes"
            className={inspector?.kind === "git" ? "active" : ""}
            onClick={() =>
              openInspector(inspector?.kind === "git" ? null : { kind: "git" })
            }
          >
            <GitBranch size={19} aria-hidden="true" />
          </button>
          <button
            aria-label="Settings"
            aria-expanded={panel === "settings"}
            aria-controls={
              panel === "settings" ? "pearl-settings-page" : undefined
            }
            className={
              panel === "settings"
                ? "active pearl-rail-settings"
                : "pearl-rail-settings"
            }
            title="Settings"
            onClick={() =>
              setPanel(panel === "settings" ? "chats" : "settings")
            }
          >
            <Settings2 size={19} aria-hidden="true" />
          </button>
        </nav>
        {shownSidebar === "chats" && (
          <aside
            className={`pearl-sidebar${sidebarClosing ? " is-closing" : ""}`}
            style={{ width: sidebarWidth }}
            id="pearl-chats-panel"
            aria-label="Chats panel"
            aria-hidden={sidebarClosing}
            inert={sidebarClosing}
          >
            <button className="pearl-new" onClick={() => void create()}>
              <Plus size={17} /> New chat
            </button>
            <div className="pearl-sidebar-heading">Chats</div>
            {chatList(chats, "chats")}
            <div
              className="pearl-sidebar-resize"
              role="separator"
              aria-label="Resize chat list"
              aria-orientation="vertical"
              onPointerDown={startSidebarResize}
            />
          </aside>
        )}
        {shownSidebar === "archived" && (
          <aside
            className={`pearl-sidebar${sidebarClosing ? " is-closing" : ""}`}
            style={{ width: sidebarWidth }}
            id="pearl-archived-panel"
            aria-label="Archived panel"
            aria-hidden={sidebarClosing}
            inert={sidebarClosing}
          >
            <div className="pearl-sidebar-heading">Archived</div>
            {chatList(archivedChats, "archived")}
            <div
              className="pearl-sidebar-resize"
              role="separator"
              aria-label="Resize chat list"
              aria-orientation="vertical"
              onPointerDown={startSidebarResize}
            />
          </aside>
        )}
        {panel === "settings" ? (
          <PearlSettings
            api={api}
            onBack={() => setPanel("chats")}
            onSessionChange={(info) => setConfigured(info.configured)}
          />
        ) : (
          <>
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
                      Ask a question, discuss an idea, or choose a project and
                      build with Pearl.
                    </p>
                    <button
                      className="pearl-welcome-project"
                      onClick={() => void chooseProject()}
                    >
                      <Folder size={16} aria-hidden="true" />
                      {chat?.project
                        ? chat.project.path.split("/").at(-1)
                        : "Choose a project folder"}
                    </button>
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
                        <strong>Archived chat</strong>
                        <p>Restore this chat to continue the conversation.</p>
                        <button
                          onClick={() =>
                            void changeLifecycle(chat.id, "restore")
                          }
                        >
                          Restore chat
                        </button>
                      </div>
                    </section>
                  )}
                  {roomTimeline(chat?.messages || []).map((entry) => {
                    if (entry.kind === "activity")
                      return (
                        <PearlActivity
                          key={entry.group.id}
                          group={entry.group}
                        />
                      );
                    const item = entry.message;
                    if (entry.progress)
                      return (
                        <PearlMessageFrame
                          key={item.id}
                          role="assistant"
                          at={item.at}
                          progress
                          fallbackModel={item.fallbackModel}
                        >
                          <RichText text={item.text} readableProse />
                        </PearlMessageFrame>
                      );
                    return (
                      <PearlMessageFrame
                        key={item.id}
                        role={item.role}
                        at={item.at}
                        fallbackModel={item.fallbackModel}
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
                                  {item.evidence.filesWritten === 1
                                    ? ""
                                    : "s"}{" "}
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
                                  {item.evidence
                                    .successfulBrowserAfterLatestUiWrite
                                    ? ` ${item.evidence.browserChecks || 0} browser check${item.evidence.browserChecks === 1 ? "" : "s"} completed after the UI edit; review the result.`
                                    : " No clean browser check after the latest UI edit; the UI remains unverified."}
                                </span>
                              )}
                            </div>
                          )}
                        {item.role === "assistant" &&
                          item.evidence &&
                          chat?.taskChanges &&
                          (() => {
                            const index = chat.messages.findIndex(
                              (message) => message.id === item.id,
                            );
                            const user = [...chat.messages.slice(0, index)]
                              .reverse()
                              .find((message) => message.role === "user");
                            const changes = chat.taskChanges.find(
                              (entry) => entry.turnId === user?.id,
                            );
                            if (
                              !changes ||
                              (!changes.files.length && !changes.reason)
                            )
                              return null;
                            return (
                              <div className="pearl-task-summary">
                                <strong>
                                  {changes.files.length} project change
                                  {changes.files.length === 1 ? "" : "s"}
                                </strong>
                                {changes.reason && (
                                  <span>{changes.reason}</span>
                                )}
                                <button
                                  onClick={() =>
                                    openInspector({
                                      kind: "review",
                                      turnId: changes.turnId,
                                    })
                                  }
                                >
                                  Review changes
                                </button>
                                {changes.undoAvailable &&
                                  changes.files.length > 0 && (
                                    <button
                                      onClick={() =>
                                        openInspector({
                                          kind: "review",
                                          turnId: changes.turnId,
                                        })
                                      }
                                    >
                                      Undo…
                                    </button>
                                  )}
                              </div>
                            );
                          })()}
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
                      {chat.retryHint
                        ? "Pearl is retrying from your saved chat. Waiting for Nebius."
                        : "Pearl is working…"}{" "}
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
                  {chat?.project &&
                    !chat.project.approved &&
                    !chat.lifecycle && (
                      <section
                        className="pearl-card"
                        aria-label="Project approval"
                      >
                        <ShieldCheck size={20} />
                        <div>
                          <strong>Approve this project</strong>
                          <p>
                            Pearl may read and edit UTF-8 files inside{" "}
                            <code>{chat.project.path}</code>. Commands ask for
                            separate approval. Changes are checked against the
                            file revision and backed up.
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
                            {chat.work.requirements.map(
                              (requirement, index) => (
                                <li key={index}>{requirement.quote}</li>
                              ),
                            )}
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
                    <section
                      className="pearl-card"
                      aria-label={
                        chat.pendingTool.name === "edit_files"
                          ? "File transaction review"
                          : chat.pendingTool.name === "sandbox_run_check"
                            ? "Sandbox check approval"
                            : chat.pendingTool.name === "mcp_call_tool"
                              ? "Remote MCP tool approval"
                              : "Command approval"
                      }
                    >
                      <ShieldCheck size={20} />
                      <div>
                        <strong>
                          {chat.pendingTool.name === "edit_files"
                            ? `Review ${chat.pendingTool.review?.files || 0} file changes`
                            : chat.pendingTool.name === "sandbox_run_check"
                              ? "Approve remote Sandbox check?"
                              : chat.pendingTool.name === "mcp_call_tool"
                                ? "Approve remote tool call?"
                                : "Approve command?"}
                        </strong>
                        <p>
                          {chat.pendingTool.name === "edit_files"
                            ? "Pearl proposes one file transaction. Review the complete diff. The backend checks every file again before applying it; a changed file rejects the batch."
                            : chat.pendingTool.name === "sandbox_run_check"
                              ? `Run this exact command once in the selected Nebius Sandbox checkpoint (${chat.pendingTool.remoteRevision || "unknown"}). File writes from this check are discarded. Its output enters Pearl's chat context.`
                              : chat.pendingTool.name === "mcp_call_tool"
                                ? `Send these arguments to ${chat.pendingTool.remoteEndpoint || "the remote MCP server"} and run this tool once. The server may change external data. Its result will enter Pearl's chat context and go to the selected Nebius model. Approve only if you trust the endpoint and arguments.`
                                : chat.pendingTool.name === "preview_app"
                                  ? "Start the project server and an isolated browser for this turn, up to ten minutes. Pearl can continue interacting with it; form actions can change project data. Stop ends the preview."
                                  : chat.pendingTool.name === "start_terminal"
                                    ? "Start this command in an interactive terminal until you stop it or close the app. Only you can type into it; your input can run further commands inside the project sandbox."
                                    : "This runs once inside the selected project."}
                        </p>
                        <pre>
                          {chat.pendingTool.name === "edit_files"
                            ? chat.pendingTool.review?.diff ||
                              "Diff unavailable"
                            : chat.pendingTool.name === "sandbox_run_check"
                              ? chat.pendingTool.arguments
                              : chat.pendingTool.name === "mcp_call_tool"
                                ? JSON.stringify(
                                    JSON.parse(chat.pendingTool.arguments),
                                    null,
                                    2,
                                  )
                                : command
                                  ? JSON.stringify(
                                      {
                                        executable:
                                          chat.pendingTool.executable?.path,
                                        argv: [
                                          command.command,
                                          ...(command.args || []),
                                        ],
                                        ...(chat.pendingTool.name ===
                                        "preview_app"
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
                          {chat.pendingTool.name === "edit_files"
                            ? "Apply changes"
                            : chat.pendingTool.name === "mcp_call_tool"
                              ? "Call once"
                              : "Run once"}
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
                          {chat.pendingTool.name === "edit_files"
                            ? "Reject"
                            : "Deny"}
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
                            Revisiting this choice:{" "}
                            {pendingQuestion.reopenReason}
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
                          {chat.status === "paused" && chat.pausedDraft && (
                            <details className="pearl-paused-draft">
                              <summary>View Pearl's unverified draft</summary>
                              <RichText text={chat.pausedDraft} readableProse />
                            </details>
                          )}
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
              {chat && (
                <PearlSandboxPanel
                  key={`${chat.id}:${chat.sandbox?.baseImage || ""}`}
                  api={api}
                  chat={chat}
                  onChange={setChat}
                  onSettings={() => setPanel("settings")}
                  onInspect={() => openInspector({ kind: "sandbox" })}
                />
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
                <div className="pearl-composer-toolbar">
                  <button
                    type="button"
                    aria-label="Add files (coming soon)"
                    title="Add files (coming soon)"
                    disabled
                  >
                    <Paperclip size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="pearl-composer-model"
                    aria-label="Choose model"
                    title="Choose model"
                    onClick={() => setPanel("settings")}
                  >
                    <Sparkles size={15} aria-hidden="true" /> Model
                  </button>
                  <button
                    type="button"
                    aria-label="Permissions (coming soon)"
                    title="Permissions (coming soon)"
                    disabled
                  >
                    <ShieldCheck size={16} aria-hidden="true" />
                  </button>
                  <button
                    className="pearl-composer-send"
                    aria-label="Send message"
                    disabled={
                      !draft.trim() ||
                      Boolean(chat?.lifecycle) ||
                      chat?.status === "running" ||
                      chat?.status === "awaiting_approval" ||
                      chat?.sandbox?.status === "uploading" ||
                      chat?.sandbox?.status === "uncertain" ||
                      busy
                    }
                  >
                    <Send size={15} aria-hidden="true" />
                  </button>
                </div>
              </form>
              <div className="pearl-footer">
                Pearl can make mistakes. Review code changes and command
                requests.
              </div>
            </main>
            {chat &&
              shownInspector &&
              (shownInspector.kind === "sandbox" ? (
                <PearlSandboxInspector
                  api={api}
                  chat={chat}
                  closing={!inspector}
                  width={inspectorWidth}
                  onResizeStart={startResize}
                  onClose={() => setInspector(null)}
                />
              ) : (
                <PearlWorkspacePanel
                  api={api}
                  chat={chat}
                  inspector={shownInspector}
                  closing={!inspector}
                  width={inspectorWidth}
                  onResizeStart={startResize}
                  onClose={() => setInspector(null)}
                  onUndo={(turnId) => {
                    if (
                      !window.confirm(
                        "Undo this task's file changes? Newer edits will stop the action.",
                      )
                    )
                      return;
                    void action(() =>
                      mutateChat(() => api.undoPearlTask(chat.id, turnId)),
                    );
                  }}
                />
              ))}
          </>
        )}
      </div>
    </div>
  );
}
