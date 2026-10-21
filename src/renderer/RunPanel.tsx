import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowRight,
  FolderOpen,
  Play,
  Square,
  ShieldCheck,
  CircleCheck,
  Info,
} from "lucide-react";
import {
  initialTeam,
  type DesktopAPI,
  type Task,
  type Teammate,
} from "../shared/contracts";
import { portraitStyle } from "./Portrait";
import type { Run, SourceSelection, SessionInfo } from "../shared/runs";
import { ExecutionPanel } from "./ExecutionPanel";
import { CloudPanel } from "./CloudPanel";
import { ApplyPanel } from "./ApplyPanel";
import { ProjectLocation } from "./ProjectLocation";
import { CoordinationPanel } from "./CoordinationPanel";
import { TeamMessages } from "./TeamMessages";
import { SuggestionsPanel } from "./SuggestionsPanel";
import { SpecialistPanel } from "./SpecialistPanel";
import { requestLimit } from "../shared/coordination";
import { compareCorrection } from "../shared/correction-evidence";
import { InFlightStatus } from "./InFlightStatus";
import { UsagePolicyPanel } from "./UsagePolicyPanel";
import { UsageAlertsPanel } from "./UsageAlertsPanel";
import { CostPanel } from "./CostPanel";
import { LineupProposalPanel } from "./LineupProposalPanel";
import { ConsultationPanel } from "./ConsultationPanel";
import { AdviceHandoffPanel } from "./AdviceHandoffPanel";
import { RichText } from "./RichText";
import { BuildActivity } from "./BuildActivity";
import { ChangesPanel } from "./ChangesPanel";
import { CollaborativeBuild } from "./CollaborativeBuild";
export function ConnectionSettings({ api }: { api: DesktopAPI }) {
  const [info, setInfo] = useState<SessionInfo>({
    configured: false,
    model: "",
    outputTokens: 8192,
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api
      .session()
      .then((value) => {
        setInfo(value);
      })
      .catch(() => setError("Could not read connection status"));
  }, [api]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const element = e.currentTarget;
    const f = new FormData(element);
    setBusy(true);
    setError("");
    try {
      const roles = await api.roleModelSettings();
      const configured = await api.configureSession({
        key: String(f.get("key")),
        model: roles.pearl,
        outputTokens: Number(f.get("outputTokens")),
      });
      setInfo(configured);
      element.reset();
    } catch {
      setError(
        "Could not save connection. Check the fields and wait for any active run.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings-card">
      <h2>Nebius connection</h2>
      <div
        className={`connection-status-banner ${info.configured ? "is-configured" : "is-unconfigured"}`}
        role="status"
      >
        {info.configured ? (
          <CircleCheck size={20} aria-hidden="true" />
        ) : (
          <Info size={20} aria-hidden="true" />
        )}
        <div>
          <strong>
            {info.configured ? "Connection saved" : "Connection not set up"}
          </strong>
          <p>
            {info.configured
              ? "Connectivity has not been checked. No model request was sent by saving. Teammate models are configured below."
              : "Add a key to connect Nebius. Teammate models are configured below. Saving does not send a model request."}
          </p>
        </div>
      </div>
      <form onSubmit={submit}>
        <label>
          API key
          <input
            name="key"
            type="password"
            autoComplete="off"
            required
            minLength={8}
            maxLength={4096}
          />
        </label>
        <details className="connection-advanced">
          <summary>Advanced request settings</summary>
          <label>
            Default output allowance for older workflows
            <input
              name="outputTokens"
              type="number"
              min={512}
              max={32768}
              step={1}
              defaultValue={info.configured ? info.outputTokens : 8192}
              required
            />
          </label>
        </details>
        <p className="muted">
          Key kept in memory for this app session only. Collaborative agents
          choose an output allowance for each request and make bounded retries
          when a response is incomplete. The advanced value seeds older runs.
          Requests have a 90-second deadline. Token allowances are not a
          currency spending cap.
        </p>
        <button className="primary" disabled={busy}>
          Save session connection
        </button>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
export function RunPanel({
  api,
  task,
  changes = false,
  team = initialTeam,
  settingsView = "full",
  hideConversation = false,
  onOpenSettings = () => {},
  onOpenMessageSettings = () => {},
  onAskPearl = () => {},
}: {
  api: DesktopAPI;
  task: Task;
  changes?: boolean;
  team?: Teammate[];
  settingsView?: "full" | "summary";
  hideConversation?: boolean;
  onOpenSettings?: (runId: string) => void;
  onOpenMessageSettings?: (runId: string) => void;
  onAskPearl?: () => void;
}) {
  const [history, setHistory] = useState<Run[]>([]);
  const [run, setRun] = useState<Run | null>(null);
  const [usage, setUsage] = useState<
    import("../shared/usage").UsageSnapshot | null
  >(null);
  const [source, setSource] = useState<SourceSelection | null>(null);
  const [kind, setKind] = useState<"new" | "existing">("new");
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [approved, setApproved] = useState(false);
  const [lineupDirty, setLineupDirty] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [connection, setConnection] = useState<SessionInfo | null>(null);
  useEffect(() => {
    setLineupDirty(false);
  }, [run?.id, run?.lineupProposal?.planRevision]);
  useEffect(() => {
    setUsage(null);
    if (!run) return;
    let active = true;
    api
      .usageForRun(run.id)
      .then((value) => {
        if (active) setUsage(value);
      })
      .catch(() => {
        if (active) setUsage(null);
      });
    return () => {
      active = false;
    };
  }, [api, run]);
  useEffect(() => {
    let active = true;
    api
      .session()
      .then((s) => {
        if (active) setConnection(s);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [api]);
  useEffect(() => {
    let active = true;
    const off = api.onRun((next) => {
      if (active && next.taskId === task.id) {
        setApproved(false);
        setLineupDirty(false);
        setRun(next);
        setHistory((h) => [next, ...h.filter((r) => r.id !== next.id)]);
      }
    });
    api
      .runs(task.id)
      .then((list) => {
        if (active) {
          setHistory(list);
          setRun(list[0] || null);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (active) {
          setError("Could not load runs.");
          setLoaded(true);
        }
      });
    return () => {
      active = false;
      off();
    };
  }, [api, task.id]);
  async function act(action: () => Promise<void>) {
    setError("");
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Operation failed. No retry was made.",
      );
    } finally {
      setBusy(false);
    }
  }
  const active =
    run && ["planning", "building", "auditing"].includes(run.status);
  const staleTask =
    !!run?.taskSnapshot &&
    (run.taskSnapshot.title !== task.title ||
      run.taskSnapshot.description !== task.description ||
      run.taskSnapshot.mode !== task.mode);
  const otherAttempts = run ? history.filter((item) => item.id !== run.id) : [];
  if (changes) {
    return (
      <ChangesPanel
        api={api}
        task={task}
        run={run}
        loaded={loaded}
        onAskPearl={onAskPearl}
      />
    );
  }
  if (
    run &&
    (run.collaboration ||
      task.mode === "work" ||
      (run.status === "planned" &&
        (!!run.approvedLineup || !!run.planning?.approved)))
  ) {
    return (
      <section className="run-panel" aria-label="Task execution">
        <h2>Project build</h2>
        <p>{task.description || task.title}</p>
        {!run.collaboration && !run.projectWorkspace && (
          <ProjectLocation api={api} run={run} onUpdated={setRun} />
        )}
        {run.plan && !run.collaboration && <RichText text={run.plan} />}
        <CollaborativeBuild
          api={api}
          run={run}
          onRun={setRun}
          onOpenSettings={
            onOpenSettings ? () => onOpenSettings(run.id) : undefined
          }
        />
        <p className="muted">
          {usage
            ? `${usage.measured} measured requests, ${usage.unknown} with unknown usage, ${usage.pending} pending. Reported tokens: ${usage.inputTokens + usage.outputTokens}.`
            : "Usage is unavailable."}
        </p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </section>
    );
  }
  return (
    <section className="run-panel" aria-label="Task execution">
      <h2>{changes ? "Changes & review" : "Your task has a home."}</h2>
      <p className="muted">{task.description || task.title}</p>
      {!loaded && <p role="status">Loading saved runs...</p>}
      {loaded && !run && (
        <>
          <p>
            Choose a clean new project or a selected source snapshot. Nothing is
            sent until you approve the run.
          </p>
          <fieldset>
            <legend>Project source</legend>
            <label className="radio-option">
              <input
                type="radio"
                checked={kind === "new"}
                onChange={() => setKind("new")}
              />{" "}
              New project
            </label>
            <label className="radio-option">
              <input
                type="radio"
                checked={kind === "existing"}
                onChange={() => setKind("existing")}
              />{" "}
              Existing project
            </label>
          </fieldset>
          {kind === "existing" && (
            <>
              <button
                className="secondary source-folder-button"
                disabled={busy}
                onClick={() =>
                  act(async () => {
                    const s = await api.selectSource();
                    if (s) {
                      setSource(s);
                      setSelected(s.files.map((file) => file.path));
                    }
                  })
                }
              >
                <FolderOpen size={16} /> Choose source folder
              </button>
              {source && (
                <>
                  <p>
                    {source.name}: {source.files.length} available text files.{" "}
                    {source.excluded} entries excluded.
                  </p>
                  <p className="muted">
                    Select only files you authorise sharing. This is a partial
                    snapshot, not a complete checkout. Hidden files, common
                    build/dependency folders, symlinks, binary/large files and
                    detected secrets are excluded. Custom ignore rules are not
                    interpreted; inspect content before selecting.
                  </p>
                  <div className="source-files">
                    {source.files.map((f) => (
                      <details key={f.path}>
                        <summary>
                          <label>
                            <input
                              type="checkbox"
                              checked={selected.includes(f.path)}
                              onChange={(e) =>
                                setSelected((v) =>
                                  e.target.checked
                                    ? [...v, f.path]
                                    : v.filter((p) => p !== f.path),
                                )
                              }
                            />
                            {f.path}
                          </label>
                        </summary>
                        <pre>{f.content}</pre>
                      </details>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
          <button
            className="primary prepare-button"
            disabled={
              busy || (kind === "existing" && (!source || !selected.length))
            }
            onClick={() =>
              act(async () => {
                const r = await api.prepareRun(
                  task.id,
                  kind === "new" ? null : source!.id,
                  kind === "new" ? [] : selected,
                  "direct",
                );
                setRun(r);
                setHistory((h) => [r, ...h]);
                setApproved(false);
              })
            }
          >
            Prepare project plan <ArrowRight size={15} />
          </button>
        </>
      )}
      {run && (
        <>
          <div className="run-meta">
            <span className="pill">{run.status}</span>
            <span>{run.sourceName}</span>
            <span>
              {run.calls}/{requestLimit(run)} requests
            </span>
          </div>
          {!active && ["prepared", "planned"].includes(run.status) && (
            <button
              className="secondary change-source-button"
              disabled={busy}
              onClick={() => {
                setRun(null);
                setSource(null);
                setSelected([]);
                setApproved(false);
              }}
            >
              Change project source
            </button>
          )}
          {staleTask && (
            <p role="alert" className="attention">
              Task details changed after this run was prepared. Prepare another
              attempt to review the new request.
            </p>
          )}
          <InFlightStatus run={run} team={team} />
          <SuggestionsPanel
            key={`suggestions-${run.id}`}
            run={run}
            api={api}
            team={team}
          />
          {run.redirection && task.mode !== "plan" && (
            <section className="settings-card">
              <h3>Revised plan context</h3>
              <p>
                From run {run.redirection.parentId.slice(0, 8)}. Review this
                context before upload. Earlier local notes are not included.
              </p>
              {run.redirection.instructions.map((text, i) => (
                <p key={i}>{text}</p>
              ))}
              <details>
                <summary>Previous plan and draft, for reference only</summary>
                <pre>{run.redirection.previousPlan || "No previous plan"}</pre>
                {run.redirection.previousDrafts.map((f) => (
                  <div key={f.path}>
                    <h4>{f.path}</h4>
                    <pre>{f.content}</pre>
                  </div>
                ))}
              </details>
            </section>
          )}
          {run.correction && (
            <section className="settings-card">
              <h3>Corrective attempt</h3>
              <p>
                Original run {run.correction.parentId.slice(0, 8)} · revision{" "}
                {run.correction.parentRevision.slice(0, 12)}
              </p>
              <p>
                {run.correction.finding.path}: {run.correction.finding.detail}
              </p>
              <p>
                Separate draft, at most two requests. Parent changes are
                preserved unless replaced by this correction. Original findings
                and decisions are not automatically resolved. Execution and
                application require fresh permission.
              </p>
              {run.correction.recheck && (
                <p>
                  Unchanged focused check: {run.correction.recheck.testPath}.
                  Test SHA-256: {run.correction.recheck.testSha256.slice(0, 12)}
                  .
                </p>
              )}
              {(() => {
                const comparison = compareCorrection(
                  history.find((item) => item.id === run.correction?.parentId),
                  run,
                );
                return (
                  <div aria-label="Correction check comparison">
                    <p>{comparison.detail}</p>
                    {comparison.baseline && (
                      <p>
                        Original: {comparison.baseline.status}.{" "}
                        {comparison.baseline.detail}
                      </p>
                    )}
                    {comparison.candidate && (
                      <p>
                        Correction: {comparison.candidate.status}.{" "}
                        {comparison.candidate.detail}
                      </p>
                    )}
                  </div>
                );
              })()}
              {history.some((item) => item.id === run.correction?.parentId) && (
                <button
                  className="secondary"
                  disabled={!!active}
                  onClick={() => {
                    setRun(
                      history.find(
                        (item) => item.id === run.correction?.parentId,
                      ) || null,
                    );
                    setApproved(false);
                  }}
                >
                  Review original finding
                </button>
              )}
              <details>
                <summary>Review parent draft shared for correction</summary>
                {run.correction.parentDrafts.map((f) => (
                  <div key={f.path}>
                    <h4>{f.path}</h4>
                    <pre>{f.content}</pre>
                  </div>
                ))}
              </details>
            </section>
          )}
          {["prepared", "planned"].includes(run.status) && (
            <div className="consent-card">
              <h3>
                {run.status === "planned"
                  ? "Review the plan, then approve building"
                  : task.mode === "plan"
                    ? "Start with a plan"
                    : "Review before starting"}
              </h3>
              {run.status === "prepared" && task.mode === "plan" && (
                <p>
                  Pearl will prepare a plan for your review. After planning
                  starts, you can discuss the task with your team.
                </p>
              )}
              {run.plan && settingsView !== "summary" && (
                <RichText text={run.plan} />
              )}
              {run.status === "planned" &&
                (!run.lineupProposal?.core || !!run.approvedLineup?.core) && (
                  <CoordinationPanel
                    key={`coordination-${run.id}`}
                    run={run}
                    team={team}
                    api={api}
                    invalidateConsent={() => setApproved(false)}
                  />
                )}
              {run.status === "planned" &&
                run.lineupProposal &&
                run.teamSnapshot && (
                  <LineupProposalPanel
                    key={`${run.id}:${run.lineupProposal.planRevision}`}
                    proposal={run.lineupProposal}
                    team={run.teamSnapshot.members}
                    approvedLineup={run.approvedLineup}
                    earlyReviews={!!run.coordination?.settings?.chunkReviews}
                    busy={busy}
                    onDraftChange={setLineupDirty}
                    onApprove={(entries, core) =>
                      act(async () => {
                        const updated = core
                          ? await api.approveLineup(
                              run.id,
                              run.lineupProposal!.planRevision,
                              entries,
                              true,
                              core,
                            )
                          : await api.approveLineup(
                              run.id,
                              run.lineupProposal!.planRevision,
                              entries,
                              true,
                            );
                        setRun(updated);
                        setApproved(false);
                        setLineupDirty(false);
                      })
                    }
                  />
                )}
              {run.status === "planned" && !lineupDirty && (
                <ConsultationPanel api={api} run={run} onUpdated={setRun} />
              )}
              {run.status === "planned" && !lineupDirty && (
                <ConsultationPanel
                  api={api}
                  run={run}
                  onUpdated={setRun}
                  phase="building"
                />
              )}
              {run.status === "planned" && !lineupDirty && (
                <AdviceHandoffPanel api={api} run={run} onUpdated={setRun} />
              )}
              {run.status === "planned" && (
                <ProjectLocation api={api} run={run} onUpdated={setRun} />
              )}
              <p>
                Shares this task, teammate instructions and {run.files.length}{" "}
                selected files with Nebius. No automatic upload of other project
                files. Credentials are used for authentication, not included in
                prompts.
              </p>
              {run.teamSnapshot && (
                <p>
                  Saved team for this run: {run.teamSnapshot.name} v
                  {run.teamSnapshot.version},{" "}
                  {run.teamSnapshot.members
                    .map((member) => member.name)
                    .join(", ")}
                  .
                </p>
              )}
              <details>
                <summary>Review exact source snapshot</summary>
                {run.files.length ? (
                  run.files.map((f) => (
                    <div key={f.path}>
                      <h4>{f.path}</h4>
                      <pre>{f.content}</pre>
                    </div>
                  ))
                ) : (
                  <p>No source files. New project.</p>
                )}
              </details>
              <p className="muted">
                {!run.correction &&
                (task.mode === "plan" || !!run.redirection) &&
                run.status === "prepared"
                  ? "One planning request, then pause for approval."
                  : run.coordination
                    ? "Two writer requests in parallel and one final auditor request."
                    : "One builder request and one auditor request."}{" "}
                {run.coordination &&
                  `The saved coordinator ceiling is ${requestLimit(run)} requests across this run; up to ${Math.max(0, requestLimit(run) - run.calls)} remain. ${run.coordination.settings?.chunkReviews ? "Includes up to two optional early chunk reviews." : "Early reviews are disabled."}`}{" "}
                Uses the saved run model and output limit shown in Run usage.
                {run.workspaceMode === "direct"
                  ? "Building writes reviewed proposals into the selected project folder. No shell commands run automatically."
                  : "Your source project stays untouched. No generated code or shell commands run."}
              </p>
              <label className="consent">
                <input
                  type="checkbox"
                  checked={approved}
                  disabled={staleTask}
                  onChange={(e) => setApproved(e.target.checked)}
                />{" "}
                I approve this upload and bounded credit use.
              </label>
              <button
                className="primary"
                disabled={
                  busy ||
                  !approved ||
                  lineupDirty ||
                  staleTask ||
                  (run.status === "planned" &&
                    run.workspaceMode === "direct" &&
                    !run.projectWorkspace) ||
                  !!run.consultations?.some(
                    (item) => item.status === "consulting",
                  ) ||
                  (run.status === "planned" &&
                    !!run.lineupProposal &&
                    run.approvedLineup?.planRevision !==
                      run.lineupProposal.planRevision)
                }
                onClick={() =>
                  act(async () => {
                    const r = await api.startRun(run.id, true);
                    setRun(r);
                    setApproved(false);
                  })
                }
              >
                <Play size={14} />
                {!run.correction &&
                (task.mode === "plan" || !!run.redirection) &&
                run.status === "prepared"
                  ? "Request plan"
                  : "Build and audit"}
              </button>
            </div>
          )}
          {settingsView === "full" && (
            <p className="muted" aria-label="Model token usage">
              {usage
                ? usage.requests === 0
                  ? "No model requests yet."
                  : `${usage.inputTokens.toLocaleString()} input + ${usage.outputTokens.toLocaleString()} output tokens reported across ${usage.measured} measured ${usage.measured === 1 ? "request" : "requests"}. ${usage.pending} pending (up to ${usage.pendingMaxOutputTokens.toLocaleString()} output tokens requested; input unknown). ${usage.unknown} ${usage.unknown === 1 ? "request has" : "requests have"} unknown usage.`
                : "Model token usage is unavailable."}
            </p>
          )}
          {settingsView === "summary" && (
            <h3 className="run-settings-heading">Run settings</h3>
          )}
          <div
            className={
              settingsView === "summary" ? "run-settings-summary" : undefined
            }
          >
            <UsagePolicyPanel
              run={run}
              mode={task.mode}
              session={connection}
              api={api}
              compact={settingsView === "summary"}
              onOpenSettings={() => onOpenSettings(run.id)}
              onUpdate={(next) => {
                setApproved(false);
                setRun(next);
                setHistory((items) => [
                  next,
                  ...items.filter((item) => item.id !== next.id),
                ]);
              }}
            />
            <UsageAlertsPanel
              run={run}
              usage={usage}
              api={api}
              compact={settingsView === "summary"}
              onOpenSettings={() => onOpenSettings(run.id)}
              onSaveTokens={() => {
                void act(async () => {
                  await api.saveTokensForRemaining(run.id);
                });
              }}
              onStop={() => {
                void act(async () => {
                  const replying = run.replies?.some(
                    (reply) => reply.status === "answering",
                  );
                  setRun(
                    replying && !active
                      ? await api.stopReply(run.id)
                      : await api.stopRun(run.id),
                  );
                });
              }}
            />
            <CostPanel
              run={run}
              api={api}
              compact={settingsView === "summary"}
              onOpenSettings={() => onOpenSettings(run.id)}
            />
          </div>
          {active && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                act(async () => {
                  setRun(await api.stopRun(run.id));
                })
              }
            >
              <Square size={14} /> Stop local coordination
            </button>
          )}
          {connection && (
            <p className="connection-info">
              {connection.configured
                ? run.planning
                  ? `Pearl: ${run.model || run.usagePolicy?.model || connection.model} · teammates use their saved role models · output allowance adapts to each model`
                  : `Pearl: ${run.model || run.usagePolicy?.model || connection.model} · teammates use their saved role models · up to ${run.usagePolicy?.outputTokens || connection.outputTokens} output tokens per request`
                : "Configure a Nebius session in Settings before starting."}
            </p>
          )}
          {hideConversation && <BuildActivity run={run} />}
          {!hideConversation && (
            <div className="run-events" aria-live="polite">
              {run.events.map((e, i) => (
                <article key={i} className={`run-event actor-${e.actor}`}>
                  {e.actor !== "system" && (
                    <span
                      className="event-portrait portrait"
                      style={portraitStyle(
                        e.actorPortraitId ||
                          team.find((person) => person.id === e.actor)
                            ?.portraitId ||
                          initialTeam.find((person) => person.id === e.actor)
                            ?.portraitId ||
                          initialTeam[0].portraitId,
                      )}
                    />
                  )}
                  <strong>
                    {e.actor === "system"
                      ? "Scully"
                      : `${e.actorName || team.find((t) => t.id === e.actor)?.name || e.actor} · ${e.actorRole || team.find((t) => t.id === e.actor)?.role || e.actor}`}
                  </strong>
                  <time>{new Date(e.at).toLocaleTimeString()}</time>
                  <p>{e.text}</p>
                </article>
              ))}
            </div>
          )}
          {!hideConversation && run.status !== "prepared" && (
            <TeamMessages
              key={`messages-${run.id}`}
              run={run}
              api={api}
              team={team}
              onOpenSettings={() => onOpenMessageSettings(run.id)}
            />
          )}
          {run.error && (
            <p className="error" role="alert">
              {run.error}
            </p>
          )}
          {run.status !== "prepared" && run.status !== "planned" && (
            <CoordinationPanel
              key={`coordination-${run.id}`}
              run={run}
              team={team}
              api={api}
              invalidateConsent={() => setApproved(false)}
            />
          )}
          {run.status === "complete" && (
            <ConsultationPanel api={api} run={run} onUpdated={setRun} />
          )}
          {!!run.drafts.length && (
            <SpecialistPanel
              key={`specialist-${run.id}`}
              run={run}
              api={api}
              relatedRuns={history}
              team={team}
            />
          )}
          {!!run.checks.length && (
            <div className="settings-card">
              <h3>Checks actually performed</h3>
              <ul>
                {run.checks.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          )}
          {!!run.findings.length && (
            <div className="settings-card">
              <h3>Auditor findings · not independently verified</h3>
              {run.findings.map((f, i) => (
                <p key={i}>
                  <strong>
                    {f.severity}: {f.path}
                  </strong>
                  <br />
                  {f.detail}
                </p>
              ))}
            </div>
          )}
          {!!run.commands?.length && (
            <section className="settings-card" aria-label="Command review">
              <h3>Proposed checks</h3>
              <p>
                Review each command separately. These decisions are recorded
                only: recording approval here does not execute anything.
                Approval expires when the app restarts. Local execution requires
                fresh permission below.
              </p>
              <p className="muted">
                Intended location: a private local copy of this draft, not your
                source folder. A local copy is not a security sandbox. Programs
                and project scripts can access your computer and network with
                your account permissions. Argument text is not a safety
                guarantee.
              </p>
              {run.commands.map((command, index) => (
                <article className="command-proposal" key={command.id}>
                  <h4>
                    Check {index + 1}: {command.executable}
                  </h4>
                  <p>{command.reason}</p>
                  {command.findingLink && (
                    <p>
                      Specialist finding {command.findingLink.findingIndex + 1}{" "}
                      in {command.findingLink.path}. Expected observations:{" "}
                      {command.findingLink.expected}
                    </p>
                  )}
                  <pre>
                    {JSON.stringify(
                      {
                        executable: command.executable,
                        arguments: command.args,
                        workingDirectory:
                          command.cwd === "."
                            ? "(private draft root)"
                            : command.cwd,
                        timeoutSeconds: command.timeoutSeconds,
                      },
                      null,
                      2,
                    )}
                  </pre>
                  <p>
                    Draft: <code>{command.revision.slice(0, 12)}</code> ·
                    Decision: {command.decision} · Not executed
                  </p>
                  {command.decidedAt && (
                    <p className="muted">
                      Recorded {new Date(command.decidedAt).toLocaleString()}
                    </p>
                  )}
                  {run.status === "complete" &&
                    (command.decision === "pending" ||
                      command.decision === "approved") && (
                      <div className="command-actions">
                        {command.decision === "pending" && (
                          <button
                            className="secondary"
                            disabled={busy}
                            onClick={() =>
                              act(async () => {
                                setRun(
                                  await api.decideCommand(
                                    run.id,
                                    command.id,
                                    command.revision,
                                    "approved",
                                  ),
                                );
                              })
                            }
                          >
                            Record approval for check {index + 1}
                          </button>
                        )}
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() =>
                            act(async () => {
                              setRun(
                                await api.decideCommand(
                                  run.id,
                                  command.id,
                                  command.revision,
                                  "denied",
                                ),
                              );
                            })
                          }
                        >
                          {command.decision === "approved"
                            ? "Revoke approval"
                            : `Deny check ${index + 1}`}
                        </button>
                      </div>
                    )}
                </article>
              ))}
            </section>
          )}
          {!!run.drafts.length && (
            <div className="drafts">
              <h3>Isolated file changes</h3>
              <p className="muted">
                Before and after from this exact snapshot. See the application
                record below for destination write status.
              </p>
              {run.drafts.map((f) => (
                <details key={f.path}>
                  <summary>
                    {f.before === null ? "Added" : "Changed"} · {f.path}
                  </summary>
                  <div className="diff-columns">
                    <section>
                      <h4>Before</h4>
                      <pre>{f.before ?? "(New file)"}</pre>
                    </section>
                    <section>
                      <h4>After</h4>
                      <pre>{f.content}</pre>
                    </section>
                  </div>
                </details>
              ))}
            </div>
          )}
          {!!run.commands?.length && (
            <>
              <ExecutionPanel key={run.id} api={api} run={run} />
              <CloudPanel key={`${run.id}-cloud`} api={api} run={run} />
            </>
          )}
          {!!run.drafts.length && (
            <ApplyPanel key={`apply-${run.id}`} api={api} run={run} />
          )}
          {!active &&
            !["prepared", "planned", "awaiting_input"].includes(run.status) && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() => {
                  setRun(null);
                  setSource(null);
                  setSelected([]);
                  setApproved(false);
                }}
              >
                Prepare another attempt
              </button>
            )}
        </>
      )}
      {otherAttempts.length > 0 && (
        <details>
          <summary>Other attempts ({otherAttempts.length})</summary>
          <p>
            Preparing a project source saves an attempt for this task. A
            prepared attempt has not started model work.
          </p>
          {otherAttempts.map((r) => (
            <button
              className="secondary"
              key={r.id}
              disabled={!!active}
              onClick={() => {
                setRun(r);
                setApproved(false);
              }}
            >
              {r.sourceName} · {r.status} · {r.calls} model{" "}
              {r.calls === 1 ? "request" : "requests"} · {r.id.slice(0, 8)}
            </button>
          ))}
        </details>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
