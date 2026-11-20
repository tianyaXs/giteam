import { useEffect, useState, type ReactNode } from "react";
import { BotAvatar, botAvatarPalette } from "bot-avatars";
import type { GeneralSettingsDraft } from "./SettingsDialog";
import { cn } from "../../lib/utils";
import { getPetActivitySnapshot, subscribePetActivity } from "../../lib/petActivity";
import {
  faceLabel,
  glassesLabel,
  hatLabel,
  loadPetSettings,
  PET_FACES,
  PET_GLASSES,
  PET_HATS,
  PET_SHADINGS,
  PET_SIZE_MAX,
  PET_SIZE_MIN,
  PET_SLEEP_MAX,
  PET_SLEEP_MIN,
  PET_TYPES,
  savePetSettings,
  shadingLabel,
  shapeLabel,
  type PetSettings,
} from "../../lib/petSettings";
import { resolvePetState, type PetMotionState } from "../../lib/petState";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "../ui/item";
import { SegmentedControl } from "../ui/segmented";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Slider } from "../ui/slider";
import { Switch } from "../ui/switch";

type PetLocale = "zh-CN" | "zh-TW" | "en-US";

const COPY = {
  "zh-CN": {
    title: "宠物",
    kicker: "桌面",
    description: "宠物单独悬浮在桌面上。主窗口不在前台、甚至收到托盘时，它也会留在屏幕上。点击打开客户端，拖动可以换位置。",
    enable: "显示桌面宠物",
    enableDesc: "关闭后悬浮窗会藏起来，外观设置仍会保留。",
    appearance: "形象",
    shape: "造型",
    shapeDesc: "十八种图形里选一只。",
    material: "材质",
    materialDesc: "绒布、塑料、锐利边缘、柔和表面或哑光。",
    face: "五官",
    faceDesc: "只画眼睛，或加上会随状态变化的嘴巴。",
    wear: "装扮",
    hat: "帽子",
    hatDesc: "戴在头顶，会跟着头一起转。",
    glasses: "眼镜",
    glassesDesc: "圆框、方框或墨镜。",
    headphones: "耳机",
    headphonesDesc: "头戴式耳机。",
    bowTie: "领结",
    bowTieDesc: "放在脸的下方。",
    color: "颜色",
    body: "身体颜色",
    bodyDesc: "留空则使用这个造型自己的颜色。",
    accessory: "配件颜色",
    accessoryDesc: "帽子、耳机和领结的颜色。皇冠保持金色。",
    usePalette: "跟随造型",
    useDefault: "默认",
    motion: "状态",
    sleep: "休眠时间",
    sleepDesc: "超过这么久没有操作就休眠。有会话正在运行时保持忙碌。",
    minutes: "分钟",
    size: "大小",
    sizeDesc: "桌面上的显示尺寸。",
    preview: "预览",
    stateDefault: "待机",
    stateWorking: "忙碌",
    stateSleeping: "休眠",
    stateHint: "有会话正在运行是忙碌；超过休眠时间没有操作是休眠；其余时间是待机。",
  },
  "zh-TW": {
    title: "寵物",
    kicker: "桌面",
    description: "寵物單獨懸浮在桌面上。主視窗不在前景、甚至收到托盤時，它也會留在螢幕上。點擊打開用戶端，拖動可以換位置。",
    enable: "顯示桌面寵物",
    enableDesc: "關閉後懸浮窗會藏起來，外觀設定仍會保留。",
    appearance: "形象",
    shape: "造型",
    shapeDesc: "十八種圖形裡選一隻。",
    material: "材質",
    materialDesc: "絨布、塑料、銳利邊緣、柔和表面或啞光。",
    face: "五官",
    faceDesc: "只畫眼睛，或加上會隨狀態變化的嘴巴。",
    wear: "裝扮",
    hat: "帽子",
    hatDesc: "戴在頭頂，會跟著頭一起轉。",
    glasses: "眼鏡",
    glassesDesc: "圓框、方框或墨鏡。",
    headphones: "耳機",
    headphonesDesc: "頭戴式耳機。",
    bowTie: "領結",
    bowTieDesc: "放在臉的下方。",
    color: "顏色",
    body: "身體顏色",
    bodyDesc: "留空則使用這個造型自己的顏色。",
    accessory: "配件顏色",
    accessoryDesc: "帽子、耳機和領結的顏色。皇冠保持金色。",
    usePalette: "跟隨造型",
    useDefault: "預設",
    motion: "狀態",
    sleep: "休眠時間",
    sleepDesc: "超過這麼久沒有操作就休眠。有會話正在執行時保持忙碌。",
    minutes: "分鐘",
    size: "大小",
    sizeDesc: "桌面上的顯示尺寸。",
    preview: "預覽",
    stateDefault: "待機",
    stateWorking: "忙碌",
    stateSleeping: "休眠",
    stateHint: "有會話正在執行是忙碌；超過休眠時間沒有操作是休眠；其餘時間是待機。",
  },
  "en-US": {
    title: "Pet",
    kicker: "Desktop",
    description: "The pet floats on its own window. It stays on screen when this window is in the background or tucked into the tray. Click it to open the app, and drag it to move it.",
    enable: "Show desktop pet",
    enableDesc: "Hiding it keeps the look you chose.",
    appearance: "Look",
    shape: "Shape",
    shapeDesc: "Pick one of the eighteen bodies.",
    material: "Material",
    materialDesc: "Fabric, plastic, crisp, smooth, or flat.",
    face: "Face",
    faceDesc: "Eyes only, or eyes with a mouth that follows the state.",
    wear: "Accessories",
    hat: "Hat",
    hatDesc: "Sits on the head and turns with it.",
    glasses: "Glasses",
    glassesDesc: "Round, square, or shades.",
    headphones: "Headphones",
    headphonesDesc: "Over-ear headphones.",
    bowTie: "Bow tie",
    bowTieDesc: "Sits under the face.",
    color: "Color",
    body: "Body color",
    bodyDesc: "Empty uses the shape’s own color.",
    accessory: "Accessory color",
    accessoryDesc: "Color for the hat, headphones, and bow tie. The crown stays gold.",
    usePalette: "Use shape color",
    useDefault: "Default",
    motion: "State",
    sleep: "Sleep after",
    sleepDesc: "Sleep when nothing happens for this long. A running session stays busy.",
    minutes: "min",
    size: "Size",
    sizeDesc: "How large it is on the desktop.",
    preview: "Preview",
    stateDefault: "Idle",
    stateWorking: "Busy",
    stateSleeping: "Asleep",
    stateHint: "A running session is busy. No activity past the sleep time is asleep. Otherwise it idles.",
  },
} as const;

