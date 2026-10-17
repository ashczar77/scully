// Only explicit requests initiate a direction change. Questions remain questions.
export function requestsTaskChange(text: string): boolean {
  const value = text.trim().replace(/\s+/g, " ");
  if (!value || value.length > 2000) return false;
  return (
    /^(?:actually[, ]+|please )?(?:change|revise|redirect|switch|replace|remove|add)\b/i.test(
      value,
    ) ||
    /^instead of\b/i.test(value) ||
    /^let(?:'s| us)\b.*\binstead\b/i.test(value) ||
    /^i (?:want|need|would like) (?:to |you to )?(?:change|revise|switch|replace|remove|add)\b/i.test(
      value,
    ) ||
    /^(?:can we|could you|would you|will you) (?:please )?(?:add|change|remove|replace|build|implement|include)\b/i.test(
      value,
    ) ||
    /^(?:please\s+)?(?:use|make|build|keep|include|exclude|do not|don't)\b/i.test(
      value,
    ) ||
    /^(?:let's|let us)\s+(?:use|make|build|keep|include|exclude)\b/i.test(
      value,
    ) ||
    /^(?:i prefer|i'd prefer|we should|we want|i choose)\b/i.test(value)
  );
}
