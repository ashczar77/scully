import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, Sparkles } from "lucide-react";
import type { ModelOption } from "../shared/runs";

export function ModelPicker({
  value,
  options,
  onChange,
  disabled = false,
  label = "Model",
}: {
  value: string;
  options: ModelOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const choices = options.some((option) => option.id === value)
    ? options
    : value
      ? [{ id: value, name: value.split("/").at(-1) || value }, ...options]
      : options;
  const selected = choices.find((option) => option.id === value);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    root.current
      ?.querySelectorAll<HTMLButtonElement>('[role="option"]')
      [active]?.focus();
  }, [open, active]);
  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActive(
        (index) =>
          (index + (event.key === "ArrowDown" ? 1 : -1) + choices.length) %
          choices.length,
      );
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActive(event.key === "Home" ? 0 : choices.length - 1);
    }
  }
  return (
    <div className="model-picker" ref={root} onKeyDown={keyDown}>
      <button
        ref={trigger}
        type="button"
        className="model-picker-trigger"
        aria-label={`${label}: ${selected?.name || "Choose a model"}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled || choices.length === 0}
        onClick={() => {
          setActive(
            Math.max(
              0,
              choices.findIndex((option) => option.id === value),
            ),
          );
          setOpen((current) => !current);
        }}
      >
        <Sparkles size={15} aria-hidden="true" />
        <span>{selected?.name || "Choose a model"}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div className="model-picker-popover" role="listbox" aria-label={label}>
          {choices.map((option, index) => (
            <button
              key={option.id}
              type="button"
              role="option"
              aria-selected={option.id === value}
              className={option.id === value ? "selected" : ""}
              onMouseEnter={() => setActive(index)}
              onClick={() => {
                onChange(option.id);
                setOpen(false);
                trigger.current?.focus();
              }}
            >
              <span>{option.name}</span>
              {option.id === value && <Check size={15} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
