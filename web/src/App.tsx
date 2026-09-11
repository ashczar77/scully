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
  evidence: EvidenceReference[];
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

type InvestigationDetail = {
  investigation_id: string;
  capsule_id: string;
  status: string;
  planning_source: "local" | "nemotron";
  hypotheses: Hypothesis[];
  experiments: ExperimentPlan[];
  events: InvestigationEvent[];
};

type ConnectionState = "checking" | "ready" | "offline";
type ImportState = "idle" | "importing" | "accepted" | "rejected";
type PlanningState = "idle" | "planning" | "ready" | "rejected";

export function App() {
  const [connection, setConnection] = useState<ConnectionState>("checking");
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [importState, setImportState] = useState<ImportState>("idle");
  const [capsule, setCapsule] = useState<CapsuleSummary | null>(null);
  const [rejection, setRejection] = useState<string | null>(null);
  const [planningState, setPlanningState] = useState<PlanningState>("idle");
  const [investigation, setInvestigation] = useState<InvestigationDetail | null>(null);
  const [planningError, setPlanningError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

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
    } catch (error) {
      setInvestigation(null);
      setPlanningError(
        error instanceof Error ? error.message : "Investigation planning failed",
      );
      setPlanningState("rejected");
    }
  }

  return (
    <div className="app-shell">
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

      <main>
        <section className="hero" aria-labelledby="hero-title">
          <div>
            <p className="eyebrow">Incident reproduction workspace</p>
            <h1 id="hero-title">Turn evidence into a testable failure.</h1>
            <p className="hero-copy">
              Import a sanitized incident capsule, preserve its evidence lineage,
              and prepare a deterministic investigation without production access.
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
              {importState === "importing" ? "Checking capsule" : "Load seed capsule"}
              <span aria-hidden="true">→</span>
            </button>
            <button
              className="secondary-action"
              type="button"
              disabled={importState === "importing" || connection !== "ready"}
              onClick={() => fileInput.current?.click()}
            >
              Import ZIP
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
        </section>

        <section className="workspace" aria-label="Capsule import workspace">
          <div className="workspace-heading">
            <div>
              <p className="section-label">
                {capsule ? "Accepted capsule" : "Ingestion boundary"}
              </p>
              <h2>{capsule?.title ?? "Review before investigation"}</h2>
            </div>
            <span className={`phase-badge phase-${importState}`}>
              {importState === "accepted" ? "Accepted" : "Step 2.2"}
            </span>
          </div>

          {rejection && (
            <div className="rejection" role="alert">
              <strong>Capsule rejected</strong>
              <span>{rejection}</span>
            </div>
          )}

          {capsule ? (
            <CapsuleDetails
              capsule={capsule}
              planningState={planningState}
              onCreateInvestigation={() =>
                void createInvestigation(capsule.capsule_id)
              }
            />
          ) : (
            <div className="signal-grid">
              <article className="signal-card">
                <span className="signal-index">01</span>
                <p className="signal-label">Validate</p>
                <strong>Fail closed</strong>
                <span>Schema, paths, sizes, types, and hashes must all agree</span>
              </article>
              <article className="signal-card">
                <span className="signal-index">02</span>
                <p className="signal-label">Scan</p>
                <strong>No credentials</strong>
                <span>Obvious secrets and local machine paths stop the import</span>
              </article>
              <article className="signal-card">
                <span className="signal-index">03</span>
                <p className="signal-label">Normalize</p>
                <strong>Lineage retained</strong>
                <span>Accepted evidence keeps its hash, provenance, and redaction state</span>
              </article>
            </div>
          )}

          {planningError && (
            <div className="rejection" role="alert">
              <strong>Planning stopped</strong>
              <span>{planningError}</span>
            </div>
          )}

          {investigation && <InvestigationPlan investigation={investigation} />}

          <div className="foundation-status">
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
          </div>
        </section>
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
  return (
    <div className="capsule-details">
      <div className="capsule-summary">
        <p>{capsule.observed_summary}</p>
        <dl>
          <div>
            <dt>Schema</dt>
            <dd>{capsule.schema_version}</dd>
          </div>
          <div>
            <dt>Signature</dt>
            <dd>{capsule.signature_id}</dd>
          </div>
          <div>
            <dt>Evidence</dt>
            <dd>{capsule.evidence.length} files</dd>
          </div>
        </dl>
        <button
          className="primary-action planning-action"
          type="button"
          disabled={planningState === "planning" || planningState === "ready"}
          onClick={onCreateInvestigation}
        >
          {planningState === "planning"
            ? "Planning investigation"
            : planningState === "ready"
              ? "Plan ready"
              : "Create investigation"}
          <span aria-hidden="true">→</span>
        </button>
      </div>
      <div className="evidence-list" aria-label="Accepted evidence">
        {capsule.evidence.map((evidence) => (
          <article className="evidence-row" key={evidence.evidence_id}>
            <span className="evidence-status" aria-hidden="true">✓</span>
            <div>
              <strong>{evidence.evidence_id}</strong>
              <span>{evidence.provenance}</span>
            </div>
            <div className="evidence-meta">
              <span>{formatBytes(evidence.byte_size)}</span>
              <span>{evidence.redaction_status}</span>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function InvestigationPlan({
  investigation,
}: {
  investigation: InvestigationDetail;
}) {
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
          return (
            <article className="hypothesis-card" key={hypothesis.hypothesis_id}>
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
                  <span>Queued experiment</span>
                  <strong>{formatVariant(experiment.variant)}</strong>
                  <small>
                    {experiment.operation_limit} operations · {experiment.timeout_seconds}s
                  </small>
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
        <div className="execution-lock">
          <span aria-hidden="true">◇</span>
          <div>
            <strong>Execution remains locked</strong>
            <p>Experiments become runnable only after the next review gate.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function formatBytes(bytes: number) {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

function formatVariant(variant: string) {
  return variant.replaceAll("-", " ");
}
