// @vitest-environment node
import { expect, it, vi } from "vitest";
import {
  fetchModelCatalog,
  parseModelCatalog,
} from "../src/main/model-catalog";

it("accepts only bounded, valid model IDs and deduplicates the choices", () => {
  expect(
    parseModelCatalog({
      data: [
        { id: "nvidia/Nemotron-3_5-Lightning" },
        { id: "nvidia/Nemotron-3_5-Lightning" },
        { id: "bad model" },
        { id: "x" },
      ],
    }),
  ).toEqual([
    { id: "nvidia/Nemotron-3_5-Lightning", name: "Nemotron-3_5-Lightning" },
    { id: "x", name: "x" },
  ]);
  expect(() => parseModelCatalog({ data: [{ id: "invalid model" }] })).toThrow(
    /no selectable/i,
  );
});

it("keeps the key in the backend request and rejects provider failures", async () => {
  const request = vi.fn().mockResolvedValue(new Response("", { status: 401 }));
  await expect(fetchModelCatalog("private-key", request)).rejects.toThrow(
    "HTTP 401",
  );
  expect(request).toHaveBeenCalledWith(
    "https://api.tokenfactory.nebius.com/v1/models",
    expect.objectContaining({
      method: "GET",
      headers: { Authorization: "Bearer private-key" },
    }),
  );
  await expect(
    fetchModelCatalog(
      "private-key",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ data: [{ id: "x" }] }) + "x".repeat(524289),
          ),
        ),
    ),
  ).rejects.toThrow(/size limit/i);
});
