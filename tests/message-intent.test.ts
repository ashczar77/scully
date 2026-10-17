import { expect, it } from "vitest";
import { requestsTaskChange } from "../src/shared/message-intent";

it("recognizes explicit task changes but leaves questions and ordinary messages alone", () => {
  expect(requestsTaskChange("Actually, change this to a mobile app.")).toBe(
    true,
  );
  expect(requestsTaskChange("Instead of local storage, use SQLite.")).toBe(
    true,
  );
  expect(requestsTaskChange("Let's use React instead.")).toBe(true);
  expect(
    requestsTaskChange("Use vanilla JavaScript and test duplicates."),
  ).toBe(true);
  expect(requestsTaskChange("I prefer localStorage.")).toBe(true);
  expect(requestsTaskChange("We should add import later.")).toBe(true);
  expect(requestsTaskChange("What if we used React? ")).toBe(false);
  expect(requestsTaskChange("Can you explain the current plan?")).toBe(false);
  expect(requestsTaskChange("@Sloane, how would you design the list?")).toBe(
    false,
  );
});
