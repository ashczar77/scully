import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { FilePreview } from "../src/renderer/FilePreview";

it("opens a read-only central file preview and returns to the previous page", () => {
  const onBack = vi.fn();
  render(
    <FilePreview
      file={{
        path: "src/App.tsx",
        content: "<script>not HTML</script>",
        status: "proposed",
        owner: "Maya",
      }}
      onBack={onBack}
    />,
  );
  expect(
    screen.getByRole("region", { name: "File preview" }),
  ).toBeInTheDocument();
  expect(screen.getByText("src/App.tsx")).toBeInTheDocument();
  expect(
    screen.getByText("Maya · proposed · Read-only preview"),
  ).toBeInTheDocument();
  expect(screen.getByText("<script>not HTML</script>")).toBeInTheDocument();
  expect(document.querySelector("script")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(onBack).toHaveBeenCalledOnce();
});
