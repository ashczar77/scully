import { parsePortraitId } from "./portrait-library";

export type Teammate = {
  id: string;
  runRole?: "builder" | "tester" | "auditor" | "reserve";
  name: string;
  role: string;
  bio: string;
  instructions: string;
  portraitId: import("./portrait-library").PortraitId;
};
export type Task = {
  id: string;
  title: string;
  description: string;
  mode: "plan" | "work";
  createdAt: string;
  teamConfigId?: string;
};
export type Workspace = {
  tasks: Task[];
  teammates: Teammate[];
  savedTeams?: import("./teams").SavedTeam[];
  defaultTeamId?: string;
  activity: import("./team-activity").TeamActivity;
};
export type TaskInput = Pick<Task, "title" | "description" | "mode">;
export type DesktopAPI = import("./runs").RunAPI & {
  load: () => Promise<Workspace>;
  createTask: (input: TaskInput) => Promise<Task>;
  updateTask: (id: string, input: TaskInput) => Promise<Task>;
  deleteTask: (id: string) => Promise<{ deletedRuns: number }>;
  updateTeammate: (input: Teammate) => Promise<Teammate>;
  applyTeamStyle: (
    style: import("./team-styles").TeamStyleId,
  ) => Promise<Teammate[]>;
  saveTeam: (
    input: import("./fixed-teams").SaveFixedTeamInput,
  ) => Promise<import("./teams").SavedTeam>;
  setDefaultTeam: (id: string) => Promise<import("./teams").SavedTeam>;
  deleteTeam: (id: string) => Promise<import("./teams").SavedTeam>;
  restoreTeam: (id: string) => Promise<import("./teams").SavedTeam>;
};
export const initialTeam: Teammate[] = [
  {
    id: "maya",
    name: "Maya",
    role: "Builder",
    bio: "Turns the plan into thoughtful, focused changes.",
    instructions:
      "Follow project conventions. Keep changes focused and explain trade-offs.",
    portraitId: "portrait-01",
  },
  {
    id: "ellis",
    name: "Ellis",
    role: "Code auditor",
    bio: "Checks correctness, boundaries and maintainability.",
    instructions:
      "Challenge assumptions. Tie findings to specific code and reproducible evidence.",
    portraitId: "portrait-02",
  },
  {
    id: "jun",
    name: "Jun",
    role: "Test engineer",
    bio: "Looks past the happy path to find what breaks.",
    instructions:
      "Test negative cases and integration boundaries. Distinguish passed, failed and skipped checks.",
    portraitId: "portrait-03",
  },
];
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid input");
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number, required = true): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  )
    throw new Error("Invalid text");
  return value.trim();
}
export function parseTask(value: unknown): TaskInput {
  const v = record(value);
  if (v.mode !== "plan" && v.mode !== "work")
    throw new Error("Invalid task mode");
  return {
    title: text(v.title, 120),
    description: text(v.description, 4000, false),
    mode: v.mode,
  };
}
export function parseTeammate(value: unknown): Teammate {
  const v = record(value);
  if (typeof v.id !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(v.id))
    throw new Error("Invalid teammate ID");
  const legacy = initialTeam.some((t) => t.id === v.id);
  if (
    v.runRole !== undefined &&
    !["builder", "tester", "auditor", "reserve"].includes(v.runRole as string)
  )
    throw new Error("Invalid run role");
  if (!legacy && v.runRole === undefined)
    throw new Error("Choose a run role for the new member");
  return {
    id: v.id as string,
    ...(v.runRole !== undefined && {
      runRole: v.runRole as Teammate["runRole"],
    }),
    name: text(v.name, 40),
    role: text(v.role, 60),
    bio: text(v.bio, 240),
    instructions: text(v.instructions, 2000),
    portraitId: parsePortraitId(v.portraitId),
  };
}
