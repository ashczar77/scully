export function liveRequestLimit(value) {
  const requested = Number(value ?? 18);
  return Number.isSafeInteger(requested) && requested > 0
    ? Math.min(24, requested)
    : 18;
}

export function liveStallTracker(now = Date.now, maxIdleMs = 120_000) {
  let lastProgressAt = now();
  let lastMessageCount = -1;
  return (status, messageCount) => {
    if (messageCount !== lastMessageCount) {
      lastMessageCount = messageCount;
      lastProgressAt = now();
    }
    return status === "running" && now() - lastProgressAt > maxIdleMs;
  };
}
