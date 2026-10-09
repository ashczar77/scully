import { containsSecret, safePath } from "./runs";

export type CommandSpec = {
  executable: string;
  args: string[];
  cwd: string;
  reason: string;
  timeoutSeconds: number;
};
export type CommandProposal = CommandSpec & {
  findingLink?: {
    auditIndex: number;
    findingIndex: number;
    revision: string;
    detail: string;
    path: string;
    severity: string;
    expected: string;
  };
  id: string;
  revision: string;
  decision: "pending" | "approved" | "denied" | "expired";
  decidedAt?: string;
};

// This validates shape and scope, not whether a program is safe to execute.
export function parseCommands(value: unknown): CommandSpec[] {
  if (value === undefined) return []; // Older saved/provider drafts.
  if (!Array.isArray(value) || value.length > 6)
    throw new Error("At most six command proposals are allowed");
  return value.map((v) => {
    if (
      !v ||
      typeof v.executable !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,79}$/.test(v.executable) ||
      !Array.isArray(v.args) ||
      v.args.length > 32 ||
      v.args.some(
        (a: unknown) =>
          typeof a !== "string" || a.length > 2000 || /[\x00-\x1f\x7f]/.test(a),
      ) ||
      typeof v.cwd !== "string" ||
      typeof v.reason !== "string" ||
      !v.reason.trim() ||
      v.reason.length > 1000 ||
      /[\x00-\x1f\x7f]/.test(v.reason) ||
      !Number.isInteger(v.timeoutSeconds) ||
      v.timeoutSeconds < 1 ||
      v.timeoutSeconds > 120
    )
      throw new Error("Invalid command proposal");
    if (v.cwd !== ".") safePath(v.cwd);
    const spec: CommandSpec = {
      executable: v.executable,
      args: [...v.args],
      cwd: v.cwd,
      reason: v.reason,
      timeoutSeconds: v.timeoutSeconds,
    };
    if (
      JSON.stringify(spec).length > 8000 ||
      containsSecret(JSON.stringify(spec))
    )
      throw new Error("Command proposal is too large or contains credentials");
    return spec;
  });
}
