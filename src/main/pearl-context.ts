import type { PearlMessage } from "../shared/pearl-chat";

// Keep the stored transcript intact. Superseded reads and older completed writes become
// explicit observations, so repeated source copies cannot crowd out decisions.
export function compactToolHistory(messages: PearlMessage[]): PearlMessage[] {
  const recentBoundary = Math.max(0, messages.length - 16);
  const latestReads = new Map<string, string>();
  const readKey = (value: Record<string, unknown>) =>
    JSON.stringify([value.path, value.startLine || 0, value.lineCount || 0]);
  for (const message of messages) {
    if (message.role !== "tool" || message.toolName !== "read_file") continue;
    try {
      const observation = JSON.parse(message.text);
      if (
        typeof observation.path === "string" &&
        typeof observation.content === "string"
      )
        latestReads.set(readKey(observation), message.id);
    } catch {
      /* Failed reads do not replace observed source. */
    }
  }
  const result: PearlMessage[] = [];
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    const calls =
      message.role === "assistant"
        ? message.toolCalls ||
          (message.toolCallId && message.toolName
            ? [
                {
                  id: message.toolCallId,
                  name: message.toolName,
                  arguments: message.arguments || "{}",
                },
              ]
            : [])
        : [];
    if (
      calls.length &&
      !message.providerContinuation &&
      index + calls.length < recentBoundary &&
      calls.every((call) =>
        [
          "read_file",
          "create_file",
          "write_file",
          "replace_in_file",
          "apply_patch",
          "edit_files",
        ].includes(call.name),
      )
    ) {
      const observations = messages.slice(index + 1, index + 1 + calls.length);
      if (
        calls.every(
          (call, offset) =>
            observations[offset]?.role === "tool" &&
            observations[offset].toolCallId === call.id,
        )
      ) {
        try {
          const summaries = calls.map((call, offset) => {
            const observation = JSON.parse(observations[offset].text);
            if (call.name === "edit_files" && observation.written === true) {
              if (
                !Array.isArray(observation.revisions) ||
                observation.revisions.some(
                  (item: { path?: unknown; sha256?: unknown }) =>
                    typeof item.path !== "string" ||
                    typeof item.sha256 !== "string",
                )
              )
                throw new Error("Not a file transaction observation");
              return {
                tool: call.name,
                files: observation.revisions.map(
                  (item: { path: string; sha256: string }) => ({
                    path: item.path,
                    sha256: item.sha256,
                  }),
                ),
                written: true,
              };
            }
            if (
              typeof observation.path !== "string" ||
              typeof observation.sha256 !== "string"
            )
              throw new Error("Not a file observation");
            if (
              call.name === "read_file" &&
              latestReads.get(readKey(observation)) === observations[offset].id
            )
              throw new Error("Retain the latest source observation");
            return {
              tool: call.name,
              path: observation.path,
              sha256: observation.sha256,
              written: observation.written === true,
              ...(observation.startLine
                ? {
                    startLine: observation.startLine,
                    lineCount: observation.lineCount,
                  }
                : {}),
            };
          });
          result.push({
            id: message.id,
            role: "assistant",
            at: message.at,
            text: `[Recorded file observations; source bodies omitted from this context, full transcript preserved. Read the current file before another edit.]\n${JSON.stringify(summaries)}${message.text ? "\n" + message.text : ""}`,
          });
          index += calls.length;
          continue;
        } catch {
          /* Failed or incomplete actions retain their exact results. */
        }
      }
    }
    result.push(message);
  }
  return result;
}

// A conservative local character allowance, not a tokenizer or the provider's
// advertised maximum. Keep room for tool schemas, instructions and generation.
export function contextCharacterBudget(model: string, retry = false): number {
  if (model === "zai-org/GLM-5.3-Flash") return retry ? 80_000 : 320_000;
  return retry ? 24_000 : 80_000;
}
