import { useEffect, useRef, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import type { DesktopAPI } from "../shared/contracts";
import { defaultPlanningSettings } from "../shared/planning-settings";

export function PlanningSettings({ api }: { api: DesktopAPI }) {
  const [temperature, setTemperature] = useState(
    defaultPlanningSettings.temperature,
  );
  const [saved, setSaved] = useState(defaultPlanningSettings.temperature);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(false);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    let live = true;
    void api
      .planningSettings()
      .then((settings) => {
        if (live) {
          setTemperature(settings.temperature);
          setSaved(settings.temperature);
        }
      })
      .catch(() => {
        if (live) setError("Could not load planning settings.");
      });
    return () => {
      live = false;
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    };
  }, [api]);
  return (
    <section className="settings-card" aria-label="Planning settings">
      <h2>Planning</h2>
      <p>
        Temperature controls variation in Pearl’s draft planning responses.
        Lower values tend to be steadier. The default is 0.2; this does not make
        repeated requests identical.
      </p>
      <label htmlFor="planning-temperature">
        Planning temperature: {temperature.toFixed(1)}
      </label>
      <input
        id="planning-temperature"
        type="range"
        min="0"
        max="1"
        step="0.1"
        value={temperature}
        onChange={(event) => {
          setTemperature(Number(event.target.value));
          setNotice(false);
          if (noticeTimer.current) clearTimeout(noticeTimer.current);
        }}
        disabled={busy}
      />
      <div className="setting-actions">
        <button
          type="button"
          className="secondary"
          disabled={busy || temperature === saved}
          onClick={() => {
            setBusy(true);
            setError("");
            void api
              .setPlanningSettings({ temperature })
              .then((settings) => {
                setTemperature(settings.temperature);
                setSaved(settings.temperature);
                setNotice(true);
                if (noticeTimer.current) clearTimeout(noticeTimer.current);
                noticeTimer.current = setTimeout(() => setNotice(false), 3500);
              })
              .catch(() => setError("Could not save planning temperature."))
              .finally(() => setBusy(false));
          }}
        >
          Save planning temperature
        </button>
      </div>
      {notice && (
        <div className="settings-save-banner" role="status">
          <CheckCircle2 size={18} aria-hidden="true" />
          <span>Planning temperature saved.</span>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