function resolvePetLocale(language: GeneralSettingsDraft["language"]): PetLocale {
  if (language === "en-US" || language === "zh-TW" || language === "zh-CN") return language;
  const normalized = (navigator.language || "zh-CN").toLowerCase();
  if (normalized.startsWith("zh-tw") || normalized.startsWith("zh-hk")) return "zh-TW";
  if (normalized.startsWith("zh")) return "zh-CN";
  return "en-US";
}

export function petSectionMeta(language: GeneralSettingsDraft["language"]) {
  const copy = COPY[resolvePetLocale(language)];
  return { title: copy.title, kicker: copy.kicker, description: copy.description };
}

function stateLabel(copy: (typeof COPY)[PetLocale], state: PetMotionState): string {
  if (state === "working") return copy.stateWorking;
  if (state === "sleeping") return copy.stateSleeping;
  return copy.stateDefault;
}

function SettingsSelect(props: { label: string; value: string; onChange: (value: string) => void; options: Array<[string, string]> }) {
  return (
    <Select value={props.value} onValueChange={props.onChange}>
      <SelectTrigger className="h-8 w-40 rounded-md bg-muted/30 text-sm" aria-label={props.label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {props.options.map(([value, label]) => (
            <SelectItem key={value} value={value}>{label}</SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

export function PetSettingsSection(props: { language: GeneralSettingsDraft["language"] }) {
  const copy = COPY[resolvePetLocale(props.language)];
  const [settings, setSettings] = useState<PetSettings>(() => loadPetSettings());
  const live = useSyncActivity();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const update = (patch: Partial<PetSettings>) => {
    setSettings((current) => savePetSettings({ ...current, ...patch }));
  };

  const state = resolvePetState({
    busy: live.busy,
    lastActivityAt: live.lastActivityAt,
    now,
    sleepMinutes: settings.sleepMinutes,
  });
  const previewSize = Math.min(settings.size, 200);
  const bodyColor = hexColor(settings.color || botAvatarPalette[settings.type]);

  return (
    <div className="flex flex-col gap-6">
      <section className="overflow-hidden rounded-lg border border-black/[0.08] bg-card shadow-[var(--gt-elev-card)] dark:border-border/80 dark:shadow-none">
        <div className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
          <div>
            <div className="text-sm font-medium text-foreground">{copy.preview}</div>
            <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">{copy.stateHint}</p>
          </div>
          <div className="rounded-full bg-muted/70 px-2.5 py-1 text-[12px] font-medium text-foreground">{stateLabel(copy, state)}</div>
        </div>
        <div className="grid place-items-center px-4 py-6">
          <BotAvatar
            type={settings.type}
            state={state}
            shading={settings.shading}
            face={settings.face}
            hat={settings.hat}
            glasses={settings.glasses}
            headphones={settings.headphones}
            bowTie={settings.bowTie}
            color={settings.color || undefined}
            accessoryColor={settings.accessoryColor || undefined}
            size={previewSize}
            aria-label={`${shapeLabel(settings.type)}，${stateLabel(copy, state)}`}
          />
        </div>
      </section>

      <ItemGroup className="gap-2.5">
        <div className="px-1 text-sm font-medium text-muted-foreground">{copy.title}</div>
        <Row title={copy.enable} description={copy.enableDesc}>
          <Switch checked={settings.enabled} onCheckedChange={(checked) => update({ enabled: checked })} aria-label={copy.enable} />
        </Row>
      </ItemGroup>

      <ItemGroup className="gap-2.5">
        <div className="px-1 text-sm font-medium text-muted-foreground">{copy.appearance}</div>
        <div className="flex flex-col overflow-hidden rounded-lg border border-black/[0.08] bg-card shadow-[var(--gt-elev-card)] dark:border-border/80 dark:shadow-none">
          <Row bare title={copy.shape} description={copy.shapeDesc}>
            <SettingsSelect
              label={copy.shape}
              value={settings.type}
              onChange={(type) => update({ type: type as PetSettings["type"] })}
              options={PET_TYPES.map((type) => [type, shapeLabel(type)])}
            />
          </Row>
          <Row bare title={copy.material} description={copy.materialDesc}>
            <SettingsSelect
              label={copy.material}
              value={settings.shading}
              onChange={(shading) => update({ shading: shading as PetSettings["shading"] })}
              options={PET_SHADINGS.map((shading) => [shading, shadingLabel(shading)])}
            />
          </Row>
          <Row bare title={copy.face} description={copy.faceDesc}>
            <SegmentedControl
              group="pet-face"
              value={settings.face}
              onChange={(face) => update({ face })}
              options={PET_FACES.map((face) => ({ value: face, label: faceLabel(face) }))}
            />
          </Row>
        </div>
      </ItemGroup>

      <ItemGroup className="gap-2.5">
        <div className="px-1 text-sm font-medium text-muted-foreground">{copy.wear}</div>
        <div className="flex flex-col overflow-hidden rounded-lg border border-black/[0.08] bg-card shadow-[var(--gt-elev-card)] dark:border-border/80 dark:shadow-none">
          <Row bare title={copy.hat} description={copy.hatDesc}>
            <SettingsSelect
              label={copy.hat}
              value={settings.hat}
              onChange={(hat) => update({ hat: hat as PetSettings["hat"] })}
              options={PET_HATS.map((hat) => [hat, hatLabel(hat)])}
            />
          </Row>
          <Row bare title={copy.glasses} description={copy.glassesDesc}>
            <SettingsSelect
              label={copy.glasses}
              value={settings.glasses}
              onChange={(glasses) => update({ glasses: glasses as PetSettings["glasses"] })}
              options={PET_GLASSES.map((glasses) => [glasses, glassesLabel(glasses)])}
            />
          </Row>
          <Row bare title={copy.headphones} description={copy.headphonesDesc}>
            <Switch checked={settings.headphones} onCheckedChange={(checked) => update({ headphones: checked })} aria-label={copy.headphones} />
          </Row>
          <Row bare title={copy.bowTie} description={copy.bowTieDesc}>
            <Switch checked={settings.bowTie} onCheckedChange={(checked) => update({ bowTie: checked })} aria-label={copy.bowTie} />
          </Row>
        </div>
      </ItemGroup>

      <ItemGroup className="gap-2.5">
        <div className="px-1 text-sm font-medium text-muted-foreground">{copy.color}</div>
        <div className="flex flex-col overflow-hidden rounded-lg border border-black/[0.08] bg-card shadow-[var(--gt-elev-card)] dark:border-border/80 dark:shadow-none">
          <Row bare title={copy.body} description={copy.bodyDesc}>
            <ColorField
              label={copy.body}
              value={bodyColor}
              custom={Boolean(settings.color)}
              resetLabel={copy.usePalette}
              onChange={(color) => update({ color })}
              onReset={() => update({ color: "" })}
            />
          </Row>
          <Row bare title={copy.accessory} description={copy.accessoryDesc}>
            <ColorField
              label={copy.accessory}
              value={settings.accessoryColor || "#2b2b2b"}
              custom={Boolean(settings.accessoryColor)}
              resetLabel={copy.useDefault}
              onChange={(accessoryColor) => update({ accessoryColor })}
              onReset={() => update({ accessoryColor: "" })}
            />
          </Row>
        </div>
      </ItemGroup>

      <ItemGroup className="gap-2.5">
        <div className="px-1 text-sm font-medium text-muted-foreground">{copy.motion}</div>
        <div className="flex flex-col overflow-hidden rounded-lg border border-black/[0.08] bg-card shadow-[var(--gt-elev-card)] dark:border-border/80 dark:shadow-none">
          <Row bare title={copy.size} description={copy.sizeDesc}>
            <div className="flex w-44 items-center gap-3">
              <Slider
                min={PET_SIZE_MIN}
                max={PET_SIZE_MAX}
                step={4}
                value={[settings.size]}
                onValueChange={([size]) => { if (typeof size === "number") update({ size }); }}
                aria-label={copy.size}
              />
              <span className="w-10 text-right text-[13px] tabular-nums text-muted-foreground">{settings.size}</span>
            </div>
          </Row>
          <Row bare title={copy.sleep} description={copy.sleepDesc}>
            <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <Input
                type="number"
                min={PET_SLEEP_MIN}
                max={PET_SLEEP_MAX}
                inputMode="numeric"
                aria-label={copy.sleep}
                className="h-8 w-20 rounded-md bg-muted/30 text-sm"
                value={settings.sleepMinutes}
                onChange={(event) => {
                  const sleepMinutes = Number(event.target.value);
                  if (Number.isFinite(sleepMinutes)) update({ sleepMinutes });
                }}
              />
              {copy.minutes}
            </label>
          </Row>
        </div>
      </ItemGroup>
    </div>
  );
}

function useSyncActivity() {
  const [activity, setActivity] = useState(getPetActivitySnapshot);
  useEffect(() => subscribePetActivity(() => setActivity(getPetActivitySnapshot())), []);
  return activity;
}

function hexColor(value: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : "#888888";
}

function Row(props: { title: string; description: string; bare?: boolean; children: ReactNode }) {
  return (
    <Item
      variant="outline"
      className={cn(
        "gap-6 rounded-none border-0 px-4 py-3",
        props.bare ? "border-b last:border-b-0" : "rounded-lg border border-black/[0.08] bg-card shadow-[var(--gt-elev-card)] dark:border-border/80 dark:shadow-none"
      )}
    >
      <ItemContent className="min-w-0 gap-0.5">
        <ItemTitle className="leading-6 font-semibold">{props.title}</ItemTitle>
        <ItemDescription className="text-[13px] leading-5">{props.description}</ItemDescription>
      </ItemContent>
      <ItemActions className="shrink-0 justify-end">{props.children}</ItemActions>
    </Item>
  );
}

function ColorField(props: {
  label: string;
  value: string;
  custom: boolean;
  resetLabel: string;
  onChange: (value: string) => void;
  onReset: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        aria-label={props.label}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        className="h-8 w-10 cursor-pointer rounded-md border border-border/80 bg-transparent p-0.5"
      />
      <Button type="button" variant="ghost" size="sm" disabled={!props.custom} onClick={props.onReset}>
        {props.resetLabel}
      </Button>
    </div>
  );
}
