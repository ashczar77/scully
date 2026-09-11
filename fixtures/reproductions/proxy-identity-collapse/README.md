# Proxy Identity Collapse Reproduction

This package reproduces an Express proxy-trust failure using two synthetic
TEST-NET-2 client addresses and a loopback-only local server.

## Requirements

- Node.js 22.22.2
- npm 10 or later

## Run

```shell
npm ci
npm run observe
npm test
```

`npm run observe` prints the deterministic incident observation. `npm test`
is expected to fail because the two forwarded clients collapse into the same
rate-limit bucket and receive responses `200,429` instead of `200,200`.

Verify both the incident and known-good paths, plus the expected failing-test
exit code:

```shell
npm run verify
```

The package binds only to `127.0.0.1` and makes no external network requests
after dependency installation.
