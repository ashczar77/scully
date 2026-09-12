import { readFile } from "node:fs/promises";

const EXPECTED_CLIENTS = ["198.51.100.10", "198.51.100.11"];

export async function loadTrigger(
  source = new URL("../fixtures/requests.json", import.meta.url),
) {
  const value = JSON.parse(await readFile(source, "utf8"));
  if (
    value.schema_version !== "1.0" ||
    value.method !== "GET" ||
    value.path !== "/limited" ||
    !Array.isArray(value.clients) ||
    value.clients.length !== EXPECTED_CLIENTS.length ||
    value.clients.some((client, index) => client !== EXPECTED_CLIENTS[index])
  ) {
    throw new Error("Synthetic trigger data is outside the reviewed contract");
  }
  return Object.freeze({
    method: value.method,
    path: value.path,
    clients: Object.freeze([...value.clients]),
  });
}
