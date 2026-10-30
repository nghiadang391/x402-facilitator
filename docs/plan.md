# x402-fiber — Project Plan

x402 facilitator + `@x402-fiber` SDK, settling over CKB/Fiber (FNN).
**Naming:** repo `x402-fiber`, npm `@x402-fiber`. Deliberately distinct
from the dormant `David-Pjs/fiber402` PoC (same word order reversed);
that demo claims none of our names (verified on GitHub + npm, 2026-10-30).
Schemes: `exact` + metered `upto`. Application-layer only; zero PRs into
`nervosnetwork/fiber`, zero dependency on FNN roadmap items (PTLC,
liquidity M5).

Status: DRAFT, uncommitted. 2026-10-30.

---

## 1. What (deliverables)

1. `@x402-fiber` SDK (npm): x402 scheme handler (`exact`, `upto`),
   FNN settlement + ccc tx building, typed client helpers, tests, CI,
   published to npm.
2. Facilitator service: provider-side x402 middleware (pay-per-API-call),
   deployed on testnet, public URL.
3. Metered demo: agent (ToyTrade's price-lookup flow as the "real user")
   pays a live provider, settled at measured usage within a signed cap.
4. `verification/` dir: tx hashes + reproducible commands (committee
   evidence standard, cf. Dular, Seedsong).
5. Scheme spec doc (see §5) + application appendix ("no roadmap
   dependencies" statement).

Live in this repo (`x402_facilitator/`). ToyTrade stays untouched; it is
the week-4 demo user.

## 2. Why (one paragraph)

FNN's own design doc (issue #1255) calls for an x402 facilitator
("4 weeks, 1 engineer, high priority"); their internal PR #1301 has been a
stalled draft for 4+ months and no x402 work shipped in v0.9.0, v0.9.1 or
v0.10.0-rc1. The only public x402-on-Fiber demos (David-Pjs/fiber402, mocked;
RetricSu/fiber-x402-blog, works only on the unmerged #1301 branch) ship no
usable SDK. x402 is
the Linux Foundation standard with real external demand ($24M volume,
22k sellers in 30 days on EVM chains) — a Fiber bridge into that
ecosystem does not exist. This is application-layer (server + SDK +
scheme), not protocol-core — the exact line that rejected Fiber Weir.
The 2026 AI-agent grant track has zero approvals so far; first-mover
advantage.

## 3. Stack (verified on npm 2026-10-30, no deprecated packages)

| Role | Package | Version / last-modified |
|---|---|---|
| x402 types + facilitator interface | `@x402/core` | 2.29.0, mod 2026-10-28 |
| agent-side client integration | `@x402/axios` | 2.29.0 |
| CKB tx building (CKB + UDT) | `@ckb-ccc/core` | 1.23.0, mod 2026-09-26 |
| UDT helpers | `@ckb-ccc/udt` | 0.2.15, mod 2026-09-26 |
| FNN access | plain JSON-RPC over `fetch` | FNN v0.9.x stable RPC; no package needed |
| server | Node 20 + Hono + TypeScript | facilitator is an API, not a web app |
| tests | Jest + ts-jest | test-DB isolation per project rules |

Rejected, with reason:
- Lumos (`@ckb-lumos/*`) — frozen since 2024, officially deprecated;
  FiberPass was rejected partly for Lumos. Zero Lumos here.
- `@nervosnetwork/ckb-types` — last modified 2025-06, frozen; use ccc.
- `@spore-sdk/core` — dormant since 2024; not needed for this slice.
- FNN v0.10.0-rc1 — prerelease, "does not support upgrades from older
  versions"; target v0.9.x stable so reviewer re-runs are reliable.

## 4. How (weekly milestones, each ends in public evidence)

- **W1 — Baseline + cap design.** Reproduce the gap (mocked David-Pjs demo
  fails on a live channel). PoC: `exact`-scheme payment on FNN testnet
  (agent → provider invoice → keysend + preimage proof). Finalize `upto`
  design (§5). Evidence: reproducible PoC + design note.
  **Precondition (from w1-reality-check):** the local FNN v0.9.1 node at
  127.0.0.1:8227 currently drops JSON-RPC POSTs (Biscuit-gated or slow
  module) — W1's first task is unblocking that node (`node_info` must
  answer); if it stays broken, W1 evidence falls back to the documented
  mock path and live-node evidence moves to W3 with a healthy node.
- **W2 — SDK.** `@x402-fiber`: scheme handler (`exact`, `upto`), settle
  via FNN + ccc, typed client helpers, unit tests, CI green, npm publish.
- **W3 — Facilitator.** Provider middleware + settlement + audit log;
  deploy to testnet VPS; provider demo (ToyTrade's reference-price
  endpoint as the live-paid API). Evidence: public URL.
- **W4 — Metered demo + verification.** Agent session pays measured
  usage up to cap; `verification/` with tx hashes + commands; docs;
  application-ready appendix.

## 5. `upto` scheme design (the cap-objection answer)

`upto` = metered x402 scheme: buyer pre-authorizes a cap ("at most X"),
provider does the work, settlement is the *measured* amount m ≤ X.
`exact` = fixed price known upfront. `batch` = out of scope for this grant.

Worked example: agent calls a provider LLM endpoint, sets cap 500 CKB;
measured usage 80 CKB; provider settles 80 via facilitator.

Flow:
1. agent `POST /inference` → 402 Payment Required
   `{scheme:"upto", cap:500, payTo:provider, asset, network, mime}`.
2. agent signs the x402 `upto` authorization: binds cap, payTo, session
   id, expiry, and a fresh secret s (commitment H(s)). This signed object
   is the single-use capability "spend ≤ cap, provable via s".
3. agent retries with `X-PAYMENT` header.
4. provider does the work, measures 80 CKB.
5. provider calls facilitator: settle(measured=80).
6. facilitator settles over FNN on the session channel: keysend 80 CKB to
   payTo, attach usage receipt as custom record, reveal s to satisfy the
   preimage gate (replays rejected — single-use).
7. provider returns 200 + `X-SETTLEMENT` receipt (settled=80, proof).
   Agent holds proof of payment and proof of delivery.

**The cap is physical, not a counter.** Before the session, the buyer
funds a dedicated channel (or capped UDT cell) with exactly the cap
amount, with an expiry. Even a fully prompt-injected agent can move at
most the cap — the reviewers' exact suggested fix
(Routed Machine Payment Sessions thread). This is the strongest line in
the application.

Primitives used (all released in FNN v0.9.0): keysend + custom records;
preimage-gated / secret-knowledge settlement (FiberLatch pattern,
one-time redemption, replay rejection).

What does not exist yet (the fundable delta): the x402 `upto` handler
mapping authorization → keysend + preimage-gated settlement on FNN;
cap-channel funding + session lifecycle; the facilitator service.

Open design calls — settled by `docs/spikes/w1-reality-check.md` (W1):
`@x402/core` has built-in metering machinery (`Settlement-Overrides`
header, `SettleResponse.amount` carries the actually-settled amount,
`maxAmountPerPayment` is the resolved cap) — our `enforceCap` backstop
complements it, not duplicates it. CAIP pinned to `"fiber" /
"fiber:ckb-testnet"` (one constant, coordinate with `quake/x402` before
W2 publish). Dedicated channel vs. on-chain cap cell for physical cap
enforcement: decide in W1, document either way.

## 6. Costs (state in the application)

- 1 VPS ~$10–20/month for grant duration — paid by applicant, stated.
- FNN testnet CKB: nominal. No mainnet spending in scope.
- Facilitator is stateless → no DB, no recurring infra.
- Payout in CKB/USDI accepted (volatile CKB, stated).

## 7. Coordination notes

- `quake/x402` draft PR: build to its MVP spec where sensible; document
  "complements, does not fork".
- kayceeDev/ckb-escrow, Trickle, AgentPay: no overlap — this is
  standards interop (x402), not another private escrow/secret-gate
  scheme. One sentence in the application.

## 8. Positioning (the duplication defense — lift near-verbatim into the application)

Landscape as of 2026-10-30:

- **The only existing public x402-on-Fiber work is
  `David-Pjs/fiber402`:** a 12-commit hackathon PoC (March 2026), 0
  stars / 1 fork / 0 open issues. Liveness check 2026-10-30: last push
  **2026-04-20** (~6.5 months dormant). Payments are **mocked by
  default** (README: "Without a Fiber node, payments fall back to mock
  automatically"); x402 headers are hand-rolled with **no dependency on
  any `@x402/*` Foundation package**; **no metering** — strictly
  one-payment-per-request; no CI, no releases. Its `package.json` is
  `fiber-402` with `"private": true` — the author claims **none** of
  the `@x402-fiber*` npm names (all five sub-package names unclaimed on
  the registry as of 2026-10-30). It demonstrates the idea; it does not
  ship it.
  *Watch item:* the author's last commit (2026-04-20) pivots the README
  toward "x402-fiber-sdk" tooling with no code behind it. If that repo
  wakes up before our W2 npm publish, it could stake the `@x402-fiber`
  scope first — re-check registry availability ~2 weeks before
  application posting, and publish the SDK early in W2 to lock the name.
- **Trickle / AgentPay / FiberPass / FiberLatch** — all real, several
  funded, but *private* CKB-internal schemes (per-tick keysend grants,
  hold-invoice escrow, prepaid sessions, secret-gate receipts). None is
  x402-standard, none meters.
- **The FNN team's own draft PR #1301** (`quake/x402`) — stalled 4+
  months, unmerged, untouched since June.
- **`RetricSu/fiber-x402-blog`** (maintainer demo, May 2026): a runnable
  x402 paywall built **on the unmerged #1301 branch only** — its own
  README states it cannot run against a stable FNN release. This *confirms*
  the FNN team is validating the direction; it does not close the gap,
  because it depends on exactly the code that has not shipped. It
  strengthens our "no stable-release implementation" claim.

Therefore this proposal's delta, in one paragraph for the application:

> The only existing public x402-on-Fiber work (David-Pjs/fiber402) is an
> early hackathon proof-of-concept: mocked payments by default,
> hand-rolled headers not built on the x402 Foundation packages, no
> metering, no CI, no published packages. FNN maintainers' own x402
> integration (draft PR #1301) has been stalled for four months, and
> CKB's active payment-scheme projects (Trickle, AgentPay,
> FiberPass/FiberLatch) are private schemes that are not x402-standard
> and do not meter. This project ships the production SDK and
> facilitator on the standard `@x402/core`, and adds the metered `upto`
> scheme — capped, replay-rejecting, physically enforced — that does
> not exist in any CKB payment implementation. It complements, does not
> fork, the maintainers' draft work.

## 9. Housekeeping

- `Toy_trading_platform/docs/spark_application_escrow_security.md` is
  SUPERSEDED (kayceeDev/ckb-escrow exists and is stronger: arbitrator
  state machine, reproducible builds, ckb-testtool tests). Mark it and
  do not post it.
- Nothing committed or pushed — per project rule 1, local only until
  explicit approval.
- AI tooling files (AGENTS.md, .agents/, skills-lock.json, …) stay
  untracked per rule 4 (already in .gitignore).
