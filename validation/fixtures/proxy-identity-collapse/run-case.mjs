import { createHash } from "node:crypto";
import http from "node:http";
import express from "express";

const caseName = process.env.SCULLY_CASE ?? "incident";

if (!new Set(["incident", "known-good"]).has(caseName)) {
  throw new Error(`Unsupported SCULLY_CASE: ${caseName}`);
}

const app = express();
const records = [];
const buckets = new Map();

if (caseName === "known-good") {
  app.set("trust proxy", "loopback");
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

app.get("/limited", (request, response) => {
  const identity = request.ip;
  const count = (buckets.get(identity) ?? 0) + 1;
  buckets.set(identity, count);

  const status = count > 1 ? 429 : 200;
  records.push({
    event: status === 429 ? "rate_limit_rejected" : "request_allowed",
    forwardedClient: request.get("x-forwarded-for"),
    identityDigest: digest(identity),
    status,
  });

  response.status(status).json({ status });
});

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address()));
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function request(port, clientAddress) {
  return new Promise((resolve, reject) => {
    const outgoing = http.request(
      {
        host: "127.0.0.1",
        port,
        path: "/limited",
        headers: { "x-test-client-address": clientAddress },
      },
      (response) => {
        response.resume();
        response.once("end", () => resolve(response.statusCode));
      },
    );
    outgoing.once("error", reject);
    outgoing.end();
  });
}

const backend = http.createServer(app);
const backendAddress = await listen(backend);

const proxy = http.createServer((incoming, response) => {
  const forwardedClient = incoming.headers["x-test-client-address"];
  const outgoing = http.request(
    {
      host: "127.0.0.1",
      port: backendAddress.port,
      path: incoming.url,
      method: incoming.method,
      headers: { "x-forwarded-for": forwardedClient },
    },
    (backendResponse) => {
      response.writeHead(backendResponse.statusCode, backendResponse.headers);
      backendResponse.pipe(response);
    },
  );
  outgoing.once("error", (error) => {
    response.writeHead(502);
    response.end(error.code ?? "proxy_error");
  });
  incoming.pipe(outgoing);
});

const proxyAddress = await listen(proxy);

try {
  const statuses = [
    await request(proxyAddress.port, "198.51.100.10"),
    await request(proxyAddress.port, "198.51.100.11"),
  ];
  const identities = records.map((record) => record.identityDigest);
  const actual = { identities, records, statuses };
  const matches =
    caseName === "incident"
      ? statuses.join(",") === "200,429" && identities[0] === identities[1]
      : statuses.join(",") === "200,200" && identities[0] !== identities[1];

  process.stdout.write(`${JSON.stringify({ case: caseName, matches, ...actual })}\n`);
  process.exitCode = matches ? 0 : 1;
} finally {
  await close(proxy);
  await close(backend);
}
