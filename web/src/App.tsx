import { useEffect, useRef, useState } from "react";

type HealthResponse = {
  status: "ok" | "degraded";
  service: string;
  version: string;
  database: "ready" | "unavailable";
  live_providers_enabled: boolean;
};

type EvidenceReference = {
  evidence_id: string;
  relative_path: string;
  sha256: string;
  byte_size: number;
  media_type: string;
  provenance: string;
  redaction_status: "clean" | "redacted" | "rejected";
};

type CapsuleSummary = {
  schema_version: string;
  capsule_id: string;
  title: string;
  observed_summary: string;
  signature_id: string;
  signature_matcher_count: number;
  known_good_summary: string;
  environment: Array<{
    name: string;
    incident_value: string;
    known_good_value: string | null;
  }>;
  evidence: EvidenceReference[];
  exclusions: string[];
  execution_boundary: {
    runtime: string;
    runtime_version: string;
    network_access: false;
    max_duration_seconds: number;
  };
  missing_evidence: string[];
};

type Hypothesis = {
  hypothesis_id: string;
  title: string;
  mechanism: string;
  rationale: string;
  testable_prediction: string;
  alternative_group: string;
  evidence_ids: string[];
  confidence: number;
};

type ExperimentPlan = {
  experiment_id: string;
  hypothesis_id: string;
  checkpoint_id: string;
  adapter: string;
  variant: string;
  parameters: Record<string, string | number | boolean>;
  operation_limit: number;
  timeout_seconds: number;
};

type InvestigationEvent = {
  sequence: number;
  event_type: string;
};

type ExperimentOutcome = {
  experiment_id: string;
  hypothesis_id: string;
  status: string;
  verdict: string;
  hypothesis_disposition: "supported" | "eliminated" | "inconclusive";
  observation_digest: string;
  matcher_results: Array<{
    matcher_id: string;
    required: boolean;
    passed: boolean;
    reason: string;
  }>;
  elimination_reasons: string[];
  duration_ms: number;
};

type ExecutionReport = {
  status: string;
  signature_id: string;
  evaluator_version: string;
  execution_source: "local" | "sandbox";
  isolation_verified: boolean;
  operation_count: number;
  retry_count: number;
  supported_hypothesis_id: string | null;
  outcomes: ExperimentOutcome[];
  limitations: string[];
};

type InvestigationDetail = {
  investigation_id: string;
  capsule_id: string;
  status: string;
  planning_source: "local" | "nemotron";
  hypotheses: Hypothesis[];
  experiments: ExperimentPlan[];
  events: InvestigationEvent[];
  execution: ExecutionReport | null;
};

type ConnectionState = "checking" | "ready" | "offline";
type ImportState = "idle" | "importing" | "accepted" | "rejected";
type PlanningState = "idle" | "planning" | "ready" | "rejected";
type ExecutionState = "idle" | "running" | "complete" | "rejected";

