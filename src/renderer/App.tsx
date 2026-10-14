import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  GitBranch,
  LayoutGrid,
  MessageSquare,
  Plus,
  Settings2,
  ShieldCheck,
  X,
  Monitor,
  Pencil,
  Users,
  CircleHelp,
  Gauge,
  PlugZap,
  Activity,
  BookText,
  Braces,
  ClipboardCheck,
  Compass,
  Crosshair,
  FileText,
  Fingerprint,
  Lightbulb,
  LockKeyhole,
  MousePointer2,
  Palette,
  RefreshCcw,
  Search,
  Server,
  Sparkles,
  Workflow,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { DesktopAPI, Teammate, Workspace } from "../shared/contracts";
import {
  characterById,
  characterCatalog,
  type CharacterId,
} from "../shared/character-catalog";
import {
  catalogTeammate,
  rosterMembers,
  type FixedRoster,
} from "../shared/fixed-teams";
import { runRole } from "../shared/teams";
import { Portrait } from "./Portrait";
import scullyLogo from "../../assets/branding/scully-friendly-nerd-transparent-v1.png";
import { RunPanel, ConnectionSettings } from "./RunPanel";
import { MetricsPanel } from "./MetricsPanel";
import { StoragePanel } from "./StoragePanel";
import { RunSettings } from "./RunSettings";
import { TeamPreview } from "./TeamPreview";
import type { SessionInfo } from "../shared/runs";

