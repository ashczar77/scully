export type Teammate = {
  id: string;
  name: string;
  role: string;
  bio: string;
  instructions: string;
};
export type Task = {
  id: string;
  title: string;
  description: string;
  mode: "plan" | "work";
  createdAt: string;
};
export type Workspace = { tasks: Task[]; teammates: Teammate[] };
export type TaskInput = Pick<Task, "title" | "description" | "mode">;
export type DesktopAPI = import("./runs").RunAPI & {
  load: () => Promise<Workspace>;
  createTask: (input: TaskInput) => Promise<Task>;
  updateTeammate: (input: Teammate) => Promise<Teammate>;
};
export const initialTeam: Teammate[] = [
  {
    id: "maya",
    name: "Maya",
    role: "Builder",
    bio: "Turns the plan into thoughtful, focused changes.",
    instructions:
      "Follow project conventions. Keep changes focused and explain trade-offs.",
  },
  {
    id: "ellis",
    name: "Ellis",
    role: "Code auditor",
    bio: "Checks correctness, boundaries and maintainability.",
    instructions:
      "Challenge assumptions. Tie findings to specific code and reproducible evidence.",
  },
  {
    id: "jun",
    name: "Jun",
    role: "Test engineer",
    bio: "Looks past the happy path to find what breaks.",
    instructions:
      "Test negative cases and integration boundaries. Distinguish passed, failed and skipped checks.",
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
  if (!initialTeam.some((t) => t.id === v.id))
    throw new Error("Unknown teammate");
  return {
    id: v.id as string,
    name: text(v.name, 40),
    role: text(v.role, 60),
    bio: text(v.bio, 240),
    instructions: text(v.instructions, 2000),
  };
}
