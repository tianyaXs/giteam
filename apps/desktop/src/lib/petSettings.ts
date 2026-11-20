import type {
  BotAvatarFace,
  BotAvatarGlasses,
  BotAvatarHat,
  BotAvatarShading,
  BotAvatarType,
} from "bot-avatars";

export const PET_TYPES = [
  "clover", "flower", "triangle", "square", "blob", "ghost", "circle", "drop", "star",
  "droid", "mech", "alien", "hexagon", "cat", "cloud", "pill", "pebble", "puddle",
] as const satisfies readonly BotAvatarType[];

type _PetTypesMatch =
  BotAvatarType extends (typeof PET_TYPES)[number]
    ? (typeof PET_TYPES)[number] extends BotAvatarType
      ? true
      : never
    : never;

export const PET_SETTINGS_KEY = "giteam.settings.pet.v1";
export const PET_SETTINGS_EVENT = "giteam-pet-settings";

export const PET_SHADINGS = ["fabric", "plastic", "crisp", "smooth", "flat"] as const;
export const PET_FACES = ["eyes", "mouth"] as const;
export const PET_HATS = ["none", "beret", "beanie", "party", "crown"] as const;
export const PET_GLASSES = ["none", "round", "square", "shades"] as const;

export const PET_SIZE_MIN = 112;
export const PET_SIZE_MAX = 240;
export const PET_SLEEP_MIN = 1;
export const PET_SLEEP_MAX = 240;

export type PetSettings = {
  enabled: boolean;
  type: BotAvatarType;
  shading: BotAvatarShading;
  face: BotAvatarFace;
  hat: BotAvatarHat;
  glasses: BotAvatarGlasses;
  headphones: boolean;
  bowTie: boolean;
  /** 空字符串表示跟随造型的默认配色。 */
  color: string;
  /** 空字符串表示配件用默认颜色。 */
  accessoryColor: string;
  /** 头像逻辑像素边长。窗口会比它更大，给跳跃留出空间。 */
  size: number;
  /** 没有操作超过这么多分钟后休眠。 */
  sleepMinutes: number;
};

export const DEFAULT_PET_SETTINGS: PetSettings = {
  enabled: true,
  type: "circle",
  shading: "flat",
  face: "eyes",
  hat: "none",
  glasses: "none",
  headphones: false,
  bowTie: false,
  color: "",
  accessoryColor: "",
  size: 168,
  sleepMinutes: 5,
};

const SHAPE_LABELS: Record<BotAvatarType, string> = {
  clover: "四叶草",
  flower: "花朵",
  triangle: "三角",
  square: "方块",
  blob: "团子",
  ghost: "幽灵",
  circle: "圆球",
  drop: "水滴",
  star: "星星",
  droid: "机器人",
  mech: "机甲",
  alien: "外星人",
  hexagon: "六边形",
  cat: "猫咪",
  cloud: "云朵",
  pill: "胶囊",
  pebble: "卵石",
  puddle: "水洼",
};

const SHADING_LABELS: Record<BotAvatarShading, string> = {
  fabric: "绒布",
  plastic: "亮面塑料",
  crisp: "锐利边缘",
  smooth: "柔和表面",
  flat: "哑光",
};

const FACE_LABELS: Record<BotAvatarFace, string> = {
  eyes: "眼睛",
  mouth: "眼睛和嘴巴",
};

const HAT_LABELS: Record<BotAvatarHat, string> = {
  none: "无",
  beret: "贝雷帽",
  beanie: "毛线帽",
  party: "派对帽",
  crown: "皇冠",
};

const GLASSES_LABELS: Record<BotAvatarGlasses, string> = {
  none: "无",
  round: "圆框",
  square: "方框",
  shades: "墨镜",
};

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function normalizeHex(value: unknown): string {
  if (typeof value !== "string") return "";
  const text = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(text) ? text.toLowerCase() : "";
}

export function normalizePetSettings(value: unknown): PetSettings {
  const raw = value && typeof value === "object" ? (value as Partial<PetSettings>) : {};
  return {
    enabled: raw.enabled !== false,
    type: oneOf(raw.type, PET_TYPES, DEFAULT_PET_SETTINGS.type),
    shading: oneOf(raw.shading, PET_SHADINGS, DEFAULT_PET_SETTINGS.shading),
    face: oneOf(raw.face, PET_FACES, DEFAULT_PET_SETTINGS.face),
    hat: oneOf(raw.hat, PET_HATS, DEFAULT_PET_SETTINGS.hat),
    glasses: oneOf(raw.glasses, PET_GLASSES, DEFAULT_PET_SETTINGS.glasses),
    headphones: raw.headphones === true,
    bowTie: raw.bowTie === true,
    color: normalizeHex(raw.color),
    accessoryColor: normalizeHex(raw.accessoryColor),
    size: clampInt(raw.size, PET_SIZE_MIN, PET_SIZE_MAX, DEFAULT_PET_SETTINGS.size),
    sleepMinutes: clampInt(raw.sleepMinutes, PET_SLEEP_MIN, PET_SLEEP_MAX, DEFAULT_PET_SETTINGS.sleepMinutes),
  };
}

export function loadPetSettings(): PetSettings {
  try {
    const raw = window.localStorage.getItem(PET_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_PET_SETTINGS };
    return normalizePetSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_PET_SETTINGS };
  }
}

export function savePetSettings(next: PetSettings): PetSettings {
  const normalized = normalizePetSettings(next);
  try {
    window.localStorage.setItem(PET_SETTINGS_KEY, JSON.stringify(normalized));
  } catch {
    // ignore unavailable storage
  }
  window.dispatchEvent(new CustomEvent(PET_SETTINGS_EVENT, { detail: normalized }));
  return normalized;
}

export function shapeLabel(type: BotAvatarType): string {
  return SHAPE_LABELS[type] ?? type;
}

export function shadingLabel(shading: BotAvatarShading): string {
  return SHADING_LABELS[shading] ?? shading;
}

export function faceLabel(face: BotAvatarFace): string {
  return FACE_LABELS[face] ?? face;
}

export function hatLabel(hat: BotAvatarHat): string {
  return HAT_LABELS[hat] ?? hat;
}

export function glassesLabel(glasses: BotAvatarGlasses): string {
  return GLASSES_LABELS[glasses] ?? glasses;
}
