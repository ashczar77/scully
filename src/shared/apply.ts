import type { DraftFile } from "./runs";
export type ApplyReview = {
  token: string;
  runId: string;
  destination: string;
  revision: string;
  expiresAt: string;
  files: DraftFile[];
};
export type ApplyResult = {
  id: string;
  destination: string;
  revision: string;
  backupDirectory: string;
  status: "applying" | "applied" | "failed" | "interrupted";
  written: string[];
  pendingPath: string;
  error: string;
  startedAt: string;
  finishedAt?: string;
};
