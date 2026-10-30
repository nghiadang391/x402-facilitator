/**
 * fiber402 facilitator HTTP surface (W1: bare, no auth — W2 adds
 * createAuthHeaders shared-bearer + audit log).
 *
 * Endpoints (the @x402/core http client contract):
 *   GET  /supported  -> { kinds, extensions, signers }
 *   POST /verify     -> VerifyResponse
 *   POST /settle     -> SettleResponse
 *
 * Wire bodies are x402 core's VerifyRequest/SettleRequest shapes:
 *   { x402Version, paymentPayload, paymentRequirements }
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { serve } from "@hono/node-server";
import { x402Facilitator } from "@x402/core/facilitator";
import type {
  PaymentPayload,
  PaymentRequirements,
} from "@x402/core/types";
import { FnnClient } from "./fnnClient";
import {
  createExactFiberFacilitator,
  createExactFiberClient,
} from "./scheme";
import { FIBER_NETWORK } from "./types";

interface X402WireRequest {
  x402Version: number;
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
}

export function createFacilitatorApp(
  fnn: FnnClient,
  opts: { payerPubkey?: string } = {},
): Hono {
  const app = new Hono();
  const facilitator = new x402Facilitator();
  // exact is live in W1; the same registration is where "upto" attaches in W2.
  facilitator.register(
    [FIBER_NETWORK],
    createExactFiberFacilitator(fnn, opts.payerPubkey),
  );

  app.get("/supported", (c: Context) => c.json(facilitator.getSupported()));

  app.post("/verify", async (c: Context) => {
    const body = (await c.req.json()) as X402WireRequest;
    return c.json(
      await facilitator.verify(body.paymentPayload, body.paymentRequirements),
    );
  });

  app.post("/settle", async (c: Context) => {
    const body = (await c.req.json()) as X402WireRequest;
    return c.json(
      await facilitator.settle(body.paymentPayload, body.paymentRequirements),
    );
  });

  app.get("/__meta", (c: Context) =>
    c.json({
      service: "fiber402-facilitator",
      version: "w1",
      network: FIBER_NETWORK,
      schemes: ["exact"],
      fnn: "injected",
    }),
  );

  // dev helper: expose the client-builder too, so a same-process provider
  // demo (W2) can be assembled without re-instantiating.
  (app as unknown as { __fiberClient?: unknown }).__fiberClient =
    createExactFiberClient(opts.payerPubkey);

  return app;
}

export { FIBER_NETWORK };

// `npm run dev` entrypoint (tsx; require.main is unreliable under ESM,
// so detect by argv instead). Node uses serve() from @hono/node-server.
if (process.argv[1]?.endsWith("src/server.ts")) {
  const fnn = new FnnClient();
  const app = createFacilitatorApp(fnn);
  const port = Number(process.env.FACILITATOR_PORT ?? 4020);
  serve(
    { fetch: app.fetch, port, hostname: process.env.FACILITATOR_HOST ?? "127.0.0.1" },
    (info) => {
      console.log(`[fiber402] facilitator listening on http://127.0.0.1:${info.port}`);
    },
  );
}
