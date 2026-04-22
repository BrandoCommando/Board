export type Point = { x: number; y: number };

export type StrokePayload = {
  points: Point[];
  color: string;
  strokeWidthNorm: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  lineDash: number[];
};

export type StrokeRecord = {
  id: string;
  boardId: string;
  userId: string;
  payload: StrokePayload;
  createdAt: string | null;
};
