# x402-facilitator

Settles [x402](https://x402.org) machine payments over CKB's Fiber Network (FNN): a facilitator service and the `@x402-fiber` SDK, implementing the `exact` and metered `upto` schemes.

## The gap

x402 is how AI agents pay for APIs behind a paywall (HTTP 402 -> pay -> receipt). Its volume is on EVM. CKB/Fiber had no bridge: FNN's own x402 work is a draft PR that has sat for months, and the only public Fiber demo settles with mocked payments.

This repo is the bridge. The facilitator verifies and settles x402 payments over FNN channels, using primitives already released in v0.9.0 (keysend + custom records, preimage-gated settlement). The SDK is what agent code imports.

`upto` is the scheme that fits the gap: instead of a fixed amount, the buyer opens a dedicated channel capped at an authorized limit, the provider does the work and meters usage, and the measured amount settles (never more than the cap). The cap is funded channel state, not a counter in the SDK, so a compromised or prompt-injected agent physically cannot spend more than what is in the channel.

## Usage

Requires Node >= 20 and an FNN v0.9.x testnet node (default `127.0.0.1:8227`, override with `FIBER_RPC_URL`).

```bash
git clone https://github.com/nghiadang391/x402-facilitator
cd x402-facilitator
npm install
cp .env.example .env
```

Reproduce the gap (mocked demo receipts vs live node-issued receipts):

```bash
npx tsx scripts/gap-repro.ts
```

Run the `exact` scheme end-to-end (402 -> verify -> settle over FNN):

```bash
npx tsx scripts/exact-poc.ts
```

Offline test suite (24 tests, no network, no DB):

```bash
npm test
```

Facilitator HTTP service (`/supported`, `/verify`, `/settle`):

```bash
npm run dev
```

## Layout

```
src/scheme.ts      x402 client + facilitator handlers for "exact"; "upto" attaches in registerUptoScheme()
src/fnnClient.ts   FNN JSON-RPC transport, injectable fetch, offline fbr_mock_ gate
src/capability.ts  upto math: cap clamping, preimage registry (replay rejection), deadlines
src/server.ts      Hono facilitator surface
scripts/           gap-repro.ts, exact-poc.ts
tests/             offline unit tests
docs/              spike notes, upto design, W1 evidence, grant application draft
```

## Status

- `exact` runs end-to-end against a live node. `upto` ships as capability math + design (`docs/upto-design.md`); the handler is the next milestone (W2 in `docs/plan.md`).
- On FNN v0.9.1 (local testnet node) `send_payment` drops the connection; the facilitator reports it as a `fnn_transport_unavailable` settle failure rather than crashing. Details in `docs/spikes/w1-reality-check.md` section B.
- No Lumos, no `@nervosnetwork/ckb-types`; the CKB side is `@ckb-ccc/core`.
