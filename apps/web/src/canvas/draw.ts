import type { StrokePayload, StrokeRecord } from "../types";

export function resizeCanvasToContainer(
  canvas: HTMLCanvasElement,
  container: HTMLElement,
): { cssWidth: number; cssHeight: number } {
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = Math.max(1, container.clientWidth);
  const cssHeight = Math.max(1, container.clientHeight);
  canvas.width = Math.max(1, Math.floor(cssWidth * dpr));
  canvas.height = Math.max(1, Math.floor(cssHeight * dpr));
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D context unavailable");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { cssWidth, cssHeight };
}

function minDim(cssWidth: number, cssHeight: number) {
  return Math.min(cssWidth, cssHeight);
}

export function redrawStrokes(
  ctx: CanvasRenderingContext2D,
  cssWidth: number,
  cssHeight: number,
  strokes: StrokeRecord[],
) {
  ctx.save();
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  ctx.fillStyle = "#fafbff";
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  const m = minDim(cssWidth, cssHeight);

  for (const s of strokes) {
    drawStroke(ctx, cssWidth, cssHeight, m, s.payload);
  }
  ctx.restore();
}

export function drawStroke(
  ctx: CanvasRenderingContext2D,
  cssWidth: number,
  cssHeight: number,
  minSide: number,
  payload: StrokePayload,
) {
  if (payload.points.length < 2) return;

  ctx.beginPath();
  const p0 = payload.points[0]!;
  ctx.moveTo(p0.x * cssWidth, p0.y * cssHeight);
  for (let i = 1; i < payload.points.length; i++) {
    const p = payload.points[i]!;
    ctx.lineTo(p.x * cssWidth, p.y * cssHeight);
  }

  ctx.strokeStyle = payload.color;
  ctx.lineWidth = payload.strokeWidthNorm * minSide;
  ctx.lineCap = payload.lineCap;
  ctx.lineJoin = payload.lineJoin;
  ctx.setLineDash(payload.lineDash.map((d) => d * minSide));
  ctx.stroke();
  ctx.setLineDash([]);
}
