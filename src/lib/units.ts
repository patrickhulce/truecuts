export class DimensionError extends Error {
  readonly input: string;

  constructor(message: string, input: string) {
    super(message);
    this.name = "DimensionError";
    this.input = input;
  }
}

/** Normalize typographic unit marks and arithmetic operators. */
function normalizeMarks(value: string): string {
  return value.trim().replace(/[′’]/g, "'").replace(/[″”]/g, '"')
    .replace(/[–—−]/g, "-").replace(/×/g, "*").replace(/÷/g, "/");
}

/**
 * Evaluate dimension arithmetic in inches. Bare numbers are inches; feet and
 * inches join with a space. Minus always subtracts, including immediately after feet.
 * Fractions and mixed numbers are literals; multiplication/division precede addition.
 */
export function parseDimension(input: number | string): number {
  if (typeof input === "number") {
    if (!Number.isFinite(input)) throw new DimensionError("Dimension must be a finite number", String(input));
    return input;
  }
  const source = normalizeMarks(input);
  if (!source) throw new DimensionError("Empty dimension", input);
  // Bound recursion and work for pasted or imported input.
  if (source.length > 4096) throw new DimensionError("Dimension expression is too long", input);
  let cursor = 0;
  const fail = (message = "Cannot parse dimension"): never => { throw new DimensionError(message, input); };
  const space = () => { while (/\s/.test(source[cursor] ?? "") && cursor < source.length) cursor++; };
  const take = (token: string) => {
    space();
    if (source[cursor] !== token) return false;
    cursor++;
    return true;
  };
  const finite = (value: number) => Number.isFinite(value) ? value : fail("Dimension must be a finite number");
  function number(): number {
    space();
    const match = source.slice(cursor).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i);
    if (!match) return fail("Expected a number or dimension");
    cursor += match[0].length;
    const whole = Number(match[0]);
    // A space-separated fraction belongs to the preceding whole number.
    const mixed = source.slice(cursor).match(/^\s+(\d+)\s*\/\s*(\d+)(?![\d.])/);
    if (mixed) {
      cursor += mixed[0].length;
      const denominator = Number(mixed[2]);
      if (denominator === 0) return fail("Division by zero");
      return finite(whole + Number(mixed[1]) / denominator);
    }
    return finite(whole);
  }
  function literal(): number {
    let value = number();
    // Read a simple fraction as one literal so 3/4" and 1/2' carry units.
    const fraction = source.slice(cursor).match(/^\s*\/\s*(\d+(?:\.\d*)?|\.\d+)\s*(['"])/);
    if (fraction) {
      cursor += fraction[0].length;
      const denominator = Number(fraction[1]);
      if (denominator === 0) return fail("Division by zero");
      value /= denominator;
      if (fraction[2] === '"') return finite(value);
    } else if (!take("'")) {
      take('"');
      return value;
    }
    value *= 12;
    space();
    if (/^[\d.]/.test(source.slice(cursor))) {
      let inches = number();
      const fraction = source.slice(cursor).match(/^\s*\/\s*(\d+)(?![\d.])/);
      if (fraction) {
        cursor += fraction[0].length;
        const denominator = Number(fraction[1]);
        if (denominator === 0) return fail("Division by zero");
        inches /= denominator;
      }
      take('"');
      value += inches;
    }
    return finite(value);
  }
  function unary(depth: number): number {
    if (depth > 64) return fail("Dimension expression is nested too deeply");
    if (take("+")) return unary(depth + 1);
    if (take("-")) return -unary(depth + 1);
    if (take("(")) {
      const value = expression(depth + 1);
      if (!take(")")) return fail("Missing closing parenthesis");
      return value;
    }
    return literal();
  }
  function product(depth: number): number {
    let value = unary(depth);
    while (true) {
      if (take("*")) value = finite(value * unary(depth));
      else if (take("/")) {
        const divisor = unary(depth);
        if (divisor === 0) return fail("Division by zero");
        value = finite(value / divisor);
      } else return value;
    }
  }
  function expression(depth: number): number {
    let value = product(depth);
    while (true) {
      if (take("+")) value = finite(value + product(depth));
      else if (take("-")) value = finite(value - product(depth));
      else return value;
    }
  }
  const value = expression(0);
  space();
  if (cursor !== source.length) return fail("Unexpected text in dimension");
  return finite(value);
}

/** Signed offsets use the same arithmetic and unit syntax as dimensions. */
export function parseOffset(input: number | string): number {
  return parseDimension(input);
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

/** Pretty-print feet and decimal inches; pass a denominator to use fractions. */
export function formatInches(inches: number, denom?: number): string {
  if (denom === undefined) {
    const rounded = Math.round(Math.abs(inches) * 10000) / 10000;
    const feet = Math.floor(rounded / 12);
    const remainder = Number((rounded - feet * 12).toFixed(4));
    const sign = inches < 0 && rounded !== 0 ? "-" : "";
    if (feet === 0) return sign + remainder + '"';
    return sign + feet + "'" + (remainder === 0 ? "" : " " + remainder + '"');
  }
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
  return `${sign}${feetOut}' ${inchPart}"`;
}
