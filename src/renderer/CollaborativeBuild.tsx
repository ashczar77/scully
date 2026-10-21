import { useEffect, useState } from "react";
import type { DesktopAPI } from "../shared/contracts";
import type { Run } from "../shared/runs";
import { characterCatalog } from "../shared/character-catalog";
import { RichText } from "./RichText";
import { PlannedBuild } from "./PlannedBuild";

type ScopeReview = Awaited<ReturnType<DesktopAPI["reviewCollaboration"]>>;
type SyncReview = Awaited<ReturnType<DesktopAPI["reviewCollaborationSync"]>>;
type DispatchReview = {
  token: string;
  teammate: { name: string; permissions: string[] };
  checkpoint: string;
  projectPath: string;
  mode: string;
};
const checks = [
  { label: "npm test", value: '["npm","test"]' },
  { label: "npm run build", value: '["npm","run","build"]' },
  { label: "npm run typecheck", value: '["npm","run","typecheck"]' },
  { label: "npm run format:check", value: '["npm","run","format:check"]' },
  { label: "npm run lint", value: '["npm","run","lint"]' },
];

export function CollaborativeBuild({
  api,
  run,
  onRun,
  onOpenSettings,
}: {
  api: DesktopAPI;
  run: Run;
  onRun: (run: Run) => void;
  onOpenSettings?: () => void;
}) {
  if (run.planning?.approved)
    return (
      <PlannedBuild
        api={api}
        run={run}
        onRun={onRun}
        onOpenSettings={onOpenSettings}
      />
    );
  return (
    <LegacyCollaborativeBuild
      api={api}
      run={run}
      onRun={onRun}
      onOpenSettings={onOpenSettings}
    />
  );
}

