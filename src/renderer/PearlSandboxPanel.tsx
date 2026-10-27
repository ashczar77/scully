import { useEffect, useState } from "react";
import {
  Box,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  GitBranch,
} from "lucide-react";
import type { DesktopAPI } from "../shared/contracts";
import type { PearlChat } from "../shared/pearl-chat";
import type { PearlSandboxImageList } from "../shared/pearl-sandbox";
import type { FileReview } from "../shared/pearl-workspace";
import { ModelPicker } from "./ModelPicker";

export function PearlSandboxPanel({
  api,
  chat,
  onChange,
  onSettings,
  onInspect,
  onOpenFile,
}: {
  api: DesktopAPI;
  chat: PearlChat;
  onChange: (chat: PearlChat) => void;
  onSettings: () => void;
  onInspect?: () => void;
  onOpenFile: (review: FileReview) => void;
}) {
  const [catalog, setCatalog] = useState<PearlSandboxImageList | null>(null);
  const [image, setImage] = useState("");
  const [branchName, setBranchName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(chat.sandbox?.status !== "ready");
  const sandbox = chat.sandbox;
  useEffect(() => {
    setExpanded(sandbox?.status !== "ready");
  }, [sandbox?.status]);
  const locked =
    chat.status === "running" || chat.status === "awaiting_approval";
  const selected = sandbox?.branches.find(
    (item) => item.id === sandbox.activeBranchId,
  );
  const baselineFiles = new Map(
    sandbox?.manifest.map((file) => [file.path, file.sha256]) || [],
  );
  const hasUnsyncedChanges = Boolean(
    selected &&
    Object.entries(selected.files).some(
      ([path, digest]) => baselineFiles.get(path) !== digest,
    ),
  );
  async function run(work: () => Promise<PearlChat>) {
    setBusy(true);
    setError("");
    try {
      onChange(await work());
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Sandbox action failed",
      );
    } finally {
      setBusy(false);
    }
  }
  function loadImages() {
    setBusy(true);
    setError("");
    void api
      .pearlSandboxImages()
      .then((list) => {
        setCatalog(list);
        setImage(
          sandbox && list.images.some((item) => item.uuid === sandbox.baseImage)
            ? sandbox.baseImage
            : list.images[0]?.uuid || "",
        );
      })
      .catch((cause) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not list images. Connect Sandbox in Settings.",
        ),
      )
      .finally(() => setBusy(false));
  }
  if (!chat.project?.approved || chat.lifecycle) return null;
  return (
    <section className="pearl-sandbox-panel" aria-label="Nebius Sandbox">
      <div className="pearl-sandbox-head">
        <div className="pearl-sandbox-heading">
          <strong>Nebius Sandbox</strong>
          {selected && <small>{selected.name}</small>}
          <span
            className={`pearl-sandbox-mode ${sandbox?.active ? "remote" : "local"}`}
          >
            {sandbox?.active ? "Remote mode" : "Local mode"}
          </span>
        </div>
        <div className="pearl-sandbox-actions">
          <span
            className={`pearl-sandbox-status ${sandbox?.status || "local"}`}
          >
            {sandbox?.status || ""}
          </span>
          {sandbox?.status === "ready" && onInspect && (
            <button type="button" onClick={onInspect}>
              View Sandbox
            </button>
          )}
          <button
            type="button"
            className="pearl-sandbox-toggle"
            aria-expanded={expanded}
            aria-label={
              expanded ? "Collapse Sandbox details" : "Expand Sandbox details"
            }
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
          </button>
        </div>
      </div>
      <div
        className={`pearl-sandbox-body${expanded ? " expanded" : ""}`}
        inert={!expanded}
      >
        {error && (
          <p role="alert" className="pearl-settings-error">
            {error}
          </p>
        )}
        {!sandbox && (
          <>
            <p>
              Opt in for this task. Pearl will edit remote checkpoints; your
              local project changes only after you review and approve a sync.
            </p>
            <div className="pearl-sandbox-controls">
              {!catalog ? (
                <button type="button" disabled={busy} onClick={loadImages}>
                  Work in Sandbox
                </button>
              ) : (
                <>
                  <div className="pearl-sandbox-choice">
                    <span>Base image</span>
                    <ModelPicker
                      label="Sandbox base image"
                      noun="image"
                      recommendedIds={[]}
                      icon={<Box size={15} />}
                      value={image}
                      options={catalog.images.map((item) => ({
                        id: item.uuid,
                        name: item.tag || item.uuid,
                      }))}
                      onChange={setImage}
                    />
                  </div>
                  <button
                    type="button"
                    disabled={busy || !image}
                    onClick={() =>
                      void run(() => api.preparePearlSandbox(chat.id, image))
                    }
                  >
                    Review upload
                  </button>
                </>
              )}
              <button type="button" onClick={onSettings}>
                Sandbox connection settings
              </button>
            </div>
          </>
        )}
        {sandbox?.status === "prepared" && (
          <>
            <p>
              Upload {sandbox.manifest.length} eligible files from the approved
              project to Nebius Sandbox. {sandbox.excluded.length} candidate
              paths are excluded. Git ignored paths are not scanned. Review this
              list before continuing.
            </p>
            <details className="pearl-sandbox-file-list">
              <summary>Files to upload ({sandbox.manifest.length})</summary>
              <ul>
                {sandbox.manifest.map((file) => (
                  <li key={file.path}>
                    {file.path} ({file.bytes} bytes)
                  </li>
                ))}
              </ul>
            </details>
            {sandbox.excluded.length > 0 && (
              <details>
                <summary>Excluded paths ({sandbox.excluded.length})</summary>
                <ul>
                  {sandbox.excluded.map((path) => (
                    <li key={path}>{path}</li>
                  ))}
                </ul>
              </details>
            )}
            <div className="pearl-sandbox-controls pearl-sandbox-upload-actions">
              {catalog ? (
                <>
                  <div className="pearl-sandbox-choice">
                    <span>Base image</span>
                    <ModelPicker
                      label="Sandbox base image"
                      noun="image"
                      recommendedIds={[]}
                      icon={<Box size={15} />}
                      value={image}
                      options={catalog.images.map((item) => ({
                        id: item.uuid,
                        name: item.tag || item.uuid,
                      }))}
                      onChange={setImage}
                    />
                  </div>
                  {image !== sandbox.baseImage && (
                    <button
                      type="button"
                      disabled={busy || !image}
                      onClick={() =>
                        void run(() => api.preparePearlSandbox(chat.id, image))
                      }
                    >
                      Review new image
                    </button>
                  )}
                </>
              ) : (
                <button type="button" disabled={busy} onClick={loadImages}>
                  Choose another image
                </button>
              )}
              <button
                type="button"
                disabled={
                  busy || (catalog !== null && image !== sandbox.baseImage)
                }
                onClick={() => void run(() => api.startPearlSandbox(chat.id))}
              >
                Upload files and start Sandbox
              </button>
            </div>
          </>
        )}
        {sandbox?.status === "uploading" && (
          <p role="status">
            Uploading source snapshot. Wait for a saved checkpoint.
          </p>
        )}
        {sandbox?.status === "uncertain" && (
          <>
            <p role="alert">
              The remote operation has an uncertain outcome. No automatic retry
              was made.
            </p>
            <button
              type="button"
              disabled={busy || !sandbox.lastOperation?.remoteId}
              onClick={() => void run(() => api.reconcilePearlSandbox(chat.id))}
            >
              Inspect saved operation
            </button>
          </>
        )}
        {sandbox?.status === "ready" && (
          <>
            <div className="pearl-sandbox-controls pearl-sandbox-branch-row">
              <div className="pearl-sandbox-choice">
                <span>Branch</span>
                <ModelPicker
                  label="Sandbox branch"
                  noun="branch"
                  recommendedIds={[]}
                  icon={<GitBranch size={15} />}
                  value={selected?.id || ""}
                  options={sandbox.branches.map((item) => ({
                    id: item.id,
                    name: item.name,
                  }))}
                  disabled={busy || locked}
                  onChange={(id) =>
                    void run(() => api.switchPearlSandboxBranch(chat.id, id))
                  }
                />
              </div>
              <span
                className={`pearl-sandbox-mode ${sandbox.active ? "remote" : "local"}`}
              >
                {sandbox.active ? "Remote mode active" : "Local mode active"}
              </span>
              {sandbox.active ? (
                <button
                  type="button"
                  disabled={busy || locked}
                  onClick={() => void run(() => api.leavePearlSandbox(chat.id))}
                >
                  Return to local mode
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy || locked || !selected}
                  onClick={() =>
                    void run(() =>
                      api.switchPearlSandboxBranch(chat.id, selected!.id),
                    )
                  }
                >
                  Resume Sandbox
                </button>
              )}
            </div>
            {sandbox.active && (
              <div className="pearl-sandbox-actions pearl-sandbox-fork-row">
                <input
                  aria-label="New Sandbox branch name"
                  placeholder="Branch name"
                  maxLength={60}
                  value={branchName}
                  onChange={(event) => setBranchName(event.target.value)}
                />
                <button
                  type="button"
                  disabled={busy || locked || !branchName.trim()}
                  onClick={() =>
                    void run(async () => {
                      const next = await api.forkPearlSandbox(
                        chat.id,
                        branchName,
                      );
                      setBranchName("");
                      return next;
                    })
                  }
                >
                  Fork checkpoint
                </button>
              </div>
            )}
            <p>
              Checkpoint: {selected?.headImage || "Unavailable"}. Checks run
              remotely with one-use approval and discard their file writes.
            </p>
            {selected?.checks.length ? (
              <p
                className={`pearl-sandbox-check ${selected.checks.at(-1)?.passed ? "passed" : "failed"}`}
                role="status"
              >
                {selected.checks.at(-1)?.passed && (
                  <CheckCircle2 size={16} aria-hidden="true" />
                )}
                {selected.checks.at(-1)?.passed
                  ? "Command completed successfully"
                  : "Command failed"}
                : {selected.checks.at(-1)?.command}{" "}
                {selected.checks.at(-1)?.args?.join(" ") || ""} (exit{" "}
                {selected.checks.at(-1)?.exitCode ?? "unknown"})
              </p>
            ) : null}
            <button
              type="button"
              disabled={busy || locked || !hasUnsyncedChanges}
              title={
                !hasUnsyncedChanges ? "No unsynced Sandbox changes" : undefined
              }
              onClick={() =>
                void run(() => api.reviewPearlSandboxSync(chat.id))
              }
            >
              Review local sync
            </button>
            {!hasUnsyncedChanges && (
              <span className="pearl-sandbox-sync-hint">
                No unsynced Sandbox changes
              </span>
            )}
            {sandbox.pendingSync && (
              <div className="pearl-sandbox-sync">
                <strong>Local sync review</strong>
                <p>
                  {sandbox.pendingSync.files.length} files will be written to
                  the approved local project. Open each file and approve this
                  exact branch checkpoint once.
                </p>
                <ul>
                  {sandbox.pendingSync.files.map((file) => (
                    <li key={file.path}>
                      <button
                        type="button"
                        onClick={() => {
                          setError("");
                          void api
                            .reviewPearlSandboxFile(chat.id, file.path)
                            .then((result) => {
                              onOpenFile(result);
                              void api.getPearlChat(chat.id).then(onChange);
                            })
                            .catch((cause) => setError(String(cause)));
                        }}
                      >
                        {file.path} ({file.kind}){" "}
                        {sandbox.pendingSync?.viewed.includes(file.path)
                          ? "✓"
                          : ""}
                      </button>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  disabled={
                    busy ||
                    locked ||
                    sandbox.pendingSync.files.some(
                      (file) =>
                        !sandbox.pendingSync?.viewed.includes(file.path),
                    )
                  }
                  onClick={() =>
                    void run(() =>
                      api.approvePearlSandboxSync(
                        chat.id,
                        sandbox.pendingSync!.token,
                      ),
                    )
                  }
                >
                  Approve local sync
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
