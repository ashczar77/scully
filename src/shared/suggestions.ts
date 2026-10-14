export type DeferredSuggestion = {
  id: string;
  text: string;
  actor: string;
  actorName?: string;
  revision: string;
};
export function parseSuggestions(value: unknown): string[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > 3 ||
    value.some(
      (v) =>
        typeof v !== "string" ||
        !v.trim() ||
        v.length > 1000 ||
        /[\x00-\x08\x0b-\x1f\x7f]/.test(v),
    )
  )
    throw new Error("Invalid deferred suggestions");
  return [...new Set(value.map((v) => v.trim()))];
}
export function suggestionsVisible(status: string): boolean {
  return ["complete", "failed", "stopped", "interrupted"].includes(status);
}
