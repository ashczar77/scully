import { useEffect, useState } from "react";

type HealthResponse = {
  status: "ok" | "degraded";
  service: string;
  version: string;
  database: "ready" | "unavailable";
  live_providers_enabled: boolean;
};

type ConnectionState = "checking" | "ready" | "offline";

export function App() {
  const [connection, setConnection] = useState<ConnectionState>("checking");
  const [health, setHealth] = useState<HealthResponse | null>(null);

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
              Import a sanitized incident capsule, compare isolated hypotheses,
              and produce a reproduction backed by deterministic evidence.
            </p>
          </div>
          <button className="primary-action" type="button" disabled>
            Import capsule
            <span aria-hidden="true">→</span>
          </button>
        </section>

        <section className="workspace" aria-label="Investigation preview">
          <div className="workspace-heading">
            <div>
              <p className="section-label">Seed investigation</p>
              <h2>Proxy identity collapse</h2>
            </div>
            <span className="phase-badge">Foundation</span>
          </div>

          <div className="signal-grid">
            <article className="signal-card">
              <span className="signal-index">01</span>
              <p className="signal-label">Evidence</p>
              <strong>Sanitized capsule</strong>
              <span>Import contract scheduled for Step 2.2</span>
            </article>
            <article className="signal-card">
              <span className="signal-index">02</span>
              <p className="signal-label">Execution</p>
              <strong>Bounded branches</strong>
              <span>Provider timeout with a local deadline</span>
            </article>
            <article className="signal-card">
              <span className="signal-index">03</span>
              <p className="signal-label">Verdict</p>
              <strong>Deterministic only</strong>
              <span>Model output cannot mark a reproduction successful</span>
            </article>
          </div>

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
