import { useEffect, useRef, useState } from "react";
import type { DesktopAPI } from "../shared/contracts";
import type { Run } from "../shared/runs";
import type { CloudImage, CloudReview, CloudSession } from "../shared/cloud";
import { CloudComparison } from "./CloudComparison";
import { assessCloudCriterion } from "../shared/check-criteria";

const statusPollLimit = 12;
const statusPollIntervalMs = 5_000;
type PollTarget = {
  runId: string;
  executionId: string;
  projectId: string;
  attempts: number;
  generation: number;
};

export function CloudPanel({ api, run }: { api: DesktopAPI; run: Run }) {
  const [session, setSession] = useState<CloudSession | null>(null);
  const [editingCredentials, setEditingCredentials] = useState(false);
  const [key, setKey] = useState("");
  const [projectId, setProjectId] = useState("");
  const [imageSearch, setImageSearch] = useState("");
  const [images, setImages] = useState<CloudImage[]>([]);
  const [imagesLoaded, setImagesLoaded] = useState(false);
  const [imagesLimited, setImagesLimited] = useState(false);
  const [image, setImage] = useState("");
  const [saveChanges, setSaveChanges] = useState(false);
  const [parentExecutionId, setParentExecutionId] = useState<
    string | undefined
  >();
  const [executable, setExecutable] = useState("");
  const [manualCommandId, setManualCommandId] = useState<string | null>(null);
  const [resolutionReason, setResolutionReason] = useState("");
  const [review, setReview] = useState<CloudReview | null>(null);
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pollTarget, setPollTarget] = useState<PollTarget | null>(null);
  const [pollMessage, setPollMessage] = useState("");
  const pollGeneration = useRef(0);
  const pollInFlight = useRef(false);
  useEffect(
    () => () => {
      pollGeneration.current++;
    },
    [],
  );
  useEffect(() => {
    let active = true;
    void api
      .cloudSession()
      .then((value) => {
        if (active) {
          setSession(value);
          setProjectId(value.projectId);
        }
      })
      .catch(() => {
        if (active) setError("Could not read cloud settings");
      });
    return () => {
      active = false;
    };
  }, [api]);
  useEffect(() => {
    if (!pollTarget) return;
    if (
      pollTarget.runId !== run.id ||
      !session?.configured ||
      session.projectId !== pollTarget.projectId ||
      editingCredentials
    ) {
      pollGeneration.current++;
      setPollTarget(null);
      setPollMessage(
        "Automatic status checks stopped because the cloud session changed. You can refresh manually.",
      );
      return;
    }
    const current = run.cloudExecutions?.find(
      (item) => item.id === pollTarget.executionId,
    );
    if (current?.status === "complete" || current?.status === "failed") {
      pollGeneration.current++;
      setPollTarget(null);
      setPollMessage("");
      return;
    }
    if (busy || pollInFlight.current) return;
    const timer = setTimeout(() => {
      if (pollGeneration.current !== pollTarget.generation) return;
      pollInFlight.current = true;
      void api
        .refreshCloud(pollTarget.runId, pollTarget.executionId)
        .then((updated) => {
          pollInFlight.current = false;
          if (pollGeneration.current !== pollTarget.generation) return;
          const item = updated.cloudExecutions?.find(
            (entry) => entry.id === pollTarget.executionId,
          );
          if (item?.status === "complete" || item?.status === "failed") {
            pollGeneration.current++;
            setPollTarget(null);
            setPollMessage("");
          } else if (item?.status !== "submitted" || !item.operationId) {
            pollGeneration.current++;
            setPollTarget(null);
            setPollMessage(
              "Automatic status checks stopped because the operation is no longer confirmed. Review its saved state before refreshing manually.",
            );
          } else if (pollTarget.attempts + 1 >= statusPollLimit) {
            pollGeneration.current++;
            setPollTarget(null);
            setPollMessage(
              "Automatic status checks reached their limit. You can refresh manually.",
            );
          } else {
            setPollTarget({ ...pollTarget, attempts: pollTarget.attempts + 1 });
          }
        })
        .catch(() => {
          pollInFlight.current = false;
          if (pollGeneration.current !== pollTarget.generation) return;
          pollGeneration.current++;
          setPollTarget(null);
          setPollMessage(
            "Automatic status checks stopped after an error. You can refresh manually.",
          );
        });
    }, statusPollIntervalMs);
    return () => clearTimeout(timer);
  }, [
    api,
    busy,
    editingCredentials,
    pollTarget,
    run.cloudExecutions,
    run.id,
    session,
  ]);
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cloud action failed");
    } finally {
      setBusy(false);
    }
  }
  const merged = new Map(run.files.map((file) => [file.path, file.content]));
  for (const file of run.drafts) merged.set(file.path, file.content);
  const savedEnvironments = (run.cloudExecutions || [])
    .map((item, index) => ({ item, number: index + 1 }))
    .filter(
      ({ item }) =>
        item.saveChanges === true &&
        item.resultImage &&
        item.status === "complete" &&
        item.remoteStatus === "SUCCESS" &&
        item.projectId === session?.projectId &&
        run.commands?.some((command) => command.revision === item.revision),
    );
  const selectedSaved = savedEnvironments.find(
    ({ item }) => item.id === parentExecutionId,
  );
  const options = {
    saveChanges,
    ...(parentExecutionId ? { parentExecutionId } : {}),
  };
  const reviewCriterion = run.commands?.find(
    (command) =>
      command.id === review?.commandId && command.revision === review.revision,
  )?.findingLink?.criterion;
  return (
    <section className="settings-card" aria-label="Cloud execution">
      <h3>Run a check in Nebius Sandboxes</h3>
      <p>
        Cloud checks are optional. The app sends the reviewed snapshot and draft
        files, then runs one proposed command in an isolated guest. This can
        consume Nebius credits. It does not run automatically.
      </p>
      <p className="muted">
        Billing status and overage settings cannot be verified here. Confirm
        them in Token Factory before approving a cloud check. The guest has no
        network access. Uploaded files and logs may remain on the service even
        when the execution is disposable.
      </p>
      {session?.configured && (
        <button
          className="secondary"
          disabled={busy}
          onClick={() => {
            setReview(null);
            setApproved(false);
            setEditingCredentials((value) => !value);
          }}
        >
          {editingCredentials
            ? "Keep current cloud credentials"
            : "Change cloud credentials"}
        </button>
      )}
      {(!session?.configured || editingCredentials) && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void act(async () => {
              const value = await api.configureCloud({ key, projectId });
              setSession(value);
              setKey("");
              setEditingCredentials(false);
              setImages([]);
              setImagesLoaded(false);
              setImage("");
              setParentExecutionId(undefined);
              setSaveChanges(false);
              setManualCommandId(null);
              setResolutionReason("");
              setReview(null);
              setApproved(false);
              pollGeneration.current++;
              setPollTarget(null);
            });
          }}
        >
          <label>
            Sandbox project ID{" "}
            <input
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              autoComplete="off"
            />
          </label>
          <label>
            Sandbox API key{" "}
            <input
              type="password"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              autoComplete="off"
            />
          </label>
          <button className="secondary" disabled={busy} type="submit">
            Use for this app session
          </button>
          <p className="muted">
            The key stays in memory and is not saved in the workspace database.
          </p>
        </form>
      )}
      {session?.configured && <p>Cloud project: {session.projectId}</p>}
      {session?.configured && run.status === "complete" && (
        <div>
          <form
            className="cloud-image-search"
            onSubmit={(event) => {
              event.preventDefault();
              setImages([]);
              setImagesLoaded(false);
              setImage("");
              setParentExecutionId(undefined);
              setManualCommandId(null);
              setResolutionReason("");
              setReview(null);
              setApproved(false);
              void act(async () => {
                const result = await api.cloudImages(imageSearch);
                setImages(result.images);
                setImagesLimited(result.limited);
                setImagesLoaded(true);
              });
            }}
          >
            <label>
              Search sandbox image tags by prefix{" "}
              <input
                value={imageSearch}
                maxLength={80}
                onChange={(event) => setImageSearch(event.target.value)}
                placeholder="python, node, ubuntu..."
              />
            </label>
            <button className="secondary" type="submit" disabled={busy}>
              Find sandbox images
            </button>
          </form>
          {imagesLoaded && images.length === 0 && (
            <p>No tagged public images matched. Try another prefix.</p>
          )}
          {imagesLimited && (
            <p className="muted">
              Showing the first 100 matches. Narrow the tag prefix to find more.
            </p>
          )}
          {images.length > 0 && (
            <div
              className="cloud-image-grid"
              role="group"
              aria-label="Sandbox images"
            >
              {images.map((option) => (
                <button
                  type="button"
                  className="cloud-image-option"
                  aria-pressed={!parentExecutionId && image === option.uuid}
                  key={option.uuid}
                  disabled={busy}
                  onClick={() => {
                    setImage(option.uuid);
                    setParentExecutionId(undefined);
                    setManualCommandId(null);
                    setResolutionReason("");
                    setReview(null);
                    setApproved(false);
                  }}
                >
                  <span className="cloud-image-name">{option.tag}</span>
                  <span className="cloud-image-id">{option.uuid}</span>
                </button>
              ))}
            </div>
          )}
          {savedEnvironments.length > 0 && (
            <div role="group" aria-label="Saved sandbox environments">
              <h4>Start from a saved environment</h4>
              <div className="cloud-image-grid">
                {savedEnvironments.map(({ item, number }) => (
                  <button
                    className="cloud-image-option"
                    type="button"
                    key={item.id}
                    disabled={busy}
                    aria-pressed={parentExecutionId === item.id}
                    onClick={() => {
                      setImage(item.resultImage!);
                      setParentExecutionId(item.id);
                      setManualCommandId(null);
                      setResolutionReason("");
                      setReview(null);
                      setApproved(false);
                    }}
                  >
                    <span className="cloud-image-name">
                      Saved environment from check {number}
                    </span>
                    <span>
                      {item.commandPassed
                        ? "Command passed"
                        : "Command did not pass"}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {image && (
            <p>
              Selected image:{" "}
              {selectedSaved
                ? `Saved environment from check ${selectedSaved.number}`
                : images.find((option) => option.uuid === image)?.tag}{" "}
              ({image})
            </p>
          )}
          {parentExecutionId && (
            <p className="muted">
              This experiment starts from the saved filesystem. The reviewed
              project files replace their matching paths; other saved files
              carry forward. Each experiment leaves its starting image
              unchanged.
            </p>
          )}
          <label className="consent">
            <input
              type="checkbox"
              checked={saveChanges}
              disabled={busy}
              onChange={(event) => {
                setSaveChanges(event.target.checked);
                setReview(null);
                setApproved(false);
              }}
            />
            Save this environment for another experiment
          </label>
          {saveChanges && (
            <p className="muted">
              Saved environments retain uploaded and generated files on Nebius
              under its retention policy. Scully does not yet provide remote
              deletion. Running processes are not saved.
            </p>
          )}
          <p className="muted">
            Scully checks the selected image for the proposed executable before
            preparing a review. It does not install packages or change the
            proposed arguments. Executable inspection does not prove that its
            runtime dependencies will work.
          </p>
          {(run.commands || [])
            .filter((command) => command.decision !== "denied")
            .map((command) => (
              <button
                className="secondary"
                key={command.id}
                disabled={busy || !image}
                onClick={() =>
                  void act(async () => {
                    setReview(null);
                    setApproved(false);
                    setManualCommandId(null);
                    setExecutable("");
                    const result = await api.resolveCloudExecutable(
                      run.id,
                      command.id,
                      image,
                      parentExecutionId,
                    );
                    setResolutionReason(result.reason);
                    if (result.path) {
                      setReview(
                        await api.reviewCloud(
                          run.id,
                          command.id,
                          image,
                          result.path,
                          options,
                        ),
                      );
                    } else {
                      setManualCommandId(command.id);
                    }
                  })
                }
              >
                Review cloud check: {command.executable}
              </button>
            ))}
          {manualCommandId && (
            <div className="command-proposal">
              <p>{resolutionReason}</p>
              <label>
                Executable inside image, unverified{" "}
                <input
                  value={executable}
                  onChange={(event) => setExecutable(event.target.value)}
                  placeholder="/usr/local/bin/node"
                />
              </label>
              <button
                className="secondary"
                disabled={busy || !executable}
                onClick={() =>
                  void act(async () => {
                    setReview(
                      await api.reviewCloud(
                        run.id,
                        manualCommandId,
                        image,
                        executable,
                        options,
                      ),
                    );
                    setManualCommandId(null);
                  })
                }
              >
                Review entered path
              </button>
            </div>
          )}
        </div>
      )}
      {review && (
        <div className="command-proposal">
          <h4>Approve this exact cloud transfer and command</h4>
          {reviewCriterion && (
            <p>
              Proposed observation criterion: exit {reviewCriterion.exitCode}
              {reviewCriterion.outputIncludes
                ? ` and output contains ${JSON.stringify(reviewCriterion.outputIncludes)}`
                : ""}
              . This is not a correctness guarantee.
            </p>
          )}
          <pre>
            {JSON.stringify(
              {
                projectId: review.projectId,
                imageUUID: review.image,
                imageTag: review.imageTag,
                executable: review.executable,
                executableVerifiedInImage: review.executableVerified === true,
                arguments: review.args,
                guestWorkingDirectory: review.cwd,
                timeoutSeconds: review.timeoutSeconds,
                shell: false,
                guestNetworking: false,
                saveChanges: review.saveChanges === true,
                parentExecutionId: review.parentExecutionId,
                outputLimitPerStream: "64 KiB",
                draftRevision: review.revision,
                files: review.files,
              },
              null,
              2,
            )}
          </pre>
          {review.saveChanges && (
            <p>
              This approval includes saving the resulting filesystem on Nebius
              for later experiments.
            </p>
          )}
          {review.parentExecutionId && (
            <p>
              This check inherits a saved filesystem and overlays the listed
              project files. Saved files outside this list also remain available
              to the command.
            </p>
          )}
          <details>
            <summary>Inspect exact file contents to upload</summary>
            {review.files.map((file) => (
              <details key={file.path}>
                <summary>{file.path}</summary>
                <pre>{merged.get(file.path) || ""}</pre>
              </details>
            ))}
          </details>
          <p>
            Review expires {new Date(review.expiresAt).toLocaleTimeString()}. If
            submission times out, the job may still run. No automatic retry or
            cancellation occurs. After a confirmed submission, Scully makes at
            most 12 read-only status checks while this panel stays open.
          </p>
          <label className="consent">
            <input
              type="checkbox"
              checked={approved}
              onChange={(event) => setApproved(event.target.checked)}
            />
            I approve uploading these files and running this command in Nebius,
            with possible credit usage.
          </label>
          <button
            className="primary"
            disabled={busy || !approved}
            onClick={() =>
              void act(async () => {
                const token = review.token;
                setReview(null);
                setApproved(false);
                const updated = await api.submitCloud(token, true);
                const latest = [...(updated.cloudExecutions || [])]
                  .reverse()
                  .find(
                    (item) =>
                      item.commandId === review.commandId &&
                      item.operationId &&
                      item.status === "submitted",
                  );
                if (latest) {
                  setPollMessage("");
                  setPollTarget({
                    runId: updated.id,
                    executionId: latest.id,
                    projectId: latest.projectId,
                    attempts: 0,
                    generation: ++pollGeneration.current,
                  });
                }
              })
            }
          >
            Approve and run in cloud
          </button>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => {
              setReview(null);
              setApproved(false);
            }}
          >
            Cancel review
          </button>
        </div>
      )}
      {(run.cloudExecutions || []).map((item) => (
        <article className="command-proposal" key={item.id}>
          <h4>Cloud check: {item.status}</h4>
          <p>
            Project {item.projectId} · Operation{" "}
            {item.operationId || "not confirmed"} · Remote status{" "}
            {item.remoteStatus || "unknown"}
          </p>
          {item.status === "complete" && (
            <p>
              {item.commandPassed
                ? "Command exited successfully."
                : "Command did not pass. Inspect the process exit and output."}{" "}
              Exit code: {item.exitCode ?? "unavailable"}
            </p>
          )}
          {(() => {
            const command = run.commands?.find(
              (candidate) =>
                candidate.id === item.commandId &&
                candidate.revision === item.revision,
            );
            if (!command?.findingLink?.criterion) return null;
            const observation = assessCloudCriterion(command, item);
            return (
              <p>
                Proposed criterion {observation.status}: {observation.detail}
              </p>
            );
          })()}
          {item.error && <p className="error">{item.error}</p>}
          {item.saveChanges && item.status === "complete" && (
            <p>
              {item.resultImage
                ? "Environment saved for another experiment."
                : "No saved environment was returned. Choose an earlier saved environment or a base image for the next check."}
            </p>
          )}
          {item.parentExecutionId && (
            <p>
              Branched from check{" "}
              {(run.cloudExecutions || []).findIndex(
                (parent) => parent.id === item.parentExecutionId,
              ) + 1}
              .
            </p>
          )}
          {item.operationId && (
            <button
              className="secondary"
              disabled={busy || !session?.configured}
              onClick={() =>
                void act(async () => {
                  await api.refreshCloud(run.id, item.id);
                })
              }
            >
              Refresh remote status
            </button>
          )}
          <details>
            <summary>Cloud command and uploaded file manifest</summary>
            <pre>
              {JSON.stringify(
                {
                  image: item.image,
                  imageTag: item.imageTag,
                  saveChanges: item.saveChanges === true,
                  parentExecutionId: item.parentExecutionId,
                  resultImage: item.resultImage ?? null,
                  executable: item.executable,
                  args: item.args,
                  cwd: item.cwd,
                  files: item.files,
                },
                null,
                2,
              )}
            </pre>
          </details>
          <pre aria-label="Cloud standard output">
            {item.stdout || "No standard output captured."}
          </pre>
          {item.stderr && (
            <pre aria-label="Cloud standard error">{item.stderr}</pre>
          )}
        </article>
      ))}
      <CloudComparison
        executions={run.cloudExecutions || []}
        commands={run.commands || []}
      />
      {pollTarget && (
        <p className="muted">
          Checking remote status automatically, up to {statusPollLimit} times.
          Closing this panel stops automatic checks.
        </p>
      )}
      {pollMessage && <p className="muted">{pollMessage}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
