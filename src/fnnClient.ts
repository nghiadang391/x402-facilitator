/**
 * FNN (Fiber Network Node) v0.9.x JSON-RPC transport.
 *
 * Adapted from ToyTrade's src/lib/fiber/fnnClient.ts (AbortController +
 * timeout, error normalization, dual response-path normalization,
 * fbr_mock_ offline gate). Injectable fetch so unit tests never touch a
 * network (Rule 6: tests never hit a shared DB / live node).
 */

import type {
  FnnGetInvoiceResult,
  FnnListChannelsResult,
  FnnNewInvoiceResult,
  FnnPaymentResult,
} from "./types";

/** Structured transport error: the node dropped the connection (observed on
 *  v0.9.1 for send_payment / node_info / get_payment — see spike §B). */
export class FnnTransportError extends Error {
  readonly method: string;
  constructor(method: string, cause: unknown) {
    const msg =
      cause instanceof Error ? cause.message : String(cause);
    super(`FNN transport error on ${method}: ${msg}`);
    this.name = "FnnTransportError";
    this.method = method;
  }
}

export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
}>;

export interface FnnClientOptions {
  /** Defaults to FIBER_RPC_URL env or http://127.0.0.1:8227 */
  rpcUrl?: string;
  /** Per-request timeout in ms. Default 15000. */
  timeoutMs?: number;
  /** Injectable fetch (tests). */
  fetchImpl?: FetchLike;
  /** When true, newInvoice returns fbr_mock_ invoices and sendPayment
   *  fabricates a receipt — offline mode, no node needed. Mirrors ToyTrade. */
  simulateFallback?: boolean;
}

export class FnnClient {
  private rpcUrl: string;
  private timeoutMs: number;
  private fetchImpl: FetchLike;
  private simulate: boolean;

  constructor(opts: FnnClientOptions = {}) {
    this.rpcUrl =
      opts.rpcUrl ??
      process.env.FIBER_RPC_URL ??
      "http://127.0.0.1:8227";
    this.timeoutMs = opts.timeoutMs ?? 15000;
    this.fetchImpl =
      opts.fetchImpl ??
      ((url, init) => fetch(url, init as RequestInit));
    this.simulate =
      opts.simulateFallback ??
      process.env.FIBER_SIMULATE_FALLBACK === "true";
  }

  private async callRpc<T>(
    method: string,
    params: unknown[],
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.timeoutMs,
    );
    try {
      const res = await this.fetchImpl(this.rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`FNN HTTP ${res.status}: ${res.statusText}`);
      }
      const data = (await res.json()) as {
        result?: T;
        error?: { code: number; message: string };
      };
      if (data.error) {
        throw new Error(
          `FNN RPC error (${data.error.code}): ${data.error.message}`,
        );
      }
      return data.result as T;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new FnnTransportError(
          method,
          new Error(`${this.timeoutMs}ms timeout`),
        );
      }
      // Node dropped the connection (empty reply) — keep the method
      // name, this is the v0.9.1 send_payment failure mode.
      throw new FnnTransportError(method, err);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /** new_invoice — the live, confirmed-working settlement entry point.
   *  amountShannons is decimal or 0x-hex; returns the v0.9.x nested shape
   *  normalized to { invoiceAddress, paymentHash }. */
  async newInvoice(
    amountShannons: string,
    description: string,
    currency = "Fibt",
  ): Promise<{
    invoiceAddress: string;
    paymentHash: string;
    amountShannons: string;
  }> {
    if (this.simulate) {
      const rand = randomHex(64);
      return {
        invoiceAddress: `fbr_mock_${rand}`,
        paymentHash: `0x${rand}`,
        amountShannons,
      };
    }
    const hex = amountShannons.startsWith("0x")
      ? amountShannons
      : `0x${BigInt(amountShannons).toString(16)}`;
    const res = await this.callRpc<FnnNewInvoiceResult | { payment_hash?: string }>(
      "new_invoice",
      [{ amount: hex, currency, description, expiry: "0x708" }],
    );
    // Dual-path normalization: v0.9.x nests under result.invoice.data.
    const nested = res as FnnNewInvoiceResult;
    const flat = res as { payment_hash?: string };
    return {
      invoiceAddress: nested.invoice_address ?? "",
      paymentHash:
        nested.invoice?.data?.payment_hash ?? flat.payment_hash ?? "0x",
      amountShannons,
    };
  }

  /** send_payment — known to drop the connection on some v0.9.1 nodes
   *  (spike §B); callers must handle FnnTransportError. In simulate mode
   *  a deterministic-looking receipt is fabricated for offline tests. */
  async sendPayment(
    invoiceAddress: string,
    opts: { keysend?: boolean; allowSelfPayment?: boolean } = {},
  ): Promise<FnnPaymentResult> {
    if (this.simulate || invoiceAddress.startsWith("fbr_mock_")) {
      const rand = randomHex(64);
      return {
        payment_hash: invoiceAddress.startsWith("fbr_mock_")
          ? `0x${invoiceAddress.replace("fbr_mock_", "").slice(0, 64)}`
          : `0x${rand}`,
        status: "Success",
        preimage: `0x${rand}`,
        fee: "0x0",
      };
    }
    return await this.callRpc<FnnPaymentResult>("send_payment", [
      {
        invoice: invoiceAddress,
        allow_self_payment: opts.allowSelfPayment ?? true,
        ...(opts.keysend ? { keysend: true } : {}),
      },
    ]);
  }

  /** get_payment — same drop-connection caveat; handle FnnTransportError. */
  async getPayment(paymentHash: string): Promise<FnnPaymentResult> {
    if (paymentHash.startsWith("fbr_mock_")) {
      return {
        payment_hash: paymentHash,
        status: "Success",
        preimage: `0xmockpreimage_${paymentHash.slice(0, 8)}`,
      };
    }
    return await this.callRpc<FnnPaymentResult>("get_payment", [
      { payment_hash: paymentHash },
    ]);
  }

  /** get_invoice — note the positional string param (verified live). */
  async getInvoice(paymentHash: string): Promise<FnnGetInvoiceResult> {
    return this.callRpc<FnnGetInvoiceResult>("get_invoice", [paymentHash]);
  }

  /** list_channels — confirmed live; used for the PoC's channel check. */
  async listChannels(): Promise<FnnListChannelsResult> {
    return this.callRpc<FnnListChannelsResult>("list_channels", [{}]);
  }
}

function randomHex(n: number): string {
  const bytes = new Uint8Array(n);
  // Non-cryptographic randomness is fine: this is only used for
  // deterministic-looking mock hashes in offline mode.
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
