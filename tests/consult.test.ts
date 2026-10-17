// @vitest-environment node
import { expect, it, vi } from "vitest";
import { consultSpecialist } from "../src/engine/consult";
import { parseConsultationResult } from "../src/shared/consultation";

it("uses the fixed specialist playbook for one bounded planning response", async () => {
  const complete = vi.fn().mockResolvedValue({
    advice: "Check the keyboard path.",
    questions: ["Is keyboard-only checkout required?"],
  });
  const started = vi.fn();
  const context = JSON.stringify({
    specialistId: "sloane",
    phase: "planning",
    purpose: "Review checkout usability",
    task: { title: "Checkout" },
    plan: "Draft a flow",
  });
  expect(await consultSpecialist(context, { complete }, started)).toEqual({
    advice: "Check the keyboard path.",
    questions: ["Is keyboard-only checkout required?"],
  });
  expect(started).toHaveBeenCalledOnce();
  expect(complete).toHaveBeenCalledOnce();
  expect(complete.mock.calls[0][0]).toMatchObject({
    name: "consult_specialist",
    input: context,
  });
  expect(complete.mock.calls[0][0].system).toMatch(/read-only/);
  expect(complete.mock.calls[0][0].system).toMatch(/UI and UX design/i);
  expect(complete.mock.calls[0][0].system).not.toContain(
    "Review checkout usability",
  );
});

it("rejects non-specialist identities and malformed advice", async () => {
  const complete = vi.fn();
  await expect(
    consultSpecialist('{"specialistId":"maya"}', { complete }),
  ).rejects.toThrow(/identity/i);
  expect(complete).not.toHaveBeenCalled();
  expect(() =>
    parseConsultationResult({ advice: "", questions: [] }),
  ).toThrow();
  expect(() =>
    parseConsultationResult({ advice: "Fine", questions: ["Bad\u0000text"] }),
  ).toThrow();
});

it("lets a verification specialist assess only the supplied draft without claiming execution", async () => {
  const complete = vi.fn().mockResolvedValue({
    advice: "Inspect auth handling in app.ts.",
    questions: [],
  });
  await consultSpecialist(
    JSON.stringify({
      specialistId: "kiran",
      phase: "verification",
      purpose: "Review authentication",
      artifactRevision: "revision",
      drafts: [{ path: "app.ts", content: "export const ready = true" }],
    }),
    { complete },
  );
  expect(complete.mock.calls[0][0].system).toMatch(
    /supplied draft and audit notes/,
  );
  expect(complete.mock.calls[0][0].system).toMatch(
    /Do not claim you ran tests/,
  );
  expect(complete.mock.calls[0][0].system).toMatch(/security/i);
  await expect(
    consultSpecialist('{"specialistId":"kiran","phase":"release"}', {
      complete,
    }),
  ).rejects.toThrow(/phase/i);
  expect(complete).toHaveBeenCalledOnce();
});

it("gives a building specialist a plan-only pre-build briefing", async () => {
  const complete = vi.fn().mockResolvedValue({
    advice: "Use explicit state transitions.",
    questions: [],
  });
  const context = JSON.stringify({
    specialistId: "rafi",
    phase: "building",
    purpose: "Check recovery architecture",
    task: { title: "Account recovery" },
    plan: "Build a recovery flow",
  });
  await consultSpecialist(context, { complete });
  expect(complete.mock.calls[0][0].input).toBe(context);
  expect(complete.mock.calls[0][0].system).toMatch(/before writers start/);
  expect(complete.mock.calls[0][0].system).toMatch(
    /Do not claim you inspected source files/,
  );
  expect(complete.mock.calls[0][0].system).toMatch(/read-only/);
});
