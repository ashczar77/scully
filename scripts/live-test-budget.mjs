export function liveRequestLimit(value) {
  const requested = Number(value ?? 200);
  return Number.isSafeInteger(requested) && requested > 0 ? requested : 200;
}

export function remainingLiveRequests(limit, used) {
  return Math.max(0, limit - used);
}

export function liveStallTracker(now = Date.now, maxIdleMs = 240_000) {
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
