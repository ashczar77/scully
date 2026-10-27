import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { PearlFileWorkbench } from "../src/renderer/PearlFileWorkbench";

it("opens local and Sandbox files as center tabs without activating source markup", () => {
  const select = vi.fn();
  const closeFile = vi.fn();
  render(
    <PearlFileWorkbench
      files={[
        {
          id: "local",
          path: "src/index.html",
          source: "Local",
          content: "<script>window.bad = true</script>",
        },
        {
          id: "remote",
          path: "src/main.ts",
          source: "Sandbox",
          review: {
            path: "src/main.ts",
            before: "old",
            after: "new",
            binary: false,
          },
        },
      ]}
      activeId="local"
      onSelect={select}
      onCloseFile={closeFile}
      onClose={() => {}}
    />,
  );
  expect(screen.getByLabelText("File editor")).toHaveTextContent(
    "<script>window.bad = true</script>",
  );
  expect(
    screen.getByLabelText("File editor").querySelector("script"),
  ).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: "main.ts" }));
  expect(select).toHaveBeenCalledWith("remote");
  fireEvent.click(screen.getByRole("button", { name: "Close src/index.html" }));
  expect(closeFile).toHaveBeenCalledWith("local");
});

it("renders a bounded number of lines for a large file", () => {
  render(
    <PearlFileWorkbench
      files={[
        {
          id: "large",
          path: "large.ts",
          source: "Local",
          content: Array.from(
            { length: 10_000 },
            (_, index) => `line ${index}`,
          ).join("\n"),
        },
      ]}
      activeId="large"
      onSelect={() => {}}
      onCloseFile={() => {}}
      onClose={() => {}}
    />,
  );
  expect(
    screen.getByLabelText("Code preview").querySelectorAll(".pearl-code-line")
      .length,
  ).toBeLessThanOrEqual(240);
});

it("keeps the virtual scroll height bounded for a million-line file", () => {
  render(
    <PearlFileWorkbench
      files={[
        {
          id: "million",
          path: "large.log",
          source: "Local",
          content: "x\n".repeat(1_000_000),
        },
      ]}
      activeId="million"
      onSelect={() => {}}
      onCloseFile={() => {}}
      onClose={() => {}}
    />,
  );
  const preview = screen.getByLabelText("Code preview");
  const bottomSpacer = preview.querySelector(".pearl-code-lines")
    ?.lastElementChild as HTMLElement;
  expect(parseFloat(bottomSpacer.style.height)).toBeLessThan(8_000_000);
  expect(preview.querySelectorAll(".pearl-code-line")).toHaveLength(240);
});

it("offers tab cleanup actions for the selected tab", () => {
  const closeFiles = vi.fn();
  const files = ["one", "two", "three", "four"].map((id) => ({
    id,
    path: `${id}.ts`,
    source: "Local" as const,
    content: id,
  }));
  render(
    <PearlFileWorkbench
      files={files}
      activeId="three"
      onSelect={() => {}}
      onCloseFile={() => {}}
      onCloseFiles={closeFiles}
      onClose={() => {}}
    />,
  );
  fireEvent.contextMenu(screen.getByRole("tab", { name: "three.ts" }));
  fireEvent.click(
    screen.getByRole("menuitem", { name: "Close tabs to the left" }),
  );
  expect(closeFiles).toHaveBeenCalledWith(["one", "two"]);
  fireEvent.click(screen.getByRole("button", { name: "Tab actions" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Close other tabs" }));
  expect(closeFiles).toHaveBeenCalledWith(["one", "two", "four"]);
});

it("keeps Before and After visible for both small and large text changes", () => {
  const view = render(
    <PearlFileWorkbench
      files={[
        {
          id: "small",
          path: "small.ts",
          source: "Sandbox",
          review: {
            path: "small.ts",
            before: "old",
            after: "new",
            binary: false,
          },
        },
      ]}
      activeId="small"
      onSelect={() => {}}
      onCloseFile={() => {}}
      onClose={() => {}}
    />,
  );
  expect(screen.getByText("Before")).toBeInTheDocument();
  expect(screen.getByText("After")).toBeInTheDocument();
  expect(
    screen.getByRole("separator", { name: "Resize comparison" }),
  ).toBeInTheDocument();
  view.rerender(
    <PearlFileWorkbench
      files={[
        {
          id: "large",
          path: "large.ts",
          source: "Sandbox",
          review: {
            path: "large.ts",
            before: "a\n".repeat(700),
            after: "b\n".repeat(700),
            binary: false,
          },
        },
      ]}
      activeId="large"
      onSelect={() => {}}
      onCloseFile={() => {}}
      onClose={() => {}}
    />,
  );
  expect(screen.getByText("Before")).toBeInTheDocument();
  expect(screen.getByText("After")).toBeInTheDocument();
});

it("limits comparison resizing with keyboard controls", () => {
  render(
    <PearlFileWorkbench
      files={[
        {
          id: "review",
          path: "main.ts",
          source: "Local",
          review: {
            path: "main.ts",
            before: "old",
            after: "new",
            binary: false,
          },
        },
      ]}
      activeId="review"
      onSelect={() => {}}
      onCloseFile={() => {}}
      onClose={() => {}}
    />,
  );
  const divider = screen.getByRole("separator", { name: "Resize comparison" });
  fireEvent.keyDown(divider, { key: "End" });
  expect(divider).toHaveAttribute("aria-valuenow", "75");
  fireEvent.keyDown(divider, { key: "ArrowRight" });
  expect(divider).toHaveAttribute("aria-valuenow", "75");
  fireEvent.keyDown(divider, { key: "Home" });
  expect(divider).toHaveAttribute("aria-valuenow", "25");
});

it("offers overflow controls when tabs exceed the available width", () => {
  render(
    <PearlFileWorkbench
      files={["one", "two", "three"].map((id) => ({
        id,
        path: `${id}.ts`,
        source: "Local" as const,
        content: id,
      }))}
      activeId="one"
      onSelect={() => {}}
      onCloseFile={() => {}}
      onClose={() => {}}
    />,
  );
  const strip = screen.getByRole("tablist", { name: "Open files" });
  Object.defineProperty(strip, "clientWidth", {
    configurable: true,
    value: 100,
  });
  Object.defineProperty(strip, "scrollWidth", {
    configurable: true,
    value: 500,
  });
  const scrollBy = vi.fn();
  Object.defineProperty(strip, "scrollBy", {
    configurable: true,
    value: scrollBy,
  });
  fireEvent.scroll(strip);
  fireEvent.click(screen.getByRole("button", { name: "Scroll tabs right" }));
  expect(scrollBy).toHaveBeenCalledWith(
    expect.objectContaining({ left: expect.any(Number) }),
  );
  Object.defineProperty(strip, "scrollLeft", {
    configurable: true,
    value: 300,
  });
  fireEvent.scroll(strip);
  expect(
    screen.getByRole("button", { name: "Scroll tabs left" }),
  ).toBeEnabled();
});
