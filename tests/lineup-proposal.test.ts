import { expect, it } from "vitest";
import { parseSpecialistSuggestions } from "../src/shared/lineup-proposal";

it("accepts only bounded fixed specialists with a phase and task reason", () => {
  expect(
    parseSpecialistSuggestions([
      { id: "sloane", phase: "planning", reason: " Map the first-run flow " },
      { id: "kiran", phase: "verification", reason: "Review account access" },
    ]),
  ).toEqual({
    suggestions: [
      { id: "sloane", phase: "planning", reason: "Map the first-run flow" },
      { id: "kiran", phase: "verification", reason: "Review account access" },
    ],
    discardedInvalid: false,
  });
});

it("discards forged roles, duplicate people, malformed phases and excess suggestions", () => {
  expect(
    parseSpecialistSuggestions([
      {
        id: "maya",
        phase: "building",
        reason: "Builder masquerades as specialist",
      },
      { id: "sloane", phase: "planning", reason: "Design the flow" },
      { id: "sloane", phase: "release", reason: "Duplicate" },
      { id: "kiran", phase: "verification", reason: "Beyond limit" },
    ]),
  ).toEqual({
    suggestions: [
      { id: "sloane", phase: "planning", reason: "Design the flow" },
    ],
    discardedInvalid: true,
  });
  expect(
    parseSpecialistSuggestions([
      { id: "nobody", phase: "planning", reason: "Unknown" },
      { id: "kiran", phase: "deploy", reason: "Wrong phase" },
      { id: "jess", phase: "verification", reason: "Bad\nreason" },
    ]),
  ).toEqual({ suggestions: [], discardedInvalid: true });
  expect(parseSpecialistSuggestions(undefined)).toEqual({
    suggestions: [],
    discardedInvalid: true,
  });
});
