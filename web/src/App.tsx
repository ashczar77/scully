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

type ConnectionState = "checking" | "ready" | "offline";
type ImportState = "idle" | "importing" | "accepted" | "rejected";

export function App() {
  const [connection, setConnection] = useState<ConnectionState>("checking");
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [importState, setImportState] = useState<ImportState>("idle");
  const [capsule, setCapsule] = useState<CapsuleSummary | null>(null);
  const [rejection, setRejection] = useState<string | null>(null);
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
            <CapsuleDetails capsule={capsule} />
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

function CapsuleDetails({ capsule }: { capsule: CapsuleSummary }) {
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

function formatBytes(bytes: number) {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}
