function section(plan: string, heading: string): string {
  const lines = plan.replace(/\r\n?/g, "\n").split("\n");
  const start = lines.findIndex((line) =>
    new RegExp(`^#{1,6}\\s+${heading}\\s*$`, "i").test(line.trim()),
  );
  if (start < 0) return "";
  const body: string[] = [];
  for (let index = start + 1; index < lines.length; index++) {
    if (/^#{1,6}\s+/.test(lines[index].trim())) break;
    body.push(lines[index]);
  }
  return body.join("\n").trim();
}

function readable(value: string): string {
  return value
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();
}

export function cleanPlanningText(value: string): string {
  const closing = /<\/think\s*>/gi;
  const tags = [...value.matchAll(closing)];
  const visible =
    tags.length && !/<think\b/i.test(value)
      ? value.slice(tags.at(-1)!.index! + tags.at(-1)![0].length)
      : value;
  return visible
    .replace(/<think\b[^>]*>[\s\S]*?<\/think\s*>/gi, "")
    .replace(/<think\b[^>]*>[\s\S]*$/gi, "")
    .replace(/<\/?think\b[^>]*>/gi, "")
    .trim();
}

export function coordinatorReply(value: string, ready: boolean): string {
  const original = cleanPlanningText(value);
  const cleaned = original
    .replace(
      /\b(?:I(?:'ll| will| am going to)|let me) (?:now )?proceed with the Building phase[^.!?]*[.!?]?/gi,
      "",
    )
    .replace(/[^.!?]*\bbefore I (?:start|begin) coding[^.!?]*[.!?]?/gi, "")
    .replace(/\bI can proceed to building[^.!?]*[.!?]?/gi, "")
    .replace(
      /\bI(?:'ll| will| am going to) (?:now )?(?:start coding|write the code|implement the app)[^.!?]*[.!?]?/gi,
      "",
    )
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!ready || cleaned === original) return cleaned;
  if (/\b(?:hand|bring|get)\b[^.!?]*\bteam\b/i.test(cleaned)) return cleaned;
  return cleaned
    ? `${cleaned} When you're ready, I'll hand the approved plan to the team.`
    : "The plan is ready. When you're ready, I'll hand it to the team.";
}

export function planSummary(plan: string): string {
  const supplied = section(plan, "Conversation Summary");
  if (supplied)
    return readable(supplied)
      .replace(/\s+/g, " ")
      .replace(/^the user wants\b/i, "You'd like");
  const overview = readable(section(plan, "Overview") || plan);
  const firstParagraph = overview.split(/\n\s*\n/)[0] || overview;
  const completeSentence = firstParagraph.match(/^.*?[.!?](?=\s|$)/s)?.[0];
  const first = (completeSentence || firstParagraph)
    .replace(/\s+/g, " ")
    .trim();
  if (/^(build|create|make|develop|implement)\b/i.test(first))
    return first.replace(
      /^(build|create|make|develop|implement)\b/i,
      (verb) => `I'd ${verb.toLowerCase()}`,
    );
  if (/^the user wants\b/i.test(first))
    return first.replace(/^the user wants\b/i, "You'd like");
  return first;
}

export function planQuestions(plan: string): string[] {
  const sectionText = section(plan, "User Decisions Required");
  if (!sectionText) return [];
  return sectionText
    .split("\n")
    .filter((line) => /^\s*(?:[-*+] |\d+\. )/.test(line))
    .map((line) => readable(line.replace(/^\s*(?:[-*+] |\d+\. )/, "")))
    .filter(
      (line) =>
        line &&
        !/^none\.?$/i.test(line) &&
        !/\((?:already )?(?:chosen|selected|confirmed|decided|resolved)\)\.?$/i.test(
          line,
        ),
    );
}

export function roomQuestion(value: string): string {
  const parts = value.split(/\s+[–-]\s+/, 2);
  if (parts.length !== 2)
    return value.endsWith("?") ? value : `${value.replace(/[.\s]+$/, "")}?`;
  const [, detail] = parts;
  const note = detail.match(/\s*(\((?:default|suggested):[^)]*\))\.?$/i)?.[1];
  const choice = (note ? detail.slice(0, detail.lastIndexOf(note)) : detail)
    .replace(/[?.\s]+$/, "")
    .trim();
  const direct =
    /^(?:which|what|how|should|would|could|do|does|is|are|can|will)\b|^if\b.+\b(?:should|would|could)\b/i.test(
      choice,
    );
  const question = direct
    ? `${choice}?`
    : `For ${parts[0].toLowerCase()}, which would you prefer: ${choice}?`;
  return note ? `${question} ${note}` : question;
}

export function repeatsAnsweredQuestion(
  plan: string,
  previousPlan: string,
  latestMessage: string,
): boolean {
  const previous = planQuestions(previousPlan);
  const current = planQuestions(plan);
  if (!previous.length || !current.length) return false;
  const answered = new Set<number>();
  for (const line of latestMessage.split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)[.)]\s+\S/);
    if (match) answered.add(Number(match[1]) - 1);
  }
  if (
    previous.length === 1 &&
    !/[?]/.test(latestMessage) &&
    latestMessage.trim().length > 0
  )
    answered.add(0);
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  return [...answered].some(
    (index) =>
      previous[index] &&
      current.some(
        (question) => normalize(question) === normalize(previous[index]),
      ),
  );
}

