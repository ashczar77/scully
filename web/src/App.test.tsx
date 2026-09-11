import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

describe("App", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: "ok",
          service: "scully",
          version: "0.1.0",
          database: "ready",
          live_providers_enabled: false,
        }),
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the offline-first foundation and local readiness", async () => {
    render(<App />);

    expect(
      screen.getByRole("heading", {
        name: "Turn evidence into a testable failure.",
      }),
    ).toBeTruthy();
    expect(await screen.findByText("Local runtime ready")).toBeTruthy();
    expect(screen.getByText("SQLite ready")).toBeTruthy();
    expect(screen.getByText("Disabled by default")).toBeTruthy();
  });
});
