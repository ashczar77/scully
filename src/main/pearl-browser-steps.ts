export type BrowserStep = {
  action: "click" | "fill" | "select" | "wait_for" | "press" | "reload";
  selector?: string;
  value?: string;
  key?: string;
};

export async function boundedBrowserWork<T>(
  work: Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    const stopped = new Promise<never>((_resolve, reject) => {
      if (!signal) return;
      onAbort = () => reject(new Error("Browser check stopped"));
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    });
    return await Promise.race([
      work,
      stopped,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Browser check timed out")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (signal && onAbort) signal.removeEventListener("abort", onAbort);
  }
}

export function validateBrowserSteps(value: unknown): BrowserStep[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 12)
    throw new Error("Browser check accepts at most twelve actions");
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new Error("Invalid browser action");
    const step = item as Record<string, unknown>;
    if (
      !["click", "fill", "select", "wait_for", "press", "reload"].includes(
        step.action as string,
      )
    )
      throw new Error("Invalid browser action");
    if (
      Object.keys(step).some(
        (key) => !["action", "selector", "value", "key"].includes(key),
      ) ||
      (step.action === "click" &&
        (step.value !== undefined || step.key !== undefined)) ||
      (["fill", "select", "wait_for"].includes(step.action as string) &&
        step.key !== undefined) ||
      (step.action === "press" && step.value !== undefined)
    )
      throw new Error("Invalid browser action field");
    if (
      step.selector !== undefined &&
      (typeof step.selector !== "string" ||
        !step.selector.trim() ||
        step.selector.length > 1000)
    )
      throw new Error("Invalid browser selector");
    if (
      step.value !== undefined &&
      (typeof step.value !== "string" || step.value.length > 500)
    )
      throw new Error("Invalid browser fill value");
    if (
      step.key !== undefined &&
      (typeof step.key !== "string" ||
        !/^(?:[\x20-\x7e]|Enter|Escape|Tab|Space|Backspace|Delete|ArrowUp|ArrowDown|ArrowLeft|ArrowRight)$/.test(
          step.key,
        ))
    )
      throw new Error(
        "Invalid browser key. Use one printable ASCII character, Enter, Escape, Tab, Space, Backspace, Delete, ArrowUp, ArrowDown, ArrowLeft or ArrowRight. Modifier combinations are not supported.",
      );
    if (
      (["click", "fill", "select", "wait_for"].includes(
        step.action as string,
      ) &&
        typeof step.selector !== "string") ||
      (["fill", "select"].includes(step.action as string) &&
        typeof step.value !== "string") ||
      (step.action === "press" && typeof step.key !== "string") ||
      (step.action === "reload" &&
        (step.selector !== undefined ||
          step.value !== undefined ||
          step.key !== undefined))
    )
      throw new Error("Incomplete browser action");
    return step as BrowserStep;
  });
}
