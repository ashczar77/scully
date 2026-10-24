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
    expect(() =>
      session.selectModels({ model: "Qwen/ready", key: "injected-key" }),
    ).toThrow(/valid model selection/i);
    expect(session.current()?.key).toBe("valid-key");
  });

  it("requires a distinct, valid fallback model and exposes its selection without the key", () => {
    const session = new PearlSession();
    expect(
      session.configure({
        key: "valid-key",
        model: "zai-org/GLM-5.3-Flash",
        fallbackModel: "Qwen/Qwen3-235B-A22B-Instruct-2507",
        outputTokens: 8192,
      }),
    ).toEqual({
      configured: true,
      model: "zai-org/GLM-5.3-Flash",
      fallbackModel: "Qwen/Qwen3-235B-A22B-Instruct-2507",
      outputTokens: 8192,
    });
    expect(() =>
      session.configure({
        key: "valid-key",
        model: "zai-org/GLM-5.3-Flash",
        fallbackModel: "zai-org/GLM-5.3-Flash",
        outputTokens: 8192,
      }),
    ).toThrow(/fallback/i);
    expect(session.current()?.fallbackModel).toBe(
      "Qwen/Qwen3-235B-A22B-Instruct-2507",
    );
  });

  it("switches the primary model without replacing or exposing the session key", () => {
    const session = new PearlSession();
    expect(() => session.selectModels({ model: "Qwen/ready" })).toThrow(
      /connect nebius/i,
    );
    session.configure({
      key: "valid-key",
      model: "zai-org/GLM-5.3-Flash",
      fallbackModel: "Qwen/ready",
      outputTokens: 8192,
    });
    expect(
      session.selectModels({
        model: "Qwen/ready",
        fallbackModel: "zai-org/GLM-5.3-Flash",
      }),
    ).toEqual({
      configured: true,
      model: "Qwen/ready",
      fallbackModel: "zai-org/GLM-5.3-Flash",
      outputTokens: 8192,
    });
    expect(session.current()?.key).toBe("valid-key");
    expect(() =>
      session.selectModels({
        model: "Qwen/ready",
        fallbackModel: "Qwen/ready",
      }),
    ).toThrow(/fallback/i);
    expect(session.info().fallbackModel).toBe("zai-org/GLM-5.3-Flash");
    expect(
      session.selectModels({ model: "Qwen/ready" }).fallbackModel,
    ).toBeUndefined();
    expect(session.current()?.key).toBe("valid-key");
  });
});
