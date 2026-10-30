# fiber402 — W1 Evidence

Reproducible evidence for the "exact" scheme + "upto" capability design,
built against @x402/core 2.29.0 and a local FNN v0.9.1 testnet node.

**Reviewed in ≤30 min** by running the three commands below with a local
FNN v0.9.x node running at `FIBER_RPC_URL` (default `http://127.0.0.1:8227`).

## Prerequisites

- Node ≥ 20
- `cp .env.example .env` (already done; points FNN at 127.0.0.1:8227,
  CKB at 127.0.0.1:28114)
- A **local FNN v0.9.x testnet node** running (the reviewer's machine had
  one at `~/.fiber/bin/fnn`, v0.9.1, 40-day uptime, with a live ChannelReady
  channel — see spike §B). If no node is running, the offline/simulate
  paths still produce artifacts; only the live `new_invoice` leg needs it.

## The three re-runs

| # | Command | Artifact it proves |
|---|---------|--------------------|
| 1 | `npm install && npm run typecheck` | The whole SDK typechecks against @x402/core 2.29 + @ckb-ccc 1.23 — no Lumos, no frozen ckb-types |
| 2 | `npx tsx scripts/gap-repro.ts` | **W1 artifact #1** — mocked (`fbr_mock_`, fabricated hashes) vs live (node-issued `fibt1…` invoice + real `payment_hash`) receipt contrast. Output captured in `docs/spikes/gap-repro-output.txt`. |
| 3 | `npx tsx scripts/exact-poc.ts` | **W1 artifact #2** — full x402 exact flow: 402 `PaymentRequired` → agent `PaymentPayload` → `facilitator.verify` (isValid:true) → `facilitator.settle` over live FNN. Output captured in `docs/spikes/exact-poc-output.txt`. |
| 4 | `npm test` | **W1 artifact #3** — 24 offline unit tests: `upto` capability math (cap clamp, percent floor, USD, replay, deadline) + exact-scheme wiring (verify/settle, transport-error path). Fully offline, no node, no DB (Rule 6). |

## Expected output shapes (what "passing" looks like)

**gap-repro.ts**
- `[MOCK] sendPayment` → a `payment_hash` that is *locally fabricated*
  (the dormant public fiber402 demo's behavior).
- `[LIVE] newInvoice` → a node-issued `fibt1…` invoice + real
  `payment_hash` (signed by FNN).
- `[LIVE] sendPayment` → on this v0.9.1 node, a **structural transport
  error** (`fnn_transport_unavailable`), not a crash. This is the
  documented v0.9.1 behavior where `send_payment` drops the connection
  (spike §B) — the gap stands: the live invoice is node-issued vs the
  fabricated mock receipt.

**exact-poc.ts**
- `[3] facilitator.verify` → `{"isValid":true}`
- `[4] facilitator.settle` → either `success:true` + real `payment_hash`
  (if the node's `send_payment` is healthy) **or**
  `success:false, errorReason:"fnn_transport_unavailable"` (this node's
  observed behavior). Both are valid evidence that the exact-scheme
  plumbing ran end-to-end without an unhandled exception.

## What is NOT in W1 (by scope, see docs/plan.md)

- The `upto` scheme *handler* (`registerUptoScheme` is a stubbed attach
  point). W1 delivers the `upto` **capability math** (unit-tested) + the
  full **design** (`docs/upto-design.md`) including the cap-enforcement
  decision that answers the committee objection.
- npm publish, facilitator HTTP deploy, metered agent demo → W2–W4.

## Environment findings carried into the grant narrative

- FNN v0.9.1 `new_invoice` / `list_channels` / `get_invoice` answer live;
  `send_payment` / `node_info` / `get_payment` drop the connection
  (recorded, reproducible x2, node kept serving other methods — no crash).
  This is a legitimate upstream observability/reliability finding; out of
  scope for this grant but strengthens the "network is early, real
  operators need exactly this tooling" case.
- No CKB/Fiber CAIP namespace exists in any `@x402/*` package; fiber402
  pins `"fiber"` / `"fiber:ckb-testnet"` as a single swappable constant.

## Git

Nothing committed or pushed (project Rule 1). All W1 work is local in
this repo. Commit on explicit user approval.
