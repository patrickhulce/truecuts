import { describe, expect, it } from "vitest";
import { DimensionError, formatInches, parseDimension, parseOffset } from "./units";

describe("parseDimension", () => {
  it("passes numbers through as inches", () => {
    expect(parseDimension(34)).toBe(34);
    expect(parseDimension(0)).toBe(0);
    expect(parseDimension(3.5)).toBe(3.5);
  });

  it("parses inch strings", () => {
    expect(parseDimension('8"')).toBe(8);
    expect(parseDimension("8")).toBe(8);
    expect(parseDimension("34.5\"")).toBe(34.5);
  });

  it("parses fractions", () => {
    expect(parseDimension('3/4"')).toBe(0.75);
    expect(parseDimension('6 1/2"')).toBe(6.5);
    expect(parseDimension("1/2")).toBe(0.5);
  });

  it("parses feet and combined forms", () => {
    expect(parseDimension("1'")).toBe(12);
    expect(parseDimension("1' 6\"")).toBe(18);
    expect(parseDimension("1' 6 1/2\"")).toBe(18.5);
    expect(parseDimension("2'")).toBe(24);
  });

  it("rejects empty and unparseable input", () => {
    expect(() => parseDimension("")).toThrow(DimensionError);
    expect(() => parseDimension("nope")).toThrow(DimensionError);
    expect(() => parseDimension(Number.NaN)).toThrow(DimensionError);
  });
});

describe("parseOffset", () => {
  it("parses signed inch offsets", () => {
    expect(parseOffset("-3")).toBe(-3);
    expect(parseOffset('-3/4"')).toBe(-0.75);
    expect(parseOffset("-1' 6\"")).toBe(-18);
    expect(parseOffset("+2")).toBe(2);
    expect(parseOffset(0)).toBe(0);
    expect(parseOffset(-3.5)).toBe(-3.5);
  });

  it("rejects a bare sign and garbage", () => {
    expect(() => parseOffset("-")).toThrow(DimensionError);
    expect(() => parseOffset("+")).toThrow(DimensionError);
    expect(() => parseOffset("nope")).toThrow(DimensionError);
  });
});

describe("dimension arithmetic", () => {
  it.each([
    [`5' - 1.5"`, 58.5],
    [`5'-1.5"`, 58.5],
    [`5' 1.5"`, 61.5],
    [`(2' + 6") / 2`, 15],
    [`2 * (1' 6" + 3/4")`, 37.5],
    [`1 + 2 * 3`, 7],
    [`12 / 2 / 3`, 2],
    [`10 - 2 - 3`, 5],
    [`1/2" + 3/4"`, 1.25],
    [`6 1/2" - 3/4"`, 5.75],
    [`1' 3/4" + .25"`, 13],
    [`1/2' + 1"`, 7],
    [`6-1/2`, 5.5],
    [`-1' 6" + 2'`, 6],
    [`-(2' + 6")`, -30],
    [`2 * -3`, -6],
    [`5′ − 1.5″`, 58.5],
    [`(6″ × 2) ÷ 3`, 4],
    [`1e2 + .5`, 100.5],
  ])("evaluates %s", (input, expected) => {
    expect(parseDimension(input)).toBeCloseTo(expected, 8);
    expect(parseOffset(input)).toBeCloseTo(expected, 8);
  });

  it.each([
    `1/0`, `1/0"`, `6 1/0"`, `1' 1/0"`, `2 / (3 - 3)`,
    `1 +`, `* 2`, `()`, `(2 + 3`, `2 + 3)`, `2 3`, `2 ** 3`,
    `1" rubbish`, `Math.max(1,2)`, `1e309`, `1e308 * 1e308`,
    `"`, `1''`, `1' 2'`,
  ])("rejects invalid expression %s", (input) => {
    expect(() => parseDimension(input)).toThrow(DimensionError);
  });

  it("formats the requested result and can edit it again", () => {
    const result = formatInches(parseDimension(`5' - 1.5"`));
    expect(result).toBe(`4' 10.5"`);
    expect(parseDimension(result)).toBe(58.5);
  });

  it("round trips signed dimensions and fractions", () => {
    for (const inches of [-100.25, -18.5, -0.125, 0, 0.75, 12, 18.5, 58.5]) {
      expect(parseDimension(formatInches(inches))).toBe(inches);
      expect(parseDimension(formatInches(inches, 16))).toBe(inches);
    }
  });
});

describe("formatInches", () => {
  it("formats whole inches and feet", () => {
    expect(formatInches(8)).toBe('8"');
    expect(formatInches(12)).toBe("1'");
    expect(formatInches(18)).toBe("1' 6\"");
  });

  it("formats sixteenths", () => {
    expect(formatInches(0.75, 16)).toBe('3/4"');
    expect(formatInches(18.5, 16)).toBe("1' 6 1/2\"");
  });
});
