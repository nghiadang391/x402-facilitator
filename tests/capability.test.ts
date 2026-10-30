import {
  parseOverride,
  resolveOverrideToMeasured,
  enforceCap,
  PreimageRegistry,
  commitmentFromPreimage,
  checkDeadline,
  SHANNONS_PER_CKB,
} from "../src/capability";

const CAP = 500n * SHANNONS_PER_CKB; // 500 CKB cap

describe("parseOverride", () => {
  test("raw decimal atomic units", () => {
    expect(parseOverride("1000")).toEqual({ kind: "raw", shannons: 1000n });
  });
  test("raw 0x-hex atomic units", () => {
    expect(parseOverride("0x3e8")).toEqual({ kind: "raw", shannons: 1000n });
  });
  test("percent with <=2dp", () => {
    expect(parseOverride("50%")).toEqual({ kind: "percent", percent: 50 });
    expect(parseOverride("33.33%")).toEqual({ kind: "percent", percent: 33.33 });
  });
  test("percent >100 or >2dp rejected", () => {
    expect(parseOverride("150%")).toBeNull();
    expect(parseOverride("33.333%")).toBeNull();
  });
  test("USD form", () => {
    expect(parseOverride("$0.05")).toEqual({ kind: "usd", dollars: 0.05 });
  });
  test("garbage rejected", () => {
    expect(parseOverride("")).toBeNull();
    expect(parseOverride("12abc")).toBeNull();
    expect(parseOverride("-5")).toBeNull();
  });
});

describe("resolveOverrideToMeasured", () => {
  test("raw override clamped to cap", () => {
    const m = resolveOverrideToMeasured(CAP, {
      kind: "raw",
      shannons: 700n * SHANNONS_PER_CKB,
    });
    expect(m).toBe(CAP); // 700 > 500 cap
  });
  test("raw override under cap passes through", () => {
    const m = resolveOverrideToMeasured(CAP, {
      kind: "raw",
      shannons: 80n * SHANNONS_PER_CKB,
    });
    expect(m).toBe(80n * SHANNONS_PER_CKB);
  });
  test("percent floors to atomic units", () => {
    // 33.33% of 500 CKB
    const m = resolveOverrideToMeasured(CAP, { kind: "percent", percent: 33.33 });
    expect(m).toBe((CAP * 3333n) / 10000n);
  });
});

describe("enforceCap", () => {
  test("never exceeds cap", () => {
    expect(enforceCap(10n, 5n)).toBe(5n);
    expect(enforceCap(3n, 5n)).toBe(3n);
    expect(enforceCap(5n, 5n)).toBe(5n);
  });
  test("rejects non-bigint inputs", () => {
    expect(() =>
      enforceCap(10 as unknown as bigint, 5 as unknown as bigint),
    ).toThrow(TypeError);
  });
});

describe("PreimageRegistry", () => {
  test("single-use: second consume is a replay", () => {
    const reg = new PreimageRegistry();
    expect(reg.canUse("0xAABB")).toBe(true);
    expect(reg.consume("0xAABB")).toBe(true); // first
    expect(reg.has("0xaabb")).toBe(true); // case-insensitive hex
    expect(reg.consume("0xaabb")).toBe(false); // replay
  });
  test("commitment binding", () => {
    const c1 = commitmentFromPreimage("0x1111");
    const c2 = commitmentFromPreimage("0x2222");
    expect(c1).not.toBe(c2);
    expect(c1.startsWith("0x")).toBe(true);
  });
});

describe("checkDeadline", () => {
  const now = 1_000_000;
  test("future expiry valid", () => {
    expect(checkDeadline(now, now + 10)).toEqual({ valid: true });
  });
  test("at-or-past expiry invalid", () => {
    expect(checkDeadline(now, now).valid).toBe(false);
    expect(checkDeadline(now, now - 1).reason).toBe("expired");
  });
});
