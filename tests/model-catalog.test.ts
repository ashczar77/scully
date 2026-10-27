// @vitest-environment node
import { expect, it } from "vitest";
import { parseModelCatalog } from "../src/main/model-catalog";

it("reports image input only when model metadata declares it", () => {
  const models = parseModelCatalog({
    data: [
      { id: "vendor/vision", architecture: { modality: "text+image->text" } },
      { id: "vendor/text", architecture: { modality: "text->text" } },
      { id: "vendor/unknown" },
    ],
  });
  expect(
    models.find((item) => item.id === "vendor/vision")?.supportsImages,
  ).toBe(true);
  expect(models.find((item) => item.id === "vendor/text")?.supportsImages).toBe(
    false,
  );
  expect(
    models.find((item) => item.id === "vendor/unknown")?.supportsImages,
  ).toBe(false);
});
