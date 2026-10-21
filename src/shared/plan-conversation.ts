import type { Run } from "./runs";

function section(plan: string, heading: string): string {
  const lines = plan.replace(/\r\n?/g, "\n").split("\n");
  const start = lines.findIndex(
    (line) => line.trim().toLowerCase() === `## ${heading.toLowerCase()}`,
  );
  if (start < 0) return "";
  const body: string[] = [];
  for (let index = start + 1; index < lines.length; index++) {
    if (/^#{1,6}\s+/.test(lines[index].trim())) break;
    body.push(lines[index]);
  }
  return body.join("\n").trim();
}

// Remove a provider's hidden reasoning markup, preserving visible wording and Markdown.
export function cleanPlanningText(value: string): string {
  const visible = value.replace(/<think\b[^>]*>[\s\S]*?<\/think\s*>/gi, "");
  return visible.replace(/<think\b[^>]*>[\s\S]*$/gi, "").trim();
}

export function planSummary(plan: string): string {
  return (
    section(plan, "Conversation Summary") || section(plan, "Overview") || plan
  );
}

export function planQuestions(plan: string): string[] {
  const body = section(plan, "User Decisions Required");
  if (!body) return [];
  return body
    .split("\n")
    .filter((line) => /^\s*(?:[-*+] |\d+\. )/.test(line))
    .map((line) => line.replace(/^\s*(?:[-*+] |\d+\. )/, "").trim())
    .filter(Boolean);
}

export function roomQuestion(value: string): string {
  return value;
}

export function planningTurnContext(
  run: Pick<Run, "messages" | "redirection">,
) {
  const userMessages = run.redirection
    ? run.redirection.instructions
    : (run.messages || []).map((message) => message.text);
  return {
    conversation:
      run.redirection?.conversation ||
      userMessages.map((text) => ({ from: "user", text })),
    latestUserMessage: userMessages.at(-1) || "",
    previousQuestions: planQuestions(run.redirection?.previousPlan || ""),
  };
}

export function visiblePlan(plan: string, draft: boolean): string {
  if (!draft) return plan;
  const lines = plan.replace(/\r\n?/g, "\n").split("\n");
  const visible: string[] = [];
  let hidden = false;
  for (const line of lines) {
    const heading = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (heading)
      hidden =
        /\b(team|lineup|staffing|reserves|cost exposure|request exposure)\b/i.test(
          heading[1],
        );
    if (!hidden) visible.push(line);
  }
  return visible.join("\n").trim();
}
