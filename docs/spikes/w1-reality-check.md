# W1 Reality Check — spike notes

Purpose: pin reality before writing src/. Two tracks:
(A) @x402/core 2.29.0 actual API (from installed node_modules .d.ts — source of truth),
(B) live FNN v0.9.1 node behavior.
Date: 2026-10-30.

---

## A. @x402/core@2.29.0 — verified API

Verified against `node_modules/@x402/core/dist/cjs/*.d.ts` after `npm install`.
Subpath entries: `.` (version stub), `/types`, `/types/v1`, `/client`,
`/facilitator`, `/http`, `/server`, `/schemas`, `/utils`.

### Facilitator (what x402-fiber implements)

`@x402/core/facilitator` exports: `x402Facilitator`,
`InMemoryPendingSettlementStore`, `PENDING_SETTLEMENT_TTL_MS`,
`PendingSettlementStore` (type).

```ts
// from @x402/core/types
interface SchemeNetworkFacilitator {
  readonly scheme: string;               // "exact" | "upto"
  readonly caipFamily: string;           // e.g. "eip155:*"; Fiber uses "fiber"
  getExtra(network: Network): Record<string, unknown> | undefined;
  getSigners(network: string): string[];
  verify(payload: PaymentPayload, requirements: PaymentRequirements,
         context?: FacilitatorContext): Promise<VerifyResponse>;
  settle(payload: PaymentPayload, requirements: PaymentRequirements,
         context?: FacilitatorContext): Promise<SettleResponse>;
}

// x402Facilitator runtime
class x402Facilitator {
  register(networks: Network | Network[], facilitator: SchemeNetworkFacilitator): this;
  registerV1(networks, facilitator): this;
  getSupported(): { kinds; extensions; signers };
  verify(paymentPayload, paymentRequirements): Promise<VerifyResponse>;
  settle(paymentPayload, paymentRequirements): Promise<SettleResponse>;
  onBeforeVerify / onAfterVerify / onVerifyFailure
  onBeforeSettle / onAfterSettle / onSettleFailure  // hook chains
}
```

`FacilitatorContext.getExtension<T>(key)` gives extension-provided
capabilities to verify/settle (unused in W1).

### Wire types (verbatim, line numbers in x402Client-BJMUIthr.d.ts)

```ts
type Network = `${string}:${string}`;          // "fiber:ckb-testnet"

type PaymentRequirements = {
  scheme: string; network: Network; asset: string;
  amount: string; payTo: string; maxTimeoutSeconds: number;
  extra: Record<string, unknown>;
};
type PaymentRequired = {
  x402Version: number; error?: string; resource: ResourceInfo;
  accepts: PaymentRequirements[]; extensions?: Record<string, unknown>;
};
type PaymentPayload = {
  x402Version: number; resource?: ResourceInfo;
  accepted: PaymentRequirements;
  payload: Record<string, unknown>;            // scheme-specific, opaque
  extensions?: Record<string, unknown>;
};
type VerifyResponse = {
  isValid: boolean; invalidReason?; invalidMessage?; payer?;
  extensions?; extensionResponses?; extra?;
};
type SettleResponse = {
  success: boolean; errorReason?; errorMessage?; payer?;
  transaction: string;                         // required — for Fiber: FNN payment_hash
  network: Network;
  amount?: string;                             // actual settled, atomic units — THE upto field
  extensions?; extensionResponses?; extra?;
};
type PaymentPayloadResult = Pick<PaymentPayload, "x402Version" | "payload"> &
  { extensions?: Record<string, unknown> };    // what createPaymentPayload returns
interface PaymentPayloadContext {
  extensions?: Record<string, unknown>;
  maxAmountPerPayment?: string;                // resolved atomic spend cap
}
interface SchemeNetworkClient {
  readonly scheme: string;
  readonly schemeHooks?: SchemeClientHooks;
  findDefaultAsset?: FindDefaultAsset;
  createPaymentPayload(x402Version: number, requirements: PaymentRequirements,
                      context?: PaymentPayloadContext): Promise<PaymentPayloadResult>;
}
```