export function App() {
  const [connection, setConnection] = useState<ConnectionState>("checking");
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [importState, setImportState] = useState<ImportState>("idle");
  const [capsule, setCapsule] = useState<CapsuleSummary | null>(null);
  const [rejection, setRejection] = useState<string | null>(null);
  const [planningState, setPlanningState] = useState<PlanningState>("idle");
  const [investigation, setInvestigation] = useState<InvestigationDetail | null>(null);
  const [planningError, setPlanningError] = useState<string | null>(null);
  const [executionState, setExecutionState] = useState<ExecutionState>("idle");
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [liveEvents, setLiveEvents] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const rejectionRef = useRef<HTMLDivElement>(null);
  const overviewHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function checkHealth() {
      try {
        const response = await fetch("/api/health", {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error("Health request failed");
        }
        const value = (await response.json()) as HealthResponse;
        setHealth(value);
        setConnection(value.status === "ok" ? "ready" : "offline");
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setConnection("offline");
        }
      }
    }

    void checkHealth();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (rejection) rejectionRef.current?.focus();
  }, [rejection]);

  useEffect(() => {
    if (capsule) overviewHeadingRef.current?.focus();
  }, [capsule]);

  async function submitCapsule(url: string, request?: RequestInit) {
    setImportState("importing");
    setRejection(null);
    try {
      const response = await fetch(url, { method: "POST", ...request });
      const payload = (await response.json()) as CapsuleSummary | ImportErrorResponse;
      if (!response.ok) {
        const detail = "detail" in payload ? payload.detail : null;
        throw new Error(detail?.message ?? "Capsule was rejected");
      }
      setCapsule(payload as CapsuleSummary);
      setImportState("accepted");
      setInvestigation(null);
      setPlanningState("idle");
      setPlanningError(null);
      setExecutionState("idle");
      setExecutionError(null);
      setLiveEvents([]);
    } catch (error) {
      setCapsule(null);
      setRejection(error instanceof Error ? error.message : "Capsule was rejected");
      setImportState("rejected");
    }
  }

  async function importFile(file: File) {
    await submitCapsule("/api/capsules/import", {
      body: await file.arrayBuffer(),
      headers: { "content-type": "application/zip" },
    });
  }

  async function createInvestigation(capsuleId: string) {
    setPlanningState("planning");
    setPlanningError(null);
    try {
      const response = await fetch("/api/investigations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ capsule_id: capsuleId }),
      });
      const payload = (await response.json()) as
        | InvestigationDetail
        | ImportErrorResponse;
      if (!response.ok) {
        const detail = "detail" in payload ? payload.detail : null;
        throw new Error(detail?.message ?? "Investigation planning failed");
      }
      setInvestigation(payload as InvestigationDetail);
      setPlanningState("ready");
      setExecutionState("idle");
      setLiveEvents([]);
    } catch (error) {
      setInvestigation(null);
      setPlanningError(
        error instanceof Error ? error.message : "Investigation planning failed",
      );
      setPlanningState("rejected");
    }
  }

  async function executeInvestigation(investigationId: string) {
    setExecutionState("running");
    setExecutionError(null);
    setLiveEvents([]);
    try {
      const response = await fetch(
        `/api/investigations/${investigationId}/execute/stream`,
        { method: "POST" },
      );
      if (!response.ok) {
        const payload = (await response.json()) as ImportErrorResponse;
        const detail = "detail" in payload ? payload.detail : null;
        throw new Error(detail?.message ?? "Branch execution failed");
      }
      if (!response.body) {
        setInvestigation((await response.json()) as InvestigationDetail);
        setExecutionState("complete");
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completed: InvestigationDetail | null = null;
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const message = parseSseFrame(frame);
          if (!message) continue;
          if (message.eventType === "error") {
            const error = message.payload as { message?: string };
            throw new Error(error.message ?? "Branch execution failed");
          }
          if (message.eventType === "complete") {
            completed = message.payload as InvestigationDetail;
          } else {
            setLiveEvents((current) => [...current, message.eventType]);
          }
        }
        if (done) break;
      }
      if (!completed) {
        throw new Error("Execution stream ended before completion");
      }
      setInvestigation(completed);
      setExecutionState("complete");
      setLiveEvents([]);
    } catch (error) {
      setExecutionError(
        error instanceof Error ? error.message : "Branch execution failed",
      );
      setExecutionState("rejected");
    }
  }

  const currentStep = investigation ? 3 : capsule ? 2 : 1;

  return (
    <div className="app-frame">
      <a className="skip-link" href="#main-content">
        Skip to investigation
      </a>
      <header className="topbar">
        <a className="brand" href="/" aria-label="Scully home">
          <span className="brand-mark" aria-hidden="true">
            S
          </span>
          <span>Scully</span>
        </a>
        <div className={`connection connection-${connection}`} role="status">
          <span className="connection-dot" aria-hidden="true" />
          {connection === "checking" && "Checking local runtime"}
          {connection === "ready" && "Local runtime ready"}
          {connection === "offline" && "Local runtime unavailable"}
        </div>
      </header>

      <nav className="progress-nav" aria-label="Investigation progress">
        <ol>
          {["Intake", "Overview", "Hypotheses", "Inspector", "Proof"].map(
            (label, index) => {
              const step = index + 1;
              const state = step < currentStep ? "complete" : step === currentStep ? "current" : "pending";
              return (
                <li className={`progress-${state}`} key={label}>
                  <span aria-hidden="true">{step < currentStep ? "✓" : step}</span>
                  <strong aria-current={state === "current" ? "step" : undefined}>
                    {label}
                  </strong>
                </li>
              );
            },
          )}
        </ol>
      </nav>

      <main id="main-content" tabIndex={-1}>
        {!capsule ? (
          <section className="screen intake-screen" aria-labelledby="intake-title">
            <div className="screen-heading">
              <div>
                <p className="screen-kicker">01 · New investigation</p>
                <h1 id="intake-title">What evidence will enter, and is it safe?</h1>
                <p>
                  Validate one sanitized incident capsule before any investigation
                  begins. Scully never asks for production credentials or access.
                </p>
              </div>
              <span className="mode-label">Local mode</span>
            </div>

            <div className="intake-layout">
              <div className="intake-panel">
                <div className="intake-panel-copy">
                  <span className="state-label state-observed">● Controlled input</span>
                  <h2>Select an incident capsule</h2>
                  <p>
                    Use the reviewed synthetic seed or provide a ZIP that follows
                    capsule schema 1.0.
                  </p>
                </div>
                <div className="import-actions">
                  <button
                    className="primary-action"
                    type="button"
                    disabled={importState === "importing" || connection !== "ready"}
                    onClick={() =>
                      void submitCapsule(
                        "/api/capsules/import?seed=proxy-identity-collapse",
                      )
                    }
                  >
                    {importState === "importing" ? "Validating capsule" : "Load safe seed"}
                    <span aria-hidden="true">→</span>
                  </button>
                  <button
                    className="secondary-action"
                    type="button"
                    disabled={importState === "importing" || connection !== "ready"}
                    onClick={() => fileInput.current?.click()}
                  >
                    Choose ZIP
                  </button>
                  <input
                    ref={fileInput}
                    className="visually-hidden"
                    type="file"
                    accept=".zip,application/zip"
                    aria-label="Select capsule ZIP"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      if (file) void importFile(file);
                      event.currentTarget.value = "";
                    }}
                  />
                </div>
              </div>

              <aside className="boundary-panel" aria-labelledby="boundary-title">
                <span className="boundary-symbol" aria-hidden="true">◇</span>
                <div>
                  <p className="section-label">Safety boundary</p>
                  <h2 id="boundary-title">No production connection</h2>
                  <p>
                    Only files you select cross the boundary. Provider execution
                    remains disabled by default.
                  </p>
                </div>
              </aside>
            </div>

            {rejection && (
              <div className="rejection" ref={rejectionRef} role="alert" tabIndex={-1}>
                <strong>Capsule rejected</strong>
                <span>{rejection}</span>
                <small>No evidence was accepted. Choose a corrected capsule to continue.</small>
              </div>
            )}

            <div className="validation-panel" aria-labelledby="validation-title">
              <div>
                <p className="section-label">Before acceptance</p>
                <h2 id="validation-title">Four checks must pass</h2>
              </div>
              <ol>
                <li><span>01</span><strong>Schema and file structure</strong><small>Unknown fields and unsafe paths fail closed.</small></li>
                <li><span>02</span><strong>Credential and local-path scan</strong><small>Obvious sensitive material stops the import.</small></li>
                <li><span>03</span><strong>Size, type, and hash integrity</strong><small>Every declared file must match exactly.</small></li>
                <li><span>04</span><strong>Evidence lineage</strong><small>Accepted files retain provenance and redaction status.</small></li>
              </ol>
            </div>
          </section>
        ) : (
          <section className="screen overview-screen" aria-labelledby="overview-title">
            <div className="screen-heading">
              <div>
                <p className="screen-kicker">02 · Incident overview</p>
                <h1 id="overview-title" ref={overviewHeadingRef} tabIndex={-1}>
                  What do we know happened?
                </h1>
                <p>
                  Direct observations stay separate from the hypotheses that will
                  be tested next.
                </p>
              </div>
              <span className="state-label state-observed">● Observed</span>
            </div>
            <CapsuleDetails
              capsule={capsule}
              planningState={planningState}
              onCreateInvestigation={() =>
                void createInvestigation(capsule.capsule_id)
              }
            />
          </section>
        )}

        {planningError && (
          <div className="rejection" role="alert">
            <strong>Planning stopped</strong>
            <span>{planningError}</span>
          </div>
        )}

        {executionError && (
          <div className="rejection" role="alert">
            <strong>Execution stopped</strong>
            <span>{executionError}</span>
          </div>
        )}

        {investigation && (
          <InvestigationPlan
            investigation={investigation}
            executionState={executionState}
            liveEvents={liveEvents}
            onExecute={() =>
              void executeInvestigation(investigation.investigation_id)
            }
          />
        )}

        <footer className="foundation-status" aria-label="Local product status">
          <div>
            <p className="section-label">Runtime</p>
            <strong>{health?.database === "ready" ? "SQLite ready" : "Waiting for API"}</strong>
          </div>
          <div>
            <p className="section-label">Providers</p>
            <strong>{health?.live_providers_enabled ? "Enabled" : "Disabled by default"}</strong>
          </div>
          <div>
            <p className="section-label">Version</p>
            <strong>{health?.version ?? "0.1.0"}</strong>
          </div>
        </footer>
      </main>
    </div>
  );
}

