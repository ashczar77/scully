import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

  it("loads the seed capsule and displays accepted evidence lineage", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(response(healthPayload()))
      .mockResolvedValueOnce(
        response({
          schema_version: "1.0",
          capsule_id: "proxy-identity-collapse-v1",
          title: "Proxy identity collapse",
          observed_summary: "Two clients collapse to one identity.",
          signature_id: "proxy-identity-collapse-v1",
          evidence: [
            {
              evidence_id: "requests",
              relative_path: "evidence/requests.json",
              sha256: "a".repeat(64),
              byte_size: 236,
              media_type: "application/json",
              provenance: "Project-created synthetic request sequence",
              redaction_status: "clean",
            },
          ],
        }),
      );
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /load seed capsule/i }));

    expect(await screen.findByText("Accepted capsule")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Proxy identity collapse" })).toBeTruthy();
    expect(screen.getByText("Project-created synthetic request sequence")).toBeTruthy();
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/capsules/import?seed=proxy-identity-collapse",
      { method: "POST" },
    );
  });

  it("shows a bounded rejection message", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(response(healthPayload()))
      .mockResolvedValueOnce(
        response(
          {
            detail: {
              code: "secret_detected",
              message: "Evidence failed the credential and local-path scan",
            },
          },
          false,
        ),
      );
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /load seed capsule/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Capsule rejected");
    expect(alert.textContent).toContain(
      "Evidence failed the credential and local-path scan",
    );
  });
});

function healthPayload() {
  return {
    status: "ok",
    service: "scully",
    version: "0.1.0",
    database: "ready",
    live_providers_enabled: false,
  };
}

function response(payload: unknown, ok = true) {
  return {
    ok,
    json: async () => payload,
  } as Response;
}
