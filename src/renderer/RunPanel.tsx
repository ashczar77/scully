import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowRight,
  FolderOpen,
  Play,
  Square,
  ShieldCheck,
} from "lucide-react";
import {
  initialTeam,
  type DesktopAPI,
  type Task,
  type Teammate,
} from "../shared/contracts";
import portraits from "../../assets/team-portraits.png";
import type { Run, SourceSelection, SessionInfo } from "../shared/runs";
import { ExecutionPanel } from "./ExecutionPanel";
import { CloudPanel } from "./CloudPanel";
import { ApplyPanel } from "./ApplyPanel";
import { CoordinationPanel } from "./CoordinationPanel";
import { TeamMessages } from "./TeamMessages";
import { SuggestionsPanel } from "./SuggestionsPanel";
import { SpecialistPanel } from "./SpecialistPanel";
import { requestLimit } from "../shared/coordination";
import { compareCorrection } from "../shared/correction-evidence";
import { InFlightStatus } from "./InFlightStatus";
export function ConnectionSettings({ api }: { api: DesktopAPI }) {
  const [info, setInfo] = useState<SessionInfo>({
    configured: false,
    model: "",
    outputTokens: 2048,
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api
      .session()
      .then(setInfo)
      .catch(() => setError("Could not read connection status"));
  }, [api]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const element = e.currentTarget;
    const f = new FormData(element);
    setBusy(true);
    setError("");
    try {
      setInfo(
        await api.configureSession({
          key: String(f.get("key")),
          model: String(f.get("model")),
          outputTokens: Number(f.get("outputTokens")),
        }),
      );
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
      <p>
        {info.configured
          ? `Configured for ${info.model}. Not yet a connectivity check.`
          : "Not configured. No requests have been sent."}
      </p>
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
        <label>
          Model ID
          <input
            name="model"
            placeholder="Exact model ID from Token Factory"
            defaultValue={info.model}
            required
            maxLength={160}
          />
        </label>
        <label>
          Maximum output tokens per request
          <input
            name="outputTokens"
            type="number"
            min={512}
            max={4096}
            step={1}
            defaultValue={info.outputTokens}
            required
          />
        </label>
        <p className="muted">
          Key kept in memory for this app session only. New team runs make at
          most 4 requests, or 6 with optional early reviews, each with a
          90-second deadline and no retries. Token limits are not a currency
          spending cap. Confirm free credits and account billing limits before
          starting.
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
}: {
  api: DesktopAPI;
  task: Task;
  changes?: boolean;
  team?: Teammate[];
}) {
  const [history, setHistory] = useState<Run[]>([]);
  const [run, setRun] = useState<Run | null>(null);
  const [source, setSource] = useState<SourceSelection | null>(null);
  const [kind, setKind] = useState<"new" | "existing">("new");
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [approved, setApproved] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [connection, setConnection] = useState<SessionInfo | null>(null);
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
                className="secondary"
                disabled={busy}
                onClick={() =>
                  act(async () => {
                    const s = await api.selectSource();
                    if (s) {
                      setSource(s);
                      setSelected([]);
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
            className="primary"
            disabled={
              busy || (kind === "existing" && (!source || !selected.length))
            }
            onClick={() =>
              act(async () => {
                const r = await api.prepareRun(
                  task.id,
                  kind === "new" ? null : source!.id,
                  kind === "new" ? [] : selected,
                );
                setRun(r);
                setHistory((h) => [r, ...h]);
                setApproved(false);
              })
            }
          >
            Prepare private workspace <ArrowRight size={15} />
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
          <InFlightStatus run={run} team={team} />
          <TeamMessages
            key={`messages-${run.id}`}
            run={run}
            api={api}
            team={team}
          />
          <SuggestionsPanel key={`suggestions-${run.id}`} run={run} api={api} />
          {run.redirection && (
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
                  : "Review before starting"}
              </h3>
              {run.plan && <pre>{run.plan}</pre>}
              <p>
                Shares this task, teammate instructions and {run.files.length}{" "}
                selected files with Nebius. No automatic upload of other project
                files. Credentials are used for authentication, not included in
                prompts.
              </p>
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
                  `Start working uses at most ${requestLimit(run) - 1} requests. Plan first adds one planning request, for at most ${requestLimit(run)} total. ${run.coordination.settings?.chunkReviews ? "Includes up to two early chunk reviews." : "Early reviews are disabled."}`}{" "}
                Uses the model and output limit configured in Settings. Your
                source project stays untouched. No generated code or shell
                commands run.
              </p>
              <label className="consent">
                <input
                  type="checkbox"
                  checked={approved}
                  onChange={(e) => setApproved(e.target.checked)}
                />{" "}
                I approve this upload and bounded credit use.
              </label>
              <button
                className="primary"
                disabled={busy || !approved}
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
                ? `Session model: ${connection.model} · up to ${connection.outputTokens} output tokens per request`
                : "Configure a Nebius session in Settings before starting."}
            </p>
          )}
          <div className="run-events" aria-live="polite">
            {run.events.map((e, i) => (
              <article key={i} className={`run-event actor-${e.actor}`}>
                {e.actor !== "system" && (
                  <span
                    className="event-portrait portrait"
                    style={{
                      backgroundImage: `url(${portraits})`,
                      backgroundPosition:
                        e.actor === "maya"
                          ? "0% center"
                          : e.actor === "jun"
                            ? "100% center"
                            : "50% center",
                    }}
                  />
                )}
                <strong>
                  {e.actor === "system"
                    ? "Scully"
                    : `${team.find((t) => t.id === e.actor)?.name || e.actor} · ${e.actor === "maya" ? "Builder" : e.actor === "jun" ? "Test engineer" : "Auditor"}`}
                </strong>
                <time>{new Date(e.at).toLocaleTimeString()}</time>
                <p>{e.text}</p>
              </article>
            ))}
          </div>
          {run.error && (
            <p className="error" role="alert">
              {run.error}
            </p>
          )}
          <CoordinationPanel
            key={`coordination-${run.id}`}
            run={run}
            team={team}
            api={api}
            invalidateConsent={() => setApproved(false)}
          />
          {!!run.drafts.length && (
            <SpecialistPanel
              key={`specialist-${run.id}`}
              run={run}
              api={api}
              relatedRuns={history}
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
          {!active && !["prepared", "planned"].includes(run.status) && (
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
      {history.length > 1 && (
        <details>
          <summary>Previous runs ({history.length})</summary>
          {history.map((r) => (
            <button
              className="secondary"
              key={r.id}
              disabled={!!active}
              onClick={() => {
                setRun(r);
                setApproved(false);
              }}
            >
              {r.id.slice(0, 8)} · {r.status}
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
