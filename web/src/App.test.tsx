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
        name: "What evidence will enter, and is it safe?",
      }),
    ).toBeTruthy();
    expect(await screen.findByText("Local runtime ready")).toBeTruthy();
    expect(screen.getByText("SQLite ready")).toBeTruthy();
    expect(screen.getByText("Disabled by default")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "No production connection" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Skip to investigation" })).toBeTruthy();
  });

  it("loads the seed capsule and displays accepted evidence lineage", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(response(healthPayload()))
      .mockResolvedValueOnce(response(capsulePayload()));
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /load safe seed/i }));

    const overviewHeading = await screen.findByRole("heading", {
      name: "What do we know happened?",
    });
    expect(overviewHeading).toBeTruthy();
    expect(document.activeElement).toBe(overviewHeading);
    expect(screen.getByRole("heading", { name: "Proxy identity collapse" })).toBeTruthy();
    expect(screen.getByText("Project-created synthetic environment facts")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "What changed?" })).toBeTruthy();
    expect(screen.getByText("Safety review passed")).toBeTruthy();
    expect(screen.getByText("No production credentials or provider keys")).toBeTruthy();
    expect(screen.getByText("No required comparison gaps detected.")).toBeTruthy();
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

    fireEvent.click(await screen.findByRole("button", { name: /load safe seed/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Capsule rejected");
    expect(alert.textContent).toContain(
      "Evidence failed the credential and local-path scan",
    );
    expect(document.activeElement).toBe(alert);
  });

  it("creates and displays three bounded investigation alternatives", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(response(healthPayload()))
      .mockResolvedValueOnce(response(capsulePayload()))
      .mockResolvedValueOnce(response(investigationPayload()))
      .mockResolvedValueOnce(
        streamResponse([
          ["execution.started", { checkpoint_id: "inv-test-checkpoint" }],
          ["experiment.started", { experiment_id: "inv-test-e1" }],
          ["complete", executedInvestigationPayload()],
        ]),
      );
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /load safe seed/i }));
    fireEvent.click(
      await screen.findByRole("button", { name: /create investigation/i }),
    );

    expect(
      await screen.findByRole("heading", { name: "Three causal alternatives" }),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Proxy trust is disabled" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Forwarded chain is overwritten" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Limiter key is global" })).toBeTruthy();
    expect(screen.getByText("Local execution ready")).toBeTruthy();
    expect(fetchMock).toHaveBeenLastCalledWith("/api/investigations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ capsule_id: "proxy-identity-collapse-v1" }),
    });

    fireEvent.click(screen.getByRole("button", { name: /run 3 branches/i }));

    expect(await screen.findByText("execution started")).toBeTruthy();
    expect(await screen.findByText("Supported cause")).toBeTruthy();
    expect(screen.getByText(/Isolation verified/)).toBeTruthy();
    expect(screen.getByText("Supports hypothesis")).toBeTruthy();
    expect(screen.getAllByText("Hypothesis eliminated")).toHaveLength(2);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/investigations/inv-test/execute/stream",
      { method: "POST" },
    );
    const download = screen.getByRole("link", { name: /download reproduction/i });
    expect(download.getAttribute("href")).toBe(
      "/api/investigations/inv-test/reproduction.zip",
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

function capsulePayload() {
  return {
    schema_version: "1.0",
    capsule_id: "proxy-identity-collapse-v1",
    title: "Proxy identity collapse",
    observed_summary: "Two clients collapse to one identity.",
    signature_id: "proxy-identity-collapse-v1",
    signature_matcher_count: 5,
    known_good_summary:
      "Trust only the controlled loopback proxy and both requests return HTTP 200.",
    environment: [
      {
        name: "runtime",
        incident_value: "Node.js 22.22.2",
        known_good_value: "Node.js 22.22.2",
      },
      {
        name: "trust-proxy",
        incident_value: "false",
        known_good_value: "loopback",
      },
    ],
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
    exclusions: [
      "No production credentials or provider keys",
      "No customer or employee data",
    ],
    execution_boundary: {
      runtime: "nodejs",
      runtime_version: "22.22.2",
      network_access: false,
      max_duration_seconds: 60,
    },
    missing_evidence: [],
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
    execution: null,
  };
}

function executedInvestigationPayload() {
  const planned = investigationPayload();
  return {
    ...planned,
    status: "completed",
    events: [
      ...planned.events,
      { sequence: 3, event_type: "execution.started" },
      { sequence: 4, event_type: "investigation.completed" },
    ],
    execution: {
      status: "completed",
      signature_id: "proxy-identity-collapse-v1",
      evaluator_version: "1",
      execution_source: "local",
      isolation_verified: true,
      operation_count: 3,
      retry_count: 0,
      supported_hypothesis_id: "inv-test-h1",
      outcomes: planned.hypotheses.map((hypothesis, index) => ({
        experiment_id: `inv-test-e${index + 1}`,
        hypothesis_id: hypothesis.hypothesis_id,
        status: index === 0 ? "eliminated" : "reproduced",
        verdict: index === 0 ? "not_reproduced" : "reproduced",
        hypothesis_disposition: index === 0 ? "supported" : "eliminated",
        observation_digest: "b".repeat(64),
        matcher_results: [],
        elimination_reasons:
          index === 0 ? [] : ["failure_signature_still_reproduced"],
        duration_ms: 1,
      })),
      limitations: [],
    },
  };
}

function response(payload: unknown, ok = true) {
  return {
    ok,
    json: async () => payload,
  } as Response;
}

function streamResponse(messages: [string, unknown][]) {
  const encoder = new TextEncoder();
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const [eventType, payload] = messages[index];
      controller.enqueue(
        encoder.encode(`event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`),
      );
      index += 1;
      if (index === messages.length) {
        controller.close();
        return;
      }
      return new Promise((resolve) => setTimeout(resolve, 25));
    },
  });
  return { ok: true, body } as Response;
}
