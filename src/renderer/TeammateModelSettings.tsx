import { useEffect, useRef, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import type { DesktopAPI } from "../shared/contracts";
import type { ModelOption } from "../shared/runs";
import { characterCatalog } from "../shared/character-catalog";
import { starterModelOptions } from "../shared/model-options";
import {
  defaultRoleModelSettings,
  type RoleModelSettings,
} from "../shared/role-models";
import { ModelPicker } from "./ModelPicker";

const pinnedModels = starterModelOptions.slice(0, 2);

export function TeammateModelSettings({ api }: { api: DesktopAPI }) {
  const [settings, setSettings] = useState<RoleModelSettings>(
    defaultRoleModelSettings,
  );
  const [options, setOptions] = useState<ModelOption[]>(
    pinnedModels.map((option) => ({ ...option })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    let live = true;
    void api
      .roleModelSettings()
      .then((value) => {
        if (live) setSettings(value);
      })
      .catch(() => {
        if (live) setError("Could not load teammate models.");
      });
    void api
      .session()
      .then((session) => {
        if (!session.configured) return;
        return api.listModels().then((catalog) => {
          if (!live) return;
          setOptions([
            ...pinnedModels,
            ...catalog.filter(
              (item) => !pinnedModels.some((starter) => starter.id === item.id),
            ),
          ]);
        });
      })
      .catch(() => {
        if (live)
          setError(
            "Could not load the Nebius model list. Default models remain available.",
          );
      });
    return () => {
      live = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [api]);

  async function save(next: RoleModelSettings, label: string) {
    setBusy(true);
    setError("");
    setNotice("");
    if (timer.current) clearTimeout(timer.current);
    try {
      const saved = await api.setRoleModelSettings(next);
      setSettings(saved);
      setNotice(`${label} model saved. New attempts will use this choice.`);
      timer.current = setTimeout(() => setNotice(""), 3500);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save the model choice.",
      );
    } finally {
      setBusy(false);
    }
  }

  const core = [
    { key: "pearl", label: "Pearl", description: "Planning and coordination" },
    { key: "builder", label: "Builders", description: "Implementation" },
    { key: "tester", label: "Testers", description: "Tests and verification" },
    { key: "auditor", label: "Auditors", description: "Independent review" },
  ] as const;
  return (
    <section className="settings-card" aria-label="Teammate models">
      <h2>Teammate models</h2>
      <p>
        Choose the model each teammate uses. Changes apply to new attempts.
        Active work keeps its approved model choices.
      </p>
      <div className="teammate-model-list">
        {core.map(({ key, label, description }) => (
          <div className="teammate-model-row" key={key}>
            <div>
              <strong>{label}</strong>
              <small>{description}</small>
            </div>
            <ModelPicker
              label={`${label} model`}
              value={settings[key]}
              options={options}
              disabled={busy}
              onChange={(model) =>
                void save({ ...settings, [key]: model }, label)
              }
            />
          </div>
        ))}
      </div>
      <h3>Specialists</h3>
      <div className="teammate-model-list">
        {characterCatalog
          .filter((member) => member.role === "specialist")
          .map((member) => (
            <div className="teammate-model-row" key={member.id}>
              <div>
                <strong>{member.name}</strong>
                <small>{member.specialty}</small>
              </div>
              <ModelPicker
                label={`${member.name} model`}
                value={settings.specialists[member.id]}
                options={options}
                disabled={busy}
                onChange={(model) =>
                  void save(
                    {
                      ...settings,
                      specialists: {
                        ...settings.specialists,
                        [member.id]: model,
                      },
                    },
                    member.name,
                  )
                }
              />
            </div>
          ))}
      </div>
      {notice && (
        <div className="settings-save-banner" role="status">
          <CheckCircle2 size={18} aria-hidden="true" />
          <span>{notice}</span>
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
