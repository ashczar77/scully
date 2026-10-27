export function safeExternalUrl(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new Error("Invalid external link");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid external link");
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    !url.hostname ||
    url.username ||
    url.password
  )
    throw new Error(
      "Only web links without embedded credentials can be opened",
    );
  return url.href;
}

export async function confirmExternalLink(
  value: unknown,
  confirm: (url: string) => Promise<"cancel" | "copy" | "open">,
  open: (url: string) => Promise<void>,
  copy: (url: string) => void,
  onOpenFailure?: (
    url: string,
    canRetry: boolean,
  ) => Promise<"cancel" | "copy" | "retry" | "open">,
): Promise<"cancel" | "copy" | "open"> {
  const url = safeExternalUrl(value);
  const decision = await confirm(url);
  if (decision === "copy") copy(url);
  if (decision === "open") {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await open(url);
        return "open";
      } catch (error) {
        if (!onOpenFailure) throw error;
        const fallback = await onOpenFailure(url, attempt === 0);
        if (fallback === "open") return "open";
        if (fallback === "copy") copy(url);
        if (fallback === "retry" && attempt === 0) continue;
        return fallback === "retry" ? "cancel" : fallback;
      }
    }
  }
  return decision;
}
