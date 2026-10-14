import type { Run } from "../shared/runs";
import type { Teammate, DesktopAPI } from "../shared/contracts";
import { useState } from "react";
import { requestLimit } from "../shared/coordination";
export function CoordinationPanel({
  run,
  team,
  api,
  invalidateConsent,
}: {
  run: Run;
  team: Teammate[];
  api?: DesktopAPI;
  invalidateConsent?: () => void;
}) {
  const [ownership, setOwnership] = useState(
    run.coordination?.settings?.ownership || "",
  );
  const [chunkReviews, setChunkReviews] = useState(
    run.coordination?.settings?.chunkReviews || false,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const c = run.coordination;
  if (!c) return null;
  const name = (id: string) => team.find((t) => t.id === id)?.name || id;
  const writers = c.assignments.map((assignment) => assignment.owner);
  const examples = writers.map(
    (id, index) =>
      `${id} ${index === 0 ? "src/feature.ts" : "tests/feature.test.ts"}`,
  );
  return (
    <section className="settings-card" aria-label="Team ownership">
      <h3>Team ownership</h3>
      <p>
        {name(c.integrator)} owns integration. {name(c.auditor)} reviews the
        combined revision read-only. Writers share the task, plan and selected
        snapshot, not each other's unfinished files.
      </p>
      {api && run.status === "prepared" && (
        <details>
          <summary>Configure ownership and early reviews</summary>
          <p>
            Optional overrides. Defaults stay automatic. Use one rule per line
            with an assigned writer ID and a file or folder path. Assigned
            writers: {writers.map((id) => `${name(id)} (${id})`).join(", ")}.
            Folder rules cover the subtree; overlapping rules are rejected.
          </p>
          <label>
            Ownership overrides
            <textarea
              className="ownership-input"
              rows={4}
              value={ownership}
              maxLength={4000}
              onChange={(e) => {
                setOwnership(e.target.value);
                invalidateConsent?.();
              }}
              placeholder={examples.join("\n")}
            />
          </label>
          <label className="consent">
            <input
              type="checkbox"
              checked={chunkReviews}
              onChange={(e) => {
                setChunkReviews(e.target.checked);
                invalidateConsent?.();
              }}
            />
            Review each completed writer chunk while other work continues
          </label>
          <p>
            Early reviews add up to {writers.length} additional{" "}
            {writers.length === 1 ? "request" : "requests"}. They do not replace
            the final combined audit. No changes take effect until saved; saving
            never starts a run.
          </p>
          <button
            className="secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              invalidateConsent?.();
              try {
                await api.configureCoordination(run.id, {
                  ownership,
                  chunkReviews,
                });
              } catch (e) {
                setError(
                  e instanceof Error
                    ? e.message
                    : "Could not save coordination settings",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            Save coordination settings
          </button>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
        </details>
      )}
      <p>
        Saved early reviews: {c.settings?.chunkReviews ? "enabled" : "disabled"}{" "}
        · Request ceiling including planning: {requestLimit(run)}
      </p>
      {!!c.rules?.length && (
        <ul>
          {c.rules.map((r) => (
            <li key={r.path}>
              {name(r.owner)} owns {r.path}
              {r.directory ? "/ (subtree)" : " (file)"}
            </li>
          ))}
        </ul>
      )}
      {c.assignments.map((a) => (
        <article className="command-proposal" key={a.owner}>
          <h4>
            {name(a.owner)} · {a.status}
          </h4>
          <p>{a.scope}</p>
          {a.summary && <p>{a.summary}</p>}
          {a.files.length > 0 && (
            <details>
              <summary>Proposed files ({a.files.length})</summary>
              {a.files.map((f) => (
                <details key={f.path}>
                  <summary>{f.path}</summary>
                  <pre>{f.content}</pre>
                </details>
              ))}
            </details>
          )}
        </article>
      ))}
      {c.conflicts.length > 0 && (
        <div role="alert">
          <h4>Integration needs attention</h4>
          {c.conflicts.map((f, i) => (
            <p key={i}>
              <strong>{f.path}</strong>: {f.detail}
            </p>
          ))}
          <p>
            No winner was chosen. Inspect the proposals, revise the task to
            clarify file ownership, and prepare a new attempt. This run will not
            automatically retry or apply changes.
          </p>
        </div>
      )}
      {c.integratedRevision && (
        <p>
          Combined revision: <code>{c.integratedRevision.slice(0, 12)}</code> ·{" "}
          {c.auditedRevision === c.integratedRevision
            ? "Model review recorded for this revision; findings remain unverified."
            : "Final audit not yet recorded."}
        </p>
      )}
      {
        <>
          {!!c.chunkReviews?.length && (
            <section aria-label="Early chunk reviews">
              <h4>Early reviews · findings remain unverified</h4>
              {c.chunkReviews.map((r) => (
                <article className="command-proposal" key={r.owner}>
                  <strong>
                    {name(r.owner)} branch · {r.status} ·{" "}
                    {r.revision.slice(0, 12)}
                  </strong>
                  <p>{r.summary}</p>
                  {r.findings.map((f, i) => (
                    <p key={i}>
                      {f.severity}: {f.path} · {f.detail}
                    </p>
                  ))}
                </article>
              ))}
            </section>
          )}
          {c.metrics.writerWallMs > 0 && (
            <p className="muted">
              Writers and optional reviews elapsed: {c.metrics.writerWallMs} ms
              · Sum of writer times: {c.metrics.writerTotalMs} ms · Integration
              checks: {c.metrics.integrationMs} ms. These measure this run, not
              a benchmark speedup or correctness score.
            </p>
          )}
        </>
      }
    </section>
  );
}
