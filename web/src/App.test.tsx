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

  it("creates and displays three bounded investigation alternatives", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(response(healthPayload()))
      .mockResolvedValueOnce(response(capsulePayload()))
      .mockResolvedValueOnce(response(investigationPayload()));
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /load seed capsule/i }));
    fireEvent.click(
      await screen.findByRole("button", { name: /create investigation/i }),
    );

    expect(
      await screen.findByRole("heading", { name: "Three causal alternatives" }),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Proxy trust is disabled" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Forwarded chain is overwritten" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Limiter key is global" })).toBeTruthy();
    expect(screen.getByText("Execution remains locked")).toBeTruthy();
    expect(fetchMock).toHaveBeenLastCalledWith("/api/investigations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ capsule_id: "proxy-identity-collapse-v1" }),
    });
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

function capsulePayload() {
  return {
    schema_version: "1.0",
    capsule_id: "proxy-identity-collapse-v1",
    title: "Proxy identity collapse",
    observed_summary: "Two clients collapse to one identity.",
    signature_id: "proxy-identity-collapse-v1",
    evidence: [
      {
        evidence_id: "environment",
        relative_path: "evidence/environment.json",
        sha256: "a".repeat(64),
        byte_size: 236,
        media_type: "application/json",
        provenance: "Project-created synthetic environment facts",
        redaction_status: "clean",
      },
    ],
  };
}

function investigationPayload() {
  const titles = [
    "Proxy trust is disabled",
    "Forwarded chain is overwritten",
    "Limiter key is global",
  ];
  const variants = [
    "trust-loopback",
    "preserve-forwarded-chain",
    "per-request-identity",
  ];
  const hypotheses = titles.map((title, index) => ({
    schema_version: "1.0",
    hypothesis_id: `inv-test-h${index + 1}`,
    title,
    mechanism: `Mechanism ${index + 1}`,
    rationale: `Rationale ${index + 1}`,
    testable_prediction: `Prediction ${index + 1}`,
    alternative_group: "primary-cause",
    evidence_ids: ["environment"],
    confidence: [0.7, 0.2, 0.1][index],
  }));
  return {
    schema_version: "1.0",
    investigation_id: "inv-test",
    capsule_id: "proxy-identity-collapse-v1",
    status: "ready",
    planning_source: "local",
    created_at: "2026-09-11T10:30:00Z",
    hypotheses,
    experiments: hypotheses.map((hypothesis, index) => ({
      schema_version: "1.0",
      experiment_id: `inv-test-e${index + 1}`,
      hypothesis_id: hypothesis.hypothesis_id,
      checkpoint_id: "inv-test-checkpoint",
      adapter: "local_fixture",
      variant: variants[index],
      parameters: {},
      operation_limit: 4,
      timeout_seconds: 60,
    })),
    events: [
      { sequence: 1, event_type: "investigation.created" },
      { sequence: 2, event_type: "planning.completed" },
    ],
  };
}

function response(payload: unknown, ok = true) {
  return {
    ok,
    json: async () => payload,
  } as Response;
}
