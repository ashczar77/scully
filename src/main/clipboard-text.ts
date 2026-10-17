export function boundedClipboardText(value: unknown): string {
  if (typeof value !== "string" || value.length > 200_000)
    throw new Error(
      "Clipboard text must be a string under 200,000 characters.",
    );
  return value;
}
