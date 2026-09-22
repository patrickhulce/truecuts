export type Justify = "space-between" | "space-around";

/**
 * How many gaps an open or closed run needs so each gap is at most `separation`.
 * A zero-length run is a single fastener.
 */
export function gapCount(length: number, separation: number): number {
  if (!(length > 1e-6) || !(separation > 0)) return 1;
  return Math.max(1, Math.ceil(length / separation - 1e-9));
}

/**
 * Positions along an open path of `length`, in `[0, length]`.
 * `space-between` pins fasteners to both ends. `space-around` leaves a half-gap at each end.
 */
export function layoutOpen(length: number, separation: number, justify: Justify): number[] {
  if (!(length > 1e-6)) return [0];
  const gaps = gapCount(length, separation);
  if (justify === "space-between") {
    const step = length / gaps;
    return Array.from({ length: gaps + 1 }, (_, index) => index * step);
  }
  const step = length / gaps;
  return Array.from({ length: gaps }, (_, index) => step / 2 + index * step);
}

/**
 * Positions along a closed loop of `length`, in `[0, length)`.
 * `space-between` starts on the path origin. `space-around` shifts by half a gap.
 */
export function layoutClosed(length: number, separation: number, justify: Justify): number[] {
  if (!(length > 1e-6)) return [0];
  const gaps = gapCount(length, separation);
  const step = length / gaps;
  const offset = justify === "space-around" ? step / 2 : 0;
  return Array.from({ length: gaps }, (_, index) => offset + index * step);
}
