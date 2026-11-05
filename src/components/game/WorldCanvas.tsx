import { Lock, MapPin, Package } from 'lucide-react';
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { COOLER_BY_ID, GPU_BY_ID, PSU_BY_ID, RACK_BY_ID } from '../../config/hardwareCatalog';
import { ROOM_BY_ID, ROOM_ORDER } from '../../config/roomsCatalog';
import { computePadLayout, ParticleSystem, PixelCanvas, WALL_H, WORLD_H, WORLD_W, type PadSlot } from '../../engine/PixelCanvas';
import {
  drawPixelText,
  fanSlotRect,
  gpuSlotRect,
  hash01,
  measurePixelText,
  PSU_RECT,
  px,
  RACK_H,
  RACK_W,
  sprites,
} from '../../engine/SpriteManager';
import { padCount } from '../../store/slices/roomsSlice';
import type { GameStore } from '../../store/storeTypes';
import { useGameShallow, useGameStore } from '../../store/useGameStore';
import type { RackInstance, RackStatus } from '../../types/hardware';
import type { RoomId } from '../../types/player';
import { fxBus } from '../../utils/eventBus';
import { cn } from '../../utils/cn';
import { formatCash, formatHashrate, formatNumber, formatPower, formatTemp, tempColor } from '../../utils/formatters';
import { PixelButton } from '../ui/PixelButton';

const SHIRTS = ['#ef4444', '#22c55e', '#3b82f6', '#f97316', '#a855f7', '#14b8a6'];
const STATUS_LABEL: Partial<Record<RackStatus, { text: string; color: string }>> = {
  no_psu: { text: 'NO PSU', color: '#fbbf24' },
  overload: { text: 'OVERLOAD', color: '#f43f5e' },
  overheat: { text: 'OVERHEAT', color: '#f43f5e' },
  rebooting: { text: 'REBOOT', color: '#60a5fa' },
  blackout: { text: 'NO POWER', color: '#94a3b8' },
  empty: { text: 'EMPTY', color: '#8f89c4' },
};

interface Tech {
  x: number;
  y: number;
  tx: number;
  ty: number;
  mode: 'walk' | 'work' | 'idle';
  timer: number;
  dir: 1 | -1;
  shirt: string;
  rackUid: string | null;
}

interface Inspector {
  room: RoomId;
  x: number;
  y: number;
  tx: number;
  ty: number;
  mode: 'walk' | 'check' | 'leave';
  timer: number;
  dir: 1 | -1;
  target: string | null;
}

interface Inspection {
  until: number;
  /** Racks the inspector already tagged with caution tape. */
  taped: Set<string>;
}

type StatusIconKind = 'overheat' | 'overload' | 'no_psu' | 'reboot';
const STATUS_ICON: Partial<Record<RackStatus, StatusIconKind>> = {
  overheat: 'overheat',
  overload: 'overload',
  no_psu: 'no_psu',
  rebooting: 'reboot',
};

const easeOutBack = (k: number) => 1 + 2.4 * (k - 1) ** 3 + 1.4 * (k - 1) ** 2;

interface HoverTarget {
  kind: 'rack' | 'pad';
  pad: PadSlot;
  rackUid: string | null;
}

const shortHash = (h: number) => formatHashrate(h).replace(' ', '').replace('H/s', '');

function rackAt(s: GameStore, roomId: RoomId): Map<number, RackInstance> {
  const map = new Map<number, RackInstance>();
  Object.values(s.racks).forEach((r) => {
    if (r.roomId === roomId && r.pad !== null) map.set(r.pad, r);
  });
  return map;
}

