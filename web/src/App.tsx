import { useEffect, useRef, useState, type RefObject } from "react";

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

type LiveEvent = {
  eventType: string;
  payload: Record<string, unknown>;
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
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([]);
  const [selectedExperimentId, setSelectedExperimentId] = useState<string | null>(null);
  const [proofVisible, setProofVisible] = useState(false);
  const [inspectorVisited, setInspectorVisited] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const rejectionRef = useRef<HTMLDivElement>(null);
  const overviewHeadingRef = useRef<HTMLHeadingElement>(null);
  const hypothesisHeadingRef = useRef<HTMLHeadingElement>(null);
  const inspectorHeadingRef = useRef<HTMLHeadingElement>(null);
  const proofHeadingRef = useRef<HTMLHeadingElement>(null);

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

  useEffect(() => {
    if (investigation && !selectedExperimentId && !proofVisible) {
      hypothesisHeadingRef.current?.focus();
    }
  }, [investigation?.investigation_id, proofVisible, selectedExperimentId]);

  useEffect(() => {
    if (selectedExperimentId) inspectorHeadingRef.current?.focus();
  }, [selectedExperimentId]);

  useEffect(() => {
    if (proofVisible) proofHeadingRef.current?.focus();
  }, [proofVisible]);

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
      setSelectedExperimentId(null);
      setProofVisible(false);
      setInspectorVisited(false);
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
      setSelectedExperimentId(null);
      setProofVisible(false);
      setInspectorVisited(false);
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
    setProofVisible(false);
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
            setLiveEvents((current) => [
              ...current,
              {
                eventType: message.eventType,
                payload: isRecord(message.payload) ? message.payload : {},
              },
            ]);
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

  const progressItems = [
    {
      label: "Intake",
      state: capsule ? "complete" : "current",
      optional: false,
    },
    {
      label: "Overview",
      state: investigation ? "complete" : capsule ? "current" : "pending",
      optional: false,
    },
    {
      label: "Hypotheses",
      state: selectedExperimentId || proofVisible
        ? "complete"
        : investigation
          ? "current"
          : "pending",
      optional: false,
    },
    {
      label: "Inspector",
      state: selectedExperimentId
        ? "current"
        : inspectorVisited
          ? "complete"
          : "pending",
      optional: true,
    },
    {
      label: "Proof",
      state: proofVisible ? "current" : "pending",
      optional: false,
    },
  ] as const;

  function inspectExperiment(experimentId: string) {
    setInspectorVisited(true);
    setSelectedExperimentId(experimentId);
  }

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
          {progressItems.map(
            ({ label, state, optional }, index) => {
              const step = index + 1;
              return (
                <li className={`progress-${state}`} key={label}>
                  <span aria-hidden="true">{state === "complete" ? "✓" : step}</span>
                  <strong aria-current={state === "current" ? "step" : undefined}>
                    {label}
                  </strong>
                  {optional && <small>Optional audit</small>}
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
                    Use the reviewed realistic seed or provide a ZIP that follows
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
        ) : investigation && proofVisible && investigation.execution ? (
          <ReproductionProof
            capsule={capsule}
            investigation={investigation}
            headingRef={proofHeadingRef}
            onReturn={() => setProofVisible(false)}
          />
        ) : selectedExperimentId && investigation ? (
          <ExperimentInspector
            capsule={capsule}
            investigation={investigation}
            selectedExperimentId={selectedExperimentId}
            headingRef={inspectorHeadingRef}
            onSelectExperiment={setSelectedExperimentId}
            onReturn={() => setSelectedExperimentId(null)}
          />
        ) : investigation ? (
          <HypothesisMap
            investigation={investigation}
            executionState={executionState}
            executionError={executionError}
            liveEvents={liveEvents}
            headingRef={hypothesisHeadingRef}
            onInspect={inspectExperiment}
            onOpenProof={() => setProofVisible(true)}
            onExecute={() =>
              void executeInvestigation(investigation.investigation_id)
            }
          />
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

function HypothesisMap({
  investigation,
  executionState,
  executionError,
  liveEvents,
  headingRef,
  onInspect,
  onOpenProof,
  onExecute,
}: {
  investigation: InvestigationDetail;
  executionState: ExecutionState;
  executionError: string | null;
  liveEvents: LiveEvent[];
  headingRef: RefObject<HTMLHeadingElement | null>;
  onInspect: (experimentId: string) => void;
  onOpenProof: () => void;
  onExecute: () => void;
}) {
  const execution = investigation.execution;
  const checkpointId = investigation.experiments[0]?.checkpoint_id;
  const supportedHypothesis = investigation.hypotheses.find(
    (item) => item.hypothesis_id === execution?.supported_hypothesis_id,
  );
  const supportedExperiment = investigation.experiments.find(
    (item) => item.hypothesis_id === execution?.supported_hypothesis_id,
  );
  const latestEvent = liveEvents.at(-1);

  return (
    <section className="screen hypothesis-screen" aria-labelledby="hypothesis-map-title">
      <div className="screen-heading">
        <div>
          <p className="screen-kicker">03 · Hypothesis map</p>
          <h1 id="hypothesis-map-title" ref={headingRef} tabIndex={-1}>
            What is suspected, tested, eliminated, or reproduced?
          </h1>
          <p>
            Three mutually exclusive explanations branch from one immutable
            checkpoint. Experimental result and hypothesis disposition remain separate.
          </p>
        </div>
        <div className="investigation-identity">
          <span>{investigation.planning_source} plan</span>
          <code>{investigation.investigation_id}</code>
        </div>
      </div>

      <aside className="map-reading-key" aria-label="How to read branch results">
        <div>
          <span className="state-label state-eliminated"><span aria-hidden="true">×</span> Failure eliminated</span>
          <p>The intervention removed the signature, so its causal hypothesis is supported.</p>
        </div>
        <div>
          <span className="state-label state-reproduced"><span aria-hidden="true">✓</span> Reproduced</span>
          <p>The signature remained, so that intervention hypothesis is eliminated.</p>
        </div>
      </aside>

      <div className="checkpoint-card">
        <span className="checkpoint-symbol" aria-hidden="true">◎</span>
        <div>
          <p className="section-label">Common clean checkpoint</p>
          <strong>{checkpointId}</strong>
          <small>Every branch receives the same accepted evidence and isolated starting state.</small>
        </div>
        <span className="checkpoint-status">Immutable</span>
      </div>

      <div className="branch-connector" aria-hidden="true" />
      <div className="hypothesis-grid" role="list" aria-label="Causal alternatives">
        {investigation.hypotheses.map((hypothesis, index) => {
          const experiment = investigation.experiments.find(
            (item) => item.hypothesis_id === hypothesis.hypothesis_id,
          );
          if (!experiment) return null;
          const outcome = execution?.outcomes.find(
            (item) => item.hypothesis_id === hypothesis.hypothesis_id,
          );
          const liveProgress = executionState === "running"
            ? branchProgress(liveEvents, experiment.experiment_id)
            : undefined;
          const state = branchState(outcome, liveProgress);
          return (
            <article
              className={`hypothesis-card branch-${state.key}`}
              key={hypothesis.hypothesis_id}
              role="listitem"
            >
              <div className="hypothesis-topline">
                <span>H{index + 1}</span>
                <span className={`state-label state-${state.key}`}>
                  <span aria-hidden="true">{state.symbol}</span> {state.label}
                </span>
              </div>
              <h2>{hypothesis.title}</h2>
              <p className="branch-mechanism">{hypothesis.mechanism}</p>
              <div className="prediction">
                <span>Testable prediction</span>
                <p>{hypothesis.testable_prediction}</p>
              </div>
              <div className="branch-evidence">
                <span>Accepted evidence</span>
                <div className="evidence-links" aria-label={`Evidence for ${hypothesis.title}`}>
                  {hypothesis.evidence_ids.map((evidenceId) => (
                    <span key={evidenceId}>{evidenceId}</span>
                  ))}
                </div>
              </div>
              <dl className="branch-plan">
                <div>
                  <dt>Experiment</dt>
                  <dd>{formatVariant(experiment.variant)}</dd>
                </div>
                <div>
                  <dt>Budget</dt>
                  <dd>{experiment.operation_limit} ops, {experiment.timeout_seconds}s</dd>
                </div>
                <div>
                  <dt>Confidence</dt>
                  <dd>{Math.round(hypothesis.confidence * 100)}%</dd>
                </div>
              </dl>
              <div className="branch-result">
                <strong>{state.detail}</strong>
                {outcome && (
                  <span>{formatDisposition(outcome.hypothesis_disposition)}</span>
                )}
                {!outcome && state.disposition && <span>{state.disposition}</span>}
              </div>
              <button
                className="inspect-action"
                type="button"
                onClick={() => onInspect(experiment.experiment_id)}
              >
                Inspect branch H{index + 1}
                <span aria-hidden="true">→</span>
              </button>
            </article>
          );
        })}
      </div>

      <div className="map-footer">
        <section className="timeline-panel" aria-labelledby="timeline-title">
          <div className="panel-heading compact-heading">
            <div>
              <p className="section-label">Persisted timeline</p>
              <h2 id="timeline-title">Investigation events</h2>
            </div>
            <span>{investigation.events.length} stored</span>
          </div>
          <ol>
            {investigation.events.map((event) => (
              <li key={event.sequence}>
                <span>{String(event.sequence).padStart(2, "0")}</span>
                {formatVariant(event.event_type)}
              </li>
            ))}
          </ol>
        </section>

        {execution?.supported_hypothesis_id ? (
          <aside className="execution-result map-result" aria-labelledby="result-title">
            <span aria-hidden="true">✓</span>
            <div>
              <p className="section-label">Reproduction proof ready</p>
              <h2 id="result-title">Winning experiment</h2>
              <p>{supportedExperiment ? formatVariant(supportedExperiment.variant) : "Unavailable"}</p>
              <strong className="winner-cause">Supports: {supportedHypothesis?.title}</strong>
              <span className="winner-reason">
                Changing only trust proxy from false to loopback removed HTTP 429.
              </span>
              <small>
                {execution.isolation_verified ? "Isolation verified" : "Isolation unverified"}
                {" · "}{execution.operation_count} operations{" · "}
                {execution.retry_count} retries
              </small>
              <button
                className="primary-action proof-action"
                type="button"
                onClick={onOpenProof}
              >
                Review reproduction proof
                <span aria-hidden="true">→</span>
              </button>
            </div>
          </aside>
        ) : execution ? (
          <aside className="execution-lock map-execution proof-partial" aria-labelledby="partial-proof-title">
            <span aria-hidden="true">?</span>
            <div>
              <p className="section-label">Partial result</p>
              <h2 id="partial-proof-title">Proof unavailable: no single supported cause</h2>
              <p>
                The branch map remains the final result until one causal
                alternative has inspectable support.
              </p>
            </div>
          </aside>
        ) : (
          <aside className="execution-lock map-execution" aria-labelledby="execution-title">
            <span aria-hidden="true">◇</span>
            <div>
              <p className="section-label">Bounded execution</p>
              <h2 id="execution-title">
                {executionState === "running"
                  ? "Building proof evidence"
                  : executionState === "rejected"
                    ? "Proof unavailable after execution stopped"
                    : "Run from one checkpoint"}
              </h2>
              <p>
                {executionState === "rejected"
                  ? executionError ?? "The bounded execution did not complete."
                  : executionState === "running"
                    ? "Completed sibling results remain visible while the bounded run continues."
                    : "Proof unavailable until execution completes. Run all three allowlisted branches with no network access."}
              </p>
              <button
                className="primary-action execution-action"
                type="button"
                disabled={executionState === "running"}
                onClick={onExecute}
              >
                {executionState === "running"
                  ? "Running branches"
                  : executionState === "rejected"
                    ? "Retry 3 branches"
                    : "Run 3 branches"}
                <span aria-hidden="true">→</span>
              </button>
              {executionState === "running" && latestEvent && (
                <div className="live-progress" role="status" aria-live="polite">
                  <span className="live-pulse" aria-hidden="true" />
                  <div>
                    <strong>{formatVariant(latestEvent.eventType)}</strong>
                    <small>{liveEvents.length} execution events received</small>
                  </div>
                </div>
              )}
            </div>
          </aside>
        )}
      </div>
    </section>
  );
}

function ReproductionProof({
  capsule,
  investigation,
  headingRef,
  onReturn,
}: {
  capsule: CapsuleSummary;
  investigation: InvestigationDetail;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onReturn: () => void;
}) {
  const execution = investigation.execution;
  if (!execution?.supported_hypothesis_id) return null;

  const supportedHypothesis = investigation.hypotheses.find(
    (item) => item.hypothesis_id === execution.supported_hypothesis_id,
  );
  const supportedExperiment = investigation.experiments.find(
    (item) => item.hypothesis_id === execution.supported_hypothesis_id,
  );
  const supportedOutcome = execution.outcomes.find(
    (item) => item.hypothesis_id === execution.supported_hypothesis_id,
  );
  const reproducedOutcome = execution.outcomes.find(
    (item) => item.status === "reproduced",
  );
  if (!supportedHypothesis || !supportedExperiment || !supportedOutcome) return null;

  const linkedEvidence = supportedHypothesis.evidence_ids
    .map((evidenceId) => capsule.evidence.find((item) => item.evidence_id === evidenceId))
    .filter((item): item is EvidenceReference => Boolean(item));
  const limitations = [
    ...execution.limitations,
    "The archive covers one sanitized realistic Express proxy-trust incident.",
    "Raw standard output is not retained; digests and matcher results are the audit boundary.",
    "Provider execution and remote cancellation are outside this local proof.",
  ];

  return (
    <section className="screen proof-screen" aria-labelledby="proof-title">
      <button className="back-action" type="button" onClick={onReturn}>
        <span aria-hidden="true">←</span> Return to hypothesis map
      </button>

      <div className="screen-heading proof-heading">
        <div>
          <p className="screen-kicker">05 · Reproduction proof</p>
          <h1 id="proof-title" ref={headingRef} tabIndex={-1}>
            What can another engineer run and verify?
          </h1>
          <p>
            One supported cause is connected to the accepted observation,
            bounded experiment, deterministic result, and runnable archive.
          </p>
        </div>
        <span className="state-label state-reproduced">
          <span aria-hidden="true">✓</span> Proof ready
        </span>
      </div>

      <section className="proof-verdict" aria-labelledby="proof-cause-title">
        <div>
          <p className="section-label">Supported cause</p>
          <h2 id="proof-cause-title">{supportedHypothesis.title}</h2>
          <p>{supportedHypothesis.mechanism}</p>
        </div>
        <dl>
          <div><dt>Experiment</dt><dd>{supportedExperiment.experiment_id}</dd></div>
          <div><dt>Disposition</dt><dd>{formatDisposition(supportedOutcome.hypothesis_disposition)}</dd></div>
          <div><dt>Evaluator</dt><dd>Version {execution.evaluator_version}</dd></div>
          <div><dt>Isolation</dt><dd>{execution.isolation_verified ? "Verified" : "Unverified"}</dd></div>
        </dl>
      </section>

      <div className="signature-comparison" aria-label="Original and reproduced failure signatures">
        <article>
          <p className="section-label">Original signature</p>
          <h2>{capsule.signature_id}</h2>
          <p>{capsule.observed_summary}</p>
          <small>{capsule.signature_matcher_count} declared matchers from accepted evidence</small>
        </article>
        <span className="signature-link">
          <span aria-hidden="true">=</span>
          <small>Exact match</small>
        </span>
        <article>
          <p className="section-label">Reproduced signature</p>
          <h2>{execution.signature_id}</h2>
          <p>
            Two synthetic clients cross one loopback proxy, resolve to one limiter
            identity, and return 200,429.
          </p>
          <small>
            {reproducedOutcome?.matcher_results.filter((item) => item.required && item.passed).length ?? 0}
            {" "}required matcher results passed
          </small>
        </article>
      </div>

      <div className="proof-grid">
        <section className="proof-panel proof-lineage" aria-labelledby="proof-lineage-title">
          <div className="panel-heading compact-heading">
            <div><p className="section-label">Evidence lineage</p><h2 id="proof-lineage-title">Observation to runnable result</h2></div>
            <span>{linkedEvidence.length} accepted sources</span>
          </div>
          <ol>
            <li><span>01</span><div><strong>Accepted observation</strong><p>{linkedEvidence.map((item) => item.evidence_id).join(", ")}</p></div></li>
            <li><span>02</span><div><strong>Failure signature</strong><p>{capsule.signature_id}</p></div></li>
            <li><span>03</span><div><strong>Supported hypothesis</strong><p>{supportedHypothesis.hypothesis_id}</p></div></li>
            <li><span>04</span><div><strong>Cause-eliminating experiment</strong><p>{formatVariant(supportedExperiment.variant)}</p></div></li>
            <li><span>05</span><div><strong>Deterministic result</strong><p><code>{supportedOutcome.observation_digest}</code></p></div></li>
            <li><span>06</span><div><strong>Runnable archive</strong><p>Manifest binds this investigation, signature, cause, and file hashes.</p></div></li>
          </ol>
        </section>

        <section className="proof-panel minimal-delta" aria-labelledby="minimal-delta-title">
          <div className="panel-heading compact-heading">
            <div><p className="section-label">Smallest known delta</p><h2 id="minimal-delta-title">One environment change</h2></div>
            <span>Input unchanged</span>
          </div>
          <div className="unchanged-input">
            <strong>Accepted input</strong>
            <p>Same evidence IDs, two-request sequence, and clean checkpoint.</p>
          </div>
          <div className="proof-diff">
            {Object.entries(supportedExperiment.parameters).map(([name, value]) => (
              <div key={name}>
                <strong>{formatVariant(name)}</strong>
                <span><small>Incident</small>{baselineValue(name)}</span>
                <span><small>Cause eliminated</small>{String(value)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="proof-panel test-contract" aria-labelledby="test-contract-title">
          <div className="panel-heading compact-heading">
            <div><p className="section-label">Runnable regression test</p><h2 id="test-contract-title">An intentionally failing witness</h2></div>
            <code>npm test</code>
          </div>
          <p>
            The test expects two independent client buckets. The reproduced
            incident violates that expectation and exits with status 1.
          </p>
          <strong className="expected-failure">Expected failure, not a setup error</strong>
          <dl>
            <div><dt>Expected</dt><dd>200,200</dd></div>
            <div><dt>Observed</dt><dd>200,429</dd></div>
            <div><dt>Expected exit</dt><dd>1</dd></div>
          </dl>
        </section>

        <section className="proof-panel reproduction-steps" aria-labelledby="reproduction-steps-title">
          <div className="panel-heading compact-heading">
            <div><p className="section-label">Reproduction steps</p><h2 id="reproduction-steps-title">Run from a clean directory</h2></div>
          </div>
          <ol>
            <li><span>1</span><code>unzip scully-proxy-identity-collapse.zip</code></li>
            <li><span>2</span><code>cd scully-proxy-identity-collapse</code></li>
            <li><span>3</span><code>npm ci</code></li>
            <li><span>4</span><code>npm run verify</code></li>
            <li><span>5</span><code>npm test</code></li>
          </ol>
        </section>

        <section className="proof-panel export-panel" aria-labelledby="export-title">
          <div>
            <p className="section-label">Export</p>
            <h2 id="export-title">Download the reproduction</h2>
            <p>
              The deterministic ZIP includes setup instructions, locked
              dependencies, source, a verifier, the failing test, and a hashed manifest.
            </p>
          </div>
          <dl>
            <div><dt>Execution</dt><dd>{execution.execution_source}</dd></div>
            <div><dt>Operations</dt><dd>{execution.operation_count}</dd></div>
            <div><dt>Retries</dt><dd>{execution.retry_count}</dd></div>
          </dl>
          <a
            className="primary-action proof-download"
            href={`/api/investigations/${investigation.investigation_id}/reproduction.zip`}
            download="scully-proxy-identity-collapse.zip"
          >
            Download reproduction
            <span aria-hidden="true">↓</span>
          </a>
        </section>

        <aside className="proof-panel limitations-panel" aria-labelledby="limitations-title">
          <div className="panel-heading compact-heading">
            <div><p className="section-label">Boundaries</p><h2 id="limitations-title">Limitations and uncertainty</h2></div>
          </div>
          <ul>
            {limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
          </ul>
        </aside>
      </div>
    </section>
  );
}

function ExperimentInspector({
  capsule,
  investigation,
  selectedExperimentId,
  headingRef,
  onSelectExperiment,
  onReturn,
}: {
  capsule: CapsuleSummary;
  investigation: InvestigationDetail;
  selectedExperimentId: string;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onSelectExperiment: (experimentId: string) => void;
  onReturn: () => void;
}) {
  const experiment = investigation.experiments.find(
    (item) => item.experiment_id === selectedExperimentId,
  );
  const fallbackComparison = investigation.experiments.find(
    (item) => item.experiment_id !== selectedExperimentId,
  );
  const [comparisonExperimentId, setComparisonExperimentId] = useState(
    fallbackComparison?.experiment_id ?? "",
  );
  useEffect(() => {
    if (
      comparisonExperimentId === selectedExperimentId ||
      !investigation.experiments.some(
        (item) => item.experiment_id === comparisonExperimentId,
      )
    ) {
      setComparisonExperimentId(fallbackComparison?.experiment_id ?? "");
    }
  }, [comparisonExperimentId, fallbackComparison?.experiment_id, investigation.experiments, selectedExperimentId]);
  const hypothesis = investigation.hypotheses.find(
    (item) => item.hypothesis_id === experiment?.hypothesis_id,
  );
  if (!experiment || !hypothesis) return null;

  const outcome = investigation.execution?.outcomes.find(
    (item) => item.experiment_id === experiment.experiment_id,
  );
  const otherExperiments = investigation.experiments.filter(
    (item) => item.experiment_id !== experiment.experiment_id,
  );
  const comparison = otherExperiments.find(
    (item) => item.experiment_id === comparisonExperimentId,
  ) ?? otherExperiments[0];
  const comparisonHypothesis = investigation.hypotheses.find(
    (item) => item.hypothesis_id === comparison?.hypothesis_id,
  );
  const state = branchState(outcome);
  const evidence = hypothesis.evidence_ids
    .map((evidenceId) => capsule.evidence.find((item) => item.evidence_id === evidenceId))
    .filter((item): item is EvidenceReference => Boolean(item));

  return (
    <section className="screen inspector-screen" aria-labelledby="inspector-title">
      <button className="back-action" type="button" onClick={onReturn}>
        <span aria-hidden="true">←</span> Return to hypothesis map
      </button>
      <div className="screen-heading inspector-heading">
        <div>
          <p className="screen-kicker">04 · Experiment inspector</p>
          <h1 id="inspector-title" ref={headingRef} tabIndex={-1}>
            What exactly happened in this branch?
          </h1>
          <p>
            Inspect the bounded change, retained output, deterministic matchers,
            and accepted evidence for one isolated experiment.
          </p>
        </div>
        <span className={`state-label state-${state.key}`}>
          <span aria-hidden="true">{state.symbol}</span> {state.label}
        </span>
      </div>

      <section className="inspector-summary" aria-labelledby="inspected-hypothesis-title">
        <div>
          <p className="section-label">Inspected hypothesis</p>
          <h2 id="inspected-hypothesis-title">{hypothesis.title}</h2>
          <p>{hypothesis.testable_prediction}</p>
        </div>
        <dl>
          <div><dt>Experiment</dt><dd>{experiment.experiment_id}</dd></div>
          <div><dt>Checkpoint</dt><dd>{experiment.checkpoint_id}</dd></div>
          <div><dt>Result</dt><dd>{outcome ? formatVariant(outcome.status) : "Not run"}</dd></div>
          <div><dt>Hypothesis</dt><dd>{outcome ? formatDisposition(outcome.hypothesis_disposition) : "Untested"}</dd></div>
        </dl>
      </section>

      <div className="inspector-grid">
        <section className="inspector-panel comparison-panel" aria-labelledby="comparison-title">
          <div className="panel-heading compact-heading">
            <div>
              <p className="section-label">Branch comparison</p>
              <h2 id="comparison-title">Selected and nearest alternative</h2>
            </div>
            <label>
              Compare with
              <select
                value={comparison?.experiment_id ?? ""}
                onChange={(event) => setComparisonExperimentId(event.currentTarget.value)}
              >
                {otherExperiments.map((item) => {
                  const itemHypothesis = investigation.hypotheses.find(
                    (candidate) => candidate.hypothesis_id === item.hypothesis_id,
                  );
                  return <option value={item.experiment_id} key={item.experiment_id}>{itemHypothesis?.title}</option>;
                })}
              </select>
            </label>
            <button
              className="comparison-action"
              type="button"
              disabled={!comparison}
              onClick={() => comparison && onSelectExperiment(comparison.experiment_id)}
            >
              Inspect comparison
            </button>
          </div>
          <div className="table-scroll" tabIndex={0} aria-label="Scrollable branch comparison">
            <table>
              <thead>
                <tr><th scope="col">Field</th><th scope="col">Selected</th><th scope="col">Alternative</th></tr>
              </thead>
              <tbody>
                <tr><th scope="row">Hypothesis</th><td>{hypothesis.title}</td><td>{comparisonHypothesis?.title}</td></tr>
                <tr><th scope="row">Variant</th><td>{formatVariant(experiment.variant)}</td><td>{comparison ? formatVariant(comparison.variant) : "None"}</td></tr>
                <tr><th scope="row">Change</th><td>{formatParameters(experiment.parameters)}</td><td>{comparison ? formatParameters(comparison.parameters) : "None"}</td></tr>
                <tr><th scope="row">Status</th><td>{state.label}</td><td>{comparison ? branchState(investigation.execution?.outcomes.find((item) => item.experiment_id === comparison.experiment_id)).label : "None"}</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="inspector-panel plan-panel" aria-labelledby="plan-title">
          <div className="panel-heading compact-heading">
            <div><p className="section-label">Experiment plan</p><h2 id="plan-title">Bounded operation</h2></div>
            <span>{experiment.operation_limit} ops max</span>
          </div>
          <dl className="plan-facts">
            <div><dt>Adapter</dt><dd>{formatVariant(experiment.adapter)}</dd></div>
            <div><dt>Variant</dt><dd>{formatVariant(experiment.variant)}</dd></div>
            <div><dt>Timeout</dt><dd>{experiment.timeout_seconds} seconds</dd></div>
            <div><dt>Network</dt><dd>Disabled</dd></div>
          </dl>
          <code className="operation-code">apply_allowlisted_variant {experiment.variant}</code>
        </section>

        <section className="inspector-panel diff-panel" aria-labelledby="input-diff-title">
          <div className="panel-heading compact-heading">
            <div><p className="section-label">Input diff</p><h2 id="input-diff-title">Accepted inputs unchanged</h2></div>
            <span className="unchanged-label">0 changes</span>
          </div>
          <div className="linear-diff">
            <div><span>Before</span><p>Accepted capsule evidence from the common checkpoint</p></div>
            <div><span>After</span><p>Same evidence IDs, request sequence, and checkpoint</p></div>
          </div>
        </section>

        <section className="inspector-panel diff-panel" aria-labelledby="environment-diff-title">
          <div className="panel-heading compact-heading">
            <div><p className="section-label">Environment diff</p><h2 id="environment-diff-title">Allowlisted branch change</h2></div>
            <span>{Object.keys(experiment.parameters).length} change</span>
          </div>
          <div className="diff-rows">
            {Object.entries(experiment.parameters).map(([name, value]) => (
              <div key={name}>
                <strong>{formatVariant(name)}</strong>
                <span className="diff-before">− {baselineValue(name)}</span>
                <span className="diff-after">+ {String(value)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="inspector-panel output-panel" aria-labelledby="output-title">
          <div className="panel-heading compact-heading">
            <div><p className="section-label">Retained command output</p><h2 id="output-title">Bounded operation result</h2></div>
            <span>{outcome ? `${outcome.duration_ms.toFixed(2)} ms` : "Pending"}</span>
          </div>
          {outcome ? (
            <>
              <dl className="output-facts">
                <div><dt>Exit status</dt><dd>{terminalExitStatus(outcome.status)}</dd></div>
                <div><dt>Verdict</dt><dd>{formatVariant(outcome.verdict)}</dd></div>
                <div><dt>Observation digest</dt><dd><code>{outcome.observation_digest}</code></dd></div>
              </dl>
              <p className="retention-note">Raw stdout is not retained. The digest and deterministic matcher results are the inspectable output boundary.</p>
            </>
          ) : (
            <p className="empty-inspector-state">This branch has not run. The plan and expected diff remain inspectable.</p>
          )}
        </section>

        <section className="inspector-panel matcher-panel" aria-labelledby="matcher-title">
          <div className="panel-heading compact-heading">
            <div><p className="section-label">Deterministic evaluation</p><h2 id="matcher-title">Signature matchers</h2></div>
            <span>{outcome?.matcher_results.length ?? 0} results</span>
          </div>
          {outcome?.matcher_results.length ? (
            <div className="table-scroll" tabIndex={0} aria-label="Scrollable matcher results">
              <table>
                <thead><tr><th scope="col">Matcher</th><th scope="col">Required</th><th scope="col">Result</th><th scope="col">Reason</th></tr></thead>
                <tbody>
                  {outcome.matcher_results.map((matcher) => (
                    <tr key={matcher.matcher_id}>
                      <th scope="row">{formatVariant(matcher.matcher_id)}</th>
                      <td>{matcher.required ? "Yes" : "No"}</td>
                      <td>{matcher.passed ? "Passed" : "Did not pass"}</td>
                      <td>{formatVariant(matcher.reason)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty-inspector-state">Matcher results appear after branch execution.</p>
          )}
          {outcome?.elimination_reasons.length ? (
            <div className="disposition-reason">
              <strong>Why the hypothesis changed state</strong>
              <ul>{outcome.elimination_reasons.map((reason) => <li key={reason}>{formatVariant(reason)}</li>)}</ul>
            </div>
          ) : null}
        </section>

        <section className="inspector-panel lineage-panel" aria-labelledby="lineage-title">
          <div className="panel-heading compact-heading">
            <div><p className="section-label">Source evidence</p><h2 id="lineage-title">Accepted lineage</h2></div>
            <span>{evidence.length} linked</span>
          </div>
          <ul>
            {evidence.map((item) => (
              <li key={item.evidence_id}>
                <span aria-hidden="true">●</span>
                <div><strong>{item.evidence_id}</strong><p>{item.provenance}</p><code>{item.relative_path}</code></div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </section>
  );
}

function formatBytes(bytes: number) {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

function formatVariant(variant: string) {
  return variant.replaceAll("-", " ").replaceAll("_", " ").replaceAll(".", " ");
}

function formatDisposition(disposition: ExperimentOutcome["hypothesis_disposition"]) {
  if (disposition === "supported") return "Supports hypothesis";
  if (disposition === "eliminated") return "Hypothesis eliminated";
  return "Inconclusive";
}

function branchState(
  outcome: ExperimentOutcome | undefined,
  liveProgress?: { status?: string; disposition?: string; started: boolean },
) {
  const liveStatus = liveProgress?.status;
  const liveDisposition = liveProgress?.disposition;
  if (!outcome && liveStatus === "reproduced") {
    return {
      key: "reproduced",
      symbol: "✓",
      label: "Reproduced",
      detail: "Failure reproduced; completed sibling retained.",
      disposition: liveDisposition ? formatVariant(liveDisposition) : "Evaluation pending",
    } as const;
  }
  if (!outcome && liveStatus === "eliminated") {
    return {
      key: "eliminated",
      symbol: "×",
      label: "Failure eliminated",
      detail: "Failure did not reproduce; completed sibling retained.",
      disposition: liveDisposition ? formatVariant(liveDisposition) : "Evaluation pending",
    } as const;
  }
  if (
    !outcome &&
    (liveStatus === "failed" || liveStatus === "timed_out" || liveStatus === "inconclusive")
  ) {
    return {
      key: "inconclusive",
      symbol: "?",
      label: "Inconclusive",
      detail: "The branch completed without a causal conclusion.",
      disposition: liveDisposition ? formatVariant(liveDisposition) : "Evaluation pending",
    } as const;
  }
  if (liveProgress?.started && !outcome) {
    return {
      key: "testing",
      symbol: "▶",
      label: "Testing",
      detail: "The allowlisted operation is running.",
      disposition: undefined,
    } as const;
  }
  if (!outcome) {
    return {
      key: "inferred",
      symbol: "◇",
      label: "Hypothesis",
      detail: "Untested causal alternative.",
      disposition: undefined,
    } as const;
  }
  if (outcome.status === "reproduced") {
    return {
      key: "reproduced",
      symbol: "✓",
      label: "Reproduced",
      detail: "Failure reproduced; intervention hypothesis eliminated.",
      disposition: undefined,
    } as const;
  }
  if (outcome.hypothesis_disposition === "supported") {
    return {
      key: "eliminated",
      symbol: "×",
      label: "Failure eliminated",
      detail: "Failure did not reproduce; hypothesis supported.",
      disposition: undefined,
    } as const;
  }
  return {
    key: "inconclusive",
    symbol: "?",
    label: "Inconclusive",
    detail: "Current evidence does not support a causal conclusion.",
    disposition: undefined,
  } as const;
}

function branchProgress(events: LiveEvent[], experimentId: string) {
  const branchEvents = events.filter(
    (event) => event.payload.experiment_id === experimentId,
  );
  const result = [...branchEvents]
    .reverse()
    .find((event) => event.eventType === "experiment.result");
  const evaluation = [...branchEvents]
    .reverse()
    .find((event) => event.eventType === "evaluation.completed");
  return {
    started: branchEvents.some((event) => event.eventType === "experiment.started"),
    status: typeof result?.payload.status === "string" ? result.payload.status : undefined,
    disposition:
      typeof evaluation?.payload.hypothesis_disposition === "string"
        ? evaluation.payload.hypothesis_disposition
        : undefined,
  };
}

function formatParameters(parameters: Record<string, string | number | boolean>) {
  return Object.entries(parameters)
    .map(([name, value]) => `${formatVariant(name)}: ${String(value)}`)
    .join(", ");
}

function baselineValue(name: string) {
  if (name === "trust_proxy") return "false";
  if (name === "limiter_key") return "identity";
  if (name === "proxy_mode") return "default chain";
  return "not set";
}

function terminalExitStatus(status: string) {
  return status === "eliminated" || status === "reproduced" ? "0" : "Unavailable";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSseFrame(frame: string) {
  const lines = frame.split("\n");
  const eventType = lines.find((line) => line.startsWith("event: "))?.slice(7);
  const data = lines.find((line) => line.startsWith("data: "))?.slice(6);
  if (!eventType || !data) return null;
  return { eventType, payload: JSON.parse(data) as unknown };
}
