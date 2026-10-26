import type { PearlMessage, PearlToolCall } from "../shared/pearl-chat";

type ActivityAction = {
  id: string;
  name: string;
  arguments?: string;
  results: PearlMessage[];
};

type ActivityEntry =
  | { kind: "note"; id: string; text: string }
  | { kind: "action"; action: ActivityAction };

export type ActivityGroup = {
  id: string;
  actions: ActivityAction[];
  entries: ActivityEntry[];
  fallbackModels: string[];
};

export type RoomTimelineItem =
  | {
      kind: "message";
      message: PearlMessage & { role: "user" | "assistant" };
      progress: boolean;
    }
  | { kind: "activity"; group: ActivityGroup };

const questionActions = new Set([
  "ask_user",
  "answer_question",
  "withdraw_question",
]);

function calls(message: PearlMessage): PearlToolCall[] {
  if (message.toolCalls?.length) return message.toolCalls;
  if (message.toolName)
    return [
      {
        id: message.toolCallId || message.id,
        name: message.toolName,
        arguments: message.arguments || "",
      },
    ];
  return [];
}

/** Project the durable transcript into a compact Room view without changing it. */
export function roomTimeline(messages: PearlMessage[]): RoomTimelineItem[] {
  const items: RoomTimelineItem[] = [];
  let group: ActivityGroup | undefined;
  let byCallId = new Map<string, ActivityAction>();
  function activity(message: PearlMessage): ActivityGroup {
    if (!group) {
      group = {
        id: `activity-${message.id}`,
        actions: [],
        entries: [],
        fallbackModels: [],
      };
      items.push({ kind: "activity", group });
    }
    if (
      message.fallbackModel &&
      !group.fallbackModels.includes(message.fallbackModel)
    )
      group.fallbackModels.push(message.fallbackModel);
    return group;
  }
  for (const message of messages) {
    if (message.role === "user") {
      group = undefined;
      byCallId = new Map();
      items.push({
        kind: "message",
        message: { ...message, role: "user" },
        progress: false,
      });
      continue;
    }
    if (message.role === "tool") {
      if (questionActions.has(message.toolName || "")) continue;
      const current = activity(message);
      const callId = message.toolCallId || message.id;
      let action = byCallId.get(callId);
      if (!action) {
        action = {
          id: callId,
          name: message.toolName || "action",
          results: [],
        };
        current.actions.push(action);
        current.entries.push({ kind: "action", action });
        byCallId.set(callId, action);
      }
      action.results.push(message);
      continue;
    }
    const requested = calls(message);
    const linkedQuestion = requested.some((call) =>
      questionActions.has(call.name),
    );
    if (requested.length === 0 || (linkedQuestion && message.text.trim()))
      items.push({
        kind: "message",
        message: { ...message, role: "assistant" },
        progress: linkedQuestion,
      });
    else if (
      message.text.trim() &&
      !requested.some((call) => call.name === "complete_work")
    )
      activity(message).entries.push({
        kind: "note",
        id: message.id,
        text: message.text,
      });
    for (const call of requested) {
      if (questionActions.has(call.name)) continue;
      const current = activity(message);
      let action = byCallId.get(call.id);
      if (!action) {
        action = { id: call.id, name: call.name, results: [] };
        current.actions.push(action);
        current.entries.push({ kind: "action", action });
        byCallId.set(call.id, action);
      }
      action.arguments = call.arguments;
    }
  }
  return items;
}

function patchPreview(value: string): string | null {
  try {
    const result = JSON.parse(value) as {
      path?: unknown;
      hunks?: { line?: unknown; removed?: unknown; added?: unknown }[];
    };
    if (typeof result.path !== "string" || !Array.isArray(result.hunks))
      return null;
    const lines = result.hunks.map((hunk) => {
      if (
        typeof hunk.line !== "number" ||
        typeof hunk.removed !== "string" ||
        typeof hunk.added !== "string"
      )
        throw new Error("Invalid patch hunk");
      return `@@ ${result.path}:${hunk.line} @@\n${hunk.removed.replace(/^/gmu, "-")}\n${hunk.added.replace(/^/gmu, "+")}`;
    });
    return lines.join("\n");
  } catch {
    return null;
  }
}

function browserPreview(value: string): string | null {
  try {
    const result = JSON.parse(value) as {
      title?: unknown;
      initialVisibleText?: unknown;
      visibleText?: unknown;
      controls?: { tag?: unknown; id?: unknown; label?: unknown }[];
      hiddenViolations?: { tag?: unknown; id?: unknown }[];
      errors?: unknown[];
      blockedExternalRequests?: unknown;
      completedSteps?: unknown;
    };
    if (
      typeof result.title !== "string" ||
      typeof result.visibleText !== "string" ||
      !Array.isArray(result.controls) ||
      !Array.isArray(result.hiddenViolations) ||
      !Array.isArray(result.errors)
    )
      return null;
    const controls = result.controls
      .filter(
        (item) => typeof item.tag === "string" && typeof item.id === "string",
      )
      .map(
        (item) =>
          `${item.tag}${item.id ? ` #${item.id}` : ""}${typeof item.label === "string" && item.label ? `: ${item.label}` : ""}`,
      );
    const hidden = result.hiddenViolations
      .filter(
        (item) => typeof item.tag === "string" && typeof item.id === "string",
      )
      .map((item) => `${item.tag}${item.id ? ` #${item.id}` : ""}`);
    const errors = result.errors.filter(
      (item): item is string => typeof item === "string",
    );
    return [
      `Page: ${result.title}`,
      `Actions completed: ${typeof result.completedSteps === "number" ? result.completedSteps : "unknown"}`,
      `Blocked external requests: ${typeof result.blockedExternalRequests === "number" ? result.blockedExternalRequests : "unknown"}`,
      ...(typeof result.initialVisibleText === "string" &&
      result.initialVisibleText !== result.visibleText
        ? ["Initial visible text:", result.initialVisibleText]
        : []),
      "Final visible text:",
      result.visibleText,
      "Controls:",
      controls.length ? controls.join("\n") : "None observed",
      "Hidden-state violations at any observed point:",
      hidden.length ? hidden.join("\n") : "None observed",
      "Page errors:",
      errors.length ? errors.join("\n") : "None observed",
    ].join("\n");
  } catch {
    return null;
  }
}

function formattedJson(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length > 200_000 ||
    (!trimmed.startsWith("{") && !trimmed.startsWith("["))
  )
    return value;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return value;
  }
}