export function asksForResolvedChoices(plan: string): boolean {
  if (planQuestions(plan).length > 0) return false;
  const decisions = section(plan, "User Decisions Required");
  const listedChosen = decisions
    .split("\n")
    .some((line) =>
      /\((?:already )?(?:chosen|selected|confirmed|decided|resolved)\)\.?$/i.test(
        line.trim(),
      ),
    );
  const staleIntro =
    /before i finali[sz]e[^.!?]*(?:choices|questions)|could you help me with these choices/i.test(
      planSummary(plan),
    );
  return listedChosen || staleIntro;
}

export function planningTurnContext(
  run: Pick<Run, "messages" | "redirection">,
) {
  const userMessages = run.redirection
    ? run.redirection.instructions
    : (run.messages || []).map((message) => message.text);
  const previousQuestions = planQuestions(run.redirection?.previousPlan || "");
  const latestUserMessage = userMessages.at(-1) || "";
  const answeredChoices = latestUserMessage
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*(\d+)[.)]\s+(.+?)\s*$/))
    .filter((match): match is RegExpMatchArray => !!match)
    .map((match) => ({
      question: previousQuestions[Number(match[1]) - 1],
      answer: match[2],
    }))
    .filter((item) => !!item.question);
  return {
    conversation:
      run.redirection?.conversation ||
      userMessages.slice(-20).map((text) => ({ from: "user", text })),
    latestUserMessage,
    previousQuestions,
    answeredChoices,
  };
}

export function samePlanText(a: string, b: string): boolean {
  return a.trim().replace(/\s+/g, " ") === b.trim().replace(/\s+/g, " ");
}

export function echoesConsultationQuestion(advice: string, question: string) {
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const answer = normalize(advice);
  const request = normalize(question);
  return (
    answer === request || (request.length > 80 && answer.startsWith(request))
  );
}

export function userAuthorizedSpecialistConsultation(
  latestMessage: string,
  previousPlan: string,
  memberName: string,
): boolean {
  const name = memberName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (
    new RegExp(
      `(?:@${name}\\b|\\b(?:ask|consult|check with) ${name}\\b)`,
      "i",
    ).test(latestMessage)
  )
    return true;
  const affirmative =
    /^(?:yes|yeah|yep|sure|please do|go ahead|okay|ok)\b/i.test(
      latestMessage.trim(),
    );
  return (
    affirmative &&
    new RegExp(`\\b(?:ask|consult|check with) ${name}\\b`, "i").test(
      previousPlan,
    )
  );
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
import type { Run } from "./runs";
