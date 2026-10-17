import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ConnectionSettings } from "../src/renderer/RunPanel";
import type { DesktopAPI } from "../src/shared/contracts";
import { defaultRoleModelSettings } from "../src/shared/role-models";

function connectionApi(configureSession = vi.fn(), configured = false) {
  return {
    session: vi.fn().mockResolvedValue({
      configured,
      model: configured ? defaultRoleModelSettings.pearl : "",
      outputTokens: 2048,
    }),
    roleModelSettings: vi.fn().mockResolvedValue(defaultRoleModelSettings),
    configureSession,
  } as unknown as DesktopAPI;
}

it("saves a connection with Pearl's selected model without exposing a generic model picker", async () => {
  const configureSession = vi.fn().mockResolvedValue({
    configured: true,
    model: defaultRoleModelSettings.pearl,
    outputTokens: 2048,
  });
  render(<ConnectionSettings api={connectionApi(configureSession)} />);
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Connection not set up",
  );
  expect(screen.queryByRole("button", { name: /Default model:/ })).toBeNull();
  fireEvent.change(screen.getByLabelText("API key"), {
    target: { value: "private-test-key" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Save session connection" }),
  );
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent("Connection saved"),
  );
  expect(configureSession).toHaveBeenCalledWith(
    expect.objectContaining({ model: defaultRoleModelSettings.pearl }),
  );
  expect(screen.getByRole("status")).not.toHaveTextContent("private-test-key");
  expect(screen.getByLabelText("API key")).toHaveValue("");
});

it("uses an updated Pearl model when the session connection is saved", async () => {
  const api = connectionApi(
    vi.fn().mockResolvedValue({
      configured: true,
      model: "zai-org/GLM-5.3",
      outputTokens: 2048,
    }),
  );
  vi.mocked(api.roleModelSettings).mockResolvedValue({
    ...defaultRoleModelSettings,
    pearl: "zai-org/GLM-5.3",
  });
  render(<ConnectionSettings api={api} />);
  await screen.findByRole("status");
  fireEvent.change(screen.getByLabelText("API key"), {
    target: { value: "private-test-key" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Save session connection" }),
  );
  await waitFor(() =>
    expect(api.configureSession).toHaveBeenCalledWith(
      expect.objectContaining({ model: "zai-org/GLM-5.3" }),
    ),
  );
});

it("keeps the neutral state and reports a failed save", async () => {
  const api = connectionApi(vi.fn().mockRejectedValue(new Error("rejected")));
  render(<ConnectionSettings api={api} />);
  await screen.findByRole("status");
  fireEvent.change(screen.getByLabelText("API key"), {
    target: { value: "private-test-key" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Save session connection" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not save connection",
  );
  expect(screen.getByRole("status")).toHaveTextContent("Connection not set up");
  expect(screen.getByRole("status")).not.toHaveTextContent("private-test-key");
});
