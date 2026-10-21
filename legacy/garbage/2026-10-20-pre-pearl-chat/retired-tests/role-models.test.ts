import { expect, it } from "vitest";
import { rosterMembers, starterRoster } from "../src/shared/fixed-teams";
import { characterCatalog } from "../src/shared/character-catalog";
import {
  defaultRoleModelSettings,
  modelForActor,
  parseRoleModelSettings,
  thinkingForActor,
} from "../src/shared/role-models";

it("defaults Pearl to Super and each core role and specialist to Lightning", () => {
  expect(defaultRoleModelSettings.pearl).toBe(
    "nvidia/nemotron-3-super-120b-a12b",
  );
  for (const role of ["builder", "tester", "auditor"] as const)
    expect(defaultRoleModelSettings[role]).toBe(
      "nvidia/Nemotron-3_5-Lightning",
    );
  for (const specialist of characterCatalog.filter(
    (member) => member.role === "specialist",
  ))
    expect(defaultRoleModelSettings.specialists[specialist.id]).toBe(
      "nvidia/Nemotron-3_5-Lightning",
    );
});

it("routes models by role and by individual specialist", () => {
  const settings = {
    ...defaultRoleModelSettings,
    builder: "model-builder",
    tester: "model-tester",
    auditor: "model-auditor",
    specialists: {
      ...defaultRoleModelSettings.specialists,
      sloane: "model-design",
    },
  };
  const team = rosterMembers(starterRoster);
  team.push({
    ...team.find((member) => member.id === "maya")!,
    id: "tessa",
    runRole: "reserve",
  });
  expect(modelForActor(settings, "pearl", team, "fallback")).toBe(
    settings.pearl,
  );
  expect(modelForActor(settings, "maya", team, "fallback")).toBe(
    "model-builder",
  );
  expect(modelForActor(settings, "tessa", team, "fallback")).toBe(
    "model-builder",
  );
  expect(modelForActor(settings, "jun", team, "fallback")).toBe("model-tester");
  expect(modelForActor(settings, "ellis", team, "fallback")).toBe(
    "model-auditor",
  );
  expect(modelForActor(settings, "sloane", team, "fallback")).toBe(
    "model-design",
  );
  expect(modelForActor(settings, undefined, team, "fallback")).toBe("fallback");
});

it("routes saved thinking choices to the same actors as their models", () => {
  const settings = {
    ...defaultRoleModelSettings,
    thinking: { pearl: "on", builder: "off", sloane: "on" } as const,
  };
  const team = rosterMembers(starterRoster);
  expect(thinkingForActor(settings, "pearl", team)).toBe("on");
  expect(thinkingForActor(settings, "maya", team)).toBe("off");
  expect(thinkingForActor(settings, "sloane", team)).toBe("on");
  expect(thinkingForActor(settings, "jun", team)).toBeUndefined();
});

it("rejects invalid or unknown settings at the privileged boundary", () => {
  expect(
    parseRoleModelSettings({
      ...defaultRoleModelSettings,
      thinking: { pearl: "on", builder: "off" },
    }).thinking,
  ).toEqual({ pearl: "on", builder: "off" });
  expect(() =>
    parseRoleModelSettings({
      ...defaultRoleModelSettings,
      pearl: "../../bad model",
    }),
  ).toThrow();
  expect(() =>
    parseRoleModelSettings({ ...defaultRoleModelSettings, extra: "model" }),
  ).toThrow();
  expect(() =>
    parseRoleModelSettings({
      ...defaultRoleModelSettings,
      specialists: {
        ...defaultRoleModelSettings.specialists,
        unknown: "model",
      },
    }),
  ).toThrow();
  expect(() =>
    parseRoleModelSettings({
      ...defaultRoleModelSettings,
      specialists: { ...defaultRoleModelSettings.specialists, sloane: "" },
    }),
  ).toThrow();
});
