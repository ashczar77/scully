// @vitest-environment node
import { expect, it } from "vitest";
import { sandboxClient } from "../src/engine/sandbox";

const image = "11111111-1111-1111-1111-111111111111";
const config = { key: "test-key", projectId: "test-project" };

it("explains when a selected image has no workspace directory", async () => {
  const paths: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    paths.push(url.searchParams.get("path") || "");
    if (url.searchParams.get("path") === "/workspace")
      return new Response(null, { status: 404 });
    return Response.json({ path: "/", files: [] });
  }) as typeof fetch;
  await expect(sandboxClient(config, fetcher).listFiles(image)).rejects.toThrow(
    /no \/workspace directory/i,
  );
  expect(paths).toEqual(["/workspace", "/"]);
});

it("reports the HTTP status when image inspection is denied", async () => {
  const fetcher = (async () =>
    new Response(null, { status: 403 })) as typeof fetch;
  await expect(sandboxClient(config, fetcher).listFiles(image)).rejects.toThrow(
    /HTTP 403/,
  );
});

it("does not classify a failed workspace listing as missing when root shows one", async () => {
  const fetcher = (async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).searchParams.get("path");
    if (path === "/workspace") return new Response(null, { status: 404 });
    return Response.json({
      path: "/",
      files: [{ path: "workspace", is_dir: true }],
    });
  }) as typeof fetch;
  await expect(sandboxClient(config, fetcher).listFiles(image)).rejects.toThrow(
    /HTTP 404/,
  );
});
