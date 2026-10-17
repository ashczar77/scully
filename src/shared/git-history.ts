export type GitCommit = {
  hash: string;
  parents: string[];
  subject: string;
  author: string;
  date: string;
  refs: string[];
};

export type GitFileChange = { path: string; status: string };

export type GitHistory =
  | { state: "no-project" | "no-repository" | "unavailable"; detail?: string }
  | {
      state: "ready";
      branch: string;
      branches: string[];
      commits: GitCommit[];
      changes: GitFileChange[];
    };
