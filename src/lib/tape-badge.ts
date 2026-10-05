/** Gap from the measurement end to the nearest edge of the readout, in CSS pixels. */
export const TAPE_BADGE_GAP_PX = 36;

/** Screen length below which the tape has no reliable direction. */
const SHORT_TAPE_PX = 8;

/** Pointers closer than this still count as sitting on the endpoint. */
const POINTER_ON_END_PX = 24;

/**
 * |component| below this centers the pill on that axis.
 * A unit vector always exceeds this on at least one axis, so the gap never collapses.
 */
const CENTER_AXIS = 0.5;

/** Up and to the right, used when the tape is only a few pixels on screen. */
const SHORT_DIRECTION: ScreenPoint = { x: 0.6, y: -0.8 };

export type ScreenPoint = { x: number; y: number };

export type ScreenRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type TapeBadgePlacement = {
  /** Unit screen vector from the endpoint toward the pill. Y grows downward. */
  direction: ScreenPoint;
  transform: string;
};

/**
 * Which way to push the readout. Perpendicular to the on-screen tape, preferring
 * up, and the side that points away from the pointer when the pointer has left the end.
 */
export function tapeBadgeDirection(
  start: ScreenPoint,
  end: ScreenPoint,
  pointer: ScreenPoint | null,
): ScreenPoint {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < SHORT_TAPE_PX) return SHORT_DIRECTION;

  const left = { x: -dy / length, y: dx / length };
  const right = { x: -left.x, y: -left.y };
  const toward = pointerAway(end, pointer);
  return score(left, toward) >= score(right, toward) ? left : right;
}

/** CSS transform that keeps the pill's near edge `gap` pixels off the anchor. */
export function tapeBadgeTransform(direction: ScreenPoint, gap = TAPE_BADGE_GAP_PX): string {
  return `translate(${axisTransform(direction.x, gap)}, ${axisTransform(direction.y, gap)})`;
}

export function tapeBadgePlacement(
  start: ScreenPoint,
  end: ScreenPoint,
  pointer: ScreenPoint | null,
  gap = TAPE_BADGE_GAP_PX,
): TapeBadgePlacement {
  const direction = tapeBadgeDirection(start, end, pointer);
  return { direction, transform: tapeBadgeTransform(direction, gap) };
}

/**
 * Pill rectangle relative to the endpoint after `tapeBadgeTransform`.
 * Matches the CSS anchors: a centered axis uses half the size, an anchored axis uses the full gap.
 */
export function tapeBadgeRect(
  direction: ScreenPoint,
  size: { width: number; height: number },
  gap = TAPE_BADGE_GAP_PX,
): ScreenRect {
  const left = axisPixels(direction.x, size.width, gap);
  const top = axisPixels(direction.y, size.height, gap);
  return { left, top, right: left + size.width, bottom: top + size.height };
}

function pointerAway(end: ScreenPoint, pointer: ScreenPoint | null): ScreenPoint | null {
  if (!pointer) return null;
  const x = pointer.x - end.x;
  const y = pointer.y - end.y;
  if (Math.hypot(x, y) < POINTER_ON_END_PX) return null;
  return { x, y };
}

function score(direction: ScreenPoint, towardPointer: ScreenPoint | null): number {
  let value = -direction.y + direction.x * 0.01;
  if (!towardPointer) return value;
  const dist = Math.hypot(towardPointer.x, towardPointer.y);
  const toward = direction.x * towardPointer.x + direction.y * towardPointer.y;
  return value - (toward / dist) * 4;
}

function axisTransform(component: number, gap: number): string {
  if (component >= CENTER_AXIS) return `${gap}px`;
  if (component <= -CENTER_AXIS) return `calc(-100% - ${gap}px)`;
  return "-50%";
}

function axisPixels(component: number, size: number, gap: number): number {
  if (component >= CENTER_AXIS) return gap;
  if (component <= -CENTER_AXIS) return -size - gap;
  return -size / 2;
}
