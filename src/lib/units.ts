export class DimensionError extends Error {
  readonly input: string;

  constructor(message: string, input: string) {
    super(message);
    this.name = "DimensionError";
    this.input = input;
  }
}

const FEET = /^(\d+(?:\.\d+)?)\s*'/;
const MIXED = /^(\d+(?:\.\d+)?)\s+(\d+)\s*\/\s*(\d+)\s*"?$/;
const HYPHEN_MIXED = /^(\d+(?:\.\d+)?)-(\d+)\s*\/\s*(\d+)\s*"?$/;
const FRACTION = /^(\d+)\s*\/\s*(\d+)\s*"?$/;
const DECIMAL = /^(\d+(?:\.\d+)?)\s*"?$/;

/** Normalize typographic marks so 1′‑6½″ still parses. */
function normalizeMarks(value: string): string {
  return value
    .trim()
    .replace(/[′’]/g, "'")
    .replace(/[″”]/g, '"')
    .replace(/[–—]/g, "-");
}

/**
 * Parse a number of inches, or an imperial dimension string, into inches.
 *
 * Accepted forms: `8`, `8"`, `3/4"`, `6 1/2"`, `1'`, `1'-6"`, `1'-6 1/2"`, `34.5"`.
 */
export function parseDimension(input: number | string): number {
  if (typeof input === "number") {
    if (!Number.isFinite(input)) {
      throw new DimensionError("Dimension must be a finite number", String(input));
    }
    return input;
  }

  const raw = normalizeMarks(input);
  if (!raw) {
    throw new DimensionError("Empty dimension", input);
  }

  let rest = raw;
  let inches = 0;

  const feetMatch = rest.match(FEET);
  if (feetMatch) {
    inches += Number.parseFloat(feetMatch[1]) * 12;
    rest = rest.slice(feetMatch[0].length).replace(/^\s*-?\s*/, "");
  }

  if (!rest || rest === '"') {
    return inches;
  }

  const mixed = rest.match(MIXED);
  if (mixed) {
    inches += Number.parseFloat(mixed[1]) + Number.parseInt(mixed[2], 10) / Number.parseInt(mixed[3], 10);
    return inches;
  }

  const hyphenMixed = rest.match(HYPHEN_MIXED);
  if (hyphenMixed) {
    inches +=
      Number.parseFloat(hyphenMixed[1]) +
      Number.parseInt(hyphenMixed[2], 10) / Number.parseInt(hyphenMixed[3], 10);
    return inches;
  }

  const fraction = rest.match(FRACTION);
  if (fraction) {
    const denom = Number.parseInt(fraction[2], 10);
    if (denom === 0) {
      throw new DimensionError("Division by zero in fraction", input);
    }
    inches += Number.parseInt(fraction[1], 10) / denom;
    return inches;
  }

  const decimal = rest.match(DECIMAL);
  if (decimal) {
    inches += Number.parseFloat(decimal[1]);
    return inches;
  }

  throw new DimensionError(`Cannot parse dimension "${input}"`, input);
}

export type DimensionInput = number | string;

export function parseAt(
  at: DimensionInput | [DimensionInput, DimensionInput],
): number | [number, number] {
  if (Array.isArray(at)) {
    return [parseDimension(at[0]), parseDimension(at[1])];
  }
  return parseDimension(at);
}

/** Pretty-print inches using feet + sixteenths when helpful. */
export function formatInches(inches: number, denom = 16): string {
  const sign = inches < 0 ? "-" : "";
  const abs = Math.abs(inches);
  const feet = Math.floor(abs / 12 + 1e-9);
  let rem = abs - feet * 12;
  if (rem < 0) rem = 0;

  const whole = Math.floor(rem + 1e-9);
  let frac = Math.round((rem - whole) * denom);
  let wholeOut = whole;
  let feetOut = feet;
  if (frac === denom) {
    frac = 0;
    wholeOut += 1;
  }
  if (wholeOut >= 12) {
    feetOut += Math.floor(wholeOut / 12);
    wholeOut = wholeOut % 12;
  }

  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  let inchPart: string;
  if (frac === 0) {
    inchPart = `${wholeOut}`;
  } else {
    const g = gcd(frac, denom);
    inchPart = wholeOut === 0 ? `${frac / g}/${denom / g}` : `${wholeOut} ${frac / g}/${denom / g}`;
  }

  if (feetOut === 0) {
    return `${sign}${inchPart}"`;
  }
  if (wholeOut === 0 && frac === 0) {
    return `${sign}${feetOut}'`;
  }
  return `${sign}${feetOut}'-${inchPart}"`;
}
