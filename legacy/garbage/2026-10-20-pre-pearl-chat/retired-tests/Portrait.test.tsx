import { expect, it } from "vitest";
import { portraitOptions } from "../src/shared/portrait-library";
import { portraitStyle } from "../src/renderer/Portrait";

it("uses a distinct standalone image for each team portrait", () => {
  const images = portraitOptions.map(
    (option) => portraitStyle(option.id).backgroundImage,
  );
  expect(new Set(images).size).toBe(images.length);
  expect(
    images.every((image) => image.startsWith("url(") && image.endsWith(")")),
  ).toBe(true);
  expect(portraitStyle("portrait-04").backgroundSize).toBe("cover");
});