### Client (agent side)

`@x402/core/client` exports `x402Client`, `x402ClientConfig`,
`SchemeRegistration`, `SelectPaymentRequirements`, `PaymentPolicy`,
`decodePaymentResponseHeader`.

```ts
class x402Client {
  constructor(paymentRequirementsSelector?);
  static fromConfig(config: x402ClientConfig): x402Client;
  register(network: Network, client: SchemeNetworkClient): this;
  // policies, spend controls, hooks (before/after payment creation...)
}
```

`@x402/axios` adds `wrapAxiosWithPayment(axiosInstance, client)` —
interceptor: 402 → read base64 `PAYMENT-REQUIRED` → `createPaymentPayload`
→ retry with base64 `PAYMENT-SIGNATURE` → read base64 `PAYMENT-RESPONSE`
(`SettleResponse`). (Wire headers in v2 are PAYMENT-*, not X402-*/X-PAYMENT*.)

### UPTO machinery (the load-bearing find)

```ts
interface SettlementOverrides {
  amount?: string;
  // "1000" = raw atomic units | "50%" = percent of requirements.amount
  // (<=2dp, floored) | "$0.05" = USD price via scheme getAssetDecimals
  // Resolved amount MUST be <= PaymentRequirements.amount (the cap)
}
declare const SETTLEMENT_OVERRIDES_HEADER = "Settlement-Overrides";
// provider -> facilitator settle call, base64 JSON in that header
```

`x402ResourceServer.settlePayment(paymentPayload, requirements,
declaredExtensions?, transportContext?, settlementOverrides?, phase?)`
carries the override into the settle path; the facilitator returns the
actual settled amount in `SettleResponse.amount`.

### HTTP facilitator contract

`@x402/core/http` exports `HTTPFacilitatorClient` + `FacilitatorConfig`:

```ts
interface FacilitatorConfig {
  url?: string;
  timeoutMs?: number;                  // default 90_000; settle timeout = indeterminate outcome
  createAuthHeaders?(): { verify: HeadersInit; settle: HeadersInit; supported?: HeadersInit; bazaar?: HeadersInit };
}
// POST ${url}/verify, POST ${url}/settle, GET ${url}/supported (429 backoff)
```

Auth model is OUR design choice (shared bearer in W2; unauthenticated in
W1 local PoC).

`@x402/core/server` exports `x402HTTPResourceServer` (provider-side 402
middleware) — used in W2/W3 provider demo, NOT in W1 (W1 server.ts is the
facilitator side: /verify /settle /supported).

### PendingSettlementStore (idempotency)

```ts
interface PendingSettlementStore {
  get(key: string): Promise<string | undefined>;  // stored tx hash or undefined
  set(key: string, txHash: string): Promise<void>;
  delete(key: string): Promise<void>;
}
class InMemoryPendingSettlementStore implements PendingSettlementStore {
  entriesSnapshot(): Record<string, string>;      // test-only
}
// Trigger: mechanism returns settlement_pending; next settle attempt for the
// same payload checks the store first and reconciles the broadcast hash.
// W1 decision: keep our own PreimageRegistry + payment_hash idempotency map;
// adopt InMemoryPendingSettlementStore in W2 for the published SDK.
```

### CAIP decision (pinned, swappable)

