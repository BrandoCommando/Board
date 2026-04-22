import { z } from "zod";

const lineCap = z.enum(["round", "butt", "square"]);
const lineJoin = z.enum(["round", "miter", "bevel"]);

export const strokePayloadSchema = z.object({
  points: z
    .array(
      z.object({
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
      }),
    )
    .min(2)
    .max(20000),
  color: z.string().min(1).max(64),
  strokeWidthNorm: z.number().min(0.0005).max(0.2),
  lineCap,
  lineJoin,
  lineDash: z.array(z.number().min(0).max(1)).max(16),
});

export type StrokePayload = z.infer<typeof strokePayloadSchema>;

export const wsClientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("auth"),
    token: z.string().min(1),
  }),
  z.object({
    type: z.literal("anon"),
    anonId: z.string().min(1).max(128),
  }),
  z.object({
    type: z.literal("joinBoard"),
    boardId: z.string().min(1),
  }),
  z.object({
    type: z.literal("stroke"),
    clientStrokeId: z.string().min(1),
    boardId: z.string().min(1),
    payload: strokePayloadSchema,
  }),
  z.object({
    type: z.literal("deleteStroke"),
    boardId: z.string().min(1),
    strokeId: z.string().min(1),
  }),
]);

export type WsClientMessage = z.infer<typeof wsClientMessageSchema>;