function LegacyCollaborativeBuild({
  api,
  run,
  onRun,
  onOpenSettings,
}: {
  api: DesktopAPI;
  run: Run;
  onRun: (run: Run) => void;
  onOpenSettings?: () => void;
}) {
  const [cloud, setCloud] = useState<{
    configured: boolean;
    projectId: string;
  } | null>(null);
  const [images, setImages] = useState<{ uuid: string; tag: string }[]>([]);
  const [mode, setMode] = useState<"sandbox" | "local" | "">("");
  const [baseImageId, setBaseImageId] = useState("");
  const [approvedChecks, setApprovedChecks] = useState<string[]>([]);
  const [review, setReview] = useState<ScopeReview | null>(null);
  const [sync, setSync] = useState<SyncReview | null>(null);
  const [dispatch, setDispatch] = useState<DispatchReview | null>(null);
  const [specialist, setSpecialist] = useState("");
  const [specialistEdit, setSpecialistEdit] = useState(false);
  const [redirecting, setRedirecting] = useState<string | null>(null);
  const [guidance, setGuidance] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    void api
      .cloudSession()
      .then((value) => {
        if (!live) return;
        setCloud(value);
        setMode(value.configured ? "sandbox" : "");
        if (value.configured)
          void api
            .cloudImages("")
            .then((catalog) => {
              if (!live) return;
              setImages(catalog.images);
              const preferred =
                catalog.images.find((image) => /node/i.test(image.tag)) ||
                catalog.images[0];
              setBaseImageId(preferred?.uuid || "");
            })
            .catch(() => {
              if (live)
                setError(
                  "Sandbox images could not be loaded. Configure access or choose local-only.",
                );
            });
      })
      .catch(() => {
        if (live) setError("Sandbox connection status is unavailable.");
      });
    return () => {
      live = false;
    };
  }, [api, run.id]);
  async function act(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The action failed. Review the current state before retrying.",
      );
    } finally {
      setBusy(false);
    }
  }
  const state = run.collaboration;
  const available = characterCatalog.filter(
    (item) =>
      item.role === "specialist" &&
      !state?.members.some((person) => person.id === item.id),
  );
  return (
    <section className="collaborative-build" aria-label="Collaborative build">
      <h3>Collaborative build</h3>
      {!state ? (
        <>
          <p>
            The selected local folder is the source of truth. Review its upload
            and execution scope before the team starts.
          </p>
          <p>
            <strong>Selected folder:</strong>{" "}
            {run.projectWorkspace?.path || "Choose a project folder"}
          </p>
          <fieldset>
            <legend>Work environment</legend>
            <label>
              <input
                type="radio"
                name={`environment-${run.id}`}
                checked={mode === "sandbox"}
                disabled={!cloud?.configured}
                onChange={() => {
                  setMode("sandbox");
                  setReview(null);
                }}
              />{" "}
              Nebius Sandboxes{" "}
              {cloud?.configured ? "(recommended)" : "(configure in Settings)"}
            </label>
            <label>
              <input
                type="radio"
                name={`environment-${run.id}`}
                checked={mode === "local"}
                onChange={() => {
                  setMode("local");
                  setReview(null);
                }}
              />{" "}
              Local-only, no project upload to Sandboxes
            </label>
          </fieldset>
          {mode === "sandbox" && (
            <label>
              Starting Sandbox image
              <select
                value={baseImageId}
                onChange={(event) => {
                  setBaseImageId(event.target.value);
                  setReview(null);
                }}
              >
                <option value="">Choose an image</option>
                {images.map((image) => (
                  <option key={image.uuid} value={image.uuid}>
                    {image.tag}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!cloud?.configured && (
            <p role="status">
              Nebius Sandboxes are not configured. Configure them in Settings,
              or explicitly choose local-only work.
            </p>
          )}
          <fieldset>
            <legend>Checks the team may run inside this scope</legend>
            {checks.map((check) => (
              <label key={check.value}>
                <input
                  type="checkbox"
                  checked={approvedChecks.includes(check.value)}
                  onChange={(event) => {
                    setReview(null);
                    setApprovedChecks((items) =>
                      event.target.checked
                        ? [...items, check.value]
                        : items.filter((item) => item !== check.value),
                    );
                  }}
                />{" "}
                {check.label}
              </label>
            ))}
          </fieldset>
          <button
            className="secondary"
            disabled={
              busy ||
              !run.projectWorkspace ||
              !mode ||
              (mode === "sandbox" && !baseImageId)
            }
            onClick={() =>
              void act(async () => {
                setReview(
                  await api.reviewCollaboration(run.id, {
                    mode: mode as "sandbox" | "local",
                    baseImageId: mode === "sandbox" ? baseImageId : null,
                    checks: approvedChecks,
                  }),
                );
              })
            }
          >
            Review project scope
          </button>
          {review && (
            <div
              className="collaboration-review"
              role="region"
              aria-label="Approved scope preview"
            >
              <h4>Project scope</h4>
              <p>
                {review.projectPath} ·{" "}
                {review.mode === "sandbox"
                  ? `Nebius project ${review.projectId}`
                  : "Local-only processes run on this computer"}
              </p>
              {review.baseImageId && (
                <p>Starting image: {review.baseImageId}</p>
              )}
              <details open>
                <summary>
                  Files in the approved snapshot ({review.manifest.length})
                </summary>
                <ul>
                  {review.manifest.map((file) => (
                    <li key={file.path}>
                      {file.path} · {file.bytes} bytes · SHA-256{" "}
                      {file.sha256.slice(0, 12)}
                    </li>
                  ))}
                </ul>
              </details>
              <p>
                Teammates:{" "}
                {review.members
                  .map(
                    (person) =>
                      `${person.id} (${person.permissions.join(", ")})`,
                  )
                  .join("; ")}
              </p>
              <p>
                Checks:{" "}
                {review.checks.length
                  ? review.checks
                      .map((item) => JSON.parse(item).join(" "))
                      .join(", ")
                  : "none approved"}
              </p>
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    onRun(await api.approveCollaboration(review.token, true));
                    setReview(null);
                  })
                }
              >
                Approve and start team
              </button>
            </div>
          )}
          {onOpenSettings && (
            <button className="text-button" onClick={onOpenSettings}>
              Open connection settings
            </button>
          )}
        </>
      ) : (
        <>
          <p>
            <strong>
              {state.scope.mode === "sandbox"
                ? "Nebius Sandbox branches"
                : "Local-only branches"}
            </strong>{" "}
            · {state.status} · selected folder {state.scope.projectPath}
          </p>
          {state.scope.mode === "sandbox" && (
            <p>Base image: {state.baseImageId || "Preparing"}</p>
          )}
          {state.scope.mode === "sandbox" && (
            <p className="muted">
              Sandbox account limits and operation cost are unavailable in this
              view. A completed operation does not verify the requested fix.
            </p>
          )}
          <div className="collaboration-members">
            {state.members.map((person) => (
              <article key={person.id} className="settings-card">
                <h4>
                  {person.name} <small>{person.status}</small>
                </h4>
                <p>
                  {person.role} · checkpoint {person.headId.slice(0, 12)} ·{" "}
                  {person.model}
                </p>
                {person.status === "paused" && (
                  <>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        void act(async () =>
                          onRun(await api.continueTeammate(run.id, person.id)),
                        )
                      }
                    >
                      Continue
                    </button>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => {
                        setRedirecting(person.id);
                        setGuidance("");
                      }}
                    >
                      Redirect
                    </button>
                  </>
                )}
                {redirecting === person.id && (
                  <div>
                    <label>
                      Guidance for {person.name}
                      <textarea
                        value={guidance}
                        onChange={(event) => setGuidance(event.target.value)}
                      />
                    </label>
                    <button
                      disabled={busy || !guidance.trim()}
                      onClick={() =>
                        void act(async () => {
                          onRun(
                            await api.continueTeammate(
                              run.id,
                              person.id,
                              guidance,
                            ),
                          );
                          setRedirecting(null);
                        })
                      }
                    >
                      Send redirect
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
          <h4>Operations and checkpoints</h4>
          {state.status === "paused" && !state.prepared && (
            <button
              className="secondary"
              disabled={
                busy ||
                state.operations.some((item) => item.status === "unknown")
              }
              onClick={() =>
                void act(async () =>
                  onRun(await api.continueTeammate(run.id, "system")),
                )
              }
            >
              Retry project preparation
            </button>
          )}
          {state.status === "paused" &&
            state.prepared &&
            state.scope.mode === "sandbox" &&
            !state.integration.conflicts.length &&
            !state.checkpoints.find(
              (item) => item.id === state.integration.headId,
            )?.imageId && (
              <button
                className="secondary"
                disabled={
                  busy ||
                  state.operations.some((item) => item.status === "unknown")
                }
                onClick={() =>
                  void act(async () =>
                    onRun(await api.continueTeammate(run.id, "system")),
                  )
                }
              >
                Retry integration image
              </button>
            )}
          <ul>
            {state.operations.slice(-30).map((operation) => (
              <li key={operation.id}>
                {operation.actor}: {operation.stage} · {operation.status} ·
                input {operation.inputRevision.slice(0, 12)}
                {operation.status === "unknown" && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void act(async () =>
                        onRun(
                          await api.reconcileCollaboration(
                            run.id,
                            operation.id,
                          ),
                        ),
                      )
                    }
                  >
                    Inspect remote status
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p>
            Integration: {state.integration.headId.slice(0, 12)} · audit{" "}
            {state.auditedHeadId?.slice(0, 12) || "pending"}
          </p>
          {state.integration.conflicts.length > 0 && (
            <div role="alert">
              <h4>Integration conflicts</h4>
              <ul>
                {state.integration.conflicts.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {state.auditedHeadId === state.integration.headId &&
            state.synchronizedHeadId !== state.integration.headId && (
              <>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void act(async () =>
                      setSync(await api.reviewCollaborationSync(run.id)),
                    )
                  }
                >
                  Review synchronization
                </button>
                {sync && (
                  <div className="collaboration-review">
                    <h4>Synchronize reviewed files</h4>
                    <p>
                      {sync.projectPath} · revision {sync.revision.slice(0, 12)}
                    </p>
                    <ul>
                      {sync.files.map((file) => (
                        <li key={file}>{file}</li>
                      ))}
                    </ul>
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          onRun(
                            await api.approveCollaborationSync(
                              sync.token,
                              true,
                            ),
                          );
                          setSync(null);
                        })
                      }
                    >
                      Apply to selected folder
                    </button>
                  </div>
                )}
              </>
            )}
          {available.length > 0 && (
            <div className="collaboration-dispatch">
              <h4>Bring in a specialist</h4>
              <label>
                Specialist{" "}
                <select
                  value={specialist}
                  onChange={(event) => setSpecialist(event.target.value)}
                >
                  <option value="">Choose specialist</option>
                  {available.map((person) => (
                    <option value={person.id} key={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={specialistEdit}
                  onChange={(event) => setSpecialistEdit(event.target.checked)}
                />{" "}
                Request edit and check authority
              </label>
              <button
                className="secondary"
                disabled={busy || !specialist}
                onClick={() =>
                  void act(async () =>
                    setDispatch(
                      (await api.reviewSpecialistDispatch(
                        run.id,
                        specialist,
                        specialistEdit
                          ? ["read", "edit", "check"]
                          : ["read", "audit"],
                      )) as DispatchReview,
                    ),
                  )
                }
              >
                Review dispatch
              </button>
              {dispatch && (
                <div className="collaboration-review">
                  <p>
                    {dispatch.teammate.name} joins {dispatch.mode} from{" "}
                    {dispatch.checkpoint.slice(0, 12)} in {dispatch.projectPath}{" "}
                    with {dispatch.teammate.permissions.join(", ")} access.
                  </p>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        onRun(
                          await api.approveSpecialistDispatch(
                            dispatch.token,
                            true,
                          ),
                        );
                        setDispatch(null);
                      })
                    }
                  >
                    Approve specialist
                  </button>
                </div>
              )}
            </div>
          )}
          <details>
            <summary>Diagnostics</summary>
            {state.events
              .filter((event) => event.kind === "diagnostic")
              .map((event) => (
                <div key={event.id} role="status">
                  <strong>
                    {event.actor} · {event.code}
                  </strong>
                  <RichText text={event.text} />
                  <small>Revision {event.revision.slice(0, 12)}</small>
                </div>
              ))}
          </details>
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
