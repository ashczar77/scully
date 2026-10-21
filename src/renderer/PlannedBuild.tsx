import { useEffect, useState } from "react";
import type { DesktopAPI } from "../shared/contracts";
import type { Run } from "../shared/runs";

type Recommendation = Awaited<ReturnType<DesktopAPI["recommendEnvironments"]>>;
type Review = Awaited<ReturnType<DesktopAPI["reviewCollaboration"]>>;
type LocalReview = Awaited<ReturnType<DesktopAPI["reviewLocalFallback"]>>;
type SyncReview = Awaited<ReturnType<DesktopAPI["reviewCollaborationSync"]>>;
type ProposalReview = Awaited<ReturnType<DesktopAPI["reviewDispatchProposal"]>>;

export function PlannedBuild({
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
  const [connected, setConnected] = useState(false);
  const [mode, setMode] = useState<"sandbox" | "local">("sandbox");
  const [recommendation, setRecommendation] = useState<Recommendation | null>(
    null,
  );
  const [review, setReview] = useState<Review | null>(null);
  const [localReview, setLocalReview] = useState<LocalReview | null>(null);
  const [syncReview, setSyncReview] = useState<SyncReview | null>(null);
  const [proposalReview, setProposalReview] = useState<ProposalReview | null>(
    null,
  );
  const [redirect, setRedirect] = useState<string | null>(null);
  const [guidance, setGuidance] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    void api
      .cloudSession()
      .then((value) => {
        if (live) {
          setConnected(value.configured);
          setMode(value.configured ? "sandbox" : "local");
        }
      })
      .catch(() => {
        if (live) setMode("local");
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
          : "The action could not complete. Review the current checkpoint and retry.",
      );
    } finally {
      setBusy(false);
    }
  }
  const assignments = run.planning?.approved?.assignments || [];
  const state = run.collaboration;
  return (
    <section className="planned-build" aria-label="Collaborative build">
      <header className="planned-build-header">
        <div>
          <h3>Team workspace</h3>
          <p>
            Each teammate works from the approved source and publishes
            inspectable checkpoints.
          </p>
        </div>
        <span className="status-pill">
          {state?.status || "Ready for review"}
        </span>
      </header>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {!state ? (
        <>
          <div
            className="planned-mode"
            role="group"
            aria-label="Project execution environment"
          >
            <button
              type="button"
              className={mode === "sandbox" ? "selected" : ""}
              disabled={!connected || busy}
              onClick={() => {
                setMode("sandbox");
                setRecommendation(null);
                setReview(null);
              }}
            >
              Nebius Sandboxes <small>Recommended</small>
            </button>
            <button
              type="button"
              className={mode === "local" ? "selected" : ""}
              disabled={busy}
              onClick={() => {
                setMode("local");
                setRecommendation(null);
                setReview(null);
              }}
            >
              Local only <small>No Sandbox upload</small>
            </button>
          </div>
          {!connected && (
            <p role="status">
              Sandboxes are not configured. You can configure access in Settings
              or review local work.
            </p>
          )}
          <div className="planned-assignment-list">
            {assignments.map((assignment) => {
              const match = recommendation?.selections.find(
                (item) => item.memberId === assignment.memberId,
              );
              return (
                <article
                  key={assignment.memberId}
                  className="planned-assignment"
                >
                  <h4>
                    {assignment.memberId} <small>{assignment.role}</small>
                  </h4>
                  <p>{assignment.objective}</p>
                  <p className="muted">
                    Needs{" "}
                    {assignment.environment.tools.join(", ") ||
                      "no project executable"}
                    . {assignment.environment.reason}
                  </p>
                  {match && (
                    <p
                      className={
                        match.imageId
                          ? "environment-match"
                          : "environment-missing"
                      }
                    >
                      {match.imageTag || "Local fallback needed"}:{" "}
                      {match.reason}
                    </p>
                  )}
                </article>
              );
            })}
          </div>
          {mode === "sandbox" && (
            <button
              className="secondary"
              disabled={busy || !connected}
              onClick={() =>
                void act(async () => {
                  setRecommendation(await api.recommendEnvironments(run.id));
                  setReview(null);
                })
              }
            >
              Inspect compatible images
            </button>
          )}
          {recommendation?.catalogLimited && (
            <p role="status">
              The returned image catalog is limited. Verify availability again
              if a required image is missing.
            </p>
          )}
          <button
            className="primary"
            disabled={
              busy ||
              !run.projectWorkspace ||
              (mode === "sandbox" && !recommendation)
            }
            onClick={() =>
              void act(async () =>
                setReview(
                  await api.reviewCollaboration(run.id, {
                    mode,
                    environmentToken: recommendation?.token,
                  }),
                ),
              )
            }
          >
            Review project and team scope
          </button>
          {review && (
            <div
              className="collaboration-review"
              role="region"
              aria-label="Approved scope preview"
            >
              <h4>Review the work scope</h4>
              <p>
                {review.projectPath} ·{" "}
                {review.mode === "sandbox"
                  ? `Nebius project ${review.projectId}`
                  : "Local processes on this computer"}
              </p>
              <details>
                <summary>Source files ({review.manifest.length})</summary>
                <ul>
                  {review.manifest.map((file) => (
                    <li key={file.path}>
                      {file.path} · {file.bytes} bytes
                    </li>
                  ))}
                </ul>
              </details>
              <div className="planned-assignment-list">
                {review.members
                  .filter((item) => item.id !== "pearl")
                  .map((person) => {
                    const env = review.environments?.[person.id];
                    return (
                      <p key={person.id}>
                        <strong>{person.id}</strong>:{" "}
                        {person.permissions.join(", ")} ·{" "}
                        {env?.mode || review.mode}
                        {env?.imageId ? ` · image ${env.imageId}` : ""}
                        {env?.mode === "local" && !env.localApproved
                          ? " · needs a separate local approval"
                          : ""}
                      </p>
                    );
                  })}
              </div>
              <p>
                Approved checks:{" "}
                {review.checks.length
                  ? review.checks
                      .map((item) => JSON.parse(item).join(" "))
                      .join(", ")
                  : "none"}
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
                Approve and start the team
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
          {(state.staffingRequests || []).some(
            (item) => item.status === "open",
          ) && (
            <div className="collaboration-review">
              <h4>Teammates requested help</h4>
              {(state.staffingRequests || [])
                .filter((item) => item.status === "open")
                .map((item) => (
                  <p key={item.id}>
                    <strong>{item.requester}:</strong> {item.need}
                    <br />
                    <span className="muted">Evidence: {item.evidence}</span>
                  </p>
                ))}
            </div>
          )}
          {(state.dispatchProposals || []).some(
            (item) => item.status === "pending",
          ) && (
            <div className="collaboration-review">
              <h4>Team additions for review</h4>
              {(state.dispatchProposals || [])
                .filter((item) => item.status === "pending")
                .map((item) => (
                  <article key={item.id} className="planned-assignment">
                    <h5>
                      {item.assignment.memberId} · {item.assignment.role}
                    </h5>
                    <p>{item.rationale}</p>
                    <p>{item.assignment.objective}</p>
                    <p className="muted">
                      Evidence: {item.assignment.evidence}
                    </p>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        void act(async () =>
                          setProposalReview(
                            await api.reviewDispatchProposal(run.id, item.id),
                          ),
                        )
                      }
                    >
                      Review addition
                    </button>
                  </article>
                ))}
            </div>
          )}
          {proposalReview && (
            <div
              className="collaboration-review"
              role="region"
              aria-label="Teammate addition review"
            >
              <h4>Bring in {proposalReview.proposal.assignment.memberId}</h4>
              <p>{proposalReview.proposal.rationale}</p>
              <p>
                {proposalReview.selectedInTask
                  ? "Selected teammate"
                  : "Additional catalog teammate"}{" "}
                · {proposalReview.proposal.assignment.permissions.join(", ")}{" "}
                access
              </p>
              <p>
                {proposalReview.mode === "sandbox"
                  ? `Verified Sandbox image: ${proposalReview.imageTag}`
                  : "Local environment"}
                {proposalReview.localApprovalNeeded
                  ? ", separate local approval required"
                  : ""}
              </p>
              <p>
                Source checkpoint:{" "}
                {proposalReview.proposal.sourceHeadId.slice(0, 12)} ·{" "}
                {proposalReview.projectPath}
              </p>
              <details>
                <summary>Source files ({proposalReview.files.length})</summary>
                <ul>
                  {proposalReview.files.map((file) => (
                    <li key={file}>{file}</li>
                  ))}
                </ul>
              </details>
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    onRun(
                      await api.approveSpecialistDispatch(
                        proposalReview.token,
                        true,
                      ),
                    );
                    setProposalReview(null);
                  })
                }
              >
                Approve teammate
              </button>
            </div>
          )}
          <div className="planned-assignment-list">
            {state.members.map((person) => {
              const env = state.scope.memberEnvironments?.[person.id];
              const latest = state.checkpoints.find(
                (item) => item.id === person.headId,
              );
              return (
                <article key={person.id} className="planned-assignment">
                  <div className="planned-member-heading">
                    <h4>
                      {person.name} <small>{person.role}</small>
                    </h4>
                    <span className="status-pill">
                      {person.status.replace("_", " ")}
                    </span>
                  </div>
                  {person.assignment && <p>{person.assignment.objective}</p>}
                  <p className="muted">
                    {env?.mode === "sandbox"
                      ? `Sandbox image ${env.imageId}`
                      : "Local work"}{" "}
                    · checkpoint {person.headId.slice(0, 12)} ·{" "}
                    {latest?.files.length || 0} files
                  </p>
                  {person.status === "waiting_user" &&
                    env?.mode === "local" &&
                    !env.localApproved && (
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() =>
                          void act(async () =>
                            setLocalReview(
                              await api.reviewLocalFallback(run.id, person.id),
                            ),
                          )
                        }
                      >
                        Review local fallback
                      </button>
                    )}
                  {person.status === "paused" && (
                    <div className="planned-actions">
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() =>
                          void act(async () =>
                            onRun(
                              await api.continueTeammate(run.id, person.id),
                            ),
                          )
                        }
                      >
                        Continue
                      </button>
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => {
                          setRedirect(person.id);
                          setGuidance("");
                        }}
                      >
                        Redirect
                      </button>
                    </div>
                  )}
                  {redirect === person.id && (
                    <div className="planned-redirect">
                      <label>
                        Guidance for {person.name}
                        <textarea
                          value={guidance}
                          onChange={(event) => setGuidance(event.target.value)}
                        />
                      </label>
                      <button
                        className="primary"
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
                            setRedirect(null);
                          })
                        }
                      >
                        Send redirect
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
          {localReview && (
            <div
              className="collaboration-review"
              role="region"
              aria-label="Local fallback review"
            >
              <h4>Local work for {localReview.actor}</h4>
              <p>{localReview.reason}</p>
              <p>
                Source: {localReview.projectPath} · revision{" "}
                {localReview.sourceRevision.slice(0, 12)}
              </p>
              <details>
                <summary>Files in scope ({localReview.files.length})</summary>
                <ul>
                  {localReview.files.map((path) => (
                    <li key={path}>{path}</li>
                  ))}
                </ul>
              </details>
              <h5>Commands in scope</h5>
              <ul>
                {localReview.checks.map((item) => (
                  <li key={`${item.command} ${item.args.join(" ")}`}>
                    {item.command} {item.args.join(" ")} · {item.purpose}
                  </li>
                ))}
              </ul>
              <div className="planned-actions">
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      onRun(
                        await api.approveLocalFallback(localReview.token, true),
                      );
                      setLocalReview(null);
                    })
                  }
                >
                  Approve local work
                </button>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      onRun(
                        await api.approveLocalFallback(
                          localReview.token,
                          false,
                        ),
                      );
                      setLocalReview(null);
                    })
                  }
                >
                  Keep teammate paused
                </button>
              </div>
            </div>
          )}
          <details className="planned-history">
            <summary>
              Operations and checkpoints ({state.operations.length} operations,{" "}
              {state.checkpoints.length} checkpoints)
            </summary>
            <ul>
              {state.operations.slice(-40).map((operation) => (
                <li key={operation.id}>
                  {operation.actor}: {operation.stage} · {operation.status} ·{" "}
                  {operation.inputRevision.slice(0, 12)}
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
            <ul>
              {state.checkpoints.slice(-40).map((item) => (
                <li key={item.id}>
                  {item.actor}: {item.id.slice(0, 12)} · {item.files.length}{" "}
                  files · {item.status}
                </li>
              ))}
            </ul>
          </details>
          {state.integration.conflicts.length > 0 && (
            <div role="alert">
              <h4>Integration conflicts</h4>
              <ul>
                {state.integration.conflicts.map((text) => (
                  <li key={text}>{text}</li>
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
                      setSyncReview(await api.reviewCollaborationSync(run.id)),
                    )
                  }
                >
                  Review synchronization
                </button>
                {syncReview && (
                  <div className="collaboration-review">
                    <h4>Apply reviewed files</h4>
                    <p>
                      {syncReview.projectPath} ·{" "}
                      {syncReview.revision.slice(0, 12)}
                    </p>
                    <ul>
                      {syncReview.files.map((file) => (
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
                              syncReview.token,
                              true,
                            ),
                          );
                          setSyncReview(null);
                        })
                      }
                    >
                      Apply to selected folder
                    </button>
                  </div>
                )}
              </>
            )}
        </>
      )}
    </section>
  );
}
