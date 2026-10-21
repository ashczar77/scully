import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ModelPicker } from "../src/renderer/ModelPicker";

it("selects a named model with keyboard navigation and closes on Escape", () => {
  const onChange = vi.fn();
  render(
    <ModelPicker
      label="Task model"
      value="first"
      options={[
        { id: "first", name: "First model" },
        { id: "second", name: "Second model" },
      ]}
      onChange={onChange}
    />,
  );
  const trigger = screen.getByRole("button", {
    name: "Task model: First model",
  });
  fireEvent.click(trigger);
  fireEvent.keyDown(screen.getByRole("listbox"), { key: "ArrowDown" });
  expect(screen.getByRole("option", { name: "Second model" })).toHaveFocus();
  fireEvent.click(screen.getByRole("option", { name: "Second model" }));
  expect(onChange).toHaveBeenCalledWith("second");
  fireEvent.click(trigger);
  fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(trigger).toHaveFocus();
});
