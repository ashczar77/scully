export type CloudConfig = { key: string; projectId: string };
export type CloudSession = { configured: boolean; projectId: string };
export type CloudImage = { uuid: string; tag: string };
export type CloudImageCatalog = { images: CloudImage[]; limited: boolean };
export type CloudExecutableResolution = {
  path: string | null;
  reason: string;
};
export type CloudFile = { path: string; bytes: number; sha256: string };
export type CloudReviewOptions = {
  saveChanges?: boolean;
  parentExecutionId?: string;
};
export type CloudReview = {
  token: string;
  runId: string;
  commandId: string;
  revision: string;
  image: string;
  imageTag?: string;
  saveChanges?: boolean;
  parentExecutionId?: string;
  executableVerified?: boolean;
  executable: string;
  args: string[];
  cwd: string;
  timeoutSeconds: number;
  files: CloudFile[];
  projectId: string;
  expiresAt: string;
};
export type CloudExecution = Omit<CloudReview, "token" | "expiresAt"> & {
  id: string;
  status:
    | "uploading"
    | "submission_unknown"
    | "submitted"
    | "complete"
    | "failed"
    | "interrupted";
  operationId: string | null;
  remoteStatus: string | null;
  resultImage?: string | null;
  startedAt: string;
  finishedAt?: string;
  commandPassed: boolean | null;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error: string;
};
