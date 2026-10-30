/**
 * W1 artifact #2 — "exact" scheme end-to-end PoC.
 *
 * Flow (mirrors @x402/core's provider/client flow, driven in-process so
 * the PoC has no dependency on a running HTTP server):
 *
 *   provider demands 402 (PaymentRequirements{scheme:"exact", network:
 *   "fiber:ckb-testnet", asset:"Fibt", amount, payTo})
 *   agent x402Client (exact fiber scheme) builds PaymentPayload
 *   facilitator.verify(payload, requirements)   -> VerifyResponse
 *   facilitator.settle(payload, requirements)   -> live FNN new_invoice +
 *                                                  send_payment (or the
 *                                                  documented transport
 *                                                  failure, reported
 *                                                  structurally)
 *   receipt: { transaction: payment_hash, amount, network }
 *
 * Run:  npx tsx scripts/exact-poc.ts
 */

import { x402Facilitator } from "@x402/core/facilitator";
import type {
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";
import { FnnClient } from "../src/fnnClient";
import {
  createExactFiberClient,
  createExactFiberFacilitator,
} from "../src/scheme";
import { FIBER_NETWORK } from "../src/types";

const AMOUNT_SHANNONS = "10000"; // 0.0001 CKB testnet — nominal
const PAYER_PUBKEY =
  "024714ca19abea4ddc0f3863ffdfb2e2cee76af87c477de4bc67c74a83f8140042"; // from list_channels spike

async function main(): Promise<void> {
  console.log("=== fiber402 exact-scheme PoC ===\n");
  const fnn = new FnnClient();

  // -- 1. provider's 402 demand
  const requirements: PaymentRequirements = {
    scheme: "exact",
    network: FIBER_NETWORK,
    asset: "Fibt",
    amount: AMOUNT_SHANNONS,
    payTo: PAYER_PUBKEY,
    maxTimeoutSeconds: 300,
    extra: {},
  };
  console.log("[1] provider 402 PaymentRequired:\n", JSON.stringify(requirements, null, 2), "\n");

  // -- 2. agent builds the payment payload
  const client = createExactFiberClient(PAYER_PUBKEY);
  const payloadRes = await client.createPaymentPayload(2, requirements);
  const payload = {
    x402Version: 2,
    accepted: requirements,
    payload: payloadRes.payload,
  };
  console.log("[2] agent PaymentPayload:\n", JSON.stringify(payload, null, 2), "\n");

  // -- 3. facilitator verifies
  const facilitator = new x402Facilitator().register(
    [FIBER_NETWORK],
    createExactFiberFacilitator(fnn, PAYER_PUBKEY),
  );
  const verify: VerifyResponse = await facilitator.verify(payload, requirements);
  console.log("[3] facilitator.verify ->", JSON.stringify(verify));
  if (!verify.isValid) {
    throw new Error(`verify rejected the PoC: ${verify.invalidReason}`);
  }
  console.log("");

  // -- 4. facilitator settles over live FNN
  console.log("[4] facilitator.settle -> (live FNN new_invoice + send_payment)");
  const settle: SettleResponse = await facilitator.settle(payload, requirements);
  console.log(JSON.stringify(settle, null, 2), "\n");

  if (settle.success) {
    console.log("SUCCESS: live settlement receipt");
    console.log("  transaction (FNN payment_hash):", settle.transaction);
    console.log("  amount settled:", settle.amount, "shannons");
  } else if (settle.errorReason === "fnn_transport_unavailable") {
    console.log(
      "SETTLEMENT BLOCKED BY ENVIRONMENT: this FNN v0.9.1 node drops the",
    );
    console.log(
      "send_payment connection (recorded in docs/spikes/w1-reality-check.md §B).",
    );
    console.log("The exact-scheme plumbing itself ran end-to-end:");
    console.log("  verify ok -> invoice mint attempt -> structured transport error");
    console.log("  (fnn_transport_unavailable), no unhandled exception.");
  } else {
    throw new Error(`settle failed unexpectedly: ${settle.errorReason}`);
  }
}

main().catch((e) => {
  console.error("exact-poc failed:", e);
  process.exit(1);
});
