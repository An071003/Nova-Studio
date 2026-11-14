import { z } from 'zod';

export const DOC_SCHEMA_VERSION = 1;
export const DEFAULT_PAGE_ID = 'page:main';
export const MAX_REALTIME_MESSAGE_BYTES = 1024 * 1024;

export const PRESENCE_COLORS = [
  '#F87171',
  '#FB923C',
  '#FACC15',
  '#4ADE80',
  '#2DD4BF',
  '#60A5FA',
  '#A78BFA',
  '#F472B6',
  '#E879F9',
  '#94A3B8',
] as const;

export function colorForUserId(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  const color = PRESENCE_COLORS[hash % PRESENCE_COLORS.length];
  return color ?? PRESENCE_COLORS[0];
}

export const NODE_TYPES = [
  'rect',
  'ellipse',
  'line',
  'text',
  'image',
  'group',
  'frame',
] as const;
export const NodeTypeSchema = z.enum(NODE_TYPES);
export type NodeType = z.infer<typeof NodeTypeSchema>;

export const TOOL_IDS = [
  'select',
  'hand',
  'rect',
  'ellipse',
  'line',
  'text',
  'image',
  'frame',
] as const;
export const ToolIdSchema = z.enum(TOOL_IDS);
export type ToolId = z.infer<typeof ToolIdSchema>;

export const TextAlignSchema = z.enum(['left', 'center', 'right']);
export type TextAlign = z.infer<typeof TextAlignSchema>;

export const CanvasNodeSchema = z.object({
  id: z.string().min(1),
  type: NodeTypeSchema,
  pageId: z.string().min(1).default(DEFAULT_PAGE_ID),
  parentId: z.string().min(1).nullable().default(null),
  index: z.string().min(1),
  name: z.string().max(200),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().min(0),
  height: z.number().finite().min(0),
  rotation: z.number().finite().default(0),
  opacity: z.number().finite().min(0).max(1).default(1),
  visible: z.boolean().default(true),
  locked: z.boolean().default(false),
  fill: z.string().nullable().default('#7C5CFF'),
  stroke: z.string().nullable().default(null),
  strokeWidth: z.number().finite().min(0).default(0),
  cornerRadius: z.number().finite().min(0).optional(),
  points: z.array(z.number().finite()).optional(),
  text: z.string().optional(),
  fontFamily: z.string().min(1).optional(),
  fontSize: z.number().finite().positive().optional(),
  fontWeight: z.union([z.number().int().min(100).max(900), z.string().min(1)]).optional(),
  align: TextAlignSchema.optional(),
  lineHeight: z.number().finite().positive().optional(),
  assetId: z.string().min(1).optional(),
  createdBy: z.string().min(1),
  updatedAt: z.number().finite(),
});

export type CanvasNode = z.infer<typeof CanvasNodeSchema>;

export const PresenceUserSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  color: z.string().min(1),
  avatarUrl: z.string().optional(),
});

export const PointSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

export type Point = z.infer<typeof PointSchema>;

export const ViewportStateSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  zoom: z.number().finite().positive(),
});

export type ViewportState = z.infer<typeof ViewportStateSchema>;

export const PresenceSchema = z.object({
  user: PresenceUserSchema,
  cursor: PointSchema.nullable(),
  selection: z.array(z.string().min(1)),
  tool: ToolIdSchema,
  dragging: z
    .object({
      ids: z.array(z.string().min(1)),
      dx: z.number().finite(),
      dy: z.number().finite(),
    })
    .optional(),
  viewport: ViewportStateSchema.optional(),
});

export type Presence = z.infer<typeof PresenceSchema>;
