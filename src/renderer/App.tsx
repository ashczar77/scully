import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  Code2,
  FlaskConical,
  GitBranch,
  LayoutGrid,
  MessageSquare,
  Plus,
  Settings2,
  ShieldCheck,
  Sparkles,
  Target,
  X,
  Monitor,
  BookOpen,
  Pencil,
  Users,
  CircleHelp,
} from "lucide-react";
import type { DesktopAPI, Teammate, Workspace } from "../shared/contracts";
import portraits from "../../assets/team-portraits.png";
import { RunPanel, ConnectionSettings } from "./RunPanel";
import { MetricsPanel } from "./MetricsPanel";
import { StoragePanel } from "./StoragePanel";

type Page = "Room" | "Changes" | "Preview" | "Settings" | "Profile";
const navigation = [
  { name: "Room", icon: MessageSquare },
  { name: "Changes", icon: GitBranch },
  { name: "Preview", icon: Monitor },
  { name: "Settings", icon: Settings2 },
] as const;
function Portrait({
  person,
  className = "",
}: {
  person: Teammate;
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-label={`${person.name} portrait`}
      className={`portrait ${className}`}
      style={{
        backgroundImage: `url(${portraits})`,
        backgroundPosition: `${person.id === "maya" ? 0 : person.id === "ellis" ? 50 : 100}% center`,
      }}
    />
  );
}
function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} onCancel={onClose} aria-labelledby="modal-title">
      <div className="modal-heading">
        <h2 id="modal-title">{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function Profile({
  person,
  full,
  onOpen,
  onEdit,
}: {
  person: Teammate;
  full?: boolean;
  onOpen?: () => void;
  onEdit: () => void;
}) {
  return (
    <section
      className={`profile-card ${full ? "full-profile" : ""}`}
      aria-label={`${person.name} profile`}
    >
      <div className="profile-art">
        <Portrait person={person} />
        <button className="edit-profile" onClick={onEdit}>
          <Pencil size={13} /> Edit profile
        </button>
      </div>
      <div className="profile-body">
        <div className="profile-title">
          <div>
            <h2>{person.name}</h2>
            <span>{person.role}</span>
          </div>
          <span className="idle-badge">Ready</span>
        </div>
        <p>{person.bio}</p>
        <div className="profile-stats">
          <span className="eyebrow">Statistics not aggregated yet</span>
          <div>
            <span>
              <strong>-</strong>Reviews
            </span>
            <span>
              <strong>-</strong>Findings
            </span>
            <span>
              <strong>-</strong>Tasks run
            </span>
          </div>
        </div>
        <div className="activity">
          <span className="eyebrow">CURRENT ACTIVITY</span>
          <p>
            <span className="dot muted-dot" /> See the task room for run
            activity
          </p>
        </div>
        {full && (
          <>
            <h3>Working instructions</h3>
            <p className="instructions">{person.instructions}</p>
            <h3>Tools & permissions</h3>
            <p>
              Model connection is configured in Settings. Runs need explicit
              sharing approval. Local checks require fresh individual
              permission. Publishing actions are not available yet.
            </p>
          </>
        )}
        <div className="capabilities">
          <span>
            <BookOpen size={14} /> Code review
          </span>
          <span>
            <ShieldCheck size={14} /> Evidence first
          </span>
        </div>
        {!full && (
          <button className="secondary wide" onClick={onOpen}>
            Open full profile <ArrowRight size={15} />
          </button>
        )}
      </div>
    </section>
  );
}

export function App({ api = window.scully }: { api?: DesktopAPI }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState("");
  const [page, setPage] = useState<Page>("Room");
  const [personId, setPersonId] = useState("ellis");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [newTask, setNewTask] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!api) {
      setError(
        "Open Scully in the desktop application to access your local workspace.",
      );
      return;
    }
    let active = true;
    api
      .load()
      .then((w) => {
        if (active) setWorkspace(w);
      })
      .catch(() => {
        if (active)
          setError(
            "Your workspace could not be loaded. Restart Scully to try again.",
          );
      });
    return () => {
      active = false;
    };
  }, [api]);
  if (!workspace)
    return (
      <div className="loading">
        <Sparkles size={36} />
        <h1>Scully</h1>
        <p role={error ? "alert" : "status"}>
          {error || "Opening your workspace..."}
        </p>
      </div>
    );
  const person = workspace.teammates.find((t) => t.id === personId)!;
  const task = workspace.tasks.find((t) => t.id === taskId);
  const team = workspace.teammates;
  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const created = await api!.createTask({
        title: String(form.get("title")),
        description: String(form.get("description")),
        mode: form.get("mode") === "work" ? "work" : "plan",
      });
      setWorkspace((w) => w && { ...w, tasks: [created, ...w.tasks] });
      setTaskId(created.id);
      setNewTask(false);
      setPage("Room");
    } catch {
      setError(
        "Could not save this task. Your input is still here. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const updated = await api!.updateTeammate({
        id: person.id,
        name: String(form.get("name")),
        role: String(form.get("role")),
        bio: String(form.get("bio")),
        instructions: String(form.get("instructions")),
      });
      setWorkspace(
        (w) =>
          w && {
            ...w,
            teammates: w.teammates.map((t) =>
              t.id === updated.id ? updated : t,
            ),
          },
      );
      setEditing(false);
    } catch {
      setError("Could not save the profile. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="app-shell">
      <header className="topbar">
        <button
          className="brand"
          onClick={() => setPage("Room")}
          aria-label="Scully home"
        >
          <Sparkles size={25} />
          <span>Scully</span>
        </button>
        <nav aria-label="Main navigation">
          {navigation.map(({ name, icon: Icon }) => (
            <button
              key={name}
              className={page === name ? "active" : ""}
              aria-current={page === name ? "page" : undefined}
              onClick={() => setPage(name)}
            >
              <Icon size={17} />
              {name}
            </button>
          ))}
        </nav>
        <span className="build-badge">
          <span className="dot" /> Desktop preview
        </span>
        <div className="user-badge" title="Local workspace">
          You
        </div>
      </header>
      <div className="workspace-grid">
        <aside className="project-sidebar">
          <div className="project-heading">
            <span className="project-mark">
              <Sparkles size={22} />
            </span>
            <div>
              <strong>Your workspace</strong>
              <small>Engineering, together</small>
            </div>
          </div>
          <button
            className="new-task"
            onClick={() => {
              setError("");
              setNewTask(true);
            }}
          >
            <Plus size={17} /> New task <span>↗</span>
          </button>
          <div className="sidebar-label">WORKSPACE</div>
          <button
            className={`sidebar-item ${taskId === null ? "selected" : ""}`}
            onClick={() => {
              setTaskId(null);
              setPage("Room");
            }}
          >
            <LayoutGrid size={17} /> Explore the room{" "}
            <span className="tiny-badge">Demo</span>
          </button>
          <div className="sidebar-label task-label">
            YOUR TASKS <span>{workspace.tasks.length}</span>
          </div>
          <div className="task-list">
            {workspace.tasks.length === 0 ? (
              <p className="quiet-note">
                A fresh start.
                <br />
                Your next idea belongs here.
              </p>
            ) : (
              workspace.tasks.map((t) => (
                <button
                  key={t.id}
                  className={`sidebar-item task-item ${taskId === t.id ? "selected" : ""}`}
                  onClick={() => {
                    setTaskId(t.id);
                    setPage("Room");
                  }}
                >
                  <MessageSquare size={15} />
                  <span>{t.title}</span>
                </button>
              ))
            )}
          </div>
          <div className="current-task">
            <span className="eyebrow">
              {task ? "SAVED TASK" : "EXAMPLE TASK"}
            </span>
            <h3>{task?.title || "Build password reset"}</h3>
            <p>
              {task?.description ||
                "Add a secure reset flow to the existing app."}
            </p>
            <ol className="steps">
              {["Plan agreed", "Building", "Reviewing", "Ready for you"].map(
                (s, i) => (
                  <li
                    key={s}
                    className={
                      !task && i < 2
                        ? "done"
                        : !task && i === 2
                          ? "current"
                          : ""
                    }
                  >
                    <span>{!task && i < 2 ? <Check size={12} /> : i + 1}</span>
                    {s}
                  </li>
                ),
              )}
            </ol>
            {task && <small>Run status is shown in the task room.</small>}
          </div>
          <div className="permission-card">
            <ShieldCheck size={18} />
            <div>
              <strong>You stay in control</strong>
              <small>
                Local commands require fresh approval.
                <br />
                Publishing requires approval.
              </small>
            </div>
          </div>
          <div className="sidebar-footer">
            <span className="dot muted-dot" /> Local workspace <span>v0.2</span>
          </div>
        </aside>
        <main className="main-panel">
          {page === "Room" && (
            <>
              <div className="room-heading">
                <div>
                  <span className="eyebrow">LET’S BUILD SOMETHING GOOD</span>
                  <h1>
                    Team room<span className="heading-dot">.</span>
                  </h1>
                  <p>{task?.title || "Good work happens in good company."}</p>
                </div>
                <span className="team-count">
                  <Users size={16} /> 3 teammates
                </span>
              </div>
              <div className="preview-banner">
                <FlaskConical size={17} />
                <span>
                  {task
                    ? "Private drafts · applying changes requires your approval."
                    : "Example conversation · a preview of how your team will work."}
                </span>
              </div>
              {task ? (
                <RunPanel key={task.id} api={api!} task={task} team={team} />
              ) : (
                <div className="conversation">
                  <div className="day-divider">
                    <span /> A look inside the room <span />
                  </div>
                  <Message
                    person={team[0]}
                    time="10:14"
                    onSelect={() => setPersonId("maya")}
                  >
                    Reset flow is ready for review. I kept the existing auth
                    patterns.
                  </Message>
                  <Message
                    person={team[1]}
                    time="10:18"
                    onSelect={() => setPersonId("ellis")}
                  >
                    The reset token can be reused. I’m checking that against the
                    new tests.
                  </Message>
                  <Message
                    person={team[0]}
                    time="10:27"
                    onSelect={() => setPersonId("maya")}
                  >
                    Confirmed. I’ve added single-use token handling.
                  </Message>
                  <div className="evidence-card">
                    <span className="evidence-icon">
                      <FlaskConical size={22} />
                    </span>
                    <div>
                      <strong>
                        Single-use token check{" "}
                        <span className="pill">Example</span>
                      </strong>
                      <p>Reusing a consumed token is rejected.</p>
                    </div>
                    <Check size={18} />
                  </div>
                  <Message
                    person={team[2]}
                    time="10:35"
                    onSelect={() => setPersonId("jun")}
                  >
                    Checking expired tokens and repeat submissions next.
                  </Message>
                  <div className="room-callout">
                    <span className="callout-icon">
                      <Target size={20} />
                    </span>
                    <div>
                      <strong>
                        A second pair of eyes. Whenever you need it.
                      </strong>
                      <p>Specialist reviews will be one click away.</p>
                    </div>
                  </div>
                </div>
              )}
              {!task && (
                <div className="composer-area">
                  <div className="audit-actions">
                    {[
                      { text: "Check goal", icon: Target },
                      { text: "Review code", icon: Code2 },
                      { text: "Try to break it", icon: FlaskConical },
                    ].map(({ text, icon: Icon }) => (
                      <button
                        key={text}
                        disabled
                        title="Available when the agent runtime is connected"
                      >
                        <Icon size={16} />
                        {text}
                      </button>
                    ))}
                  </div>
                  <div className="composer">
                    <Plus size={19} />
                    <textarea
                      aria-label="Message the team"
                      disabled
                      placeholder="Message the team or @ a teammate..."
                      rows={1}
                    />
                    <button disabled aria-label="Send message">
                      <ArrowUp size={21} />
                    </button>
                  </div>
                  <div className="composer-caption">
                    <span>
                      Mid-task messaging is planned for the coordination
                      milestone.
                    </span>
                    <span>
                      Private by default <ShieldCheck size={11} />
                    </span>
                  </div>
                </div>
              )}
            </>
          )}
          {page === "Profile" && (
            <>
              <button className="back-button" onClick={() => setPage("Room")}>
                <ArrowLeft size={16} /> Back to room
              </button>
              <div className="page-heading">
                <span className="eyebrow">MEET YOUR TEAMMATE</span>
                <h1>{person.name}</h1>
                <p>A clear role. A shared goal.</p>
              </div>
              <Profile
                person={person}
                full
                onEdit={() => {
                  setError("");
                  setEditing(true);
                }}
              />
            </>
          )}
          {page === "Changes" &&
            (task ? (
              <RunPanel
                key={task.id + "changes"}
                api={api!}
                task={task}
                team={team}
                changes
              />
            ) : (
              <EmptyPage
                icon={<GitBranch size={30} />}
                title="A clear view of every change."
                text="When the team starts building, review its diffs, findings and checks here before anything is applied to your project."
                note="No changes yet. This shell does not modify project files."
              />
            ))}
          {page === "Preview" && (
            <EmptyPage
              icon={<Monitor size={30} />}
              title="See what you’re building."
              text="Your running project will appear here when preview support is connected. For now, explore the room or save your first task."
              note="No application preview is running."
            />
          )}
          {page === "Settings" && (
            <>
              <div className="page-heading">
                <span className="eyebrow">YOUR WORKSPACE, YOUR RULES</span>
                <h1>Settings</h1>
                <p>Safe defaults, visible boundaries.</p>
              </div>
              <section className="settings-card">
                <h2>Execution & permissions</h2>
                <Setting
                  title="Local commands"
                  detail="Approve each command individually"
                />
                <Setting
                  title="Publishing"
                  detail="Explicit approval before commit, push or pull request"
                />
                <Setting
                  title="Agent connection"
                  detail="Configure the session below; each run needs approval"
                />
                <Setting
                  title="Theme"
                  detail="Dark · light theme planned for later"
                />
              </section>
              <ConnectionSettings api={api!} />
              <MetricsPanel api={api!} />
              <StoragePanel api={api!} />
            </>
          )}
        </main>
        <aside className="team-sidebar">
          <div className="section-heading">
            <h2>Your team</h2>
            <span className="tiny-badge">3 members</span>
          </div>
          <div className="team-cards">
            {team.map((t) => (
              <button
                key={t.id}
                className={`team-card ${personId === t.id ? "selected" : ""}`}
                aria-pressed={personId === t.id}
                onClick={() => setPersonId(t.id)}
              >
                <Portrait person={t} />
                <strong>{t.name}</strong>
                <small>
                  {t.role === "Code auditor"
                    ? "Auditor"
                    : t.role === "Test engineer"
                      ? "Tester"
                      : t.role}
                </small>
                <span className="team-status">
                  <span className="dot muted-dot" /> Ready
                </span>
              </button>
            ))}
          </div>
          <Profile
            person={person}
            onOpen={() => setPage("Profile")}
            onEdit={() => {
              setError("");
              setEditing(true);
            }}
          />
          <div className="team-footnote">
            <CircleHelp size={15} />
            <span>
              Different perspectives.
              <br />
              One shared outcome.
            </span>
          </div>
        </aside>
      </div>
      {newTask && (
        <Modal
          title="What shall we build?"
          onClose={() => !busy && setNewTask(false)}
        >
          <form onSubmit={createTask}>
            <p className="muted">
              Save an idea, then choose a project source and approve a bounded
              run.
            </p>
            <label>
              Task title
              <input
                name="title"
                required
                maxLength={120}
                placeholder="e.g. Add a password reset flow"
                autoFocus
              />
            </label>
            <label>
              What should the team know?
              <textarea
                name="description"
                maxLength={4000}
                rows={4}
                placeholder="Describe the outcome and any constraints..."
              />
            </label>
            <fieldset>
              <legend>How would you like to begin?</legend>
              <label className="radio-option">
                <input type="radio" name="mode" value="plan" defaultChecked />{" "}
                Plan first
              </label>
              <label className="radio-option">
                <input type="radio" name="mode" value="work" /> Start working
              </label>
            </fieldset>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <button className="primary wide" disabled={busy}>
              {busy ? "Saving..." : "Save task"}
              <ArrowRight size={16} />
            </button>
          </form>
        </Modal>
      )}
      {editing && (
        <Modal
          title={`Edit ${person.name}’s profile`}
          onClose={() => !busy && setEditing(false)}
        >
          <form onSubmit={saveProfile}>
            <label>
              Name
              <input
                name="name"
                defaultValue={person.name}
                required
                maxLength={40}
                autoFocus
              />
            </label>
            <label>
              Role
              <input
                name="role"
                defaultValue={person.role}
                required
                maxLength={60}
              />
            </label>
            <label>
              About
              <textarea
                name="bio"
                defaultValue={person.bio}
                required
                maxLength={240}
                rows={2}
              />
            </label>
            <label>
              Working instructions
              <textarea
                name="instructions"
                defaultValue={person.instructions}
                required
                maxLength={2000}
                rows={4}
              />
            </label>
            <p className="muted">
              Saved for future tasks. Instructions do not grant tool
              permissions.
            </p>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <button className="primary wide" disabled={busy}>
              {busy ? "Saving..." : "Save profile"}
              <Check size={16} />
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
function Message({
  person,
  time,
  children,
  onSelect,
}: {
  person: Teammate;
  time: string;
  children: ReactNode;
  onSelect: () => void;
}) {
  return (
    <article className="message">
      <button
        className="avatar-button"
        onClick={onSelect}
        aria-label={`View ${person.name}`}
      >
        <Portrait person={person} />
      </button>
      <div>
        <div className="message-heading">
          <strong>{person.name}</strong>
          <span>{person.role}</span>
          <time>{time}</time>
        </div>
        <div className="message-bubble">{children}</div>
      </div>
    </article>
  );
}
function EmptyPage({
  icon,
  title,
  text,
  note,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  note: string;
}) {
  return (
    <div className="empty-page">
      <div className="large-icon">{icon}</div>
      <h1>{title}</h1>
      <p>{text}</p>
      <span className="empty-note">{note}</span>
    </div>
  );
}
function Setting({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="setting">
      <span>{title}</span>
      <span>{detail}</span>
    </div>
  );
}
