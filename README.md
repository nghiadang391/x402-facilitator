# x402-facilitator

Settles x402 agent payments over CKB's Fiber Network (FNN): a facilitator service and the `@x402-fiber` SDK, with the `exact` and metered `upto` schemes.

## Problem

x402 is how AI agents pay for APIs behind a paywall (HTTP 402 -> pay -> receipt). All its volume is on EVM chains; CKB/Fiber has no bridge. FNN's own x402 work is a stalled draft PR, and the only public Fiber demo settles with mocked payments.

This repo is that bridge, built on primitives already released in FNN v0.9.0 (keysend + custom records, preimage-gated settlement). The differentiator is `upto`: the buyer's cap is a dedicated, funded channel and only the measured usage (<= cap) settles. The cap is channel state, not an SDK counter, so a compromised agent physically cannot spend past it.

## Status

| Piece | State |
|---|---|
| `exact` scheme (client + facilitator) | works end-to-end against a live FNN testnet node |
| `upto` capability math (cap clamp, replay rejection, deadlines) | implemented, 24 offline tests |
| `upto` scheme handler | design only, `docs/upto-design.md`; attaches at `registerUptoScheme()` in `src/scheme.ts` |
| Facilitator HTTP service | bare Hono surface (`/supported` `/verify` `/settle`), no auth yet |
| Live `send_payment` on FNN v0.9.1 | the local node drops the connection; reported structurally as `fnn_transport_unavailable`, not a crash (spike, section B) |

## Running it

Node >= 20 and an FNN v0.9.x testnet node (default `127.0.0.1:8227`, override with `FIBER_RPC_URL`).

```bash
npm install
npx tsx scripts/gap-repro.ts   # mocked demo receipts vs node-issued receipts
npx tsx scripts/exact-poc.ts   # 402 -> verify -> settle over FNN
npm test                       # offline suite; no network, no DB
npm run dev                    # facilitator HTTP on :4020
```

Layout: `src/` (scheme handlers, FNN transport, upto math, server), `scripts/`, `tests/`, `docs/` (spike, upto design, W1 evidence, grant application draft). No Lumos, no `@nervosnetwork/ckb-types`; CKB side is `@ckb-ccc/core`.
