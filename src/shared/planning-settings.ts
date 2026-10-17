export type PlanningSettings = { temperature: number };

export const defaultPlanningSettings: PlanningSettings = { temperature: 0.2 };

export function parsePlanningSettings(value: unknown): PlanningSettings {
  const temperature = (value as PlanningSettings | null)?.temperature;
  if (
    typeof temperature !== "number" ||
    !Number.isFinite(temperature) ||
    temperature < 0 ||
    temperature > 1 ||
    Math.round(temperature * 10) !== temperature * 10
  )
    throw new Error(
      "Planning temperature must be between 0 and 1 in steps of 0.1",
    );
  return { temperature };
}
