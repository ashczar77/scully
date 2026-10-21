// @vitest-environment node
import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  characterById,
  characterCatalog,
  playbookModules,
  roleCapabilities,
} from "../src/shared/character-catalog";

it("defines sixteen distinct fixed characters with complete portrait assets", () => {
  expect(characterCatalog).toHaveLength(16);
  expect(new Set(characterCatalog.map(({ id }) => id)).size).toBe(16);
  expect(
    characterCatalog.reduce<Record<string, number>>((counts, character) => {
      counts[character.role] = (counts[character.role] || 0) + 1;
      return counts;
    }, {}),
  ).toEqual({
    builder: 3,
    tester: 2,
    auditor: 2,
    specialist: 8,
    coordinator: 1,
  });
  for (const character of characterCatalog) {
    expect(character.id).toMatch(/^[a-z]+$/);
    expect(character.brief.length).toBeGreaterThan(20);
    expect(character.background.length).toBeGreaterThan(20);
    expect(character.modules).toHaveLength(1);
    expect(playbookModules[character.modules[0]]).toBeTruthy();
    if (character.portrait.kind === "asset")
      expect(existsSync(join(process.cwd(), character.portrait.path))).toBe(
        true,
      );
    else {
      expect(character.portrait.atlas).toBeGreaterThanOrEqual(1);
      expect(character.portrait.atlas).toBeLessThanOrEqual(4);
      expect(character.portrait.column).toBeGreaterThanOrEqual(0);
      expect(character.portrait.column).toBeLessThanOrEqual(2);
    }
  }
});

it("keeps catalog identity and portrait references immutable", () => {
  const pearl = characterById("pearl")!;
  expect(pearl.role).toBe("coordinator");
  expect(Object.isFrozen(characterCatalog)).toBe(true);
  expect(Object.isFrozen(pearl)).toBe(true);
  expect(Object.isFrozen(pearl.portrait)).toBe(true);
  expect(Object.isFrozen(pearl.modules)).toBe(true);
  expect(characterById("unknown")).toBeUndefined();
});

it("gives interchangeable builders, testers and auditors the same role capability boundaries", () => {
  for (const role of ["builder", "tester", "auditor"] as const) {
    const members = characterCatalog.filter(
      (character) => character.role === role,
    );
    expect(members.length).toBeGreaterThan(1);
    expect(
      members.every((member) => member.modules[0] === members[0].modules[0]),
    ).toBe(true);
  }
  expect(roleCapabilities.builder.productionChanges).toBe(true);
  expect(roleCapabilities.tester.productionChanges).toBe(false);
  expect(roleCapabilities.auditor.independentAudit).toBe(true);
  expect(roleCapabilities.specialist.productionChanges).toBe(false);
  expect(roleCapabilities.coordinator.productionChanges).toBe(false);
});

it("records the agreed specialist boundaries without treating portraits as permissions", () => {
  expect(characterById("kiran")?.brief).toMatch(
    /authentication.*authorization/i,
  );
  expect(characterById("jess")?.brief).toMatch(
    /authentication.*authorization/i,
  );
  expect(playbookModules["documentation-communications"]).toMatch(
    /user review of exact recipients, subject, body and attachments.*one-use send/i,
  );
  expect(playbookModules.coordination).toMatch(/backend/i);
  expect(playbookModules["full-stack-build"]).toMatch(
    /migrations.*performance/i,
  );
  expect(playbookModules["product-testing"]).toMatch(/skipped.*untested/i);
  expect(playbookModules["independent-audit"]).toMatch(/code smells/i);
  expect(playbookModules["preventive-security"]).toMatch(
    /authorization.*injection.*secrets/i,
  );
  expect(playbookModules["penetration-testing"]).toMatch(/approved target/i);
  for (const module of Object.values(playbookModules)) {
    expect(module.length).toBeLessThan(1200);
  }
  expect(characterById("adrian")?.background).toBe(
    "Adrian spent his early career building booking software for independent music venues. He remembers the hour before doors opened, when a slow page or missing reservation could leave a line of people waiting outside. He learned to trace problems across the whole stack and to care about speed, recovery, and customer experience.",
  );
});