type Page = "Room" | "Changes" | "Preview" | "Settings" | "Profile";
type SettingsSection = "team" | "run" | "app";
const settingsSections = [
  { id: "team", label: "Team", icon: Users },
  { id: "run", label: "Run usage", icon: Gauge },
  { id: "app", label: "App & connection", icon: PlugZap },
] as const;
const rosterGroups = [
  {
    role: "coordinator",
    title: "Coordinator",
    description:
      "Pearl keeps decisions and handoffs organized. She is part of every team.",
  },
  {
    role: "builder",
    title: "Builders",
    description:
      "Each builder can own a complete full-stack change. Choose one or more based on the work.",
  },
  {
    role: "tester",
    title: "Testers",
    description:
      "They exercise real journeys and reproduce failures independently.",
  },
  {
    role: "auditor",
    title: "Auditors",
    description:
      "An independent auditor reviews evidence before technical completion.",
  },
  {
    role: "specialist",
    title: "Specialists",
    description:
      "Keep expertise available for planning or focused questions. Selection alone makes no model request.",
  },
] as const;
const navigation = [
  { name: "Room", icon: MessageSquare },
  { name: "Changes", icon: GitBranch },
  { name: "Preview", icon: Monitor },
  { name: "Settings", icon: Settings2 },
] as const;
const panelStorageKey = "scully-panel-layout-v1";
const panelDefaults = { task: 242, team: 330 };
const panelMin = { task: 180, team: 240 };
const panelMax = { task: 420, team: 520 };
const roomMin = 420;
const dividerSpace = 12;
type PanelSide = "task" | "team";
type PanelWidths = { task: number; team: number };
function clampPanelWidths(value: PanelWidths, available: number): PanelWidths {
  const width = Math.max(
    available,
    panelMin.task + panelMin.team + roomMin + dividerSpace,
  );
  let task = Math.min(panelMax.task, Math.max(panelMin.task, value.task));
  let team = Math.min(panelMax.team, Math.max(panelMin.team, value.team));
  const roomSpace = width - roomMin - dividerSpace;
  task = Math.min(task, roomSpace - team);
  team = Math.min(team, roomSpace - task);
  return { task: Math.round(task), team: Math.round(team) };
}
function savedPanelWidths(): PanelWidths {
  try {
    const value = JSON.parse(localStorage.getItem(panelStorageKey) || "null");
    if (value && Number.isFinite(value.task) && Number.isFinite(value.team))
      return {
        task: Math.round(
          Math.min(panelMax.task, Math.max(panelMin.task, value.task)),
        ),
        team: Math.round(
          Math.min(panelMax.team, Math.max(panelMin.team, value.team)),
        ),
      };
  } catch {
    // Layout storage is optional and may be unavailable or malformed.
  }
  return panelDefaults;
}
function Modal({
  title,
  children,
  onClose,
  className = "",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={className}
      onCancel={onClose}
      aria-labelledby="modal-title"
    >
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
const characterHighlights: Record<
  CharacterId,
  readonly [
    { label: string; icon: LucideIcon; tone: "teal" | "amber" | "blue" },
    { label: string; icon: LucideIcon; tone: "teal" | "amber" | "blue" },
  ]
> = {
  maya: [
    { label: "Whole journey", icon: Workflow, tone: "teal" },
    { label: "Clear changes", icon: Braces, tone: "blue" },
  ],
  tessa: [
    { label: "Vertical slices", icon: Braces, tone: "teal" },
    { label: "Early feedback", icon: Zap, tone: "amber" },
  ],
  adrian: [
    { label: "Full stack", icon: Braces, tone: "teal" },
    { label: "Fast recovery", icon: RefreshCcw, tone: "amber" },
  ],
  jun: [
    { label: "User journeys", icon: MousePointer2, tone: "blue" },
    { label: "Repeat actions", icon: RefreshCcw, tone: "amber" },
  ],
  malik: [
    { label: "Unexpected inputs", icon: Sparkles, tone: "amber" },
    { label: "Clear repros", icon: ClipboardCheck, tone: "blue" },
  ],
  ellis: [
    { label: "Reproducible evidence", icon: ClipboardCheck, tone: "blue" },
    { label: "Open questions", icon: Search, tone: "amber" },
  ],
  meryl: [
    { label: "Upgrade safety", icon: RefreshCcw, tone: "blue" },
    { label: "Handoff risks", icon: Workflow, tone: "amber" },
  ],
  sloane: [
    { label: "Interface direction", icon: Palette, tone: "teal" },
    { label: "First use", icon: MousePointer2, tone: "amber" },
  ],
  nadine: [
    { label: "Accessible journeys", icon: MousePointer2, tone: "teal" },
    { label: "Keyboard use", icon: Fingerprint, tone: "blue" },
  ],
  rafi: [
    { label: "System contracts", icon: Server, tone: "blue" },
    { label: "Performance", icon: Activity, tone: "amber" },
  ],
  carmen: [
    { label: "Clear documentation", icon: BookText, tone: "teal" },
    { label: "Stakeholder updates", icon: FileText, tone: "blue" },
  ],
  kiran: [
    { label: "Auth boundaries", icon: LockKeyhole, tone: "amber" },
    { label: "Preventive review", icon: ShieldCheck, tone: "blue" },
  ],
  jess: [
    { label: "Scoped attacks", icon: Crosshair, tone: "amber" },
    { label: "Verified findings", icon: Fingerprint, tone: "blue" },
  ],
  nico: [
    { label: "Original sources", icon: Search, tone: "blue" },
    { label: "Evidence gaps", icon: Lightbulb, tone: "amber" },
  ],
  james: [
    { label: "Release checks", icon: ClipboardCheck, tone: "teal" },
    { label: "Rollback", icon: RefreshCcw, tone: "amber" },
  ],
  pearl: [
    { label: "Decision routing", icon: Compass, tone: "teal" },
    { label: "Dependencies", icon: Workflow, tone: "blue" },
  ],
};
function CharacterBadges({ id }: { id: string }) {
  const highlights = characterHighlights[id as CharacterId];
  if (!highlights) return null;
  return (
    <div className="capabilities" aria-label="Strengths">
      {highlights.map(({ label, icon: Icon, tone }) => (
        <span className={`capability-badge ${tone}`} key={label}>
          <Icon size={14} aria-hidden="true" /> {label}
        </span>
      ))}
    </div>
  );
}
function Profile({
  person,
  activity,
  full,
  onOpen,
  onRefreshActivity,
  activityLoading,
  activityError,
}: {
  person: Teammate;
  activity: import("../shared/team-activity").TeamActivity;
  full?: boolean;
  onOpen?: () => void;
  onRefreshActivity: () => void;
  activityLoading: boolean;
  activityError: string;
}) {
  const counts = activity.byTeammate[person.id] || {
    recordedEvents: 0,
    runsWithEvents: 0,
  };
  const catalogPerson = characterById(person.id);
  return (
    <section
      className={`profile-card ${full ? "full-profile" : ""}`}
      aria-label={`${person.name} profile`}
    >
      {full ? (
        <div className="profile-hero">
          <div className="profile-art">
            <Portrait person={person} />
          </div>
          <div className="profile-hero-copy">
            <span className="eyebrow">MEET YOUR TEAMMATE</span>
            <h2>{person.name}</h2>
            <span className="profile-role">{person.role}</span>
            <p>{person.bio}</p>
            <CharacterBadges id={person.id} />
          </div>
        </div>
      ) : (
        <div className="profile-art">
          <Portrait person={person} />
        </div>
      )}
      <div className="profile-body">
        {!full && (
          <>
            <div className="profile-title">
              <div>
                <div className="profile-name-row">
                  <h2>{person.name}</h2>
                </div>
                <span>{person.role}</span>
              </div>
            </div>
            <p>{person.bio}</p>
            <CharacterBadges id={person.id} />
          </>
        )}
        {full && catalogPerson && (
          <section className="profile-story" aria-label="Background">
            <span className="eyebrow">BACKGROUND</span>
            <p>{catalogPerson.background}</p>
          </section>
        )}
        <div className="profile-stats">
          <span className="eyebrow">SAVED RUN ACTIVITY</span>
          <div>
            <span>
              <strong>{counts.recordedEvents}</strong>Recorded events
            </span>
            <span>
              <strong>{counts.runsWithEvents}</strong>Runs with events
            </span>
          </div>
          <p>
            Across {activity.scannedRuns} recent saved{" "}
            {activity.scannedRuns === 1 ? "run" : "runs"}
            {activity.partial ? " (partial count)" : ""}. Events are saved
            messages and handoffs, not verified work or completed tasks.
          </p>
          <button
            className="secondary"
            onClick={onRefreshActivity}
            disabled={activityLoading}
          >
            {activityLoading ? "Refreshing activity..." : "Refresh activity"}
          </button>
          {activityError && <p role="alert">{activityError}</p>}
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
  const [settingsSection, setSettingsSection] =
    useState<SettingsSection>("team");
  const [personId, setPersonId] = useState("ellis");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [settingsRunId, setSettingsRunId] = useState<string | null>(null);
  const [newTask, setNewTask] = useState(false);
  const [taskDraft, setTaskDraft] = useState({
    title: "",
    description: "",
    mode: "plan" as "plan" | "work",
  });
  const [previewSession, setPreviewSession] = useState<SessionInfo | null>(
    null,
  );
  const [resumeTaskSetup, setResumeTaskSetup] = useState(false);
  const [teamNameEditing, setTeamNameEditing] = useState(false);
  const [rosterEditing, setRosterEditing] = useState(false);
  const [rosterDraft, setRosterDraft] = useState<FixedRoster | null>(null);
  const [newTeamCreating, setNewTeamCreating] = useState(false);
  const [teamDeleting, setTeamDeleting] = useState<string | null>(null);
  const [deletedTeamPage, setDeletedTeamPage] = useState(0);
  const [newTeamName, setNewTeamName] = useState("");
  const [taskEditing, setTaskEditing] = useState(false);
  const [taskDeleting, setTaskDeleting] = useState(false);
  const [taskRunCount, setTaskRunCount] = useState<number | null>(null);
  const [taskViewRevision, setTaskViewRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState("");
  const [panelWidths, setPanelWidths] = useState(savedPanelWidths);
  const [availableWidth, setAvailableWidth] = useState(() => window.innerWidth);
  const displayPanelWidths = clampPanelWidths(panelWidths, availableWidth);
  const gridRef = useRef<HTMLDivElement>(null);
  const draggingPanel = useRef<PanelSide | null>(null);
  useEffect(() => {
    try {
      localStorage.setItem(panelStorageKey, JSON.stringify(panelWidths));
    } catch {
      // A blocked storage write must not break the room layout.
    }
  }, [panelWidths]);
  useEffect(() => {
    const onResize = () =>
      setAvailableWidth(gridRef.current?.clientWidth || window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  function setPanelWidth(side: PanelSide, desired: number) {
    const available = gridRef.current?.clientWidth || window.innerWidth;
    setPanelWidths((current) => {
      const other = side === "task" ? "team" : "task";
      const max = Math.min(
        panelMax[side],
        Math.max(
          panelMin[side],
          available - roomMin - dividerSpace - displayPanelWidths[other],
        ),
      );
      return {
        ...current,
        [side]: Math.round(Math.min(max, Math.max(panelMin[side], desired))),
      };
    });
  }
  function panelKeyDown(side: PanelSide, event: KeyboardEvent<HTMLDivElement>) {
    const direction = side === "task" ? 1 : -1;
    if (event.key === "Home") {
      event.preventDefault();
      setPanelWidth(side, panelDefaults[side]);
    } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const step = event.key === "ArrowRight" ? direction : -direction;
      setPanelWidth(side, displayPanelWidths[side] + step * 20);
    }
  }
  function panelPointerMove(
    side: PanelSide,
    event: PointerEvent<HTMLDivElement>,
  ) {
    if (
      draggingPanel.current !== side ||
      !gridRef.current ||
      !Number.isFinite(event.clientX)
    )
      return;
    const bounds = gridRef.current.getBoundingClientRect();
    setPanelWidth(
      side,
      side === "task"
        ? event.clientX - bounds.left - 3
        : bounds.right - event.clientX - 3,
    );
  }
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
  useEffect(() => {
    if (
      !api ||
      (!newTask && !(page === "Settings" && settingsSection === "team"))
    )
      return;
    let active = true;
    api.session().then(
      (session) => {
        if (active) setPreviewSession(session);
      },
      () => {
        if (active) setPreviewSession(null);
      },
    );
    return () => {
      active = false;
    };
  }, [api, newTask, page, settingsSection]);
  if (!workspace)
    return (
      <div className="loading">
        <img
          className="loading-logo"
          src={scullyLogo}
          alt="Scully alien head"
        />
        <h1>Scully</h1>
        <p role={error ? "alert" : "status"}>
          {error || "Opening your workspace..."}
        </p>
      </div>
    );
  const task = workspace.tasks.find((t) => t.id === taskId);
  const savedTeams = workspace.savedTeams || [
    {
      id: "legacy-default",
      name: "Scully team",
      version: 1,
      createdAt: "",
      members: workspace.teammates,
    },
  ];
  const defaultTeam =
    savedTeams.find((saved) => saved.id === workspace.defaultTeamId) ||
    savedTeams[0];
  const availableTeams = savedTeams.filter(
    (saved) => saved.kind !== "snapshot" && !saved.deletedAt,
  );
  const deletedTeams = savedTeams.filter(
    (saved) => saved.kind === "library" && !!saved.deletedAt,
  );
  const taskTeam = task
    ? savedTeams.find((saved) => saved.id === task.teamConfigId) || defaultTeam
    : defaultTeam;
  const visibleTeam = page === "Settings" ? defaultTeam : taskTeam;
  const team = visibleTeam.members;
  const person = team.find((t) => t.id === personId) || team[0];
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
      setSettingsRunId(null);
      setNewTask(false);
      setTaskDraft({ title: "", description: "", mode: "plan" });
      setResumeTaskSetup(false);
      setPage("Room");
    } catch {
      setError(
        "Could not save this task. Your input is still here. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function openTaskEdit() {
    if (!task) return;
    setError("");
    setTaskRunCount(null);
    setTaskEditing(true);
    try {
      setTaskRunCount((await api!.runs(task.id)).length);
    } catch {
      setError("Could not check saved runs. Editing is unavailable for now.");
    }
  }
  async function saveTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!task || taskRunCount === null) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const updated = await api!.updateTask(task.id, {
        title: String(form.get("title")),
        description: String(form.get("description")),
        mode:
          taskRunCount > 0
            ? task.mode
            : form.get("mode") === "work"
              ? "work"
              : "plan",
      });
      setWorkspace(
        (w) =>
          w && {
            ...w,
            tasks: w.tasks.map((item) =>
              item.id === updated.id ? updated : item,
            ),
          },
      );
      setTaskViewRevision((value) => value + 1);
      setTaskEditing(false);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not update this task.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function deleteTask() {
    if (!task) return;
    setBusy(true);
    setError("");
    try {
      await api!.deleteTask(task.id);
      setWorkspace(
        (w) =>
          w && { ...w, tasks: w.tasks.filter((item) => item.id !== task.id) },
      );
      setTaskId(null);
      setSettingsRunId(null);
      setTaskDeleting(false);
      setPage("Room");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not delete this task.",
      );
    } finally {
      setBusy(false);
    }
  }
  function openRosterEditor() {
    setError("");
    setRosterDraft(
      defaultTeam.roster
        ? {
            ...defaultTeam.roster,
            memberIds: [...defaultTeam.roster.memberIds],
          }
        : null,
    );
    setRosterEditing(true);
  }
  function toggleCharacter(id: CharacterId) {
    if (!rosterDraft || id === "pearl") return;
    const included = rosterDraft.memberIds.includes(id);
    if (!included) {
      setRosterDraft({
        ...rosterDraft,
        memberIds: [...rosterDraft.memberIds, id],
      });
      return;
    }
    const memberIds = rosterDraft.memberIds.filter(
      (memberId) => memberId !== id,
    );
    const replacement = (role: "builder" | "auditor") =>
      memberIds.find(
        (memberId) =>
          characterCatalog.find((character) => character.id === memberId)
            ?.role === role,
      );
    if (id === rosterDraft.activeBuilderId && !replacement("builder")) return;
    if (id === rosterDraft.activeAuditorId && !replacement("auditor")) return;
    setRosterDraft({
      memberIds,
      activeBuilderId:
        id === rosterDraft.activeBuilderId
          ? replacement("builder")!
          : rosterDraft.activeBuilderId,
      activeAuditorId:
        id === rosterDraft.activeAuditorId
          ? replacement("auditor")!
          : rosterDraft.activeAuditorId,
      activeTesterId:
        id === rosterDraft.activeTesterId ? null : rosterDraft.activeTesterId,
    });
  }
  async function saveRoster(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!rosterDraft) return;
    setBusy(true);
    setError("");
    try {
      await api!.saveTeam({
        name: defaultTeam.name,
        ...rosterDraft,
        expectedDefaultTeamId: defaultTeam.id,
        saveMode: "overwrite",
      });
      setWorkspace(await api!.load());
      setRosterEditing(false);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save team roster.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function refreshActivity() {
    setActivityLoading(true);
    setActivityError("");
    try {
      const refreshed = await api!.load();
      setWorkspace((w) => w && { ...w, activity: refreshed.activity });
    } catch {
      setActivityError("Saved activity could not be refreshed. Try again.");
    } finally {
      setActivityLoading(false);
    }
  }
  async function changeTeamName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("teamName")).trim();
    if (!name || name === defaultTeam.name) {
      setTeamNameEditing(false);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api!.saveTeam({
        name,
        ...defaultTeam.roster!,
        expectedDefaultTeamId: defaultTeam.id,
        saveMode: "overwrite",
      });
      setWorkspace(await api!.load());
      setTeamNameEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save team.");
    } finally {
      setBusy(false);
    }
  }
  async function createTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api!.saveTeam({
        name: newTeamName.trim(),
        ...defaultTeam.roster!,
        expectedDefaultTeamId: defaultTeam.id,
        saveMode: "new",
      });
      setWorkspace(await api!.load());
      setNewTeamCreating(false);
      setNewTeamName("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not create team.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function deleteSavedTeam(id: string) {
    setBusy(true);
    setError("");
    try {
      await api!.deleteTeam(id);
      setWorkspace(await api!.load());
      setTeamDeleting(null);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not delete team.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function restoreSavedTeam(id: string) {
    setBusy(true);
    setError("");
    try {
      await api!.restoreTeam(id);
      setWorkspace(await api!.load());
      if (deletedTeamPage * 10 >= deletedTeams.length - 1)
        setDeletedTeamPage((page) => Math.max(0, page - 1));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not restore team.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function useSavedTeam(id: string) {
    setBusy(true);
    setError("");
    try {
      await api!.setDefaultTeam(id);
      setWorkspace(await api!.load());
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not select team.",
      );
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
          <img
            className="brand-logo"
            src={scullyLogo}
            alt="Scully alien head"
          />
          <span>Scully</span>
        </button>
        <nav
          aria-label="Main navigation"
          style={
            {
              "--nav-index": navigation.findIndex(
                ({ name }) => name === (page === "Profile" ? "Room" : page),
              ),
            } as CSSProperties
          }
        >
          <span className="main-nav-indicator" aria-hidden="true" />
          {navigation.map(({ name, icon: Icon }) => (
            <button
              key={name}
              className={
                page === name || (page === "Profile" && name === "Room")
                  ? "active"
                  : ""
              }
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
      <div
        className="workspace-grid"
        ref={gridRef}
        style={
          {
            "--task-panel-width": `${displayPanelWidths.task}px`,
            "--team-panel-width": `${displayPanelWidths.team}px`,
          } as CSSProperties
        }
      >
        <aside className="project-sidebar">
          <div className="project-heading">
            <span className="project-mark">
              <img src={scullyLogo} alt="Scully alien head" />
            </span>
            <div>
              <strong>Scully home</strong>
              <small>Tasks and team</small>
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
          <div className="sidebar-label">HOME</div>
          <button
            className={`sidebar-item ${taskId === null ? "selected" : ""}`}
            onClick={() => {
              setTaskId(null);
              setSettingsRunId(null);
              setPage("Room");
            }}
          >
            <LayoutGrid size={17} /> Overview
          </button>
          <div className="sidebar-label task-label">
            YOUR TASKS <span>{workspace.tasks.length}</span>
          </div>
          <div className="task-list">
            {workspace.tasks.length === 0 ? (
              <p className="quiet-note">No tasks yet. Create one to begin.</p>
            ) : (
              workspace.tasks.map((t) => (
                <button
                  key={t.id}
                  className={`sidebar-item task-item ${taskId === t.id ? "selected" : ""}`}
                  onClick={() => {
                    setTaskId(t.id);
                    setSettingsRunId(null);
                    setPage("Room");
                  }}
                >
                  <MessageSquare size={15} />
                  <span>{t.title}</span>
                </button>
              ))
            )}
          </div>
          {task && (
            <div className="current-task">
              <span className="eyebrow">SAVED TASK</span>
              <h3>{task.title}</h3>
              {task.description && <p>{task.description}</p>}
              <small>Run status is shown in the task room.</small>
            </div>
          )}
          <div className="permission-card">
            <ShieldCheck size={18} />
            <div>
              <strong>You stay in control</strong>
              <small>
                Local commands require fresh approval.
                <br />
                Publishing is not available yet.
              </small>
            </div>
          </div>
          <div className="sidebar-footer">
            <span className="dot muted-dot" /> Local workspace <span>v0.2</span>
          </div>
        </aside>
        <div
          className="panel-divider"
          role="separator"
          aria-label="Resize task panel"
          aria-orientation="vertical"
          aria-valuemin={panelMin.task}
          aria-valuemax={panelMax.task}
          aria-valuenow={displayPanelWidths.task}
          tabIndex={0}
          title="Drag to resize the task panel. Use arrow keys for small steps."
          onKeyDown={(event) => panelKeyDown("task", event)}
          onPointerDown={(event) => {
            draggingPanel.current = "task";
            event.currentTarget.setPointerCapture?.(event.pointerId);
          }}
          onPointerMove={(event) => panelPointerMove("task", event)}
          onPointerUp={() => (draggingPanel.current = null)}
          onPointerCancel={() => (draggingPanel.current = null)}
          onLostPointerCapture={() => (draggingPanel.current = null)}
        />
        <main className="main-panel">
          {page === "Room" && (
            <>
              <div className="room-heading">
                <div>
                  <span className="eyebrow">LET’S BUILD SOMETHING GOOD</span>
                  <h1>
                    Team room<span className="heading-dot">.</span>
                  </h1>
                  <p>{task?.title || "Your tasks and team, in one place."}</p>
                </div>
                <span className="team-count">
                  <Users size={16} /> {team.length}{" "}
                  {team.length === 1 ? "teammate" : "teammates"}
                </span>
              </div>
              {task ? (
                <>
                  <div className="task-actions" aria-label="Task actions">
                    <button className="secondary" onClick={openTaskEdit}>
                      <Pencil size={14} /> Edit task
                    </button>
                    <button
                      className="secondary danger-action"
                      onClick={() => {
                        setError("");
                        setTaskDeleting(true);
                      }}
                    >
                      Delete task
                    </button>
                  </div>
                  <div className="preview-banner">
                    <ShieldCheck size={17} />
                    <span>
                      Private drafts · applying changes requires your approval.
                    </span>
                  </div>
                  <RunPanel
                    key={`${task.id}:${taskViewRevision}`}
                    api={api!}
                    task={task}
                    team={team}
                    settingsView="summary"
                    onOpenSettings={(runId) => {
                      setSettingsRunId(runId);
                      setSettingsSection("run");
                      setPage("Settings");
                    }}
                  />
                </>
              ) : (
                <section className="room-empty" aria-label="Task overview">
                  <span className="room-empty-icon">
                    <LayoutGrid size={28} />
                  </span>
                  <span className="eyebrow">
                    {workspace.tasks.length ? "YOUR TASKS" : "START HERE"}
                  </span>
                  <h2>
                    {workspace.tasks.length
                      ? "Choose a saved task."
                      : "Start your first task."}
                  </h2>
                  <p>
                    {workspace.tasks.length
                      ? "Select a task in the sidebar to continue where you left off, or create another one."
                      : "Create a task, choose a project source, then review exactly what Scully will share before any model request."}
                  </p>
                  <button
                    className="primary"
                    onClick={() => {
                      setError("");
                      setNewTask(true);
                    }}
                  >
                    {workspace.tasks.length
                      ? "Create another task"
                      : "Create your first task"}
                    <ArrowRight size={16} />
                  </button>
                  <small>
                    Nothing is sent to a model until you approve a run.
                  </small>
                </section>
              )}
            </>
          )}
          {page === "Profile" && (
            <>
              <button className="back-button" onClick={() => setPage("Room")}>
                <ArrowLeft size={16} /> Back to room
              </button>
              <Profile
                person={person}
                activity={workspace.activity}
                full
                onRefreshActivity={refreshActivity}
                activityLoading={activityLoading}
                activityError={activityError}
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
                settingsView="summary"
                onOpenSettings={(runId) => {
                  setSettingsRunId(runId);
                  setSettingsSection("run");
                  setPage("Settings");
                }}
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
              text="Your running project will appear here when preview support is connected. For now, return to your workspace or save a task."
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
              <nav
                className="settings-sections"
                aria-label="Settings sections"
                style={
                  {
                    "--settings-index": settingsSections.findIndex(
                      (section) => section.id === settingsSection,
                    ),
                  } as CSSProperties
                }
              >
                <span
                  className="settings-section-indicator"
                  aria-hidden="true"
                />
                {settingsSections.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    className={`settings-section-button ${settingsSection === id ? "active" : ""}`}
                    aria-current={settingsSection === id ? "page" : undefined}
                    onClick={() => setSettingsSection(id)}
                  >
                    <Icon size={17} aria-hidden="true" />
                    {label}
                  </button>
                ))}
              </nav>
              <div className="settings-content" key={settingsSection}>
                {settingsSection === "run" && (
                  <RunSettings api={api!} task={task} runId={settingsRunId} />
                )}
                {settingsSection === "team" && (
                  <section className="settings-card" aria-label="Team settings">
                    <div className="team-settings-heading">
                      <h2>{defaultTeam.name}</h2>
                      <button
                        className="edit-profile"
                        onClick={() => {
                          setError("");
                          setTeamNameEditing(true);
                        }}
                        aria-label="Change team name"
                      >
                        <Pencil size={15} />
                      </button>
                    </div>
                    <p>
                      This team is used for new tasks. Existing tasks keep the
                      team they started with.
                    </p>
                    <div className="team-library-heading">
                      <h3>Team members ({defaultTeam.members.length}/16)</h3>
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={openRosterEditor}
                      >
                        <Users size={16} /> Choose team members
                      </button>
                    </div>
                    <ul className="team-member-list">
                      {defaultTeam.members.map((member) => (
                        <li key={member.id}>
                          <span>
                            <strong>{member.name}</strong> · {member.role}
                            <small>
                              {" "}
                              ·{" "}
                              {runRole(member) === "reserve"
                                ? "Reserve, no automatic request"
                                : `${runRole(member)} in runs`}
                            </small>
                          </span>
                          <div className="team-library-actions">
                            <span className="tiny-badge">
                              {runRole(member) === "reserve"
                                ? "Available"
                                : "Active"}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                    <p className="muted">
                      Current runs call one selected builder, one independent
                      auditor and, when assigned, one tester. Pearl and other
                      selected characters remain available without an automatic
                      model request. More active agents require a later approved
                      dispatch step.
                    </p>
                    <p className="muted">Preview for a new Plan first task:</p>
                    <TeamPreview
                      team={defaultTeam.members}
                      mode="plan"
                      session={previewSession}
                      context="team"
                    />
                    <div className="command-actions">
                      {resumeTaskSetup && (
                        <button
                          className="primary"
                          onClick={() => {
                            setNewTask(true);
                            setResumeTaskSetup(false);
                            setPage("Room");
                          }}
                        >
                          Continue task setup
                        </button>
                      )}
                    </div>
                    <div className="team-library-heading">
                      <h3>Saved teams ({availableTeams.length}/20)</h3>
                      <button
                        className="secondary"
                        disabled={busy || availableTeams.length >= 20}
                        onClick={() => {
                          setError("");
                          setNewTeamName("");
                          setNewTeamCreating(true);
                        }}
                      >
                        <Plus size={16} /> Create team
                      </button>
                    </div>
                    <ul className="saved-team-list">
                      {availableTeams.map((saved) => (
                        <li key={saved.id}>
                          <div>
                            <strong>{saved.name}</strong>
                            <small>
                              {saved.members
                                .map((member) => member.name)
                                .join(", ")}
                            </small>
                          </div>
                          <div className="team-library-actions">
                            {saved.id === defaultTeam.id ? (
                              <span className="tiny-badge">Current</span>
                            ) : (
                              <button
                                className="secondary"
                                disabled={busy}
                                onClick={() => useSavedTeam(saved.id)}
                              >
                                Use for new tasks
                              </button>
                            )}
                            <button
                              className="secondary"
                              disabled={busy || saved.id === defaultTeam.id}
                              title={
                                saved.id === defaultTeam.id
                                  ? "Choose another team first"
                                  : `Delete ${saved.name}`
                              }
                              onClick={() => {
                                setError("");
                                setTeamDeleting(saved.id);
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                    {availableTeams.length >= 20 && (
                      <p className="muted">
                        The 20-team limit is reached. Delete an available team
                        to create or restore another.
                      </p>
                    )}
                    <p className="muted saved-team-deletion-note">
                      Choose another team for new tasks before deleting the
                      current one. Existing tasks keep their saved team.
                    </p>
                    {deletedTeams.length > 0 && (
                      <details className="team-history">
                        <summary>Deleted teams ({deletedTeams.length})</summary>
                        <ul className="saved-team-list">
                          {deletedTeams
                            .slice(
                              deletedTeamPage * 10,
                              deletedTeamPage * 10 + 10,
                            )
                            .map((saved) => (
                              <li key={saved.id}>
                                <div>
                                  <strong>{saved.name}</strong>
                                  <small>
                                    {saved.members
                                      .map((member) => member.name)
                                      .join(", ")}
                                  </small>
                                </div>
                                <button
                                  className="secondary"
                                  disabled={busy}
                                  onClick={() => restoreSavedTeam(saved.id)}
                                >
                                  Restore team
                                </button>
                              </li>
                            ))}
                        </ul>
                        {deletedTeams.length > 10 && (
                          <div className="team-library-actions">
                            <button
                              className="secondary"
                              disabled={deletedTeamPage === 0}
                              onClick={() =>
                                setDeletedTeamPage((page) => page - 1)
                              }
                            >
                              Previous
                            </button>
                            <span>
                              Page {deletedTeamPage + 1} of{" "}
                              {Math.ceil(deletedTeams.length / 10)}
                            </span>
                            <button
                              className="secondary"
                              disabled={
                                (deletedTeamPage + 1) * 10 >=
                                deletedTeams.length
                              }
                              onClick={() =>
                                setDeletedTeamPage((page) => page + 1)
                              }
                            >
                              Next
                            </button>
                          </div>
                        )}
                      </details>
                    )}
                    {error &&
                      !teamNameEditing &&
                      !newTeamCreating &&
                      !teamDeleting &&
                      !rosterEditing && (
                        <p role="alert" className="error">
                          {error}
                        </p>
                      )}
                  </section>
                )}
                {settingsSection === "app" && (
                  <>
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
              </div>
            </>
          )}
        </main>
        <div
          className="panel-divider"
          role="separator"
          aria-label="Resize team panel"
          aria-orientation="vertical"
          aria-valuemin={panelMin.team}
          aria-valuemax={panelMax.team}
          aria-valuenow={displayPanelWidths.team}
          tabIndex={0}
          title="Drag to resize the team panel. Use arrow keys for small steps."
          onKeyDown={(event) => panelKeyDown("team", event)}
          onPointerDown={(event) => {
            draggingPanel.current = "team";
            event.currentTarget.setPointerCapture?.(event.pointerId);
          }}
          onPointerMove={(event) => panelPointerMove("team", event)}
          onPointerUp={() => (draggingPanel.current = null)}
          onPointerCancel={() => (draggingPanel.current = null)}
          onLostPointerCapture={() => (draggingPanel.current = null)}
        />
        <aside className="team-sidebar">
          <div className="section-heading">
            <h2>{visibleTeam.name}</h2>
            <span className="tiny-badge">
              {team.length} {team.length === 1 ? "member" : "members"}
            </span>
          </div>
          <p className="muted">
            {task && page !== "Settings"
              ? "Saved for this task"
              : "Default for new tasks"}
          </p>
          <button
            className="team-settings-link"
            onClick={() => {
              setSettingsSection("team");
              setPage("Settings");
            }}
          >
            <Settings2 size={14} /> Manage team
          </button>
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
              </button>
            ))}
          </div>
          <Profile
            person={person}
            activity={workspace.activity}
            onRefreshActivity={refreshActivity}
            activityLoading={activityLoading}
            activityError={activityError}
            onOpen={() => setPage("Profile")}
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
          className="new-task-dialog"
        >
          <form onSubmit={createTask} className="new-task-form">
            <div className="new-task-scroll">
              <p className="muted">
                Save an idea, then choose a project source and approve a bounded
                run.
              </p>
              <label>
                Task title
                <input
                  name="title"
                  value={taskDraft.title}
                  onChange={(event) =>
                    setTaskDraft((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
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
                  value={taskDraft.description}
                  onChange={(event) =>
                    setTaskDraft((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  maxLength={4000}
                  rows={4}
                  placeholder="Describe the outcome and any constraints..."
                />
              </label>
              <fieldset>
                <legend>How would you like to begin?</legend>
                <label className="radio-option">
                  <input
                    type="radio"
                    name="mode"
                    value="plan"
                    checked={taskDraft.mode === "plan"}
                    onChange={() =>
                      setTaskDraft((current) => ({ ...current, mode: "plan" }))
                    }
                  />{" "}
                  Plan first
                </label>
                <label className="radio-option">
                  <input
                    type="radio"
                    name="mode"
                    value="work"
                    checked={taskDraft.mode === "work"}
                    onChange={() =>
                      setTaskDraft((current) => ({ ...current, mode: "work" }))
                    }
                  />{" "}
                  Start working
                </label>
              </fieldset>
              <div className="settings-card">
                <strong>Team for this task: {defaultTeam.name}</strong>
                <p>
                  {defaultTeam.members
                    .map((member) => `${member.name} (${member.role})`)
                    .join(", ")}
                </p>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setNewTask(false);
                    setResumeTaskSetup(true);
                    setSettingsSection("team");
                    setPage("Settings");
                  }}
                >
                  Edit team before creating task
                </button>
              </div>
              <TeamPreview
                team={defaultTeam.members}
                mode={taskDraft.mode}
                session={previewSession}
              />
            </div>
            <div className="new-task-footer">
              {error && (
                <p role="alert" className="error">
                  {error}
                </p>
              )}
              <button className="primary wide" disabled={busy}>
                {busy ? "Saving..." : "Save task"}
                <ArrowRight size={16} />
              </button>
            </div>
          </form>
        </Modal>
      )}
      {taskEditing && task && (
        <Modal title="Edit task" onClose={() => !busy && setTaskEditing(false)}>
          <form onSubmit={saveTask}>
            <label>
              Task title
              <input
                name="title"
                defaultValue={task.title}
                required
                maxLength={120}
                autoFocus
              />
            </label>
            <label>
              What should the team know?
              <textarea
                name="description"
                defaultValue={task.description}
                maxLength={4000}
                rows={4}
              />
            </label>
            <fieldset disabled={taskRunCount !== 0}>
              <legend>How would you like to begin?</legend>
              <label className="radio-option">
                <input
                  type="radio"
                  name="mode"
                  value="plan"
                  defaultChecked={task.mode === "plan"}
                />{" "}
                Plan first
              </label>
              <label className="radio-option">
                <input
                  type="radio"
                  name="mode"
                  value="work"
                  defaultChecked={task.mode === "work"}
                />{" "}
                Start working
              </label>
            </fieldset>
            {taskRunCount === null ? (
              <p className="muted">Checking saved runs...</p>
            ) : taskRunCount > 0 ? (
              <p className="muted">
                The start mode is locked after a run is prepared. Updated task
                details apply to future requests, while saved work may reflect
                the earlier wording.
              </p>
            ) : null}
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <button
              className="primary wide"
              disabled={busy || taskRunCount === null}
            >
              {busy ? "Saving..." : "Save changes"}
            </button>
          </form>
        </Modal>
      )}
      {taskDeleting && task && (
        <Modal
          title="Delete task?"
          onClose={() => !busy && setTaskDeleting(false)}
        >
          <p>
            Delete <strong>{task.title}</strong> and its saved runs, usage and
            cost records? This cannot be undone.
          </p>
          <p className="muted">
            This is available before model work starts. Tasks with saved work
            keep their run and recovery records. Any existing local files and
            files already applied to a project stay unchanged.
          </p>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setTaskDeleting(false)}
            >
              Cancel
            </button>
            <button
              className="primary danger-confirm"
              disabled={busy}
              onClick={deleteTask}
            >
              {busy ? "Deleting..." : "Delete task"}
            </button>
          </div>
        </Modal>
      )}
      {rosterEditing && rosterDraft && (
        <Modal
          title="Choose team members"
          onClose={() => !busy && setRosterEditing(false)}
          className="roster-dialog"
        >
          <form onSubmit={saveRoster} className="roster-form">
            <div className="roster-scroll">
              <div className="roster-intro">
                <p>
                  Build the team for future tasks. Choose people for their
                  strengths, then assign who works automatically below. Existing
                  tasks keep their saved team.
                </p>
                <span className="roster-count">
                  {rosterDraft.memberIds.length} of 16 selected
                </span>
              </div>
              <div className="roster-catalog">
                {rosterGroups.map((group) => (
                  <section
                    className="roster-group"
                    aria-label={group.title}
                    key={group.role}
                  >
                    <div className="roster-group-heading">
                      <h3>{group.title}</h3>
                      <p>{group.description}</p>
                    </div>
                    <div className="fixed-character-grid">
                      {characterCatalog
                        .filter((character) => character.role === group.role)
                        .map((character) => {
                          const selected = rosterDraft.memberIds.includes(
                            character.id,
                          );
                          const lastRequired =
                            selected &&
                            (character.role === "builder" ||
                              character.role === "auditor") &&
                            rosterDraft.memberIds.filter(
                              (id) =>
                                characterById(id)?.role === character.role,
                            ).length === 1;
                          const required =
                            character.id === "pearl" || lastRequired;
                          return (
                            <button
                              key={character.id}
                              type="button"
                              className={`fixed-character-choice ${selected ? "selected" : ""}`}
                              aria-pressed={selected}
                              aria-label={`${character.name}, ${catalogTeammate(character.id).role}`}
                              disabled={required}
                              onClick={() => toggleCharacter(character.id)}
                            >
                              <Portrait
                                person={catalogTeammate(character.id)}
                              />
                              <span className="fixed-character-copy">
                                <span className="fixed-character-name">
                                  <strong>{character.name}</strong>
                                  <span className="fixed-character-state">
                                    {required
                                      ? "Required"
                                      : selected
                                        ? "Selected"
                                        : "Add"}
                                    {selected && (
                                      <Check size={13} aria-hidden="true" />
                                    )}
                                  </span>
                                </span>
                                <span className="fixed-character-role">
                                  {catalogTeammate(character.id).role}
                                </span>
                                <span className="fixed-character-brief">
                                  {character.brief}
                                </span>
                                <span className="fixed-character-story">
                                  {character.background}
                                </span>
                              </span>
                            </button>
                          );
                        })}
                    </div>
                  </section>
                ))}
              </div>
              <div className="roster-assignment-grid">
                <label>
                  Builder for current runs
                  <select
                    value={rosterDraft.activeBuilderId}
                    onChange={(event) =>
                      setRosterDraft({
                        ...rosterDraft,
                        activeBuilderId: event.target.value as CharacterId,
                      })
                    }
                  >
                    {characterCatalog
                      .filter(
                        (character) =>
                          character.role === "builder" &&
                          rosterDraft.memberIds.includes(character.id),
                      )
                      .map((character) => (
                        <option key={character.id} value={character.id}>
                          {character.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Independent auditor for current runs
                  <select
                    value={rosterDraft.activeAuditorId}
                    onChange={(event) =>
                      setRosterDraft({
                        ...rosterDraft,
                        activeAuditorId: event.target.value as CharacterId,
                      })
                    }
                  >
                    {characterCatalog
                      .filter(
                        (character) =>
                          character.role === "auditor" &&
                          rosterDraft.memberIds.includes(character.id),
                      )
                      .map((character) => (
                        <option key={character.id} value={character.id}>
                          {character.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Tester for current runs
                  <select
                    value={rosterDraft.activeTesterId || ""}
                    onChange={(event) =>
                      setRosterDraft({
                        ...rosterDraft,
                        activeTesterId: event.target.value
                          ? (event.target.value as CharacterId)
                          : null,
                      })
                    }
                  >
                    <option value="">No assigned tester</option>
                    {characterCatalog
                      .filter(
                        (character) =>
                          character.role === "tester" &&
                          rosterDraft.memberIds.includes(character.id),
                      )
                      .map((character) => (
                        <option key={character.id} value={character.id}>
                          {character.name}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              <p className="muted">
                Only assigned members receive automatic requests. Selected
                specialists and other available members receive none until a
                later dispatch step.
              </p>
              <TeamPreview
                team={rosterMembers(rosterDraft)}
                mode="plan"
                session={previewSession}
                context="team"
              />
            </div>
            <div className="roster-footer">
              {error && (
                <p role="alert" className="error">
                  {error}
                </p>
              )}
              <button className="primary wide" disabled={busy}>
                {busy ? "Saving..." : "Save team roster"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {teamNameEditing && (
        <Modal
          title="Change team name"
          onClose={() => setTeamNameEditing(false)}
        >
          <form onSubmit={changeTeamName}>
            <label>
              Team name
              <input
                name="teamName"
                defaultValue={defaultTeam.name}
                required
                maxLength={80}
                autoFocus
              />
            </label>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <button className="primary wide" disabled={busy}>
              {busy ? "Saving..." : "Save changes"}
            </button>
          </form>
        </Modal>
      )}
      {newTeamCreating && (
        <Modal
          title="Create team"
          onClose={() => !busy && setNewTeamCreating(false)}
        >
          <form onSubmit={createTeam}>
            <p>
              The new team starts with {defaultTeam.name}'s members. You can
              edit it after saving.
            </p>
            <label>
              Team name
              <input
                value={newTeamName}
                onChange={(event) => setNewTeamName(event.target.value)}
                maxLength={80}
                required
                autoFocus
                placeholder="Name this team"
              />
            </label>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <button
              className="primary wide"
              disabled={busy || !newTeamName.trim()}
            >
              {busy ? "Creating..." : "Create team"}
            </button>
          </form>
        </Modal>
      )}
      {teamDeleting && (
        <Modal
          title="Delete team?"
          onClose={() => !busy && setTeamDeleting(null)}
        >
          <p>
            Delete{" "}
            <strong>
              {savedTeams.find((saved) => saved.id === teamDeleting)?.name}
            </strong>{" "}
            from available teams? Existing tasks keep their saved team. You can
            restore this team later.
          </p>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setTeamDeleting(null)}
            >
              Cancel
            </button>
            <button
              className="primary danger-confirm"
              disabled={busy}
              onClick={() => deleteSavedTeam(teamDeleting)}
            >
              {busy ? "Deleting..." : "Delete team"}
            </button>
          </div>
        </Modal>
      )}
    </div>
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
