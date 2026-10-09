import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { it, expect, vi } from "vitest";
import { parseSuggestions } from "../src/shared/suggestions";
import { SuggestionsPanel } from "../src/renderer/SuggestionsPanel";
import type { Run, RunAPI } from "../src/shared/runs";
it("bounds optional suggestions and deduplicates them", () => {
  expect(parseSuggestions(undefined)).toEqual([]);
  expect(parseSuggestions([" Later ", "Later"])).toEqual(["Later"]);
  for (const value of [
    null,
    "text",
    [""],
    [42],
    ["x".repeat(1001)],
    ["a", "b", "c", "d"],
    ["x\u0000"],
  ])
    expect(() => parseSuggestions(value)).toThrow();
});
it("waits until work stops and makes review explicitly non-authorizing", async () => {
  const run = {
    id: "r",
    status: "building",
    suggestions: [
      {
        id: "s",
        actor: "ellis",
        text: "Consider documentation examples",
        revision: "abc",
      },
    ],
  } as Run;
  const reviewSuggestion = vi.fn().mockResolvedValue({});
  const api = { reviewSuggestion } as unknown as RunAPI;
  const { rerender } = render(<SuggestionsPanel run={run} api={api} />);
  expect(screen.queryByText("Suggestions for later")).not.toBeInTheDocument();
  rerender(<SuggestionsPanel run={{ ...run, status: "complete" }} api={api} />);
  expect(
    screen.getByText(/does not approve implementation/),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByText("Mark reviewed"));
  await waitFor(() => expect(reviewSuggestion).toHaveBeenCalledWith("r", "s"));
  rerender(
    <SuggestionsPanel
      run={{ ...run, status: "complete", reviewedSuggestionIds: ["s"] }}
      api={api}
    />,
  );
  expect(screen.getByText("Reviewed, not scheduled")).toBeInTheDocument();
  expect(screen.queryByText("Mark reviewed")).not.toBeInTheDocument();
});
