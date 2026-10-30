# fiber402 "upto" (metered) scheme — design

W1 design artifact. Answers the grant committee's standing objection —
*"if the cap lives only as a counter inside the SDK, a prompt-injected
tool call could reset or bypass it"* (Routed Machine Payment Sessions,
talk.nervos.org/t/routed-machine-payment-sessions-on-fiber-looking-for-community-feedback/10694)
— by making the cap **physical**: a funded FNN channel, not a counter.

Pinned to @x402/core 2.29.0 types (spike §A) and FNN v0.9.1 RPC (spike §B).
W1 implements the capability math (`src/capability.ts`, unit-tested) and the
`exact` scheme end-to-end; the `upto` handler itself is the single stubbed
attach point `registerUptoScheme()` in `src/scheme.ts` (W2).

---

## 1. What "upto" means

`upto` = x402's metered scheme (mirror of `@x402/evm`'s `UptoPermit2Payload`
shape, without the EVM dependencies):

- The **cap** (authorized maximum, in atomic shannons) travels as
  `PaymentRequirements.amount` for scheme `"upto"`.
- The **measured amount** (m ≤ cap) travels back to the client in
  `SettleResponse.amount` ("Actual amount settled in atomic token units.
  Present for schemes like `upto` where settlement amount may differ from
  the authorized maximum" — verbatim from the 2.29.0 .d.ts).
- The provider's metering signal is the **`Settlement-Overrides` header**
  (base64 JSON `SettlementOverrides{amount}` — three forms: raw atomic
  units `"1000"`, percent `"50%"` ≤2dp floored, USD price `"$0.05"`
  via asset decimals), sent on the settle call.

## 2. Cap enforcement (the committee-objection answer)

### Decision (pinned): dedicated FNN channel funded to exactly the cap

Before a session, the buyer opens a **dedicated FNN channel (or capped UDT
cell) funded with exactly the cap amount**, with a session expiry.
Consequences:

- Even a fully compromised / prompt-injected agent can move **at most the
  cap** — there is only that much value in the channel. The cap is
  physical: funded on-chain cells plus channel state, not a variable.
- A prompt-injected tool call can change the *metered amount* (it can try
  to settle the full cap instead of the measured usage), but it cannot
  exceed it: settlement is `min(measured, cap)` in `enforceCap()`
  (src/capability.ts), which the facilitator applies **server-side, after
  any override parsing** — so a malicious `Settlement-Overrides` header
  cannot lift the bound either.
- Session expiry is enforced twice: the capability's `expiresAtMs`
  (checked by `checkDeadline()` at settle) and the channel's own on-chain
  force-close expiry (last-resort, node-less recovery via the commitment
  transaction).

### Alternative considered (documented, not chosen)

On-chain cap cell: a CKB cell locked with a two-party lock (buyer +
facilitator) holding exactly the cap, released by keysend proof.
Rejected for W1 because it adds a CKB tx to the session hot path
(fees + confirmation latency per settlement) where the FNN channel path
already delivers gasless instant settlement. Revisit only if the chosen
asset turns out to be UDT-only and the UDT channel funding UX is
unacceptable.

### Why this is stronger than every existing CKB agent-payment design

Trickle (per-tick keysend + signed grants) and AgentPay (hold-invoice
escrow) both keep budgets as *signed authorization objects or off-chain
counters*. fiber402's `upto` makes the budget the **funded channel amount**
— the fix the community reviewers asked for in thread 10694, wired to the
x402 standard so any `@x402/axios` agent client works unchanged.

## 3. Sequence (metered LLM/API call)

```
Agent (x402Client + @x402-fiber "upto" scheme client)
   │ 1. GET /inference                    (no payment)
   ▼
Provider (402 middleware)
   │ 2. 402 Payment-Required:
   │    accepts:[{scheme:"upto", network:"fiber:ckb-testnet",
   │              asset:"Fibt", amount:<CAP shannons>, payTo:provider}]
   ▼
Agent
   │ 3. createPaymentPayload(upto): signs the capability —
   │    {cap, payTo, sessionId, preimage s (commit H(s)), expiresAtMs}
   │ 4. retries with base64 Payment-Signature header
   ▼
Provider
   │ 5. does the work; meters usage → measured m
   │ 6. settle call → facilitator with Settlement-Overrides header
   │    {amount: m}  (or "NN%" / "$X.XX")
   ▼
Facilitator (fiber402, /settle)
   │ 7. parsed = parseOverride(override); capCheck = enforceCap(resolved, CAP)
   │    — server-side clamp; the override CANNOT exceed the cap
   │ 8. PreimageRegistry.consume(s)  — single-use; replay → reject
   │ 9. FNN keysend m (≤ CAP) with custom_records
   │    {0x1: usageReceipt}  — delivery proof, node-attested
   │ 10. returns SettleResponse{success, transaction: payment_hash,
   │     amount: m, network}
   ▼
Provider → Agent: 200 + Payment-Response header (SettleResponse)
   Agent now holds: proof of payment (payment_hash + receipt) AND
   proof of delivery (usage receipt in custom_records)
```

## 4. Replay / idempotency

- **Preimage-gated single-use** (FiberLatch pattern): the payer commits
  `H(s)` in the capability; settlement reveals `s` via keysend + custom
  records. `PreimageRegistry` (src/capability.ts) tracks consumed
  preimages — a second settle with the same `s` is rejected.
- **Settle idempotency**: payment_hash-keyed idempotency map in the
  facilitator (W1) → `InMemoryPendingSettlementStore` / shared store in W2
  for broadcast-then-confirm reconciles (core's `settlement_pending`
  contract, spike §A).
- Note (W2): FNN-level replay is also bounded by channel state — a
  settled keysend consumes channel balance; a replayed settle simply
  fails for lack of funds.

## 5. Failure modes (behavior table)

| Failure | Detection | Behavior |
|---|---|---|
| Override > cap | `enforceCap` clamp | settle at cap, `SettleResponse.amount = cap` (documented: provider over-billed → capped) |
| Preimage replay | `PreimageRegistry.has` | `success:false, errorReason:"preimage_replayed"` |
| Capability expired | `checkDeadline` | `success:false, errorReason:"capability_expired"` |
| FNN transport drop (v0.9.1 send_payment, spike §B) | `FnnTransportError` | `success:false, errorReason:"fnn_transport_unavailable"` — never an unhandled exception; channel-level recovery (force-close/commitment tx) is the last-resort fund-safety net |
| Metering dispute (provider claims m, agent disagrees) | usage receipt in custom_records vs agent's own meter | receipts are node-attested (FNN signature in the invoice/payment record); agent can recompute; open disputes are out of protocol scope — session expiry + channel force-close bounds losses at the cap |
| Agent session abandoned | channel expiry | commitment transaction recovers; no funds stuck beyond the on-chain timelock |

## 6. Session lifecycle & who pays what

- **Channel funding**: buyer pays — the cap IS their pre-authorized spend.
  Testnet: nominal. (Stated in the application: applicant's own testnet
  allocation; mainnet out of scope for the grant.)
- **Facilitator hosting**: one VPS ~$10–20/month for grant duration —
  applicant pays, stated in the application.
- **Metering**: provider's job (it measured the usage); facilitator only
  clamps and settles.

## 7. What exists today vs what the grant builds

| Piece | Status |
|---|---|
| x402 `upto` wire machinery (Settlement-Overrides, SettleResponse.amount) | **Exists** in @x402/core 2.29 (EVM reference: @x402/evm `UptoEvmScheme`) |
| FNN primitives: keysend + custom records, preimage-gated settlement, channels | **Exist** in FNN v0.9.0+ (released) |
| FNN x402 facilitator, any scheme | **Does not exist** (internal PR #1301: stalled draft; public demo: mocked payments) |
| fiber402 `exact` + `upto` handlers over FNN, cap-channel session model | **This grant** (W1: exact + capability math + design; W2: upto handler + SDK publish; W3: facilitator deploy; W4: metered demo + verification/) |

## 8. Open decisions (W2, documented not silently chosen)

1. `caipFamily`/network string — pinned to `"fiber"` / `"fiber:ckb-testnet"`
   in src/types.ts; align with `quake/x402` maintainers before npm publish.
2. UDT asset selection: RUSD (whitelisted in user's node config) vs
   mainnet CKB Fibt — the application targets testnet; mainnet asset
   choice is a W2+ operational question (post-USDI stable vacuum, plan §gap 1).
3. Capability signing: W1 uses node-pubkey identity (`payerPubkey`);
   W2 adds ccc/JoyID passkey signing so browser agents can author
   capabilities without key custody.
