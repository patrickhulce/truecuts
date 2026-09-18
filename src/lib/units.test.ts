import { describe, expect, it } from "vitest";
import { DimensionError, formatInches, parseDimension } from "./units";

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
    expect(parseDimension("1'-6\"")).toBe(18);
    expect(parseDimension("1'-6 1/2\"")).toBe(18.5);
    expect(parseDimension("2'")).toBe(24);
  });

  it("rejects empty and unparseable input", () => {
    expect(() => parseDimension("")).toThrow(DimensionError);
    expect(() => parseDimension("nope")).toThrow(DimensionError);
    expect(() => parseDimension(Number.NaN)).toThrow(DimensionError);
  });
});

describe("formatInches", () => {
  it("formats whole inches and feet", () => {
    expect(formatInches(8)).toBe('8"');
    expect(formatInches(12)).toBe("1'");
    expect(formatInches(18)).toBe("1'-6\"");
  });

  it("formats sixteenths", () => {
    expect(formatInches(0.75)).toBe('3/4"');
    expect(formatInches(18.5)).toBe("1'-6 1/2\"");
  });
});
