import { useState } from "react";
import type { RunAPI } from "../shared/runs";
import type { MetricSnapshot } from "../shared/telemetry";
export function MetricsPanel({ api }: { api: RunAPI }) {
  const [data, setData] = useState<MetricSnapshot | null>(null);
  const [error, setError] = useState("");
  const grouped = new Map<string, { count: number; total: number }>();
  for (const e of data?.events || []) {
    const key = `${e.operation} · ${e.outcome}`;
    const v = grouped.get(key) || { count: 0, total: 0 };
    v.count++;
    v.total += e.durationMs;
    grouped.set(key, v);
  }
  return (
    <section className="settings-card" aria-label="Local metrics">
      <h2>Local operational metrics</h2>
      <p>
        In memory only. Last 1,000 events, at most 24 hours, cleared on exit.
        Nothing is sent externally. No task content, credentials, paths or error
        messages are collected.
      </p>
      <p>
        Returned means an operation returned normally, not that a task or test
        passed. Backend action timing measures the action itself, not background
        run or process duration. Model timing measures the complete provider
        call, not time to first token. Counts describe this retained window, not
        lifetime totals.
      </p>
      <button
        className="secondary"
        onClick={async () => {
          try {
            setData(await api.metrics());
            setError("");
          } catch {
            setError("Local metrics unavailable");
          }
        }}
      >
        Refresh local metrics
      </button>
      {data && (
        <>
          <p>{data.events.length} retained events</p>
          <ul>
            {[...grouped].map(([key, v]) => (
              <li key={key}>
                {key}: {v.count} events · mean {Math.round(v.total / v.count)}{" "}
                ms
              </li>
            ))}
          </ul>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
