# Proxy Identity Collapse Reproduction

This package reproduces an Express proxy-trust failure using two synthetic
TEST-NET-2 client addresses, a loopback reverse proxy, and a separate loopback
application server. The client sends a test-only identity marker to the proxy.
Only the proxy writes `X-Forwarded-For` before forwarding the request to
Express.

## Requirements

- Node.js 22.22.2
- npm 10 or later

## Run

```shell
npm ci
npm run minimize
npm run verify
npm test
```

`npm run minimize` executes the incident, removes every observation field not
required by the declared signature, and prints the full-versus-minimized
comparison. It must retain four payload fields and remove seven informational
fields without changing the signature result.

`npm test` is expected to fail because the two forwarded clients collapse into
the same rate-limit bucket and receive responses `200,429` instead of
`200,200`.

Verify both the incident and known-good paths, plus the expected failing-test
exit code:

```shell
npm run verify
```

The archive includes the synthetic trigger in `fixtures/requests.json`, the
target signature in `signatures/proxy-identity-collapse-v1.json`, the reviewed
comparison in `minimization.json`, and the complete result and file-hash
manifest in `reproduction.json`.

The package binds both servers only to `127.0.0.1` and makes no external
network requests after dependency installation. All application and proxy
source in this archive is project-created and distributed under the repository
license. Express remains subject to its own dependency license.
