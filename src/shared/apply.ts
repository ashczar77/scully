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
export type RecoveryInspection = {
  applicationId: string;
  checkedAt: string;
  recordStatus: ApplyResult["status"];
  manifest: "consistent" | "missing" | "diverged" | "unavailable";
  files: {
    path: string;
    recordedWritten: boolean;
    pending: boolean;
    backup:
      | "matches_baseline"
      | "not_required"
      | "missing"
      | "different"
      | "unavailable";
    destination: "draft" | "baseline" | "different" | "unavailable";
  }[];
};
