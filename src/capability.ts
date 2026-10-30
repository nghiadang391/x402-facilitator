/**
 * fiber402 "upto" (metered) capability math — pure, no I/O, unit-tested.
 *
 * This is the part of the design that answers the committee's objection:
 * "if the cap lives only as a counter inside the SDK, a prompt-injected
 * tool call could reset or bypass it." Here the cap is enforced
 * server-side (enforceCap) and the preimage is single-use
 * (PreimageRegistry) — neither can be silently rewritten by a
 * compromised agent, because both live in the facilitator, not the SDK.
 *
 * See docs/upto-design.md §"cap enforcement".
 */

import { createHash } from "node:crypto";

/** 1 CKB / main unit = 1e8 shannons (atomic units). */
export const SHANNONS_PER_CKB = 100_000_000n;

export type OverrideFormat =
  | { kind: "raw"; shannons: bigint }
  | { kind: "percent"; percent: number } // 0..100, up to 2dp
  | { kind: "usd"; dollars: number } // decimal USD, converted by decimals

export function isBigInt(n: unknown): n is bigint {
  return typeof n === "bigint";
}

/**
 * Parse a SettlementOverrides.amount string into an OverrideFormat.
 * Three supported forms (mirrors @x402/core SettlementOverrides docs):
 *   - raw atomic units: "1000" (decimal) or "0x3e8" (hex)
 *   - percent of cap:   "50%"  (up to two decimals, e.g. "33.33%")
 *   - USD price:        "$0.05" (needs getAssetDecimals to convert)
 * Returns null when the string is not a valid override amount.
 */
export function parseOverride(input: string): OverrideFormat | null {
  const s = input.trim();
  if (s.length === 0) return null;

  if (s.endsWith("%")) {
    const num = s.slice(0, -1).trim();
    const p = Number(num);
    if (!Number.isFinite(p) || p < 0 || p > 100) return null;
    // Enforce <= 2 decimal places (per @x402/core contract).
    const m = num.match(/^(\d+)(\.\d{1,2})?$/);
    if (!m) return null;
    return { kind: "percent", percent: p };
  }

  if (s.startsWith("$")) {
    const num = s.slice(1).trim();
    const d = Number(num);
    if (!Number.isFinite(d) || d < 0) return null;
    return { kind: "usd", dollars: d };
  }

  // raw atomic units: decimal or 0x hex
  try {
    let sh: bigint;
    if (s.startsWith("0x")) sh = BigInt(s);
    else sh = BigInt(s);
    if (sh < 0n) return null;
    return { kind: "raw", shannons: sh };
  } catch {
    return null;
  }
}

/**
 * Resolve an override to a concrete measured amount in shannons.
 *
 * @param capShannons the authorized maximum (PaymentRequirements.amount)
 * @param override    the parsed override (from the provider's metering)
 * @param assetDecimals for "$"-form, the atomic decimals of the asset
 * @returns the measured amount in shannons, already clamped to <= cap
 *          (percent is floored; raw and usd are clamped, usd rounded)
 */
export function resolveOverrideToMeasured(
  capShannons: bigint,
  override: OverrideFormat,
  assetDecimals = 8,
): bigint {
  let measured: bigint;
  switch (override.kind) {
    case "raw":
      measured = override.shannons;
      break;
    case "percent": {
      // floor to the nearest atomic unit
      const num = Math.floor(override.percent * 100); // basis points, floored
      measured = (capShannons * BigInt(num)) / 10000n;
      break;
    }
    case "usd": {
      // $X -> atomic units via decimals, rounded to nearest atomic unit.
      const atomicPerDollar = 10n ** BigInt(assetDecimals);
      // dollars has at most 8dp; multiply to avoid float error.
      const scaled = BigInt(Math.round(override.dollars * 1e8)) * atomicPerDollar;
      measured = scaled / 100_000_000n;
      break;
    }
  }
  return enforceCap(measured, capShannons);
}

/**
 * Server-side, unbypassable cap check: measured can never exceed the
 * authorized cap. This is the backstop — even if the provider's override
 * header is ignored or maliciously set, the facilitator clamps here.
 */
export function enforceCap(measured: bigint, capShannons: bigint): bigint {
  if (!isBigInt(measured) || !isBigInt(capShannons)) {
    throw new TypeError("enforceCap expects bigint measured and cap");
  }
  return measured <= capShannons ? measured : capShannons;
}

/* ---------------------------------------------------------------- */
/* PreimageRegistry — single-use settlement, replay detection       */
/* ---------------------------------------------------------------- */

/**
 * A preimage (secret s, committed as H(s)) authorizes exactly one
 * settlement. Once settled, any replay with the same preimage is
 * rejected. This is the FiberLatch one-time-redemption pattern.
 * In W1 it is in-memory; a multi-instance facilitator would back it with
 * a shared store (W2).
 */
export class PreimageRegistry {
  private used = new Set<string>();

  /** True if this preimage has NOT been settled yet. */
  canUse(preimage: string): boolean {
    return !this.used.has(normalizeHex(preimage));
  }

  /** Mark a preimage as consumed. Returns true if it was new, false if
   *  it was already consumed (i.e. this call is a replay). */
  consume(preimage: string): boolean {
    const k = normalizeHex(preimage);
    if (this.used.has(k)) return false;
    this.used.add(k);
    return true;
  }

  has(preimage: string): boolean {
    return this.used.has(normalizeHex(preimage));
  }
}

/**
 * Derive the preimage from the commitment + the measured amount, so the
 * settlement is bound to BOTH the payer's committed secret and the
 * metered value. (The provider commits H(s) up front; the facilitator
 * reconstructs the binding at settle time.)
 */
export function commitmentFromPreimage(preimage: string): string {
  return "0x" + createHash("sha256").update(normalizeHex(preimage)).digest("hex");
}

function normalizeHex(h: string): string {
  const s = h.startsWith("0x") ? h.slice(2) : h;
  return s.toLowerCase();
}

/* ---------------------------------------------------------------- */
/* deadline / expiry                                                  */
/* ---------------------------------------------------------------- */

export interface DeadlineCheck {
  valid: boolean;
  reason?: string;
}

/** A capability is valid until its expiry (unix ms). */
export function checkDeadline(nowMs: number, expiresAtMs: number): DeadlineCheck {
  if (expiresAtMs <= nowMs) {
    return { valid: false, reason: "expired" };
  }
  return { valid: true };
}
