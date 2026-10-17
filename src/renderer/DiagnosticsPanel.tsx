import { useEffect, useState } from "react";
import type { RunAPI } from "../shared/runs";

export function DiagnosticsPanel({ api }: { api: RunAPI }) {
  const [status, setStatus] = useState<{
    armed: boolean;
    saved: boolean;
  } | null>(null);
  const [capture, setCapture] =
    useState<Awaited<ReturnType<RunAPI["readRawCapture"]>>>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    void api
      .rawCaptureStatus()
      .then((value) => {
        if (live) setStatus(value);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [api]);
  async function act(work: () => Promise<void>) {
    setError("");
    try {
      await work();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Capture action failed",
      );
    }
  }
  return (
    <section className="settings-card" aria-label="Request diagnostics">
      <h3>Request diagnostics</h3>
      <p>
        Each attempt records its stage, response status, finish reason,
        duration, and reported token use. Open full activity in the Room to
        inspect those records. Routine diagnostics never contain prompts,
        responses, or credentials.
      </p>
      <p>
        For one difficult request, you can temporarily capture the exact prompt
        and provider response on this device. It can contain private task and
        source content. The capture is off by default, handles one request, and
        is removed when you clear it or restart Scully.
      </p>
      <div className="command-actions">
        <button
          className="secondary"
          disabled={!!status?.armed}
          onClick={() =>
            void act(async () => {
              setCapture(null);
              setStatus(await api.armRawCapture());
            })
          }
        >
          Capture next model request
        </button>
        <button
          className="secondary"
          onClick={() =>
            void act(async () => {
              const value = await api.readRawCapture();
              setCapture(value);
              setStatus(await api.rawCaptureStatus());
            })
          }
        >
          View capture
        </button>
        <button
          className="secondary"
          onClick={() =>
            void act(async () => {
              setCapture(null);
              setStatus(await api.clearRawCapture());
            })
          }
        >
          Clear capture
        </button>
      </div>
      <p role="status">
        {status?.armed
          ? "Armed for the next model request."
          : status?.saved
            ? "One local capture is available."
            : "Capture is off."}
      </p>
      {capture && (
        <details open>
          <summary>Private request and response</summary>
          <pre className="private-capture">
            {JSON.stringify(capture, null, 2)}
          </pre>
        </details>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
