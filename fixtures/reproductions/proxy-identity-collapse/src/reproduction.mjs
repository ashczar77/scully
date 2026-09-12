import express from "express";
import http from "node:http";

const CLIENT_IDENTITIES = new Map([
  ["198.51.100.10", "identity:test-net-client-a"],
  ["198.51.100.11", "identity:test-net-client-b"],
]);
const VARIANTS = new Map([
  [
    "incident",
    { trustProxy: false, proxyMode: "replace", limiterKey: "normalized_ip" },
  ],
  [
    "trust-loopback",
    { trustProxy: "loopback", proxyMode: "replace", limiterKey: "normalized_ip" },
  ],
  [
    "preserve-forwarded-chain",
    { trustProxy: false, proxyMode: "preserve", limiterKey: "normalized_ip" },
  ],
  [
    "per-request-identity",
    { trustProxy: false, proxyMode: "replace", limiterKey: "request_ip" },
  ],
]);

export function createApp({ trustProxy = false, limiterKey = "normalized_ip" } = {}) {
  const app = express();
  const requestCount = new Map();
  app.set("trust proxy", trustProxy);
  app.get("/limited", (request, response) => {
    const identitySource = limiterKey === "request_ip" ? request.ip : String(request.ip);
    const identityDigest =
      CLIENT_IDENTITIES.get(identitySource) ?? "identity:loopback-proxy";
    const count = requestCount.get(identityDigest) ?? 0;
    requestCount.set(identityDigest, count + 1);
    const rejected = count >= 1;
    response.status(rejected ? 429 : 200).json({
      event: rejected ? "rate_limit_rejected" : "request_accepted",
      forwardedClient: request.get("x-forwarded-for"),
      identityDigest,
      normalizedIp: request.ip,
      socketAddress: request.socket.remoteAddress,
      limiterBucketCount: requestCount.size,
    });
  });
  return app;
}

export function createProxy({ targetPort, proxyMode }) {
  return http.createServer((request, response) => {
    const syntheticClient = request.headers["x-scully-client-ip"];
    if (typeof syntheticClient !== "string" || !CLIENT_IDENTITIES.has(syntheticClient)) {
      response.writeHead(400).end("invalid synthetic client");
      return;
    }
    const prior = request.headers["x-forwarded-for"];
    const forwarded =
      proxyMode === "preserve" && typeof prior === "string"
        ? `${prior}, ${syntheticClient}`
        : syntheticClient;
    const upstream = http.request(
      {
        host: "127.0.0.1",
        port: targetPort,
        path: request.url,
        method: request.method,
        headers: {
          accept: "application/json",
          connection: "close",
          "x-forwarded-for": forwarded,
          "x-forwarded-proto": "http",
        },
      },
      (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
        upstreamResponse.pipe(response);
      },
    );
    upstream.on("error", (error) => {
      response.writeHead(502).end(error.message);
    });
    request.pipe(upstream);
  });
}

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Local server did not expose a port");
  }
  return address.port;
}

async function close(server) {
  if (!server.listening) return;
  server.closeAllConnections?.();
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

export async function runSequence({ variant = "incident", trigger } = {}) {
  const configuration = VARIANTS.get(variant);
  if (!configuration) {
    throw new Error("Unsupported reproduction variant");
  }
  if (
    !trigger ||
    trigger.method !== "GET" ||
    trigger.path !== "/limited" ||
    !Array.isArray(trigger.clients) ||
    trigger.clients.length !== 2 ||
    trigger.clients.some((client) => !CLIENT_IDENTITIES.has(client))
  ) {
    throw new Error("Synthetic trigger is outside the reproduction contract");
  }
  const application = http.createServer(createApp(configuration));
  const applicationPort = await listen(application);
  const proxy = createProxy({
    targetPort: applicationPort,
    proxyMode: configuration.proxyMode,
  });
  const proxyPort = await listen(proxy);
  try {
    const records = [];
    for (const client of trigger.clients) {
      const response = await fetch(`http://127.0.0.1:${proxyPort}${trigger.path}`, {
        method: trigger.method,
        headers: { "x-scully-client-ip": client },
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
        normalized_ips: records.map((record) => record.normalizedIp),
        socket_addresses: records.map((record) => record.socketAddress),
        limiter_bucket_counts: records.map((record) => record.limiterBucketCount),
        proxy_hops: 1,
        proxy_mode: configuration.proxyMode,
        trust_proxy: configuration.trustProxy,
        limiter_key: configuration.limiterKey,
      },
    };
  } finally {
    await close(proxy);
    await close(application);
  }
}
