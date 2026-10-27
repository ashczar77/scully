import type { CloudImage } from "./cloud";
import type { TaskFileChange } from "./pearl-workspace";

export type PearlSandboxConnection = {
  configured: boolean;
  projectId: string;
};

export type PearlSandboxManifestFile = {
  path: string;
  bytes: number;
  sha256: string;
};

export type PearlSandboxBranch = {
  id: string;
  name: string;
  parentId?: string;
  headImage: string;
  files: Record<string, string>;
  checks: {
    command: string;
    args?: string[];
    exitCode: number | null;
    passed: boolean;
    at: string;
    stdout?: string;
    stderr?: string;
  }[];
  syncedHead?: string;
};

export type PearlSandboxSyncReview = {
  token: string;
  branchId: string;
  headImage: string;
  files: TaskFileChange[];
  viewed: string[];
};

export type PearlSandboxState = {
  status: "prepared" | "uploading" | "ready" | "uncertain";
  active: boolean;
  projectId: string;
  projectPath: string;
  baseImage: string;
  baseImageTag?: string;
  baseDigest: string;
  manifest: PearlSandboxManifestFile[];
  excluded: string[];
  branches: PearlSandboxBranch[];
  activeBranchId?: string;
  pendingSync?: PearlSandboxSyncReview;
  pendingWrite?: { path: string; sha256: string; baseHead: string };
  pendingInstall?: { baseHead: string; branchId: string };
  pendingTurn?: {
    turnId: string;
    branchId: string;
    headImage: string;
    files: Record<string, string>;
  };
  lastOperation?: {
    stage: string;
    status: string;
    remoteId: string | null;
  };
  uploadProgress?: PearlSandboxUploadProgress;
  operations?: {
    stage: string;
    status: string;
    remoteId: string | null;
    resultImageId?: string | null;
    path?: string;
    at: string;
  }[];
};

export type PearlSandboxSnapshot = {
  branch: string;
  checkpoint: string;
  files: { path: string; changed: boolean; sha256: string }[];
  operations: NonNullable<PearlSandboxState["operations"]>;
  checks: PearlSandboxBranch["checks"];
};

export type PearlSandboxImageList = {
  images: CloudImage[];
  limited: boolean;
};

export type PearlSandboxUploadProgress = {
  phase: "preparing" | "transferring" | "verifying";
  uploadedBytes: number;
  totalBytes: number;
  completedFiles: number;
  totalFiles: number;
};
