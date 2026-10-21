import { describe, expect, it } from "vitest";
import { PearlSession } from "../src/main/pearl-session";

describe("Pearl session", () => {
  it("keeps credentials out of session info and returns a copy to the agent", () => {
    const session = new PearlSession();
    expect(session.info()).toEqual({
      configured: false,
      model: "",
      outputTokens: 2048,
    });
    expect(
      session.configure({
        key: " secret-key ",
        model: "nvidia/Nemotron",
        outputTokens: 8192,
      }),
    ).toEqual({
      configured: true,
      model: "nvidia/Nemotron",
      outputTokens: 8192,
    });
    const current = session.current()!;
    current.key = "changed-key";
    expect(session.current()?.key).toBe("secret-key");
    session.close();
    expect(session.current()).toBeNull();
  });

  it("rejects invalid configuration without replacing the active connection", () => {
    const session = new PearlSession();
    session.configure({
      key: "valid-key",
      model: "nvidia/Nemotron",
      outputTokens: 8192,
    });
    expect(() =>
      session.configure({
        key: "short",
        model: "nvidia/Nemotron",
        outputTokens: 8192,
      }),
    ).toThrow("Enter a valid key");
    expect(session.current()?.key).toBe("valid-key");
  });
});
