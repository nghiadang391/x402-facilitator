/**
 * fiber402 scheme glue — @x402/core types pinned in w1-reality-check.md §A.
 *
 * Implements:
 *  - exactFiberClient  : SchemeNetworkClient (agent side, createPaymentPayload)
 *  - exactFiberFacilitator : SchemeNetworkFacilitator (verify/settle over FNN)
 *  - registerUptoScheme : single W2 attach point (stub in W1)
 */

import type {
  PaymentPayload,
  PaymentPayloadContext,
  PaymentPayloadResult,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";
import type {
  SchemeNetworkClient,
  SchemeNetworkFacilitator,
  Network,
  FacilitatorContext,
} from "@x402/core/types";
import { FnnClient, FnnTransportError } from "./fnnClient";
import {
  FIBER_CAIP_FAMILY,
  FIBER_NETWORK,
  type FiberExactPayload,
  type FiberUptoPayload,
} from "./types";

/* ---------------------------------------------------------------- */
/* "exact" scheme — client side (agent builds the payment payload)  */
/* ---------------------------------------------------------------- */

export function createExactFiberClient(payerPubkey?: string): SchemeNetworkClient {
  return {
    scheme: "exact",
    async createPaymentPayload(
      x402Version: number,
      _requirements: PaymentRequirements,
      _context?: PaymentPayloadContext,
    ): Promise<PaymentPayloadResult> {
      const payload: FiberExactPayload = {
        payerPubkey,
        keysend: true,
      };
      return { x402Version, payload: payload as unknown as Record<string, unknown> };
    },
  };
}

/* ---------------------------------------------------------------- */
/* "exact" scheme — facilitator side (verifies + settles over FNN)  */
/* ---------------------------------------------------------------- */

export function createExactFiberFacilitator(
  fnn: FnnClient,
  signerPubkey?: string,
): SchemeNetworkFacilitator {
  const self: SchemeNetworkFacilitator = {
    scheme: "exact",
    caipFamily: FIBER_CAIP_FAMILY,
    getExtra: (_network: Network) => undefined,
    getSigners: (_network: string) => (signerPubkey ? [signerPubkey] : []),

    async verify(
      _payload: PaymentPayload,
      requirements: PaymentRequirements,
      _context?: FacilitatorContext,
    ): Promise<VerifyResponse> {
      if (requirements.scheme !== "exact") {
        return {
          isValid: false,
          invalidReason: "unsupported_scheme",
          invalidMessage: `fiber402 facilitator expects scheme "exact", got "${requirements.scheme}"`,
        };
      }
      if (!requirements.network.startsWith("fiber:")) {
        return {
          isValid: false,
          invalidReason: "unsupported_network",
          invalidMessage: `expected a "fiber:<chain>" network, got "${requirements.network}"`,
        };
      }
      // Amount must be a positive hex/decimal shannon amount.
      const amt = parseShannons(requirements.amount);
      if (amt === null || amt <= 0n) {
        return {
          isValid: false,
          invalidReason: "invalid_amount",
          invalidMessage: `requirements.amount must be a positive shannon amount, got "${requirements.amount}"`,
        };
      }
      return { isValid: true };
    },

    async settle(
      _payload: PaymentPayload,
      requirements: PaymentRequirements,
      _context?: FacilitatorContext,
    ): Promise<SettleResponse> {
      const net: Network = requirements.network;
      try {
        // 1. Open an invoice for the exact authorized amount.
        const inv = await fnn.newInvoice(
          requirements.amount,
          `fiber402 exact settle payTo=${requirements.payTo}`,
          String(requirements.asset || "Fibt"),
        );
        // 2. Pay it over FNN (keysend so the payer can prove delivery later).
        const pay = await fnn.sendPayment(inv.invoiceAddress, { keysend: true });
        if (pay.status !== "Success") {
          return {
            success: false,
            errorReason: "settle_failed",
            errorMessage: `FNN send_payment status=${pay.status}`,
            transaction: pay.payment_hash,
            network: net,
          };
        }
        return {
          success: true,
          transaction: pay.payment_hash,
          network: net,
          amount: requirements.amount,
        };
      } catch (err) {
        // v0.9.1 transport drop (spike §B) — report structurally, never throw.
        if (err instanceof FnnTransportError) {
          return {
            success: false,
            errorReason: "fnn_transport_unavailable",
            errorMessage: err.message,
            transaction: "",
            network: net,
          };
        }
        throw err;
      }
    },
  };
  return self;
}

/* ---------------------------------------------------------------- */
/* "upto" scheme — W2 attach point (stub, not implemented in W1)   */
/* ---------------------------------------------------------------- */

/**
 * W2 fills this in: a SchemeNetworkClient + SchemeNetworkFacilitator for
 * scheme "upto" that (a) binds the cap into the signed payload,
 * (b) settles measured <= cap via SettlementOverrides, and
 * (c) returns the actual amount in SettleResponse.amount.
 * The metering math lives in src/capability.ts and is already unit-tested.
 */
export function registerUptoScheme(_facilitator: unknown, _fnn: FnnClient): void {
  throw new Error(
    "registerUptoScheme is a W2 attach point — see docs/plan.md §'W2 attach points'. " +
      "W1 delivers exact + the upto capability math only.",
  );
}

// re-export for scripts/tests
export type { FiberUptoPayload };

/* ---------------------------------------------------------------- */
/* helpers                                                          */
/* ---------------------------------------------------------------- */

/** Parse a shannon amount given as decimal or 0x-hex string into BigInt.
 *  Returns null when it is not a valid non-negative integer string. */
export function parseShannons(s: string): bigint | null {
  if (typeof s !== "string" || s.length === 0) return null;
  try {
    if (s.startsWith("0x")) return BigInt(s);
    return BigInt(s);
  } catch {
    return null;
  }
}

export { FIBER_NETWORK };