function resultText(message: PearlMessage): string {
  if (message.toolName === "apply_patch")
    return patchPreview(message.text) ?? formattedJson(message.text);
  if (["browser_check", "preview_app"].includes(message.toolName || ""))
    return browserPreview(message.text) ?? formattedJson(message.text);
  return formattedJson(message.text);
}

function failedResult(message: PearlMessage): boolean {
  try {
    const result = JSON.parse(message.text) as Record<string, unknown>;
    return (
      result.ok === false ||
      result.isError === true ||
      result.success === false ||
      (typeof result.exitCode === "number" && result.exitCode !== 0) ||
      (typeof result.error === "string" && result.error.length > 0) ||
      (Array.isArray(result.errors) && result.errors.length > 0) ||
      (Array.isArray(result.hiddenViolations) &&
        result.hiddenViolations.length > 0)
    );
  } catch {
    return (
      /^(Action rejected:|Action failed:|Completion rejected:|Approved command could not start:|The command was stopped\.|Command review limit reached|User denied this command\.|User denied this remote MCP call\.|Error:)/i.test(
        message.text,
      ) ||
      (["browser_check", "preview_app"].includes(message.toolName || "") &&
        message.text.trim().length > 0)
    );
  }
}

function label(name: string): string {
  const names: Record<string, string> = {
    mcp_list_tools: "List remote tools",
    mcp_call_tool: "Call remote tool",
    update_plan: "Update plan",
    project_map: "Inspect project",
    list_files: "List files",
    read_file: "Read file",
    search_text: "Search files",
    search_web: "Search web",
    read_web_result: "Read web result",
    create_file: "Create file",
    write_file: "Write file",
    replace_in_file: "Edit file",
    apply_patch: "Apply patch",
    edit_files: "Edit files",
    run_command: "Run command",
    preview_app: "Start preview",
    browser_check: "Check in browser",
    complete_work: "Finish work",
  };
  return names[name] || name.replace(/_/g, " ");
}

function countLabel(actions: ActivityAction[]): string {
  const fileNames = new Set([
    "create_file",
    "write_file",
    "replace_in_file",
    "apply_patch",
    "edit_files",
  ]);
  const counts = [
    ["file action", actions.filter((item) => fileNames.has(item.name)).length],
    [
      "browser check",
      actions.filter((item) => item.name === "browser_check").length,
    ],
    ["command", actions.filter((item) => item.name === "run_command").length],
    [
      "plan update",
      actions.filter((item) => item.name === "update_plan").length,
    ],
  ] as const;
  const parts = counts
    .filter(([, count]) => count > 0)
    .map(([name, count]) => `${count} ${name}${count === 1 ? "" : "s"}`);
  const described = counts.reduce((total, [, count]) => total + count, 0);
  const other = actions.length - described;
  if (other) parts.push(`${other} other action${other === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

export function PearlActivity({ group }: { group: ActivityGroup }) {
  const issues = group.actions.filter((action) =>
    action.results.some(failedResult),
  ).length;
  const latestAction = group.actions.at(-1);
  return (
    <details
      className={`pearl-activity${issues ? " has-issues" : ""}`}
      aria-label="Pearl activity"
    >
      <summary>
        <span>Activity</span>
        <small>{countLabel(group.actions)}</small>
        {group.fallbackModels.map((model) => (
          <small key={model}>Fallback: {model}</small>
        ))}
        {latestAction && (
          <span className="pearl-activity-status">
            Latest: {label(latestAction.name)}
          </span>
        )}
        {issues > 0 && (
          <strong>
            {issues} issue{issues === 1 ? "" : "s"}
          </strong>
        )}
      </summary>
      <div className="pearl-activity-list">
        {group.entries.map((entry) => {
          if (entry.kind === "note")
            return (
              <p className="pearl-activity-note" key={entry.id}>
                {entry.text}
              </p>
            );
          const action = entry.action;
          const failed = action.results.some(failedResult);
          return (
            <details
              key={action.id}
              className={`pearl-activity-action${failed ? " has-issues" : ""}`}
            >
              <summary>
                {label(action.name)}
                {failed ? " · needs attention" : ""}
                {action.results.length === 0 ? " · requested" : ""}
              </summary>
              {action.arguments && (
                <details className="pearl-activity-detail">
                  <summary>Request details</summary>
                  <pre>{formattedJson(action.arguments)}</pre>
                </details>
              )}
              {action.results.map((result) => (
                <details className="pearl-activity-detail" key={result.id}>
                  <summary>
                    {failedResult(result) ? "Issue details" : "Result"}
                  </summary>
                  <pre>{resultText(result)}</pre>
                </details>
              ))}
            </details>
          );
        })}
      </div>
    </details>
  );
}