/** Room ambience painted every frame on top of the cached background. */
function drawRoomLife(ctx: CanvasRenderingContext2D, roomId: RoomId, t: number, dt: number, s: GameStore, ps: ParticleSystem): void {
  const fx = s.settings.particles;
  switch (roomId) {
    case 'bedroom': {
      for (let i = 0; i < 9; i += 1) {
        const on = Math.sin(t * (1.5 + hash01('star', i) * 2) + i) > -0.2;
        if (on) px(ctx, 305 + Math.floor(hash01('sx', i) * 60), 16 + Math.floor(hash01('sy', i) * 18), 1, 1, '#fef9c3');
      }
      px(ctx, 352, 19, 5, 5, '#fef3c7');
      px(ctx, 351, 20, 1, 3, '#fef3c7');
      px(ctx, 354, 19, 3, 2, '#0b1026');
      // Rain on the window panes, with the odd lightning flash
      const storm = t % 11;
      if (storm < 0.1 || (storm > 0.2 && storm < 0.28)) {
        ctx.globalAlpha = 0.5;
        px(ctx, 303, 15, 64, 44, '#c7d2fe');
        ctx.globalAlpha = 0.05;
        px(ctx, 0, 0, WORLD_W, WORLD_H, '#e0e7ff');
      }
      ctx.globalAlpha = 0.7;
      for (let i = 0; i < 30; i += 1) {
        const dx = 303 + Math.floor(hash01('rain', i) * 64);
        if (dx === 334 || dx === 335) continue;
        const dy = 15 + ((hash01('ry', i) * 44 + t * (70 + hash01('rv', i) * 40)) % 44);
        px(ctx, dx, dy, 1, Math.min(3, 59 - dy), '#93c5fd');
      }
      for (let i = 0; i < 5; i += 1) {
        const dy = 15 + ((t * (2 + i) + hash01('dy', i) * 44) % 44);
        px(ctx, 306 + Math.floor(hash01('drip', i) * 58), dy, 1, 2, '#dbeafe');
      }
      ctx.globalAlpha = 1;
      // Desk CRT shows the live $CC chart
      const candles = s.market.CC.candles.slice(-34);
      const lo = Math.min(...candles.map((c) => c.l));
      const hi = Math.max(...candles.map((c) => c.h));
      candles.forEach((c, i) => {
        const y = 142 - ((c.c - lo) / Math.max(1e-9, hi - lo)) * 20;
        px(ctx, 409 + i, y, 1, 1, c.c >= c.o ? '#4ade80' : '#f87171');
      });
      if (Math.floor(t * 2) % 2 === 0) px(ctx, 440, 122, 2, 2, '#4ade80');
      break;
    }
    case 'garage': {
      const sway = Math.sin(t * 1.2) * 3;
      px(ctx, 250 + sway / 2, 0, 1, 18, '#18181b');
      px(ctx, 247 + sway, 18, 7, 6, '#fef08a');
      px(ctx, 248 + sway, 24, 5, 2, '#fde047');
      ctx.globalAlpha = 0.06;
      ctx.fillStyle = '#fef9c3';
      ctx.beginPath();
      ctx.moveTo(250 + sway, 24);
      ctx.lineTo(120 + sway * 4, WORLD_H);
      ctx.lineTo(380 + sway * 4, WORLD_H);
      ctx.fill();
      ctx.globalAlpha = 1;
      // Welder at the workbench: arc flicker + spark shower
      const welding = t % 4 < 2.6;
      ctx.drawImage(sprites.welder(welding ? Math.floor(t * 12) : 0), 82, 126);
      if (welding) {
        const flick = hash01('arc', Math.floor(t * 30));
        ctx.globalAlpha = 0.12 + flick * 0.12;
        ctx.drawImage(sprites.glow(18, '#bae6fd'), 81 - 18, 130 - 18);
        ctx.globalAlpha = 0.45 + flick * 0.4;
        ctx.drawImage(sprites.glow(5, '#a5f3fc'), 81 - 5, 130 - 5);
        ctx.globalAlpha = 1;
        px(ctx, 80, 129, 2, 2, flick > 0.3 ? '#ffffff' : '#cffafe');
        if (fx && Math.random() < dt * 22) ps.spark(81, 130);
      }
      break;
    }
    case 'warehouse': {
      [106, 326].forEach((x, i) => {
        px(ctx, x - 2, 18, 25, 25, '#1e293b');
        ctx.drawImage(sprites.fan(21, Math.floor(t * 10) + i, '#94a3b8', '#475569'), x, 20);
      });
      // Forklift shuttling crates along the back aisle
      const lap = t % 44;
      const right = lap < 22;
      const fxPos = right ? -40 + (lap / 22) * 560 : 520 - ((lap - 22) / 22) * 560;
      const fl = sprites.forklift(Math.floor(fxPos / 3));
      const fy = 98;
      ctx.globalAlpha = 0.3;
      px(ctx, fxPos + 1, fy + 20, 32, 3, '#000000');
      ctx.globalAlpha = 1;
      ctx.save();
      if (right) ctx.drawImage(fl, Math.round(fxPos), fy);
      else {
        ctx.translate(Math.round(fxPos) + 34, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(fl, 0, fy);
      }
      ctx.restore();
      const bx = right ? Math.round(fxPos) + 12 : Math.round(fxPos) + 19;
      const on = Math.floor(t * 4) % 2 === 0;
      px(ctx, bx, fy, 3, 2, on ? '#fb923c' : '#7c2d12');
      if (on) {
        ctx.globalAlpha = 0.3;
        px(ctx, bx - 2, fy - 2, 7, 5, '#fdba74');
        ctx.globalAlpha = 1;
      }
      break;
    }
    case 'arctic': {
      // Aurora borealis behind the peaks (cached frames), then the window mullion again
      ctx.globalAlpha = 0.75;
      ctx.drawImage(sprites.aurora(Math.floor(t * 4)), 153, 11);
      ctx.globalAlpha = 1;
      px(ctx, 239, 11, 2, 52, '#64748b');
      for (let i = 0; i < 34; i += 1) {
        const fx = 153 + ((hash01('snow', i) * 174 + t * (6 + hash01('w', i) * 8)) % 174);
        const fy = 11 + ((hash01('sny', i) * 52 + t * (10 + hash01('v', i) * 10)) % 52);
        px(ctx, fx, fy, 1, 1, '#ffffff');
      }
      break;
    }
    case 'submarine': {
      [96, 240, 384].forEach((cx, k) => {
        for (let i = 0; i < 3; i += 1) {
          const fy = 40 + Math.round((hash01('fy', i + k * 3) - 0.5) * 18);
          const speed = 6 + hash01('fs', i + k) * 10;
          const fxp = cx - 14 + ((t * speed + hash01('fx', i + k * 7) * 28) % 28);
          const color = ['#fb923c', '#facc15', '#a3e635'][i];
          if (Math.hypot(fxp - cx, fy - 40) < 12) {
            px(ctx, fxp, fy, 3, 2, color);
            px(ctx, fxp - 1, fy, 1, 2, shadeTail(color));
          }
        }
        const by = 52 - ((t * 9 + k * 5) % 24);
        px(ctx, cx + Math.round(Math.sin(t + k) * 4), by, 1, 1, '#bae6fd');
      });
      // Sonar: rotating sweep with afterglow, fading contacts and a ping ring
      const scx = 446;
      const scy = 39;
      const sweep = t * 1.8;
      for (let k = 3; k >= 0; k -= 1) {
        const a = sweep - k * 0.13;
        ctx.globalAlpha = k === 0 ? 1 : 0.5 - k * 0.13;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        for (let r = 1; r <= 12; r += 1) px(ctx, scx + Math.round(ca * r), scy + Math.round(sa * r), 1, 1, '#34d399');
      }
      for (let i = 0; i < 3; i += 1) {
        const ang = hash01('blip', i) * Math.PI * 2;
        const rad = 3 + hash01('blipr', i) * 8;
        const since = ((((sweep - ang) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2);
        if (since > 0.75) continue;
        ctx.globalAlpha = 1 - since / 0.75;
        px(ctx, scx + Math.round(Math.cos(ang) * rad), scy + Math.round(Math.sin(ang) * rad), 2, 2, '#a7f3d0');
      }
      const pt = t % 3.2;
      if (pt < 1.4) {
        const rr = (pt / 1.4) * 13;
        ctx.globalAlpha = 1 - pt / 1.4;
        for (let k = 0; k < 28; k += 1) {
          const a = (k / 28) * Math.PI * 2;
          px(ctx, scx + Math.round(Math.cos(a) * rr), scy + Math.round(Math.sin(a) * rr), 1, 1, '#5eead4');
        }
      }
      ctx.globalAlpha = 1;
      break;
    }
    default:
      break;
  }
}

const shadeTail = (c: string) => (c === '#fb923c' ? '#c2410c' : c === '#facc15' ? '#a16207' : '#4d7c0f');

export function WorldCanvas() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pcRef = useRef<PixelCanvas | null>(null);
  const particles = useRef(new ParticleSystem());
  const techs = useRef<Tech[]>([]);
  const coinTimers = useRef(new Map<string, number>());
  const inspections = useRef(new Map<RoomId, Inspection>());
  const inspector = useRef<Inspector | null>(null);
  /** Solo-block celebration start time (-1 = starts on the next frame). */
  const celebration = useRef<number | null>(null);
  const hoverRef = useRef<HoverTarget | null>(null);
  const [hover, setHover] = useState<{ target: HoverTarget; left: number; top: number } | null>(null);
  const [placing, setPlacing] = useState<{ pad: number; left: number; top: number } | null>(null);

  const ui = useGameShallow((s) => ({
    activeRoom: s.activeRoom,
    ownedRooms: s.ownedRooms,
    racks: s.racks,
    talents: s.talents,
  }));
  const { setActiveRoom, selectRack, placeRack, setSideTab } = useGameStore.getState();

  // ── FX bus: solo block celebration & raid inspections ──
  useEffect(
    () =>
      fxBus.on((fx) => {
        if (fx.kind === 'raid') {
          const prev = inspections.current.get(fx.roomId);
          const live = prev && prev.until > Date.now();
          inspections.current.set(fx.roomId, { until: Math.max(fx.until, prev?.until ?? 0), taped: live ? prev.taped : new Set() });
          return;
        }
        if (fx.kind !== 'block') return;
        celebration.current = -1;
        const s = useGameStore.getState();
        if (!s.settings.particles) return;
        const pads = computePadLayout(padCount(s.activeRoom, s.talents));
        rackAt(s, s.activeRoom).forEach((_r, padIdx) => {
          const pad = pads[padIdx];
          if (!pad) return;
          for (let i = 0; i < 12; i += 1) particles.current.block(pad.x + 20, pad.y, 10, 10, 1 + Math.random() * 0.6);
          for (let i = 0; i < 6; i += 1) particles.current.coin(pad.x + 20, pad.y, 10, 10);
        });
        for (let i = 0; i < 28; i += 1) particles.current.block(WORLD_W / 2, 118, 10, 10, 1.4 + Math.random());
        for (let i = 0; i < 24; i += 1) particles.current.sparkle(WORLD_W / 2 + (Math.random() - 0.5) * 170, 96 + Math.random() * 36, i % 2 ? '#67e8f9' : '#fef08a');
      }),
    [],
  );

  // ── Canvas lifecycle & render loop ──
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return undefined;
    const pc = new PixelCanvas(canvas, WORLD_W, WORLD_H);
    pcRef.current = pc;
    const ro = new ResizeObserver(() => pc.resize(wrap.clientWidth, wrap.clientHeight));
    ro.observe(wrap);
    pc.resize(wrap.clientWidth, wrap.clientHeight);

    const render = (ctx: CanvasRenderingContext2D, t: number, dt: number) => {
      const s = useGameStore.getState();
      const roomId = s.activeRoom;
      const roomLive = s.live.rooms[roomId];
      const pads = computePadLayout(padCount(roomId, s.talents));
      const byPad = rackAt(s, roomId);
      const hovered = hoverRef.current;
      const fx = s.settings.particles;

      ctx.drawImage(sprites.roomBackground(roomId, WORLD_W, WORLD_H, WALL_H), 0, 0);
      drawRoomLife(ctx, roomId, t, dt, s, particles.current);

      // Empty pads
      pads.forEach((pad) => {
        if (byPad.has(pad.index)) return;
        const isHover = hovered?.kind === 'pad' && hovered.pad.index === pad.index;
        const pulse = 0.35 + 0.25 * Math.sin(t * 3 + pad.index);
        ctx.globalAlpha = isHover ? 0.95 : pulse;
        const c = isHover ? '#22d3ee' : '#e9e6ff';
        const by = pad.y + RACK_H - 10;
        for (let x = 0; x < RACK_W; x += 4) {
          px(ctx, pad.x + x, by, 2, 1, c);
          px(ctx, pad.x + x, by + 9, 2, 1, c);
        }
        for (let y = 0; y < 10; y += 3) {
          px(ctx, pad.x, by + y, 1, 2, c);
          px(ctx, pad.x + RACK_W - 1, by + y, 1, 2, c);
        }
        px(ctx, pad.x + 19, by + 2, 2, 6, c);
        px(ctx, pad.x + 16, by + 4, 8, 2, c);
        ctx.globalAlpha = 1;
      });

      const inspection = inspections.current.get(roomId);
      const insp = inspection && inspection.until > Date.now() ? inspection : null;

      // Racks
      byPad.forEach((rack, padIdx) => {
        const pad = pads[padIdx];
        if (!pad) return;
        const x = pad.x;
        const y = pad.y;
        const model = RACK_BY_ID[rack.modelId];
        const live = s.live.racks[rack.uid];
        const status: RackStatus = live?.status ?? 'empty';
        const powered = status === 'online' || status === 'overheat';

        ctx.globalAlpha = 0.35;
        px(ctx, x - 3, y + RACK_H - 2, RACK_W + 6, 4, '#000000');
        ctx.globalAlpha = 1;
        ctx.drawImage(sprites.rackBody(model.style, model.slots, model.fanSlots), x, y);

        rack.gpuSlots.forEach((uid, i) => {
          if (!uid) return;
          const g = s.gpus[uid];
          if (!g) return;
          const r = gpuSlotRect(model.slots, i);
          const gl = s.live.gpus[uid];
          const gm = GPU_BY_ID[g.modelId];
          sprites.drawGpu(ctx, gm, x + r.x, y + r.y, r.w, r.h, t, {
            running: !!gl?.running, load: gl?.load ?? 0, temp: g.temp, shutdown: g.shutdown, throttled: !!gl?.throttled,
          });
          if (gl?.running && gl.throttled) {
            // Red heat shimmer: wobbling translucent scanlines
            ctx.globalAlpha = 0.16 + 0.1 * Math.sin(t * 7 + i);
            for (let k = 0; k < r.h; k += 1) {
              const off = Math.round(Math.sin(t * 9 + k * 1.3 + i * 0.7));
              px(ctx, x + r.x + 1 + off, y + r.y + k, r.w - 2, 1, k % 2 ? '#f97316' : '#ef4444');
            }
            ctx.globalAlpha = 1;
          } else if (gl?.running && g.ocBonus > 0) {
            // Overclock glow: pulsing accent edges + a light sweep across the card
            const pulse = 0.5 + 0.5 * Math.sin(t * 5 + i * 0.9 + padIdx);
            ctx.globalAlpha = 0.45 + 0.45 * pulse;
            px(ctx, x + r.x - 1, y + r.y, 1, r.h, gm.palette.accent);
            ctx.globalAlpha = 0.2 + 0.3 * pulse;
            px(ctx, x + r.x, y + r.y, r.w, 1, gm.palette.accent);
            px(ctx, x + r.x, y + r.y + r.h - 1, r.w, 1, gm.palette.accent);
            const ph = ((t + i * 0.37 + padIdx * 0.61) % 1.8) / 1.8;
            if (ph < 0.6) {
              const sx = Math.floor((ph / 0.6) * (r.w + 2)) - 2;
              const x0 = Math.max(0, sx);
              const x1 = Math.min(r.w, sx + 2);
              ctx.globalAlpha = 0.45;
              if (x1 > x0) px(ctx, x + r.x + x0, y + r.y, x1 - x0, r.h, '#ffffff');
            }
            ctx.globalAlpha = 1;
          }
          if (status === 'rebooting') {
            ctx.globalAlpha = 0.85;
            px(ctx, x + r.x, y + r.y, r.w, r.h, '#1d4ed8');
            ctx.globalAlpha = 1;
            if (r.h >= 5) px(ctx, x + r.x + 3, y + r.y + 1, 1, Math.max(1, r.h - 3), '#ffffff');
          }
          if (fx && g.temp > 85 && Math.random() < dt * 4) particles.current.smoke(x + r.x + r.w / 2, y + r.y);
          if (fx && g.temp > 90 && Math.random() < dt * 3) particles.current.spark(x + r.x + Math.random() * r.w, y + r.y + r.h / 2);
        });

        rack.fanSlots.forEach((uid, i) => {
          if (!uid || !s.coolers[uid]) return;
          const cm = COOLER_BY_ID[s.coolers[uid].modelId];
          const r = fanSlotRect(i);
          const speed = cm.kind === 'immersion' ? 5 : cm.kind === 'cryo' ? 3 : 16;
          ctx.drawImage(sprites.cooler(cm, r.w, r.h, powered ? Math.floor(t * speed) + i : 0), x + r.x, y + r.y);
          if (fx && powered && cm.kind === 'cryo' && Math.random() < dt * 2) particles.current.sparkle(x + r.x + 4, y + r.y + 2, '#e0f2fe');
        });

        if (model.selfPowered) {
          const glow = 0.5 + 0.5 * Math.sin(t * 4);
          px(ctx, x + PSU_RECT.x, y + PSU_RECT.y, PSU_RECT.w, PSU_RECT.h, '#713f12');
          ctx.globalAlpha = 0.5 + glow * 0.5;
          px(ctx, x + PSU_RECT.x + 1, y + PSU_RECT.y + 1, PSU_RECT.w - 2, PSU_RECT.h - 2, '#facc15');
          ctx.globalAlpha = 1;
          if (fx && Math.random() < dt * 2.5) particles.current.sparkle(x + Math.random() * RACK_W, y + Math.random() * RACK_H);
        } else if (rack.psuUid && s.psus[rack.psuUid]) {
          ctx.drawImage(sprites.psu(PSU_BY_ID[s.psus[rack.psuUid].modelId], PSU_RECT.w, PSU_RECT.h), x + PSU_RECT.x, y + PSU_RECT.y);
          const led = powered ? '#22c55e' : status === 'overload' ? (Math.floor(t * 6) % 2 ? '#ef4444' : '#450a0a') : '#3f3f46';
          px(ctx, x + PSU_RECT.x + PSU_RECT.w - 3, y + PSU_RECT.y + 1, 2, 2, led);
        }

        if (status === 'rebooting' && insp?.taped.has(rack.uid)) ctx.drawImage(sprites.cautionTape(), x, y);

        // Activity LEDs
        for (let k = 0; k < 6; k += 1) {
          let c = '#27272a';
          if (powered) c = hash01(rack.uid, k + Math.floor(t * 9)) > 0.45 ? '#22c55e' : '#14532d';
          else if (status === 'overload') c = Math.floor(t * 6) % 2 ? '#ef4444' : '#450a0a';
          else if (status === 'rebooting') c = Math.floor(t * 10) % 6 === k ? '#fbbf24' : '#422006';
          px(ctx, x + 4 + k * 4, y + 3, 2, 2, c);
        }
        // Voltage gauge needle
        const ratio = live && Number.isFinite(live.capacity) && live.capacity > 0 ? Math.min(1.1, live.load / live.capacity) : powered ? 0.35 : 0;
        const ang = Math.PI - ratio * Math.PI;
        for (let k = 1; k <= 4; k += 1) px(ctx, x + 32 + Math.cos(ang) * k, y + 6 - Math.sin(ang) * k * 0.9, 1, 1, ratio > 0.9 ? '#ef4444' : '#111827');

        // Status & labels
        const anyShutdown = rack.gpuSlots.some((u) => u && s.gpus[u]?.shutdown);
        const lbl = STATUS_LABEL[status] ?? (anyShutdown ? { text: 'HOT!', color: '#ef4444' } : undefined);
        const icon = STATUS_ICON[status] ?? (anyShutdown && status === 'online' ? 'overheat' : undefined);
        if (lbl) {
          // Icon stays on (so the state reads at a glance); the label blinks next to it.
          const tw = measurePixelText(lbl.text);
          const left = Math.round(x + RACK_W / 2 - (icon ? tw + 11 : tw) / 2);
          if (icon) {
            const bob = icon === 'reboot' ? 0 : Math.floor(t * 4) % 2;
            ctx.drawImage(sprites.statusIcon(icon, Math.floor(t * (icon === 'reboot' ? 12 : 5))), left, y - 10 - bob);
          }
          if (status === 'empty' || Math.floor(t * 2) % 2 === 0) drawPixelText(ctx, lbl.text, icon ? left + 11 : left, y - 8, lbl.color, { shadow: '#000000' });
        }
        if (live && live.maxTemp > 0) drawPixelText(ctx, `${Math.round(live.maxTemp)}°`, x, y + RACK_H + 1, tempColor(live.maxTemp), { shadow: '#000000' });
        if (live && live.hash > 0) drawPixelText(ctx, shortHash(live.hash), x + RACK_W, y + RACK_H + 1, '#a3e635', { align: 'right', shadow: '#000000' });

        if (hovered?.kind === 'rack' && hovered.rackUid === rack.uid) {
          const c = Math.floor(t * 4) % 2 ? '#22d3ee' : '#67e8f9';
          px(ctx, x - 2, y - 2, RACK_W + 4, 1, c);
          px(ctx, x - 2, y + RACK_H + 1, RACK_W + 4, 1, c);
          px(ctx, x - 2, y - 2, 1, RACK_H + 4, c);
          px(ctx, x + RACK_W + 1, y - 2, 1, RACK_H + 4, c);
        }

        // Floating rewards towards the in-canvas counter
        if (fx && powered && live && live.hash > 0 && s.pool !== 'solo') {
          const tm = (coinTimers.current.get(rack.uid) ?? Math.random()) + dt;
          const interval = s.pool === 'darknet' ? 0.9 : 1.6;
          if (tm > interval) {
            particles.current.coin(x + 20, y + 4, 12, 9);
            coinTimers.current.set(rack.uid, 0);
          } else coinTimers.current.set(rack.uid, tm);
        } else if (fx && powered && live && live.hash > 0 && Math.random() < dt * 0.25) {
          particles.current.text(x + 20, y - 2, 'SHARE', '#22d3ee');
        }
      });

      // Technicians
      const want = s.technicians;
      while (techs.current.length < want) {
        const i = techs.current.length;
        techs.current.push({ x: i % 2 ? WORLD_W + 8 : -8, y: 262, tx: WORLD_W / 2, ty: 262, mode: 'walk', timer: 0, dir: 1, shirt: SHIRTS[i % SHIRTS.length], rackUid: null });
      }
      if (techs.current.length > want) techs.current.length = want;
      const rackList = [...byPad.entries()];
      techs.current.forEach((tech, i) => {
        if (tech.mode === 'walk') {
          const dx = tech.tx - tech.x;
          const dy = tech.ty - tech.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 1.5) {
            tech.mode = tech.rackUid ? 'work' : 'idle';
            tech.timer = tech.rackUid ? 2.5 + Math.random() * 2 : 0.8 + Math.random();
          } else {
            const sp = 30 * dt;
            tech.x += (dx / dist) * Math.min(sp, dist);
            tech.y += (dy / dist) * Math.min(sp, dist);
            tech.dir = dx >= 0 ? 1 : -1;
          }
        } else {
          tech.timer -= dt;
          if (tech.mode === 'work' && fx && Math.random() < dt * 3) particles.current.sparkle(tech.x + tech.dir * 5, tech.y - 9, '#fef08a');
          if (tech.timer <= 0) {
            const pick = rackList.length ? rackList[Math.floor(Math.random() * rackList.length)] : null;
            const pad = pick ? pads[pick[0]] : null;
            if (pad && pick) {
              const side = Math.random() < 0.5 ? -1 : 1;
              tech.tx = side < 0 ? pad.x - 6 : pad.x + RACK_W + 6;
              tech.ty = pad.y + RACK_H + 2;
              tech.rackUid = pick[1].uid;
            } else {
              tech.tx = 40 + Math.random() * (WORLD_W - 80);
              tech.ty = WALL_H + 120 + Math.random() * 60;
              tech.rackUid = null;
            }
            tech.mode = 'walk';
          }
        }
        const walkFrame = tech.mode === 'walk' ? Math.floor(t * 8 + i) : Math.floor(t * 4);
        const spr = sprites.technician(walkFrame, tech.shirt, tech.mode === 'work');
        ctx.save();
        if (tech.dir < 0) {
          ctx.translate(Math.round(tech.x) + 5, 0);
          ctx.scale(-1, 1);
          ctx.drawImage(spr, 0, Math.round(tech.y) - 16);
        } else {
          ctx.drawImage(spr, Math.round(tech.x) - 5, Math.round(tech.y) - 16);
        }
        ctx.restore();
      });

      // Electrical inspector (darknet raid): walks to every rebooting rack and tapes it off
      if (inspector.current && inspector.current.room !== roomId) inspector.current = null;
      if (insp && !inspector.current) inspector.current = { room: roomId, x: -10, y: 262, tx: -10, ty: 262, mode: 'check', timer: 0, dir: 1, target: null };
      const cop = inspector.current;
      if (cop) {
        if (cop.mode === 'check') {
          cop.timer -= dt;
          if (cop.timer <= 0) {
            if (cop.target) insp?.taped.add(cop.target);
            let next: { uid: string; pad: PadSlot; d: number } | null = null;
            if (insp) {
              for (const [padIdx, rack] of byPad) {
                const pad = pads[padIdx];
                if (!pad || insp.taped.has(rack.uid) || s.live.racks[rack.uid]?.status !== 'rebooting') continue;
                const d = Math.hypot(pad.x + RACK_W + 6 - cop.x, pad.y + RACK_H + 2 - cop.y);
                if (!next || d < next.d) next = { uid: rack.uid, pad, d };
              }
            }
            if (next) {
              cop.target = next.uid;
              cop.tx = next.pad.x + RACK_W + 6;
              cop.ty = next.pad.y + RACK_H + 2;
              cop.mode = 'walk';
            } else {
              cop.target = null;
              cop.tx = cop.x < WORLD_W / 2 ? -14 : WORLD_W + 14;
              cop.ty = 262;
              cop.mode = 'leave';
            }
          }
        } else {
          const dx = cop.tx - cop.x;
          const dy = cop.ty - cop.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 1.5) {
            if (cop.mode === 'leave') inspector.current = null;
            else {
              cop.mode = 'check';
              cop.timer = 1.1;
              cop.dir = -1;
            }
          } else {
            const sp = 46 * dt;
            cop.x += (dx / dist) * Math.min(sp, dist);
            cop.y += (dy / dist) * Math.min(sp, dist);
            cop.dir = dx >= 0 ? 1 : -1;
          }
        }
        const checking = cop.mode === 'check' && cop.target !== null;
        const spr = sprites.inspector(checking ? Math.floor(t * 5) : Math.floor(t * 8), checking);
        const ix = Math.round(cop.x);
        const iy = Math.round(cop.y) - 17;
        ctx.save();
        if (cop.dir < 0) {
          ctx.translate(ix + 6, 0);
          ctx.scale(-1, 1);
          ctx.drawImage(spr, 0, iy);
        } else ctx.drawImage(spr, ix - 5, iy);
        ctx.restore();
        if (checking) {
          px(ctx, ix - 3, iy - 9, 7, 7, '#f8fafc');
          px(ctx, ix - 2, iy - 2, 2, 1, '#f8fafc');
          drawPixelText(ctx, Math.floor(t * 3) % 2 ? '!' : '?', ix - 1, iy - 8, '#b91c1c');
        }
      }

      // Particles
      particles.current.update(dt);
      particles.current.draw(
        ctx,
        t,
        (p, frame) => ctx.drawImage(p.kind === 'coin' ? sprites.coin(frame) : sprites.dataBlock(), Math.round(p.x - 3), Math.round(p.y - 3)),
        (p) => drawPixelText(ctx, p.text ?? '', p.x, p.y, p.color, { align: 'center', shadow: '#000000' }),
      );

      // Environmental overlays
      const ev = s.event;
      if (ev?.id === 'heatwave') {
        ctx.globalAlpha = 0.08 + 0.03 * Math.sin(t * 2);
        px(ctx, 0, 0, WORLD_W, WORLD_H, '#f97316');
        ctx.globalAlpha = 1;
      } else if (ev?.id === 'cold_snap') {
        ctx.globalAlpha = 0.1;
        px(ctx, 0, 0, WORLD_W, WORLD_H, '#38bdf8');
        ctx.globalAlpha = 1;
      }
      if (roomLive?.blackout) {
        ctx.globalAlpha = 0.62;
        px(ctx, 0, 0, WORLD_W, WORLD_H, '#020617');
        ctx.globalAlpha = 1;
        if (Math.floor(t * 2) % 2 === 0) {
          px(ctx, 6, 6, 6, 4, '#ef4444');
          px(ctx, WORLD_W - 12, 6, 6, 4, '#ef4444');
        }
        drawPixelText(ctx, 'BLACKOUT - GRID DOWN', WORLD_W / 2, 100, '#f87171', { align: 'center', scale: 2, shadow: '#000000' });
      } else if (roomLive && roomLive.brownout < 1 && Math.floor(t * 2) % 2 === 0) {
        drawPixelText(ctx, `BROWNOUT ${Math.round(roomLive.brownout * 100)}% - LINE OVERLOADED`, WORLD_W / 2, WALL_H + 4, '#fbbf24', { align: 'center', shadow: '#000000' });
      }

      // Raid strobe: red / blue halves swapping at 2 Hz (low alpha), hazard strip + beacons
      if (insp) {
        const blue = Math.floor(t * 2) % 2 === 1;
        ctx.globalAlpha = blue ? 0.12 : 0.17;
        px(ctx, blue ? WORLD_W / 2 : 0, 0, WORLD_W / 2, WORLD_H, blue ? '#3b82f6' : '#ef4444');
        ctx.globalAlpha = 0.05;
        px(ctx, 0, 0, WORLD_W, WORLD_H, blue ? '#3b82f6' : '#ef4444');
        ctx.globalAlpha = 1;
        ctx.drawImage(sprites.hazardStrip(WORLD_W), 0, 19);
        const label = `ELECTRICAL INSPECTION ${Math.max(0, Math.ceil((insp.until - Date.now()) / 1000))}S`;
        const bw = measurePixelText(label) + 12;
        const bx = Math.round(WORLD_W / 2 - bw / 2);
        px(ctx, bx, 17, bw, 13, '#07060f');
        px(ctx, bx, 17, bw, 1, '#facc15');
        px(ctx, bx, 29, bw, 1, '#facc15');
        drawPixelText(ctx, label, WORLD_W / 2, 21, '#facc15', { align: 'center' });
        const lit = Math.floor(t * 8) % 2 === 0;
        [bx - 18, bx + bw + 4].forEach((lx) => {
          px(ctx, lx - 1, 19, 16, 9, '#111827');
          px(ctx, lx, 20, 7, 6, !blue && lit ? '#ef4444' : '#450a0a');
          px(ctx, lx + 7, 20, 7, 6, blue && lit ? '#60a5fa' : '#172554');
          if (lit) {
            px(ctx, lx + (blue ? 9 : 2), 21, 2, 2, '#ffffff');
            ctx.globalAlpha = 0.3;
            px(ctx, lx + (blue ? 5 : -2), 16, 11, 14, blue ? '#93c5fd' : '#fca5a5');
            ctx.globalAlpha = 1;
          }
        });
      } else if (inspection) {
        inspections.current.delete(roomId);
      }

      // In-canvas counter (coins fly here)
      ctx.globalAlpha = 0.82;
      px(ctx, 3, 3, 118, 13, '#07060f');
      ctx.globalAlpha = 1;
      px(ctx, 3, 3, 118, 1, '#3a3470');
      ctx.drawImage(sprites.coin(Math.floor(t * 6)), 6, 6);
      drawPixelText(ctx, `${formatNumber(s.cc)} CC`, 16, 7, '#facc15');
      drawPixelText(ctx, shortHash(s.live.totalHash), 118, 7, '#a3e635', { align: 'right' });

      // Solo block celebration: white flash, shockwave ring, bouncing ribbon banner
      if (celebration.current !== null) {
        if (celebration.current < 0) celebration.current = t;
        const e = t - celebration.current;
        if (e > 3.2) celebration.current = null;
        else {
          if (e < 0.45) {
            ctx.globalAlpha = (1 - e / 0.45) * 0.7;
            px(ctx, 0, 0, WORLD_W, WORLD_H, '#ffffff');
          }
          if (e < 1.4) {
            ctx.globalAlpha = 0.14 * (1 - e / 1.4);
            px(ctx, 0, 0, WORLD_W, WORLD_H, '#facc15');
          }
          if (e < 0.9) {
            const rr = 8 + (e / 0.9) * 250;
            ctx.globalAlpha = 1 - e / 0.9;
            const n = 96;
            for (let k = 0; k < n; k += 1) {
              const a = (k / n) * Math.PI * 2;
              px(ctx, WORLD_W / 2 + Math.cos(a) * rr, 110 + Math.sin(a) * rr * 0.6, 2, 2, k % 2 ? '#67e8f9' : '#fef08a');
            }
          }
          ctx.globalAlpha = 1;
          const banner = sprites.blockBanner();
          const rest = 92;
          const by = Math.round(e < 0.4 ? -40 + (rest + 40) * easeOutBack(e / 0.4) : e < 2.8 ? rest + (Math.floor(e * 3) % 2) : rest - ((e - 2.8) / 0.4) * 140);
          const bxl = Math.round(WORLD_W / 2 - banner.width / 2);
          ctx.drawImage(banner, bxl, by);
          if (e > 0.45 && e < 1.25) {
            // Shine sweeping across the ribbon
            const sx = bxl + 10 + ((e - 0.45) / 0.8) * (banner.width - 20);
            ctx.save();
            ctx.beginPath();
            ctx.rect(bxl + 10, by + 4, banner.width - 20, 22);
            ctx.clip();
            ctx.globalAlpha = 0.55;
            for (let k = 0; k < 22; k += 1) px(ctx, sx - k * 0.5, by + 4 + k, 3, 1, '#ffffff');
            ctx.restore();
          }
          if (e > 0.4 && e < 2.8) {
            drawPixelText(ctx, 'SOLO JACKPOT!', WORLD_W / 2, by + 36, '#fef08a', { align: 'center', shadow: '#000000' });
          }
          if (s.settings.particles && e < 2.6 && Math.random() < dt * 18) {
            particles.current.sparkle(bxl + Math.random() * banner.width, by + (Math.random() < 0.5 ? 0 : 32), Math.random() < 0.5 ? '#fef08a' : '#67e8f9');
          }
        }
      }
    };

    pc.start(render);
    return () => {
      pc.stop();
      ro.disconnect();
    };
  }, []);

  // ── Pointer interaction ──
  const hitTest = (clientX: number, clientY: number): HoverTarget | null => {
    const pc = pcRef.current;
    if (!pc) return null;
    const { x, y } = pc.toWorld(clientX, clientY);
    const s = useGameStore.getState();
    const pads = computePadLayout(padCount(s.activeRoom, s.talents));
    const byPad = rackAt(s, s.activeRoom);
    for (const pad of pads) {
      const rack = byPad.get(pad.index);
      if (rack && x >= pad.x - 2 && x <= pad.x + RACK_W + 2 && y >= pad.y - 10 && y <= pad.y + RACK_H + 8) return { kind: 'rack', pad, rackUid: rack.uid };
      if (!rack && x >= pad.x && x <= pad.x + RACK_W && y >= pad.y + RACK_H - 22 && y <= pad.y + RACK_H + 2) return { kind: 'pad', pad, rackUid: null };
    }
    return null;
  };

  const onMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const target = hitTest(e.clientX, e.clientY);
    const prev = hoverRef.current;
    hoverRef.current = target;
    if (target?.kind !== prev?.kind || target?.pad.index !== prev?.pad.index) {
      if (target && pcRef.current) {
        const right = pcRef.current.toCss(target.pad.x + RACK_W + 6, target.pad.y);
        const wrapW = wrapRef.current?.clientWidth ?? 9999;
        const canvasLeft = canvasRef.current?.offsetLeft ?? 0;
        const left = canvasLeft + right.left + 216 > wrapW ? canvasLeft + pcRef.current.toCss(target.pad.x - 6, 0).left - 214 : canvasLeft + right.left;
        setHover({ target, left: Math.max(4, left), top: (canvasRef.current?.offsetTop ?? 0) + right.top });
      } else setHover(null);
    }
  };

  const onClick = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    const target = hitTest(e.clientX, e.clientY);
    if (!target) {
      setPlacing(null);
      return;
    }
    if (target.kind === 'rack' && target.rackUid) {
      setPlacing(null);
      selectRack(target.rackUid);
    } else if (pcRef.current) {
      const pos = pcRef.current.toCss(target.pad.x + RACK_W / 2, target.pad.y + RACK_H - 12);
      setPlacing({ pad: target.pad.index, left: (canvasRef.current?.offsetLeft ?? 0) + pos.left, top: (canvasRef.current?.offsetTop ?? 0) + pos.top });
    }
  };

  const storedRacks = Object.values(ui.racks).filter((r) => r.roomId === null);
  const nextRoom = ROOM_ORDER.find((id) => !ui.ownedRooms.includes(id));

  return (
    <section className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1">
        {ROOM_ORDER.filter((id) => ui.ownedRooms.includes(id)).map((id) => (
          <PixelButton key={id} size="sm" variant={id === ui.activeRoom ? 'primary' : 'secondary'} onClick={() => setActiveRoom(id)} silent>
            <MapPin size={12} /> {ROOM_BY_ID[id].name}
          </PixelButton>
        ))}
        {nextRoom && (
          <PixelButton size="sm" variant="ghost" onClick={() => setSideTab('shop')} title="Buy it in the Shop → Rooms">
            <Lock size={12} /> {ROOM_BY_ID[nextRoom].name} · {formatCash(ROOM_BY_ID[nextRoom].price)}
          </PixelButton>
        )}
        <span className="ml-auto hidden font-silk text-[10px] text-dim sm:inline">
          {ROOM_BY_ID[ui.activeRoom].subtitle} · {padCount(ui.activeRoom, ui.talents)} pads
        </span>
      </div>

      <div ref={wrapRef} className="pixel-box relative grid aspect-[16/9] max-h-[68vh] w-full place-items-center overflow-hidden bg-black">
        <canvas
          ref={canvasRef}
          className="pixelated block cursor-pointer"
          onPointerMove={onMove}
          onPointerLeave={() => {
            hoverRef.current = null;
            setHover(null);
          }}
          onClick={onClick}
          aria-label="Mining room view"
        />

        {hover && !placing && <HoverCard target={hover.target} left={hover.left} top={hover.top} />}

        {placing && (
          <div
            className="pixel-box pixel-box-hi pop-in absolute z-10 w-64 p-3"
            style={{ left: Math.max(8, Math.min(placing.left - 128, (wrapRef.current?.clientWidth ?? 400) - 272)), top: Math.max(8, placing.top - 150) }}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="font-pixel text-[9px] text-neon">PAD #{placing.pad + 1}</span>
              <button type="button" className="text-dim hover:text-ink" onClick={() => setPlacing(null)}>
                ✕
              </button>
            </div>
            {storedRacks.length ? (
              <div className="retro-scroll flex max-h-40 flex-col gap-1 overflow-y-auto">
                {storedRacks.map((r) => {
                  const m = RACK_BY_ID[r.modelId];
                  return (
                    <button
                      key={r.uid}
                      type="button"
                      className="flex items-center gap-2 bg-panel-2 px-2 py-1 text-left hover:bg-panel-3"
                      onClick={() => {
                        placeRack(r.uid, ui.activeRoom, placing.pad);
                        setPlacing(null);
                      }}
                    >
                      <img src={sprites.rackIcon(r.modelId)} alt="" className="pixelated h-8 w-5" />
                      <span className="text-[17px] leading-none">
                        {m.name}
                        <span className="block text-[14px] text-dim">{r.gpuSlots.filter(Boolean).length}/{m.slots} GPUs</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col gap-2 text-[17px] leading-tight text-dim">
                <span className="flex items-center gap-1">
                  <Package size={14} /> No racks in storage.
                </span>
                <PixelButton size="sm" variant="primary" onClick={() => { setSideTab('shop'); setPlacing(null); }}>
                  Open shop
                </PixelButton>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function HoverCard({ target, left, top }: { target: HoverTarget; left: number; top: number }) {
  const data = useGameShallow((s) => {
    const rack = target.rackUid ? s.racks[target.rackUid] : null;
    return { rack, live: rack ? s.live.racks[rack.uid] : undefined, gpus: s.gpus };
  });
  if (target.kind === 'pad') {
    return (
      <div className="pointer-events-none absolute z-10 bg-black/85 px-2 py-1 text-[16px] text-neon shadow-[0_0_0_2px_#22d3ee]" style={{ left, top }}>
        Empty pad — click to place a rack
      </div>
    );
  }
  if (!data.rack) return null;
  const m = RACK_BY_ID[data.rack.modelId];
  const status = data.live?.status ?? 'empty';
  return (
    <div className={cn('pointer-events-none absolute z-10 w-52 bg-black/90 p-2 shadow-[0_0_0_2px_#3a3470]')} style={{ left, top }}>
      <div className="font-pixel text-[9px] text-ink">{m.name}</div>
      <div className="mt-1 grid grid-cols-2 gap-x-2 text-[16px] leading-tight">
        <span className="text-dim">Status</span>
        <span style={{ color: status === 'online' ? '#a3e635' : '#fbbf24' }}>{status.replace('_', ' ').toUpperCase()}</span>
        <span className="text-dim">Hashrate</span>
        <span className="text-lime">{formatHashrate(data.live?.hash ?? 0)}</span>
        <span className="text-dim">Hottest</span>
        <span style={{ color: tempColor(data.live?.maxTemp ?? 0) }}>{formatTemp(data.live?.maxTemp ?? 0)}</span>
        <span className="text-dim">PSU load</span>
        <span>
          {formatPower(data.live?.load ?? 0)}
          {data.live && Number.isFinite(data.live.capacity) ? ` / ${formatPower(data.live.capacity)}` : ''}
        </span>
        <span className="text-dim">GPUs</span>
        <span>
          {data.rack.gpuSlots.filter(Boolean).length}/{m.slots}
        </span>
      </div>
      <div className="mt-1 font-silk text-[9px] text-neon">Click to open rack</div>
    </div>
  );
}
