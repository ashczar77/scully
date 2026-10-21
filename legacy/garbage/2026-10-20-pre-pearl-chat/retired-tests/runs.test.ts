import { expect, it } from "vitest";
import {
  safePath,
  parseDraft,
  parseAudit,
  validateSession,
  containsSecret,
  normalizeDraftPath,
  canStartInitialPlanning,
} from "../src/shared/runs";
it("permits only the initial plan request through the historical run entry point", () => {
  const initial = {
    status: "prepared",
    taskSnapshot: { mode: "plan" },
    plan: "",
    correction: null,
  } as const;
  expect(canStartInitialPlanning(initial)).toBe(true);
  expect(canStartInitialPlanning({ ...initial, status: "planned" })).toBe(
    false,
  );
  expect(canStartInitialPlanning({ ...initial, plan: "Already planned" })).toBe(
    false,
  );
  expect(
    canStartInitialPlanning({
      ...initial,
      taskSnapshot: { ...initial.taskSnapshot!, mode: "work" },
    }),
  ).toBe(false);
  expect(canStartInitialPlanning({ ...initial, correction: {} })).toBe(false);
});
it.each([
  "../escape",
  "/absolute",
  "a/../b",
  "a\\b",
  "C:/x",
  ".env",
  "a/.git/config",
  "node_modules/x",
  "secret.json",
  "a.pem",
  "a\0b",
  "a//b",
  "con.txt",
  "src/AUX",
  "trailing.",
])("rejects unsafe output %s", (path) =>
  expect(() => safePath(path)).toThrow(),
);
it.each(["src/main.rs", "index.html", "tests/test_service.py", "pom.xml"])(
  "accepts cross-language source %s",
  (path) => expect(() => safePath(path)).not.toThrow(),
);
it("normalizes a harmless current-directory prefix before checking duplicate paths", () => {
  expect(normalizeDraftPath("./src/app.ts")).toBe("src/app.ts");
  expect(() => normalizeDraftPath("../src/app.ts")).toThrow(
    /parent directory/i,
  );
  expect(() => normalizeDraftPath("./.env")).toThrow(/hidden or private/i);
  expect(() => normalizeDraftPath("/private/app.ts")).toThrow(/absolute/i);
  expect(() =>
    parseDraft({
      summary: "x",
      files: [
        { path: "./src/app.ts", content: "a" },
        { path: "src/app.ts", content: "b" },
      ],
    }),
  ).toThrow(/Conflicting output paths/);
});
it("rejects duplicated, case-colliding and parent-child paths", () => {
  for (const paths of [
    ["a", "a"],
    ["a", "A"],
    ["a", "a/b"],
  ])
    expect(() =>
      parseDraft({
        summary: "x",
        files: paths.map((path) => ({ path, content: "x" })),
      }),
    ).toThrow();
});
it("rejects oversized drafts and unknown audit paths", () => {
  expect(() =>
    parseDraft({
      summary: "x",
      files: [{ path: "a", content: "x".repeat(48001) }],
    }),
  ).toThrow();
  expect(() =>
    parseAudit(
      {
        summary: "x",
        findings: [{ path: "missing", severity: "error", detail: "x" }],
      },
      ["a"],
    ),
  ).toThrow();
});
it("detects obvious credentials", () => {
  expect(containsSecret('api_key = "abcdefghijklmnop12345"')).toBe(true);
  expect(() =>
    parseDraft({
      summary: "x",
      files: [{ path: "config.txt", content: "-----BEGIN PRIVATE KEY-----" }],
    }),
  ).toThrow();
});
it("validates session limits without silently widening them", () => {
  expect(() =>
    validateSession({
      key: "placeholder-key",
      model: "model/name",
      outputTokens: 32769,
    }),
  ).toThrow();
  expect(() =>
    validateSession({
      key: "placeholder-key",
      model: "https://evil.example",
      outputTokens: 2048,
    }),
  ).not.toThrow();
  expect(() =>
    validateSession({ key: "x", model: "m", outputTokens: 2048 }),
  ).toThrow();
});
