/**
 * @x402-fiber public exports (the future npm package boundary).
 *
 * W1 surface: FNN transport, exact-scheme client + facilitator,
 * upto capability math, and shared types. W2 adds: auth, audit log,
 * the "upto" scheme handlers, and npm build metadata.
 */

export {
  FIBER_NETWORK,
  FIBER_NETWORK_MAINNET,
  FIBER_CAIP_FAMILY,
} from "./types";
export type {
  FiberScheme,
  FiberNetwork,
  FiberAsset,
  FiberExactPayload,
  FiberUptoPayload,
  FnnPaymentResult,
  FnnNewInvoiceResult,
  FnnListChannelsResult,
  FnnGetInvoiceResult,
} from "./types";

export { FnnClient, FnnTransportError } from "./fnnClient";
export type { FnnClientOptions, FetchLike } from "./fnnClient";

export {
  createExactFiberClient,
  createExactFiberFacilitator,
  registerUptoScheme,
  parseShannons,
} from "./scheme";

export {
  SHANNONS_PER_CKB,
  parseOverride,
  resolveOverrideToMeasured,
  enforceCap,
  PreimageRegistry,
  commitmentFromPreimage,
  checkDeadline,
} from "./capability";
export type {
  OverrideFormat,
  DeadlineCheck,
} from "./capability";

export { createFacilitatorApp } from "./server";
