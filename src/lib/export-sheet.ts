import type { Aabb } from "./geometry";
import { formatInches } from "./units";

export const SHEET_WIDTH = 2400;
export const SHEET_MARGIN = 72;
export const SHEET_GAP = 36;
export const SHEET_HEADER = 160;
export const SHEET_LABEL = 48;
export const EXPORT_CELL_ASPECT = 4 / 3;

/** Share of the inner width given to the framed column. */
const RIGHT_COLUMN = 0.38;
/** Full-width boxes in the right column are wide landscape strips. */
const STACK_ASPECT = 2;

const SHEET_BG = "#1a120b";
const TITLE_COLOR = "#f59e0b";
const DIMENSION_COLOR = "#d6c3a3";
const LABEL_COLOR = "#a89070";
const RULE_COLOR = "#3d2a18";
const FRAME_COLOR = "#6b4a2b";

export type SheetRect = { x: number; y: number; width: number; height: number };

export type SheetCell = { image: SheetRect; label: SheetRect; framed: boolean };

export type SheetLayout = {
  width: number;
  height: number;
  header: SheetRect;
  titleWidth: number;
  dimensionWidth: number;
  cells: SheetCell[];
};

export function layoutSheet(viewCount: number, sheetWidth = SHEET_WIDTH): SheetLayout {
  const count = Math.max(0, Math.floor(viewCount));
  const inner = sheetWidth - SHEET_MARGIN * 2;
  const header: SheetRect = { x: SHEET_MARGIN, y: SHEET_MARGIN, width: inner, height: SHEET_HEADER };
  const headerBottom = header.y + header.height;
  if (count === 0) {
    return {
      width: sheetWidth,
      height: headerBottom + SHEET_MARGIN,
      header,
      titleWidth: header.width * 0.48,
      dimensionWidth: header.width * 0.48,
      cells: [],
    };
  }

  const bodyTop = headerBottom + SHEET_GAP;
  if (count === 1) {
    const imageHeight = inner / EXPORT_CELL_ASPECT;
    return {
      width: sheetWidth,
      height: bodyTop + imageHeight + SHEET_LABEL + SHEET_MARGIN,
      header,
      titleWidth: header.width * 0.48,
      dimensionWidth: header.width * 0.48,
      cells: [cellAt(SHEET_MARGIN, bodyTop, inner, imageHeight, false)],
    };
  }

  const rightWidth = inner * RIGHT_COLUMN;
  const leftWidth = inner - SHEET_GAP - rightWidth;
  const rightX = SHEET_MARGIN + leftWidth + SHEET_GAP;
  const rightCells = layoutRight(count - 1, rightX, bodyTop, rightWidth);
  const stackBottom = rightCells[rightCells.length - 1]!.label.y + SHEET_LABEL;
  const hero = cellAt(SHEET_MARGIN, bodyTop, leftWidth, stackBottom - bodyTop - SHEET_LABEL, false);
  return {
    width: sheetWidth,
    height: stackBottom + SHEET_MARGIN,
    header,
    titleWidth: leftWidth,
    dimensionWidth: rightWidth,
    cells: [hero, ...rightCells],
  };
}

/** World span of the build, longest to shortest: L, then W, then H. */
export function overallDimensions(bounds: Aabb): string {
  const spans = ([0, 1, 2] as const).map((axis) => bounds.max[axis] - bounds.min[axis]);
  const [length, width, height] = [...spans].sort((a, b) => b - a);
  return `L ${formatInches(length)} × W ${formatInches(width)} × H ${formatInches(height)}`;
}

export function exportSheetFilename(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug.length > 0 ? slug : "build"}-sheet.png`;
}

export function composeSheet(input: {
  title: string;
  dimensions: string;
  views: { name: string; image: CanvasImageSource }[];
}): HTMLCanvasElement {
  const layout = layoutSheet(input.views.length);
  if (input.views.length !== layout.cells.length) {
    throw new Error("Sheet views do not match the layout");
  }
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return canvas;

  const display = fontFamily("--font-display", "Georgia, serif");
  const mono = fontFamily("--font-ibm-plex-mono", "ui-monospace, monospace");
  context.font = `600 64px ${display}`;
  const title = ellipsize(context, input.title, layout.titleWidth);
  const titleDrawn = context.measureText(title).width;
  context.font = `500 32px ${mono}`;
  const dimension = `Overall  ${input.dimensions}`;
  const dimensionDrawn = context.measureText(dimension).width;
  const extra = Math.max(0, Math.ceil(titleDrawn + SHEET_GAP + dimensionDrawn - layout.header.width));
  canvas.width = layout.width + extra;
  canvas.height = layout.height;

  context.fillStyle = SHEET_BG;
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.textBaseline = "middle";
  context.fillStyle = TITLE_COLOR;
  context.font = `600 64px ${display}`;
  context.fillText(title, layout.header.x, layout.header.y + layout.header.height / 2);

  context.fillStyle = DIMENSION_COLOR;
  context.font = `500 32px ${mono}`;
  context.textAlign = "right";
  context.fillText(dimension, canvas.width - SHEET_MARGIN, layout.header.y + layout.header.height / 2);
  context.textAlign = "left";

  context.strokeStyle = RULE_COLOR;
  context.lineWidth = 2;
  const ruleY = layout.header.y + layout.header.height;
  context.beginPath();
  context.moveTo(SHEET_MARGIN, ruleY);
  context.lineTo(canvas.width - SHEET_MARGIN, ruleY);
  context.stroke();

  input.views.forEach((view, index) => {
    const cell = layout.cells[index]!;
    context.drawImage(view.image, cell.image.x, cell.image.y, cell.image.width, cell.image.height);
    if (cell.framed) {
      context.strokeStyle = FRAME_COLOR;
      context.lineWidth = 2;
      context.strokeRect(cell.image.x + 1, cell.image.y + 1, cell.image.width - 2, cell.image.height - 2);
    }
    context.fillStyle = LABEL_COLOR;
    context.font = `500 28px ${mono}`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(
      ellipsize(context, view.name, cell.label.width - 16),
      cell.label.x + cell.label.width / 2,
      cell.label.y + cell.label.height / 2,
    );
  });
  context.textAlign = "left";
  return canvas;
}

function cellAt(x: number, y: number, width: number, height: number, framed: boolean): SheetCell {
  return {
    image: { x, y, width, height },
    label: { x, y: y + height, width, height: SHEET_LABEL },
    framed,
  };
}

function layoutRight(count: number, x: number, y: number, width: number): SheetCell[] {
  const pair = count >= 3;
  const stacked = pair ? count - 2 : count;
  const cells: SheetCell[] = [];
  let cursor = y;
  const fullHeight = width / STACK_ASPECT;
  for (let index = 0; index < stacked; index += 1) {
    cells.push(cellAt(x, cursor, width, fullHeight, true));
    cursor += fullHeight + SHEET_LABEL + SHEET_GAP;
  }
  if (pair) {
    const pairWidth = (width - SHEET_GAP) / 2;
    const pairHeight = pairWidth / EXPORT_CELL_ASPECT;
    cells.push(cellAt(x, cursor, pairWidth, pairHeight, true));
    cells.push(cellAt(x + pairWidth + SHEET_GAP, cursor, pairWidth, pairHeight, true));
  }
  return cells;
}

function fontFamily(variable: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  return value.length > 0 ? value : fallback;
}

function ellipsize(context: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (context.measureText(text).width <= maxWidth) return text;
  let trimmed = text;
  while (trimmed.length > 1 && context.measureText(`${trimmed}…`).width > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  return `${trimmed}…`;
}