No CKB/Fiber CAIP namespace exists in any @x402/* package (grep found
`eip155:*`, `solana:*` only). x402-fiber uses:

- `caipFamily = "fiber"`
- `Network = "fiber:ckb-testnet"` (testnet first; mainnet = "fiber:ckb-mainnet")

One constant in `src/types.ts`; both `x402Facilitator.register(["fiber:ckb-testnet"], ...)`
and `x402Client.register("fiber:ckb-testnet", ...)` use it. Note for
`quake/x402` coordination: align on this string before W2 publish.

---

## B. Live FNN v0.9.1 node (user's local testnet node)

Binary: `~/.fiber/bin/fnn` — **Fiber v0.9.1 (9a561b3 2026-09-10)**, exactly
the stable target. Data dir `~/.fiber/testnet`, chain: testnet, UDT
whitelist RUSD (auto_accept_amount 1,000,000,000 = 10 RUSD), CKB RPC via
testnet.ckbapp.dev.

Observed RPC behavior (2026-10-30, reproduced x2, node uptime 40 days):
- `GET /` → 405 "Used HTTP Method is not allowed. POST is required."
  (path = the RPC endpoint, confirmed)
- **Live and answering (HTTP 200, ms-scale):**
  - `list_channels` — returns a real ChannelReady channel
    (`local_balance 0x956257100` = 400 CKB, UDT type script null)
  - `new_invoice {amount:"0x2710", currency:"Fibt", description, expiry:"0x708"}`
    — returns `{invoice_address: "fibt1…", invoice:{currency, amount,
    signature, data:{timestamp, payment_hash, attrs[]}}}`. Confirms the
    v0.9.x nested shape `res.invoice.data.payment_hash`
    (ToyTrade's dual-path normalization was correct).
  - `get_invoice` — takes **`[<hash256 string>]`**, not a struct:
    `{"params":["0xc763…"]}`. (A struct `{payment_hash}` → -32602
    "expected struct InvoiceParams".)
- **Drops the connection instantly (~1ms, empty reply, per-request — node
  keeps serving other methods, no crash):** `node_info`, `get_payment`,
  `send_payment` (even `dry_run: true`). Reproducible 2x in the same
  probe loop interleaved with 200s.
- Method names verified against
  `crates/fiber-lib/src/rpc/README.md` at tag v0.9.1 — all names used
  exist (`node_info`, `new_invoice`, `get_invoice`, `send_payment`,
  `get_payment`, `list_channels`, …). `send_payment` param object
  supports `target_pubkey`, `amount`, `payment_hash`, `invoice`, `keysend`,
  `custom_records` (the delivery-proof records the `upto` design uses),
  `allow_self_payment`, `dry_run`.

**Recordable FNN v0.9.1 finding (evidence artifact, feeds the observability
narrative):** some JSON-RPC methods that touch payment/peer state drop the
HTTP connection instead of returning a JSON error, while channel/invoice
queries answer normally. Candidate root causes: the payment path blocking on
the CKB testnet RPC (testnet.ckbapp.dev flake) or a per-module panic in the
RPC layer. Worth an upstream issue; out of scope for this grant.

**Impact on W1:**
- The `exact` PoC's live-receipt leg targets `new_invoice` (confirmed
  live) + `send_payment`. `send_payment` dropping the connection is
  treated as an environmental failure: `fnnClient` reports it structurally
  (transport error → `SettleResponse{success:false, errorReason:
  "fnn_transport_unavailable"}`), the PoC prints the live invoice receipt
  (real `payment_hash`) and the mocked `fbr_mock_` settlement receipt, and
  `docs/evidence-w1.md` states both legs explicitly. Unit tests use the
  injected-fetch mock transport — zero network, Rule-6 clean.
- The gap-repro still shows the point: the existing public fiber402 demo
  settles with a locally fabricated hash, while FNN-issued receipts carry a
  node-signed `payment_hash` + `preimage` (and the `custom_records`
  delivery-proof channel for `upto`).

## Settled calls (from risk list)

1. FNN shape drift → dual-path normalization in fnnClient.ts (done by design).
2. @x402/core API → pinned above; `scheme.ts` implements exactly
   `SchemeNetworkFacilitator`, no adapter needed.
3. SettlementOverrides semantics → pinned: three formats, must be <= cap,
   facilitator returns actual in SettleResponse.amount. Our server-side
   `enforceCap` remains the backstop that cannot be bypassed.
4. InMemoryPendingSettlementStore → deferred to W2 (W1: PreimageRegistry).
5. CAIP → "fiber" / "fiber:ckb-testnet", one constant, coordinated later.
6. ccc → not imported at runtime in W1 (design-doc grounding only);
   integration is W2.
