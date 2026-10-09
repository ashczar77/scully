import type { Task } from "../shared/contracts";
import { parseAudit, type Run } from "../shared/runs";
import type { Model } from "./provider";
import { whileRequest } from "./progress";
import { snapshotRevision } from "./integration";
import { auditSchema, commandSchema, safety } from "./loop";
import { parseFindingChecks } from "../shared/audits";
import { commandRevision } from "./revision";
import { randomUUID } from "node:crypto";
export async function executeSpecialist(
  run: Run,
  task: Task,
  model: Model,
  emit: (run: Run) => void,
) {
  const next = structuredClone(run);
  const audit = next.specialistAudits?.at(-1);
  if (
    !audit ||
    audit.status !== "reviewing" ||
    audit.calls !== 0 ||
    audit.revision !== snapshotRevision(next.files, next.drafts)
  )
    throw new Error("Stale audit dispatch");
  const event = (actor: "ellis" | "maya" | "system", text: string) => {
    next.events.push({ actor, text, at: new Date().toISOString() });
    emit(structuredClone(next));
  };
  const call = async (
    actor: "ellis" | "maya",
    system: string,
    name: import("../shared/runs").InFlightRequest["name"],
    schema: object,
    input: string,
  ) => {
    if (audit.calls >= 2) throw new Error("Specialist request limit reached");
    audit.calls++;
    return whileRequest(
      next,
      actor,
      name,
      () => model.complete({ system, name, schema, input }),
      emit,
    );
  };
  try {
    next.status = "auditing";
    event(
      "ellis",
      `Starting ${audit.kind} audit of ${audit.revision.slice(0, 12)}. Read-only, no tests executed.`,
    );
    const context = {
      task: { title: task.title, description: task.description },
      selectedFiles: next.files,
      changes: next.drafts,
      revision: audit.revision,
    };
    const focus = {
      testing:
        "Check requirement coverage, negative cases, excessive mocking and missing end-to-end checks.",
      security:
        "Check trust boundaries, unsafe inputs, secret exposure and permission bypasses.",
      maintainability:
        "Check local conventions, unnecessary complexity, excessive scope and maintainability.",
    }[audit.kind];
    const result = parseAudit(
      await call(
        "ellis",
        `${safety} You are an independent specialist auditor. ${focus} Findings are unverified hypotheses. Only report concrete issues in changed files.`,
        "specialist_audit",
        auditSchema,
        JSON.stringify(context),
      ),
      next.drafts.map((f) => f.path),
    );
    audit.summary = result.summary;
    audit.findings = result.findings;
    event("ellis", result.summary);
    if (result.findings.length) {
      const response = (await call(
        "maya",
        `${safety} You are the implementation reviewer responding to an independent audit. Explain which findings you accept or contest and why. Propose up to ${Math.min(3, 6 - (next.commands?.length || 0))} focused checks using existing draft files and available runtimes, or an empty checks array when no meaningful executable check is possible. Each check names a zero-based findingIndex, a direct command, expected observations distinguishing the issue from correct behaviour, and a literal machine-checkable criterion with the expected exit code and optional short output substring. Do not invent an output marker you cannot justify from the code or existing tests. The criterion is an unverified proposal, not proof of correctness. No installs, publishing, destructive cleanup or shell wrappers. Do not invent missing test files. You cannot resolve findings by assertion, alter files or execute tests. This is the only response round; unresolved issues go to the user.`,
        "respond_to_audit",
        {
          type: "object",
          properties: {
            response: { type: "string" },
            checks: {
              type: "array",
              maxItems: Math.min(3, 6 - (next.commands?.length || 0)),
              items: {
                type: "object",
                properties: {
                  findingIndex: { type: "integer", minimum: 0 },
                  expected: { type: "string" },
                  criterion: {
                    type: "object",
                    properties: {
                      exitCode: { type: "integer", minimum: 0, maximum: 255 },
                      outputIncludes: { type: "string", maxLength: 200 },
                    },
                    required: ["exitCode"],
                    additionalProperties: false,
                  },
                  command: commandSchema,
                },
                required: ["findingIndex", "expected", "criterion", "command"],
                additionalProperties: false,
              },
            },
          },
          required: ["response", "checks"],
          additionalProperties: false,
        },
        JSON.stringify({ ...context, findings: result.findings }),
      )) as { response?: unknown; checks?: unknown };
      if (
        typeof response?.response !== "string" ||
        !response.response.trim() ||
        response.response.length > 8000
      )
        throw new Error("Invalid audit response");
      audit.response = response.response;
      const checks = parseFindingChecks(
        response.checks,
        audit.findings,
        6 - (next.commands?.length || 0),
      );
      if (checks.length) {
        next.commands ||= [];
        next.commands.push(
          ...checks.map((check) => ({
            ...check.spec,
            id: randomUUID(),
            revision: "",
            decision: "pending" as const,
            findingLink: {
              auditIndex: next.specialistAudits!.length - 1,
              findingIndex: check.findingIndex,
              revision: audit.revision,
              ...audit.findings[check.findingIndex],
              expected: check.expected,
              criterion: check.criterion,
            },
          })),
        );
        const revision = commandRevision(next);
        for (const command of next.commands) {
          command.revision = revision;
          if (command.decision === "approved") command.decision = "expired";
        }
      }
      audit.status = "needs-review";
      event("maya", audit.response);
      event(
        "system",
        "Review handoff: one response round complete. Findings remain unverified. No automatic fix, experiment, or resolution occurred.",
      );
    } else {
      audit.status = "clear";
      event(
        "system",
        "No findings reported by this specialist. This is not proof of correctness or a test pass.",
      );
    }
  } catch (error) {
    audit.status = "failed";
    audit.summary =
      error instanceof Error
        ? error.message.slice(0, 500)
        : "Specialist review failed";
    event("system", audit.summary);
  }
  next.status = "complete";
  return next;
}