type ImportErrorResponse = {
  detail?: {
    code?: string;
    message?: string;
  };
};

function CapsuleDetails({
  capsule,
  planningState,
  onCreateInvestigation,
}: {
  capsule: CapsuleSummary;
  planningState: PlanningState;
  onCreateInvestigation: () => void;
}) {
  const observedFacts = capsule.observed_summary
    .split(/\.\s+/)
    .map((item) => item.replace(/\.$/, "").trim())
    .filter(Boolean);
  const changedEnvironment = capsule.environment.filter(
    (item) => item.incident_value !== item.known_good_value,
  ).length;

  return (
    <div className="overview-layout">
      <section className="incident-card" aria-labelledby="incident-title">
        <div className="incident-card-heading">
          <div>
            <span className="state-label state-observed">● Observed incident</span>
            <h2 id="incident-title">{capsule.title}</h2>
          </div>
          <code>{capsule.capsule_id}</code>
        </div>
        <p className="incident-summary">{capsule.observed_summary}</p>
        <dl className="incident-metrics">
          <div>
            <dt>Accepted evidence</dt>
            <dd>{capsule.evidence.length} files</dd>
          </div>
          <div>
            <dt>Environment deltas</dt>
            <dd>{changedEnvironment}</dd>
          </div>
          <div>
            <dt>Execution boundary</dt>
            <dd>{capsule.execution_boundary.max_duration_seconds}s, offline</dd>
          </div>
        </dl>
      </section>

      <section className="signature-card" aria-labelledby="signature-title">
        <div className="signature-icon" aria-hidden="true">⌁</div>
        <div>
          <p className="section-label">Failure signature</p>
          <h2 id="signature-title">{capsule.signature_id}</h2>
          <p>
            {capsule.signature_matcher_count} deterministic matchers must agree
            before a branch can be marked reproduced.
          </p>
        </div>
      </section>

      <section className="overview-panel observed-sequence" aria-labelledby="sequence-title">
        <div className="panel-heading">
          <div>
            <p className="section-label">Observed sequence</p>
            <h2 id="sequence-title">Incident facts</h2>
          </div>
          <span>{observedFacts.length} facts</span>
        </div>
        <ol>
          {observedFacts.map((fact, index) => (
            <li key={fact}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <p>{fact}</p>
            </li>
          ))}
        </ol>
        <div className="known-good">
          <span className="state-label state-observed">● Known-good comparison</span>
          <p>{capsule.known_good_summary}</p>
        </div>
      </section>

      <section className="overview-panel environment-panel" aria-labelledby="environment-title">
        <div className="panel-heading">
          <div>
            <p className="section-label">Environment comparison</p>
            <h2 id="environment-title">What changed?</h2>
          </div>
          <span>{changedEnvironment} delta</span>
        </div>
        <div className="table-scroll" tabIndex={0} aria-label="Scrollable environment comparison">
          <table>
            <thead>
              <tr>
                <th scope="col">Setting</th>
                <th scope="col">Incident</th>
                <th scope="col">Known good</th>
              </tr>
            </thead>
            <tbody>
              {capsule.environment.map((item) => {
                const changed = item.incident_value !== item.known_good_value;
                return (
                  <tr className={changed ? "environment-changed" : ""} key={item.name}>
                    <th scope="row">{formatVariant(item.name)}</th>
                    <td>{item.incident_value}</td>
                    <td>{item.known_good_value ?? "Not supplied"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="overview-panel manifest-panel" aria-labelledby="manifest-title">
        <div className="panel-heading">
          <div>
            <p className="section-label">Manifest review</p>
            <h2 id="manifest-title">Included evidence</h2>
          </div>
          <span>Schema {capsule.schema_version}</span>
        </div>
        <div className="evidence-list" aria-label="Accepted evidence">
          {capsule.evidence.map((evidence) => (
            <article className="evidence-row" key={evidence.evidence_id}>
              <span className="evidence-status" aria-hidden="true">✓</span>
              <div>
                <strong>{evidence.evidence_id}</strong>
                <span>{evidence.provenance}</span>
                <code>{evidence.relative_path}</code>
              </div>
              <div className="evidence-meta">
                <span>{formatBytes(evidence.byte_size)}</span>
                <span>{evidence.redaction_status}</span>
              </div>
            </article>
          ))}
        </div>
        <div className="exclusion-list">
          <h3>Explicitly excluded</h3>
          <ul>
            {capsule.exclusions.map((exclusion) => (
              <li key={exclusion}><span aria-hidden="true">×</span>{exclusion}</li>
            ))}
          </ul>
        </div>
      </section>

      <aside className="readiness-panel" aria-labelledby="readiness-title">
        <div>
          <span className="readiness-symbol" aria-hidden="true">✓</span>
          <p className="section-label">Safety review passed</p>
          <h2 id="readiness-title">Ready to investigate</h2>
          <p>
            Schema, credential scan, file integrity, and evidence lineage passed.
            Network access is disabled.
          </p>
        </div>
        <div className={`missing-evidence ${capsule.missing_evidence.length ? "has-gaps" : ""}`}>
          <strong>Missing evidence</strong>
          {capsule.missing_evidence.length ? (
            <ul>
              {capsule.missing_evidence.map((item) => <li key={item}>{item}</li>)}
            </ul>
          ) : (
            <span>No required comparison gaps detected.</span>
          )}
        </div>
        <button
          className="primary-action planning-action"
          type="button"
          disabled={planningState === "planning" || planningState === "ready"}
          onClick={onCreateInvestigation}
        >
          {planningState === "planning"
            ? "Creating investigation"
            : planningState === "ready"
              ? "Investigation ready"
              : "Create investigation"}
          <span aria-hidden="true">→</span>
        </button>
      </aside>
    </div>
  );
}

function InvestigationPlan({
  investigation,
  executionState,
  liveEvents,
  onExecute,
}: {
  investigation: InvestigationDetail;
  executionState: ExecutionState;
  liveEvents: string[];
  onExecute: () => void;
}) {
  const execution = investigation.execution;
  const supportedHypothesis = investigation.hypotheses.find(
    (item) => item.hypothesis_id === execution?.supported_hypothesis_id,
  );
  return (
    <section className="investigation" aria-labelledby="investigation-title">
      <div className="investigation-heading">
        <div>
          <p className="section-label">Investigation ready</p>
          <h2 id="investigation-title">Three causal alternatives</h2>
          <p>
            Each hypothesis cites accepted evidence and maps to one bounded,
            app-owned experiment from the same clean checkpoint.
          </p>
        </div>
        <div className="investigation-identity">
          <span>{investigation.planning_source} plan</span>
          <code>{investigation.investigation_id}</code>
        </div>
      </div>

      <div className="hypothesis-grid">
        {investigation.hypotheses.map((hypothesis, index) => {
          const experiment = investigation.experiments.find(
            (item) => item.hypothesis_id === hypothesis.hypothesis_id,
          );
          const outcome = execution?.outcomes.find(
            (item) => item.hypothesis_id === hypothesis.hypothesis_id,
          );
          return (
            <article
              className={`hypothesis-card ${
                outcome ? `hypothesis-${outcome.hypothesis_disposition}` : ""
              }`}
              key={hypothesis.hypothesis_id}
            >
              <div className="hypothesis-topline">
                <span>H{index + 1}</span>
                <strong>{Math.round(hypothesis.confidence * 100)}%</strong>
              </div>
              <h3>{hypothesis.title}</h3>
              <div className="hypothesis-copy">
                <span>Proposed mechanism</span>
                <p>{hypothesis.mechanism}</p>
              </div>
              <div className="hypothesis-copy">
                <span>Inference from evidence</span>
                <p>{hypothesis.rationale}</p>
              </div>
              <div className="prediction">
                <span>Testable prediction</span>
                <p>{hypothesis.testable_prediction}</p>
              </div>
              <div className="evidence-links" aria-label="Evidence links">
                {hypothesis.evidence_ids.map((evidenceId) => (
                  <span key={evidenceId}>{evidenceId}</span>
                ))}
              </div>
              {experiment && (
                <div className="experiment-plan">
                  <span>{outcome ? "Branch result" : "Queued experiment"}</span>
                  <strong>{formatVariant(experiment.variant)}</strong>
                  <small>
                    limit: {experiment.operation_limit} operations · {experiment.timeout_seconds}s
                  </small>
                  {outcome && (
                    <div className="outcome-row">
                      <strong>
                        {formatDisposition(outcome.hypothesis_disposition)}
                      </strong>
                      <span>{formatVariant(outcome.verdict)}</span>
                    </div>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>

      <div className="planning-footer">
        <div>
          <p className="section-label">Persisted timeline</p>
          <ol>
            {investigation.events.map((event) => (
              <li key={event.sequence}>{event.event_type.replaceAll(".", " ")}</li>
            ))}
          </ol>
        </div>
        {execution ? (
          <div className="execution-result">
            <span aria-hidden="true">✓</span>
            <div>
              <strong>Supported cause</strong>
              <p>{supportedHypothesis?.title ?? "No single supported cause"}</p>
              <small>
                {execution.isolation_verified ? "Isolation verified" : "Isolation unverified"}
                {" · "}{execution.operation_count} operations{" · "}
                {execution.retry_count} retries
              </small>
              <a
                className="reproduction-download"
                href={`/api/investigations/${investigation.investigation_id}/reproduction.zip`}
                download="scully-proxy-identity-collapse.zip"
              >
                Download reproduction
                <span aria-hidden="true">↓</span>
              </a>
            </div>
          </div>
        ) : (
          <div className="execution-lock">
            <span aria-hidden="true">◇</span>
            <div>
              <strong>Local execution ready</strong>
              <p>Run all three allowlisted branches from one clean checkpoint.</p>
              <button
                className="primary-action execution-action"
                type="button"
                disabled={executionState === "running"}
                onClick={onExecute}
              >
                {executionState === "running" ? "Running branches" : "Run 3 branches"}
                <span aria-hidden="true">→</span>
              </button>
              {executionState === "running" && liveEvents.length > 0 && (
                <div className="live-progress" role="status">
                  <span className="live-pulse" aria-hidden="true" />
                  <div>
                    <strong>{formatVariant(liveEvents.at(-1) ?? "execution started")}</strong>
                    <small>{liveEvents.length} live events received</small>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function formatBytes(bytes: number) {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

function formatVariant(variant: string) {
  return variant.replaceAll("-", " ").replaceAll("_", " ");
}

function formatDisposition(disposition: ExperimentOutcome["hypothesis_disposition"]) {
  if (disposition === "supported") return "Supports hypothesis";
  if (disposition === "eliminated") return "Hypothesis eliminated";
  return "Inconclusive";
}

function parseSseFrame(frame: string) {
  const lines = frame.split("\n");
  const eventType = lines.find((line) => line.startsWith("event: "))?.slice(7);
  const data = lines.find((line) => line.startsWith("data: "))?.slice(6);
  if (!eventType || !data) return null;
  return { eventType, payload: JSON.parse(data) as unknown };
}
