import { useEffect, useRef, useState } from "react";
import { Check, Search, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import type { ModelOption } from "../shared/runs";
import { starterModelOptions } from "../shared/model-options";

export function ModelPicker({
  value,
  options,
  onChange,
  disabled = false,
  label = "Model",
  catalogStatus,
  onRetry,
  recommendedIds,
  noun = "model",
  icon,
}: {
  value: string;
  options: ModelOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  label?: string;
  catalogStatus?: "loading" | "ready" | "unavailable" | "disconnected";
  onRetry?: () => void;
  recommendedIds?: string[];
  noun?: string;
  icon?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const search = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const choices = options.some((option) => option.id === value)
    ? options
    : value
      ? [{ id: value, name: value.split("/").at(-1) || value }, ...options]
      : options;
  const selected = choices.find((option) => option.id === value);
  const filtered = choices.filter((option) =>
    `${option.name} ${option.id}`.toLowerCase().includes(query.toLowerCase()),
  );
  const recommended = new Set<string>(
    recommendedIds ?? starterModelOptions.slice(0, 2).map((item) => item.id),
  );
  useEffect(() => {
    if (open) search.current?.focus();
  }, [open]);
  return (
    <div className="model-picker">
      <button
        ref={trigger}
        type="button"
        className="model-picker-trigger"
        aria-label={`${label}: ${selected?.name || `Choose a ${noun}`}`}
        aria-expanded={open}
        disabled={disabled || !choices.length}
        onClick={() => {
          setQuery("");
          setActive(
            Math.max(
              0,
              choices.findIndex((option) => option.id === value),
            ),
          );
          setOpen(true);
        }}
      >
        {icon || <Sparkles size={15} aria-hidden="true" />}{" "}
        <span>{selected?.name || `Choose a ${noun}`}</span>
      </button>
      {open && (
        <div
          className="model-picker-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <section
            className="model-picker-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`Choose ${label.toLowerCase()}`}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setOpen(false);
                trigger.current?.focus();
              }
            }}
          >
            <header>
              <h2>{label}</h2>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setOpen(false);
                  trigger.current?.focus();
                }}
              >
                Close
              </button>
            </header>
            <label className="model-search">
              <Search size={16} aria-hidden="true" /> Search all available
              {noun}s
              <input
                ref={search}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className="model-catalog-status" role="status">
              {catalogStatus === "loading"
                ? "Loading Nebius models…"
                : catalogStatus === "unavailable"
                  ? "Nebius model list could not be loaded. Suggested models are shown."
                  : catalogStatus === "disconnected"
                    ? "Connect Nebius to browse its full model list. Suggested models are shown."
                    : `${options.length} ${noun}s available`}
              {catalogStatus === "unavailable" && onRetry && (
                <button type="button" className="text-button" onClick={onRetry}>
                  Retry
                </button>
              )}
            </div>
            <div
              className="model-picker-results"
              role="listbox"
              aria-label={label}
              onKeyDown={(event) => {
                if (!filtered.length) return;
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  const next =
                    (active +
                      (event.key === "ArrowDown" ? 1 : -1) +
                      filtered.length) %
                    filtered.length;
                  setActive(next);
                  event.currentTarget
                    .querySelectorAll<HTMLButtonElement>('[role="option"]')
                    [next]?.focus();
                }
              }}
            >
              {filtered.map((option, index) => (
                <div key={option.id} className="model-result-group">
                  {index === 0 && !query && (
                    <h3>
                      {recommended.has(option.id)
                        ? "Recommended"
                        : `Available ${noun}s`}
                    </h3>
                  )}
                  {index > 0 &&
                    !query &&
                    !recommended.has(option.id) &&
                    recommended.has(filtered[index - 1].id) && (
                      <h3>All {noun}s</h3>
                    )}
                  <button
                    type="button"
                    role="option"
                    aria-label={option.name}
                    aria-selected={option.id === value}
                    disabled={Boolean(option.disabledReason)}
                    title={option.disabledReason}
                    onClick={() => {
                      onChange(option.id);
                      setOpen(false);
                      trigger.current?.focus();
                    }}
                  >
                    <span>
                      <strong>{option.name}</strong>
                      <small>{option.id}</small>
                      {recommended.has(option.id) && (
                        <small className="model-recommended">Recommended</small>
                      )}
                      {option.disabledReason && (
                        <small>{option.disabledReason}</small>
                      )}
                    </span>
                    {option.id === value && (
                      <Check size={15} aria-hidden="true" />
                    )}
                  </button>
                </div>
              ))}
              {!filtered.length && <p>No {noun}s match this search.</p>}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
