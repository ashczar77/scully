import { useEffect, useState } from "react";
import type { DesktopAPI } from "../shared/contracts";
import {
  defaultMessageRoutingSettings,
  type MessageRoutingSettings,
} from "../shared/message-routing";

export function MessageSettings({ api }: { api: DesktopAPI }) {
  const [settings, setSettings] = useState<MessageRoutingSettings>(
    defaultMessageRoutingSettings,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    void api
      .messageRoutingSettings()
      .then((value) => {
        if (live) setSettings(value);
      })
      .catch((reason) => {
        if (live)
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not load message settings",
          );
      });
    return () => {
      live = false;
    };
  }, [api]);
  async function choose(change: Partial<MessageRoutingSettings>) {
    setSaving(true);
    setError("");
    try {
      setSettings(
        await api.setMessageRoutingSettings({ ...settings, ...change }),
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not save message settings",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <section
      className="settings-card message-settings"
      aria-label="Message settings"
    >
      <h2>Team messages</h2>
      <p>
        Pearl coordinates the Room conversation. You can tag a saved teammate
        directly, and choose when Pearl asks before consulting a specialist.
      </p>
      <h3>When the right teammate is unclear</h3>
      <div className="message-setting-options">
        <button
          className={settings.unclear === "pearl" ? "selected" : ""}
          disabled={saving}
          aria-pressed={settings.unclear === "pearl"}
          onClick={() => void choose({ unclear: "pearl" })}
        >
          <strong>Ask Pearl</strong>
          <span>
            Pearl handles questions that span roles or have no clear match.
          </span>
        </button>
        <button
          className={settings.unclear === "ask" ? "selected" : ""}
          disabled={saving}
          aria-pressed={settings.unclear === "ask"}
          onClick={() => void choose({ unclear: "ask" })}
        >
          <strong>Let me choose</strong>
          <span>
            Choose a teammate only when Scully cannot identify a clear match.
          </span>
        </button>
      </div>
      <h3>Specialist input while planning</h3>
      <div className="message-setting-options">
        <button
          className={
            settings.specialistConsultation === "automatic" ? "selected" : ""
          }
          disabled={saving}
          aria-pressed={settings.specialistConsultation === "automatic"}
          onClick={() => void choose({ specialistConsultation: "automatic" })}
        >
          <strong>Let Pearl consult</strong>
          <span>
            Pearl may ask a relevant specialist during your conversation.
          </span>
        </button>
        <button
          className={
            settings.specialistConsultation === "ask" ? "selected" : ""
          }
          disabled={saving}
          aria-pressed={settings.specialistConsultation === "ask"}
          onClick={() => void choose({ specialistConsultation: "ask" })}
        >
          <strong>Ask me first</strong>
          <span>
            Pearl asks before contacting a specialist. You can reply in the
            Room.
          </span>
        </button>
      </div>
      <p>
        Builder, tester, and auditor input does not require this extra step.
      </p>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
