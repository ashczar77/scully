import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { TeammateModelSettings } from "../src/renderer/TeammateModelSettings";
import type { DesktopAPI } from "../src/shared/contracts";
import { characterCatalog } from "../src/shared/character-catalog";
import { defaultRoleModelSettings } from "../src/shared/role-models";

function api() {
  return {
    roleModelSettings: vi.fn().mockResolvedValue(defaultRoleModelSettings),
    setRoleModelSettings: vi.fn().mockImplementation(async (value) => value),
    session: vi.fn().mockResolvedValue({
      configured: true,
      model: defaultRoleModelSettings.pearl,
      outputTokens: 2048,
    }),
    listModels: vi.fn().mockResolvedValue([
      { id: defaultRoleModelSettings.pearl, name: "Nemotron 3 Super" },
      { id: defaultRoleModelSettings.builder, name: "Nemotron 3.5 Lightning" },
      { id: "zai-org/GLM-5.3", name: "GLM 5.3" },
    ]),
  } as unknown as DesktopAPI;
}

it("offers distinct selectors for Pearl, core roles, and every specialist", async () => {
  render(<TeammateModelSettings api={api()} />);
  expect(
    await screen.findByRole("button", {
      name: "Pearl model: Nemotron 3 Super",
    }),
  ).toBeInTheDocument();
  for (const label of ["Builders", "Testers", "Auditors"])
    expect(
      screen.getByRole("button", {
        name: `${label} model: Nemotron 3.5 Lightning`,
      }),
    ).toBeInTheDocument();
  for (const member of characterCatalog.filter(
    (item) => item.role === "specialist",
  ))
    expect(
      screen.getByRole("button", {
        name: `${member.name} model: Nemotron 3.5 Lightning`,
      }),
    ).toBeInTheDocument();
});

it("saves a specialist choice independently and shows a temporary confirmation", async () => {
  const bridge = api();
  render(<TeammateModelSettings api={bridge} />);
  const button = await screen.findByRole("button", {
    name: "Sloane model: Nemotron 3.5 Lightning",
  });
  fireEvent.click(button);
  fireEvent.click(await screen.findByRole("option", { name: "GLM 5.3" }));
  await waitFor(() =>
    expect(bridge.setRoleModelSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        specialists: expect.objectContaining({
          sloane: "zai-org/GLM-5.3",
          nadine: defaultRoleModelSettings.specialists.nadine,
        }),
      }),
    ),
  );
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Sloane model saved",
  );
  expect(
    screen.getByRole("button", { name: "Sloane model: GLM 5.3" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", {
      name: "Nadine model: Nemotron 3.5 Lightning",
    }),
  ).toBeInTheDocument();
});

it("keeps the prior choice and reports a rejected save", async () => {
  const bridge = api();
  vi.mocked(bridge.setRoleModelSettings).mockRejectedValue(
    new Error("Model unavailable"),
  );
  render(<TeammateModelSettings api={bridge} />);
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Builders model: Nemotron 3.5 Lightning",
    }),
  );
  fireEvent.click(await screen.findByRole("option", { name: "GLM 5.3" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Model unavailable",
  );
  expect(
    screen.getByRole("button", {
      name: "Builders model: Nemotron 3.5 Lightning",
    }),
  ).toBeInTheDocument();
});
