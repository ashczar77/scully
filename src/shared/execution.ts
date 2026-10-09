export type ExecutionStatus =
  | "running"
  | "exited"
  | "failed"
  | "timed_out"
  | "stopped"
  | "output_limit"
  | "interrupted";
export type ExecutionReview = {
  token: string;
  runId: string;
  commandId: string;
  revision: string;
  executable: string;
  executableHash: string;
  args: string[];
  cwd: string;
  timeoutSeconds: number;
  expiresAt: string;
};
export type ExecutionResult = Omit<ExecutionReview, "token" | "expiresAt"> & {
  id: string;
  status: ExecutionStatus;
  startedAt: string;
  finishedAt?: string;
  exitCode: number | null;
  signal: string | null;
  output: string;
  error: string;
};
