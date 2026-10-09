import type { Finding, Run } from "./runs";
import { parseCommands, type CheckCriterion } from "./commands";
import { containsSecret } from "./runs";
import { compareCorrection } from "./correction-evidence";
export type FindingDecisionInput = {
  auditIndex: number;
  findingIndex: number;
  revision: string;
  findingKey: string;
  previousCount: number;
  decision: "unresolved" | "accepted-risk" | "dismissed" | "resolved";
  reason: string;
  evidenceIds: string[];
};
export type FindingDecision = FindingDecisionInput & { at: string };
export function findingKey(finding: Finding) {
  return JSON.stringify([finding.path, finding.severity, finding.detail]);
}
export function findingEvidence(
  run: Run,
  auditIndex: number,
  findingIndex: number,
  relatedRuns: Run[] = [],
) {
  const own = (run.executions || []).filter((e) => {
    const command = run.commands?.find((c) => c.id === e.commandId);
    return (
      command &&
      command.findingLink?.auditIndex === auditIndex &&
      command.findingLink.findingIndex === findingIndex &&
      findingCheckCurrent(run, command) &&
      e.revision === command.revision &&
      e.status === "exited" &&
      e.exitCode !== null &&
      !e.signal
    );
  });
  const corrected = relatedRuns.flatMap((child) => {
    if (
      child.correction?.parentId !== run.id ||
      child.correction.auditIndex !== auditIndex ||
      child.correction.findingIndex !== findingIndex
    )
      return [];
    const comparison = compareCorrection(run, child);
    if (
      comparison.status !== "compared" ||
      comparison.candidate?.status !== "met"
    )
      return [];
    const replay = child.commands?.find(
      (command) =>
        command.recheckOf?.parentCommandId ===
        child.correction?.recheck?.parentCommandId,
    );
    const execution = child.executions?.find(
      (result) => result.commandId === replay?.id,
    );
    return execution ? [execution] : [];
  });
  return [...own, ...corrected];
}
export function decisionCurrent(
  run: Run,
  decision: FindingDecision,
  relatedRuns: Run[] = [],
) {
  const audit = run.specialistAudits?.[decision.auditIndex];
  const finding = audit?.findings[decision.findingIndex];
  const evidence = findingEvidence(
    run,
    decision.auditIndex,
    decision.findingIndex,
    relatedRuns,
  );
  return !!(
    finding &&
    findingKey(finding) === decision.findingKey &&
    audit?.revision === decision.revision &&
    run.coordination?.integratedRevision === decision.revision &&
    run.coordination.auditedRevision === decision.revision &&
    decision.evidenceIds.every(
      (id) => evidence.filter((e) => e.id === id).length === 1,
    )
  );
}
export function recordFindingDecision(
  run: Run,
  value: unknown,
  relatedRuns: Run[] = [],
): FindingDecision {
  const v = value as FindingDecisionInput;
  if (
    !v ||
    !Number.isInteger(v.auditIndex) ||
    v.auditIndex < 0 ||
    !Number.isInteger(v.findingIndex) ||
    v.findingIndex < 0 ||
    !["unresolved", "accepted-risk", "dismissed", "resolved"].includes(
      v.decision,
    ) ||
    typeof v.reason !== "string" ||
    !v.reason.trim() ||
    v.reason.length > 2000 ||
    !Array.isArray(v.evidenceIds) ||
    v.evidenceIds.length > 3 ||
    v.evidenceIds.some((id) => typeof id !== "string") ||
    new Set(v.evidenceIds).size !== v.evidenceIds.length
  )
    throw new Error("Invalid finding decision");
  const history = run.findingDecisions || [];
  if (history.length >= 50)
    throw new Error("Finding decision history limit reached");
  if (v.previousCount !== history.length)
    throw new Error("Decision history changed. Review again.");
  const decision: FindingDecision = {
    auditIndex: v.auditIndex,
    findingIndex: v.findingIndex,
    revision: v.revision,
    findingKey: v.findingKey,
    previousCount: v.previousCount,
    decision: v.decision,
    reason: v.reason.trim(),
    evidenceIds: [...v.evidenceIds],
    at: new Date().toISOString(),
  };
  if (!decisionCurrent(run, decision, relatedRuns))
    throw new Error("Finding or evidence is stale. Review again.");
  if (v.decision === "resolved" && !v.evidenceIds.length)
    throw new Error("Resolution requires linked completed evidence");
  run.findingDecisions = [...history, decision];
  return decision;
}
export function parseFindingChecks(
  value: unknown,
  findings: Finding[],
  available: number,
) {
  if (!Array.isArray(value) || value.length > Math.min(3, available))
    throw new Error("Focused check limit exceeded");
  return value.map((v) => {
    if (
      !v ||
      !Number.isInteger(v.findingIndex) ||
      v.findingIndex < 0 ||
      v.findingIndex >= findings.length ||
      typeof v.expected !== "string" ||
      !v.expected.trim() ||
      v.expected.length > 2000
    )
      throw new Error("Invalid finding check");
    const criterion = parseCheckCriterion(v.criterion);
    return {
      spec: parseCommands([v.command])[0],
      findingIndex: v.findingIndex as number,
      expected: v.expected as string,
      criterion,
    };
  });
}
export function parseCheckCriterion(value: unknown): CheckCriterion {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid check criterion");
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).some(
      (key) => !["exitCode", "outputIncludes"].includes(key),
    ) ||
    !Object.prototype.hasOwnProperty.call(v, "exitCode") ||
    !Number.isInteger(v.exitCode) ||
    (v.exitCode as number) < 0 ||
    (v.exitCode as number) > 255 ||
    (v.outputIncludes !== undefined &&
      (typeof v.outputIncludes !== "string" ||
        !v.outputIncludes.trim() ||
        v.outputIncludes.length > 200 ||
        /[\x00-\x1f\x7f]/.test(v.outputIncludes) ||
        containsSecret(v.outputIncludes)))
  )
    throw new Error("Invalid check criterion");
  return {
    exitCode: v.exitCode as number,
    ...(v.outputIncludes === undefined
      ? {}
      : { outputIncludes: v.outputIncludes as string }),
  };
}
export function findingCheckCurrent(
  run: Run,
  command: import("./commands").CommandProposal,
) {
  const link = command.findingLink;
  const audit = link && run.specialistAudits?.[link.auditIndex];
  return !!(
    link &&
    audit &&
    audit.revision === link.revision &&
    audit.findings[link.findingIndex]?.detail === link.detail &&
    audit.findings[link.findingIndex]?.path === link.path &&
    audit.findings[link.findingIndex]?.severity === link.severity &&
    run.coordination?.integratedRevision === link.revision &&
    run.coordination.auditedRevision === link.revision
  );
}
export const auditKinds = ["testing", "security", "maintainability"] as const;
export type AuditKind = (typeof auditKinds)[number];
export type SpecialistAudit = {
  kind: AuditKind;
  revision: string;
  status: "reviewing" | "clear" | "needs-review" | "failed";
  calls: number;
  summary: string;
  findings: Finding[];
  response: string;
};
export function assertAuditKind(kind: unknown): asserts kind is AuditKind {
  if (!auditKinds.includes(kind as AuditKind))
    throw new Error("Unknown audit focus");
}
export function interruptAudits(run: Run) {
  for (const audit of run.specialistAudits || []) {
    if (audit.status === "reviewing") {
      audit.status = "failed";
      audit.summary =
        "Review interrupted locally; remote completion unconfirmed.";
    }
  }
}
