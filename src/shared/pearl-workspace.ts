export type WorkspaceEntry = {
  path: string;
  kind: "file" | "directory";
  size?: number;
};

export type TaskFileChange = {
  path: string;
  kind: "added" | "modified" | "deleted";
  entry?: "directory" | "linked-or-special";
  beforeBytes: number;
  afterBytes: number;
  additions?: number;
  deletions?: number;
};

export type TaskChangeSet = {
  turnId: string;
  at: string;
  files: TaskFileChange[];
  undoAvailable: boolean;
  reason?: string;
  undone?: boolean;
};

export type FileReview = {
  path: string;
  before: string | null;
  after: string | null;
  binary: boolean;
};

export type GitView = {
  state: "ready" | "no-repository" | "unavailable";
  branch?: string;
  commits?: { hash: string; subject: string; author: string; date: string }[];
  changes?: { status: string; path: string }[];
  detail?: string;
};
