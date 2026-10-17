import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";

export function AutoGrowTextarea({
  value,
  ...props
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value"> & {
  value: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = "auto";
    const cap = Math.max(160, Math.round(window.innerHeight * 0.42));
    element.style.height = `${Math.max(28, Math.min(element.scrollHeight, cap))}px`;
    element.style.overflowY = element.scrollHeight > cap ? "auto" : "hidden";
  }, [value]);
  return <textarea {...props} ref={ref} value={value} rows={1} />;
}
