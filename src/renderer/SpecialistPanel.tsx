import { useEffect, useState } from "react";
import {
  auditKinds,
  findingCheckCurrent,
  type AuditKind,
} from "../shared/audits";
import type { Run, RunAPI } from "../shared/runs";
import { assessLocalCriterion } from "../shared/check-criteria";
import { FindingDecisionPanel } from "./FindingDecisionPanel";
export function SpecialistPanel({
  run,
  api,
  relatedRuns = [],
}: {
  run: Run;
  api: RunAPI;
  relatedRuns?: Run[];
}) {
  const [focus, setFocus] = useState<AuditKind | null>(null);
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setApproved(false);
    setFocus(null);
  }, [run]);
  const audits = run.specialistAudits || [];
  return (
    <section className="settings-card" aria-label="Specialist audits">
      <h3>Dispatch a specialist</h3>
      <p>
        Ellis can review testing, security or maintainability. Each dispatch is
        read-only and allows one builder response if findings are raised.
        Discussion alone never resolves a finding.
      </p>
      <p>
        {audits.length}/3 dispatches used. Specialist requests:{" "}
        {audits.reduce((sum, a) => sum + a.calls, 0)} (separate from build
        requests).
      </p>
      {run.status === "complete" && run.coordination && audits.length < 3 && (
        <>
          <div className="command-actions">
            {auditKinds.map((kind) => (
              <button
                className="secondary"
                key={kind}
                disabled={busy}
                aria-pressed={focus === kind}
                onClick={() => {
                  setFocus(kind);
                  setApproved(false);
                  setError("");
                }}
              >
                Audit {kind}
              </button>
            ))}
          </div>
          {focus && (
            <div className="consent-card">
              <p>
                {focus} review of revision{" "}
                {run.coordination.integratedRevision.slice(0, 12)}. Uploads the
                task, selected source, full draft and new findings to the saved
                run model ({run.usagePolicy?.model || run.model}). Up to two
                additional requests at{" "}
                {run.usagePolicy?.outputTokens || run.outputTokens} maximum
                output tokens each, no retries. No commands execute or files
                change. Confirm free credits and billing limits first.
              </p>
              <label className="consent">
                <input
                  type="checkbox"
                  checked={approved}
                  onChange={(e) => setApproved(e.target.checked)}
                />
                I approve this specialist upload and up to two requests.
              </label>
              <button
                className="primary"
                disabled={!approved || busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await api.startAudit(
                      run.id,
                      focus,
                      run.coordination!.integratedRevision,
                      true,
                    );
                    setFocus(null);
                  } catch (e) {
                    setError(
                      e instanceof Error ? e.message : "Audit dispatch failed",
                    );
                  } finally {
                    setBusy(false);
                    setApproved(false);
                  }
                }}
              >
                Dispatch {focus} auditor
              </button>
            </div>
          )}
        </>
      )}
      {audits.map((audit, i) => (
        <article key={i} className="command-proposal">
          <h4>
            {audit.kind} · {audit.status}
          </h4>
          <p>
            Revision {audit.revision.slice(0, 12)} · {audit.calls}/2 requests
          </p>
          <p>{audit.summary}</p>
          {audit.findings.map((f, j) => (
            <div key={j}>
              <p>
                {f.severity}: {f.path}: {f.detail}
              </p>
              <FindingDecisionPanel
                key={`${run.id}-${audit.revision}-${j}-${f.detail}`}
                run={run}
                api={api}
                relatedRuns={relatedRuns}
                auditIndex={i}
                findingIndex={j}
              />
            </div>
          ))}
          {audit.response && (
            <>
              <h4>Builder response</h4>
              <p>{audit.response}</p>
            </>
          )}
          {(run.commands || [])
            .filter((c) => c.findingLink?.auditIndex === i)
            .map((command) => (
              <div key={command.id}>
                <h4>
                  Focused check: finding {command.findingLink!.findingIndex + 1}
                </h4>
                <p>{command.reason}</p>
                <p>
                  Expected observations (proposed, not verified):{" "}
                  {command.findingLink!.expected}
                </p>
                {command.findingLink?.criterion && (
                  <p>
                    Proposed literal criterion: exit{" "}
                    {command.findingLink.criterion.exitCode}
                    {command.findingLink.criterion.outputIncludes
                      ? ` and output contains ${JSON.stringify(command.findingLink.criterion.outputIncludes)}`
                      : ""}
                    . This is not an independent test oracle.
                  </p>
                )}
                <p>
                  Use the command review and local execution controls below.
                  Fresh execution permission is required.
                </p>
                {!findingCheckCurrent(run, command) && (
                  <p role="alert">
                    Stale finding link. Do not use these results for the current
                    finding.
                  </p>
                )}
                {!(run.executions || []).some(
                  (e) => e.commandId === command.id,
                ) && <p>Not executed.</p>}
                {(run.executions || [])
                  .filter((e) => e.commandId === command.id)
                  .map((e) => (
                    <div key={e.id}>
                      <p>
                        {e.status} · exit {e.exitCode ?? "none"} ·{" "}
                        {e.revision === command.revision &&
                        findingCheckCurrent(run, command)
                          ? "Matches reviewed proposal"
                          : "Stale evidence"}
                      </p>
                      <pre>{e.output || "(No output)"}</pre>
                      {command.findingLink?.criterion && (
                        <p>
                          Criterion {assessLocalCriterion(command, e).status}:{" "}
                          {assessLocalCriterion(command, e).detail}
                        </p>
                      )}
                      {e.error && <p>{e.error}</p>}
                      <p>
                        Execution does not resolve this finding automatically.
                        An exit code alone does not establish correctness.
                      </p>
                    </div>
                  ))}
              </div>
            ))}
          {audit.status === "needs-review" && (
            <p role="alert">
              Review findings and recorded user decisions above. This model
              review is not independent verification; no automatic resolution
              occurred.
            </p>
          )}
          {audit.status === "clear" && (
            <p>No findings reported. Not proof of correctness.</p>
          )}
        </article>
      ))}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
