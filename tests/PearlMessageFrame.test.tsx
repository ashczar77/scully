import React from "react";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import {
  messageTime,
  PearlMessageFrame,
} from "../src/renderer/PearlMessageFrame";

it("omits an invalid time without losing the message", () => {
  expect(messageTime("invalid timestamp")).toBe("");
  render(
    <PearlMessageFrame role="assistant" at="invalid timestamp">
      The reply is still visible.
    </PearlMessageFrame>,
  );
  expect(screen.getByText("The reply is still visible.")).toBeInTheDocument();
  expect(screen.queryByRole("time")).not.toBeInTheDocument();
  expect(document.querySelector("time")).toBeNull();
});
