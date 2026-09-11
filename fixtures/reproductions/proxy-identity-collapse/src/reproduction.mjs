import express from "express";

const CLIENTS = ["198.51.100.10", "198.51.100.11"];
const CLIENT_IDENTITIES = new Map([
  ["198.51.100.10", "identity:test-net-client-a"],
  ["198.51.100.11", "identity:test-net-client-b"],
]);

export function createApp({ trustProxy = false } = {}) {
  const app = express();
  const requestCount = new Map();
  app.set("trust proxy", trustProxy);
  app.get("/limited", (request, response) => {
    const identityDigest = CLIENT_IDENTITIES.get(request.ip) ?? "identity:loopback-proxy";
    const count = requestCount.get(identityDigest) ?? 0;
    requestCount.set(identityDigest, count + 1);
    const rejected = count >= 1;
    response.status(rejected ? 429 : 200).json({
      event: rejected ? "rate_limit_rejected" : "request_accepted",
      forwardedClient: request.get("x-forwarded-for"),
      identityDigest,
    });
  });
  return app;
}

export async function runSequence({ trustProxy = false } = {}) {
  const server = createApp({ trustProxy }).listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Reproduction server did not expose a local port");
  }
  try {
    const records = [];
    for (const client of CLIENTS) {
      const response = await fetch(`http://127.0.0.1:${address.port}/limited`, {
        headers: { "x-forwarded-for": client },
      });
      records.push({ status: response.status, ...(await response.json()) });
    }
    return {
      exit_code: 0,
      payload: {
        responses: records.map((record) => record.status),
        events: records.map((record) => record.event),
        identity_digests: records.map((record) => record.identityDigest),
        forwarded_clients: records.map((record) => record.forwardedClient),
      },
    };
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}
