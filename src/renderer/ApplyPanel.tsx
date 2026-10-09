import { useState } from "react";
import type { Run } from "../shared/runs";
import type { DesktopAPI } from "../shared/contracts";
import type { ApplyReview } from "../shared/apply";

export function ApplyPanel({ api, run }: { api: DesktopAPI; run: Run }) {
  const [review, setReview] = useState<ApplyReview | null>(null);
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Apply failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings-card" aria-label="Review and apply">
      <h3>Review and apply</h3>
      <p>
        {run.drafts.length} changed or added files · {run.findings.length}{" "}
        auditor findings · {run.executions?.length || 0} local check runs.
      </p>
      <p>
        Review the file changes, findings and check output above. Findings are
        not automatically resolved by a successful exit. Untested work stays
        unverified.
      </p>
      <p className="muted">
        Only the reviewed draft files are written, not files produced by local
        commands. Unrelated files are left alone. No deletions, commits or
        pushes. Existing files must still match the selected baseline. Originals
        are backed up locally before writing.
      </p>
      {!run.applications?.length && (
        <button
          className="secondary"
          disabled={
            busy ||
            run.status !== "complete" ||
            run.executions?.some((e) => e.status === "running")
          }
          onClick={() =>
            act(async () => {
              setReview(null);
              setApproved(false);
              setReview(await api.reviewApply(run.id));
            })
          }
        >
          Choose destination and review
        </button>
      )}
      {review && (
        <div className="command-proposal">
          <h4>Confirm destination</h4>
          <pre>{review.destination}</pre>
          <p>
            Revision {review.revision.slice(0, 12)} · Review expires{" "}
            {new Date(review.expiresAt).toLocaleTimeString()}
          </p>
          {review.files.map((f) => (
            <details key={f.path}>
              <summary>
                {f.before === null ? "Add" : "Replace"}: {f.path}
              </summary>
              <div className="diff-columns">
                <section>
                  <h4>Current baseline</h4>
                  <pre>{f.before ?? "(Must not exist)"}</pre>
                </section>
                <section>
                  <h4>Write this content</h4>
                  <pre>{f.content}</pre>
                </section>
              </div>
            </details>
          ))}
          <p>
            Multi-file application is not a single atomic transaction. If
            interrupted, some files may already be written. Retained originals
            and a manifest support manual recovery; no automatic rollback
            overwrites later user edits.
          </p>
          <label className="consent">
            <input
              type="checkbox"
              checked={approved}
              onChange={(e) => setApproved(e.target.checked)}
            />
            I approve writing these exact files to this destination, with the
            stated test limitations.
          </label>
          <button
            className="primary"
            disabled={busy || !approved}
            onClick={() =>
              act(async () => {
                const token = review.token;
                setReview(null);
                setApproved(false);
                await api.applyDraft(token, true);
              })
            }
          >
            Apply reviewed files
          </button>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => {
              setReview(null);
              setApproved(false);
            }}
          >
            Cancel apply review
          </button>
        </div>
      )}
      {run.applications?.map((a) => (
        <article key={a.id} className="command-proposal">
          <h4>Application: {a.status}</h4>
          <pre>{a.destination}</pre>
          <p>Written: {a.written.join(", ") || "None confirmed"}</p>
          {a.pendingPath && (
            <p>Write attempted, verify manually: {a.pendingPath}</p>
          )}
          {a.error && <p className="error">{a.error}</p>}
          <details>
            <summary>Recovery backup and manifest location</summary>
            <pre>{a.backupDirectory}</pre>
            <p>
              Original files are under originals/. manifest.json identifies
              added files and confirmed writes. Inspect destination content
              before restoring anything. Recovery is manual.
            </p>
          </details>
        </article>
      ))}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
