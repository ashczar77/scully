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

it("keeps the full OpenAI-compatible Nebius catalog while disabling a known non-chat endpoint", () => {
  const options = parseModelCatalog({
    data: [
      {
        id: "nvidia/nemotron-3-super-120b-a12b",
        created: 1,
        object: "model",
        owned_by: "system",
      },
      {
        id: "Qwen/Qwen3-Embedding-8B",
        created: 1,
        object: "model",
        owned_by: "system",
      },
      {
        id: "vendor/new-chat-model",
        created: 1,
        object: "model",
        owned_by: "system",
      },
    ],
  });
  expect(options).toHaveLength(3);
  expect(
    options.find((item) => item.id.includes("Embedding"))?.disabledReason,
  ).toMatch(/different endpoint/);
  expect(
    options.find((item) => item.id === "vendor/new-chat-model")?.disabledReason,
  ).toBeUndefined();
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
            JSON.stringify({ data: [{ id: "x" }] }) +
              "x".repeat(8 * 1024 * 1024 + 1),
          ),
        ),
    ),
  ).rejects.toThrow(/size limit/i);
});
