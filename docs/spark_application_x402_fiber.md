# Spark Program application — @x402-fiber: the first Fiber implementation of the x402 machine-payments standard

> Status: DRAFT for the applicant to review, then post in the **Spark Program**
> sub-category on talk.nervos.org. Budget asked: **$1,000** (below the $2,000
> ceiling — clean full-amount approvals set up a follow-on better than an
> over-ask). Single-track, testnet-only. Not an AI-tooling file; this is the
> project deliverable. Companion working code: `github.com/nghiadang391/x402-facilitator`..

---

## 1. Title & Tags

**Title:** `@x402-fiber` — the first Fiber/CKB implementation of the x402
machine-payments standard (Linux Foundation), with a metered `upto` scheme
whose spend cap is a physical FNN channel, not an SDK counter

**Tags:** Spark Program · CKB · Fiber (FNN) · x402 · Agent payments · Dev tooling

**GitHub (identity-verified account, required since 2026-07-28):**
`github.com/nghiadang391/x402-facilitator` — public `verification/` directory
to be added with on-chain/testnet evidence.

---

## 2. Overview

x402 is the Linux Foundation's machine-payments standard (30-day window:
75M txns, $24M volume, 94k buyers / 22k sellers on EVM chains). It has a
metered `upto` scheme — a buyer pre-authorizes a spend **cap**, a provider
does the work, and only the **measured** amount (≤ cap) settles. **No
Fiber/CKB implementation of x402 exists.** The FNN core team's own design
note (`nervosnetwork/fiber` #1255) calls for one ("4 weeks, 1 engineer,
high priority"); their internal `x402` PR (#1301) has sat as a stalled draft
for ~4 months; and the only public demo (fiber402) settles with *mocked*
payments.

This grant builds **`@x402-fiber`**: the first working Fiber implementation
of x402's `exact` + metered `upto` schemes, settling over FNN v0.9.x
testnet. The differentiator is the **`upto` cap model**: the authorized cap
is a *dedicated, funded FNN channel* with a session expiry, so a
prompt-injected or compromised agent physically cannot move more than the
cap — the exact fix the community asked for on the Routed Machine Payment
Sessions thread. Delivered with one **live metered demo** (an agent pays a
real provider, settles measured usage under the cap) and a reproducible
`verification/` directory.

This is a **narrow, verifiable application-layer spike on a specific,
documented gap** — the same shape the program has funded before (zk-Lock,
CKB-VM Sail Validation Sprint, ckb-verify, Tranfr). It is *not* a new
product, *not* a protocol-level FNN PR, and *not* custody delegated to a
third party.

---

## 3. Team

- **<name / handle>** — author of the ToyTrade CKB/Fiber/Spore application.
  Track record on this exact codebase, not a greenfield pitch:
  - Shipped FNN JSON-RPC integration with L1 escrow fallback
    (`Toy_trading_platform/src/lib/fiber/fnnClient.ts`).
  - Real Spore DOB mint/transfer on Aggron4 (`.../ckb/spore.ts`), exercised
    by `tests/spore.test.ts`.
  - Established test isolation (separate test DB, automated teardown).
  - In this grant's companion repo, already run: `@x402/core` 2.29 API
    pin, a live FNN v0.9.1 RPC spike, an `exact`-scheme PoC end-to-end, and
    24 offline unit tests for the `upto` capability math.
- Solo developer, scope realistic at $1,000. No deprecated tooling: uses
  `@ckb-ccc/core` + `@ckb-ccc/udt` and ckb-std — **no Lumos**.

---

## 4. Background (the specific, unmet need)

- **The gap is documented by the core team, not invented here.** FNN design
  note #1255 specifies an x402 facilitator as a first-priority, 4-week item;
  draft PR #1301 is stalled; the public demo mocks payments.
- **Agent payments have no Fiber rail today.** x402's demand lives on EVM;
  CKB/Fiber is blank. Whoever ships the `@x402-fiber` facilitator + SDK
  becomes the ecosystem default for agent-pay-over-Fiber.
- **The `upto` cap problem is the open objection.** Reviewers on the Routed
  Machine Payment Sessions thread: *"if the cap lives only as a counter
  inside the SDK, a prompt-injected tool call could reset or bypass it."*
  That objection is unanswered by any existing CKB agent-payment design
  (Trickle's signed grants, AgentPay's hold-invoice escrow both keep the
  budget as a signed/off-chain object, not the funded channel amount).

---

## 5. Solution

Ship `@x402-fiber` — an x402 `SchemeNetworkClient` + `SchemeNetworkFacilitator`
for schemes `exact` and `upto` over FNN v0.9.x:

- **`exact`** — fixed price known upfront. Buyer authorizes N; provider
  settles N over an FNN channel.
- **`upto` (the differentiator)** — metered. Buyer's cap is a **dedicated
  FNN channel funded to exactly the cap with a session expiry**. Provider
  meters usage `m`; settles `min(m, cap)` via FNN keysend + custom-records
  delivery proof, with the preimage-gated single-use settlement (replay
  rejection). `SettleResponse.amount` carries the measured value, as the
  x402 standard requires for `upto`.

**Why the cap is physical (the committee-objection answer):** the cap is
*funded on-chain channel state*, not a variable. A fully compromised agent
can still move **at most the cap**, because that is all that is in the
channel. The facilitator additionally clamps `min(measured, cap)`
server-side (independent of any client/override value), so neither a
prompt-injected call nor a malicious meter can exceed the bound. Last-resort
fund safety is the channel's on-chain force-close/commitment timelock.

Deliverable is a maintained SDK + one live metered demo + evidence. We do
**not** patch the FNN node.

---

## 6. Technical Approach

- **Where:** new repo `x402-facilitator/`. `src/` = FNN JSON-RPC transport
  (`fnnClient.ts`), scheme handlers (`scheme.ts`), `upto` capability math
  (`capability.ts`), bare facilitator HTTP surface (`server.ts`), public
  exports (`index.ts` = the npm package boundary).
- **Stack:** `@x402/core` 2.29 / `@x402/axios` 2.29 (live, 2026-10-28),
  `@ckb-ccc/core` 1.23 / `@ckb-ccc/udt` 0.2.15 (the maintained CKB JS
  stack), Hono + `@hono/node-server`, Jest. **No Lumos, no frozen
  `@nervosnetwork/ckb-types`.**
- **FNN primitives (all released in v0.9.0):** keysend + custom records
  (carry the delivery proof), preimage-gated / secret-knowledge settlement
  (the FiberLatch one-time-redeem, replay-reject pattern), channel force-
  close/commitment timelock (fund-safety net).
- **CAIP:** CKB/Fiber has no registered CAIP namespace in any `@x402/*`
  package; we pin a single swappable constant `"fiber"` / `"fiber:ckb-
  testnet"` (coordinate with the `quake/x402` maintainers before W2 publish).
- **No protocol roadmap dependency:** no PRs to `nervosnetwork/fiber`; no
  dependency on PTLC or liquidity-M5 (both are the core team's own roadmap).
  **Complements, does not fork,** the stalled `quake/x402` draft.
- **Test isolation:** all unit tests run offline (injected mock FNN
  transport, `fbr_mock_` gate); test target is the isolated test DB — no
  test artifacts ever touch a shared/production database.

---

## 7. To-Do (weeks, each ends in public evidence)

| Wk | Milestone | Verifiable output |
|----|-----------|-------------------|
| 1 | Baseline + `exact` PoC + `upto` design | Repro of the mocked-vs-live gap; `exact` end-to-end on a live FNN testnet node; 24 offline `upto`-capability tests green; cap-enforcement design pinned |
| 2 | `@x402-fiber` SDK: `upto` handler + auth + `npm` build | `registerUptoScheme()` filled (cap → dedicated channel, meter → `min(m,cap)` keysend + preimage-gate); `prepare`/build/CI; published `@x402-fiber` |
| 3 | Facilitator HTTP service on a testnet host | Provider middleware + `Settlement-Overrides` wiring + audit log; public testnet URL; shared-bearer auth |
| 4 | Live metered demo + `verification/` | Agent (ToyTrade price-lookup flow) pays a real provider, settles measured usage under the cap; `verification/` with testnet tx hashes + reproducible commands + a short demo |

---

## 8. Funding & breakdown ($1,000 asked)

| Item | Amount | Notes (who pays / alternatives) |
|------|--------|--------------------------------|
| FNN testnet channel + cell capacity to open the cap-channels, run metered + happy-path txs | $300 | Testnet CKB (Aggron4 / ckbapp.dev) — applicant's own testnet allocation; nominal. **No mainnet spend in scope.** |
| One VPS hosting the facilitator + CI for the grant window (~2 months) | $300 | ~$10–20/mo. **Alternative:** free-tier / applicant's existing host; VPS only if the commit needs an always-on public URL. |
| Metered demo provider endpoint + data/LLM metering costs | $200 | A small API the agent pays for; costs are real and disclosed |
| Reproducibility + verification infra (CI, `verification/` evidence tooling, docs) | $200 | Time/tooling |
| **Total** | **$1,000** | |

Payout in **100% CKB or 100% USDI** (per 2026 Spark terms); no fiat. We
accept that CKB is volatile and that this is an ecosystem-currency
payout. No hidden recurring costs: the facilitator is stateless in W1–W3
(no DB), so the only standing cost is the VPS above.

---

## 9. Deliverables & verification

- **`@x402-fiber`** (npm): `exact` + `upto` `SchemeNetworkClient` and
  `SchemeNetworkFacilitator` over FNN v0.9.x, with tests + CI.
- **`upto` cap model:** dedicated cap-channel + server-side `min(m, cap)`
  clamp + preimage-gated single-use settlement (replay rejection) — the
  direct answer to the prompt-injection objection.
- **Facilitator service** on a public testnet host (W3).
- **Live metered demo** (W4): a non-demo agent settles a measured usage
  under its cap on testnet.
- **`verification/` directory** (public, low-cost, reproducible — the
  scheme the committee now expects, cf. Dular and Seedsong):
  - testnet tx hashes for each metered settlement + the replay case
    (expected to be rejected);
  - the exact commands to build the SDK and re-run the demo + suite;
  - a short demo (video/screenshots) of a prompt-injected / over-billed
    meter being capped at the channel-funded cap.

**Verification is cheap and self-contained:** run the test suite and the
reproducible metered-demo commands against testnet; a public observer can
independently confirm (a) the `upto` settlement reports a measured amount
≤ cap, and (b) a replay is rejected.

---

## 10. CKB alignment

- Gives CKB/Fiber the **machine-payments rail** that x402's external demand
  ($24M/30-day volume) is already pulling on EVM chains — a direct
  ecosystem win, not an internal tool.
- Uses CKB's cell model + FNN channel settlement as the physical
  cap-enforcement primitive (the differentiator is *why* CKB, not just
  "CKB-flavored").
- Open-source throughout; aligns with Web5 / agent-commerce direction; no
  financial speculation.
- Reproducible, low-cost acceptance checks mirror the program's current
  verification direction (ckb-verify / Spark Verify, on-chain evidence
  directories).

---

## Positioning & prior art (pre-empts the two rejection modes that fired
before)

- **Not a core-roadmap item (Weir mode):** zero PRs to `nervosnetwork/
  fiber`; no dependency on PTLC or liquidity-M5. We build to the *released*
  v0.9.0 primitives (keysend + custom records + preimage-gated settlement).
- **Not an AgentPay duplicate:** AgentPay is a CKB-only hold-invoice
  scheme. This is **standards interop** — it makes Fiber reachable from the
  entire x402 ecosystem (any `@x402/axios` agent client works unchanged),
  and its cap is a *funded channel*, a different mechanism than AgentPay's
  secret-knowledge gate. We **complement** the stalled `quake/x402` draft,
  we don't fork it.
- **Not a custody hand-off (RGB++ Resume mode):** custody stays with the
  parties; the channel's on-chain timelock is the recovery path, not a
  third-party service.
