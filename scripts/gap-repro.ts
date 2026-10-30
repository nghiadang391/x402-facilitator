/**
 * W1 artifact #1 — gap reproduction.
 *
 * Shows why the existing public fiber402 demo is "mocked": a mocked receipt
 * fabricates the payment_hash/preimage locally (no node involvement), while
 * a real FNN-issued receipt carries a node-signed payment_hash + preimage
 * (+ the custom_records delivery channel the upto design relies on).
 *
 * Run:  npx tsx scripts/gap-repro.ts
 *   - uses FIBER_RPC_URL (default http://127.0.0.1:8227) for the live leg
 *   - uses FIBER_SIMULATE_FALLBACK=true to force the mocked leg
 * Output is captured to docs/spikes/gap-repro-output.txt for evidence.
 */

import { FnnClient } from "../src/fnnClient";

async function main(): Promise<void> {
  console.log("=== fiber402 gap reproduction ===\n");

  // 1. The MOCKED receipt — what the dormant public demo produces.
  const mockClient = new FnnClient({ simulateFallback: true });
  const mockInv = await mockClient.newInvoice("10000", "mocked demo");
  const mockPay = await mockClient.sendPayment(mockInv.invoiceAddress);
  console.log("[MOCK] newInvoice  ->", mockInv);
  console.log("[MOCK] sendPayment ->", mockPay);
  console.log(
    "     payment_hash is fabricated locally (no node, no preimage channel).",
  );
  console.log("     This is the 'mocked payment' the gap map calls out.\n");

  // 2. The LIVE receipt — a real FNN v0.9.x node issuing the invoice.
  const live = new FnnClient();
  try {
    const liveInv = await live.newInvoice("10000", "fiber402 gap-repro live");
    console.log("[LIVE] newInvoice -> invoice_address:", liveInv.invoiceAddress);
    console.log("[LIVE]            -> payment_hash:   ", liveInv.paymentHash);
    console.log(
      "     Node-issued invoice: the payment_hash is signed by FNN.",
    );
    console.log(
      "     Next leg (send_payment) is the settlement the demo lacks:",
    );
    try {
      const livePay = await live.sendPayment(liveInv.invoiceAddress, {
        keysend: true,
      });
      console.log("[LIVE] sendPayment ->", livePay);
      console.log(
        "     Real settlement: status + preimage + fee from the node.",
      );
    } catch (err) {
      // Documented v0.9.1 behavior: send_payment drops the connection.
      console.log("[LIVE] sendPayment -> transport error (documented):");
      console.log("     ", (err as Error).message);
      console.log(
        "     FnnClient reports this structurally; the gap stands: the live",
      );
      console.log(
        "     invoice above is node-issued vs. the fabricated mock receipt.",
      );
    }
  } catch (err) {
    console.log("[LIVE] unreachable ->", (err as Error).message);
    console.log(
      "     Live leg unavailable; mocked leg alone still shows the gap.",
    );
  }

  console.log(
    "\nGAP: public fiber402 settles with fabricated hashes; FNN receipts are",
  );
  console.log(
    "node-issued and carry preimage + custom_records (the basis for upto).",
  );
}

main().catch((e) => {
  console.error("gap-repro failed:", e);
  process.exit(1);
});
