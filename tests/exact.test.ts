/**
 * exact-scheme wiring tests — fully offline (FnnClient in simulate mode,
 * zero network, zero DB — Rule 6).
 */
import { x402Facilitator } from "@x402/core/facilitator";
import type {
  PaymentPayload,
  PaymentRequirements,
} from "@x402/core/types";
import { FnnClient, type FetchLike } from "../src/fnnClient";
import {
  createExactFiberClient,
  createExactFiberFacilitator,
  parseShannons,
} from "../src/scheme";
import { FIBER_NETWORK } from "../src/types";

function reqs(over: Partial<PaymentRequirements> = {}): PaymentRequirements {
  return {
    scheme: "exact",
    network: FIBER_NETWORK,
    asset: "Fibt",
    amount: "10000",
    payTo: "02aa",
    maxTimeoutSeconds: 300,
    extra: {},
    ...over,
  };
}

function offlineFnn(): FnnClient {
  // simulateFallback: true — no fetch, no node, no DB.
  return new FnnClient({ simulateFallback: true });
}

describe("exact scheme client", () => {
  test("createPaymentPayload returns the fiber payload", async () => {
    const client = createExactFiberClient("02payer");
    const res = await client.createPaymentPayload(2, reqs());
    expect(res.x402Version).toBe(2);
    expect(res.payload).toMatchObject({ keysend: true, payerPubkey: "02payer" });
  });
});

describe("exact scheme facilitator", () => {
  const make = () =>
    new x402Facilitator().register(
      [FIBER_NETWORK],
      createExactFiberFacilitator(offlineFnn(), "02payer"),
    );

  test("getSupported lists the exact/fiber kind", () => {
    const s = make().getSupported();
    expect(
      s.kinds.some(
        (k) => k.scheme === "exact" && k.network === FIBER_NETWORK,
      ),
    ).toBe(true);
  });

  test("verify accepts a well-formed exact request", async () => {
    const f = make();
    const payload: PaymentPayload = {
      x402Version: 2,
      accepted: reqs(),
      payload: {},
    };
    const v = await f.verify(payload, reqs());
    expect(v.isValid).toBe(true);
  });

  test("scheme guard rejects a non-fiber network directly", async () => {
    // Call the scheme object's own verify (not the router) to exercise our
    // unsupported_network guard.
    const f = createExactFiberFacilitator(offlineFnn(), "02payer");
    const payload: PaymentPayload = {
      x402Version: 2,
      accepted: reqs({ network: "eip155:8453" }),
      payload: {},
    };
    const v = await f.verify(payload, reqs({ network: "eip155:8453" }));
    expect(v.isValid).toBe(false);
    expect(v.invalidReason).toBe("unsupported_network");
  });

  test("router rejects an unregistered network before reaching our guard", async () => {
    // The @x402/core router only routes to schemes registered for the
    // requested network; an eip155 network has no fiber facilitator, so it
    // throws rather than returning. That's a second, independent defense.
    const f = make();
    const payload: PaymentPayload = {
      x402Version: 2,
      accepted: reqs({ network: "eip155:8453" }),
      payload: {},
    };
    await expect(
      f.verify(payload, reqs({ network: "eip155:8453" })),
    ).rejects.toThrow(/no facilitator registered/i);
  });

  test("verify rejects a non-positive amount", async () => {
    const f = make();
    const payload: PaymentPayload = {
      x402Version: 2,
      accepted: reqs({ amount: "0" }),
      payload: {},
    };
    const v = await f.verify(payload, reqs({ amount: "0" }));
    expect(v.isValid).toBe(false);
    expect(v.invalidReason).toBe("invalid_amount");
  });

  test("settle succeeds against the offline (simulate) FNN path", async () => {
    const f = make();
    const payload: PaymentPayload = {
      x402Version: 2,
      accepted: reqs(),
      payload: {},
    };
    const s = await f.settle(payload, reqs());
    expect(s.success).toBe(true);
    expect(s.transaction.startsWith("0x")).toBe(true);
    expect(s.network).toBe(FIBER_NETWORK);
    expect(s.amount).toBe("10000");
  });

  test("settle reports transport failure structurally (no throw)", async () => {
    // A fetch that always fails -> FnnTransportError -> success:false
    const badFetch: FetchLike = () =>
      Promise.reject(new Error("ECONNREFUSED"));
    const fnn = new FnnClient({ rpcUrl: "http://127.0.0.1:9", fetchImpl: badFetch });
    const f = new x402Facilitator().register(
      [FIBER_NETWORK],
      createExactFiberFacilitator(fnn, "02payer"),
    );
    const payload: PaymentPayload = { x402Version: 2, accepted: reqs(), payload: {} };
    const s = await f.settle(payload, reqs());
    expect(s.success).toBe(false);
    expect(s.errorReason).toBe("fnn_transport_unavailable");
    expect(s.transaction).toBe("");
  });
});

describe("parseShannons", () => {
  test("decimal + hex + rejection", () => {
    expect(parseShannons("100")).toBe(100n);
    expect(parseShannons("0x64")).toBe(100n);
    expect(parseShannons("12.5")).toBeNull();
    expect(parseShannons("")).toBeNull();
  });
});
