import { useCallback, useEffect } from 'react';
import { useGameStore } from '../store/useGameStore';
import { sfxBus, type SfxCue } from '../utils/eventBus';

interface ToneOpts {
  freq: number;
  to?: number;
  type?: OscillatorType;
  dur: number;
  gain?: number;
  delay?: number;
  attack?: number;
}

interface NoiseOpts {
  dur: number;
  gain?: number;
  delay?: number;
  filter?: BiquadFilterType;
  freq?: number;
}

/**
 * Procedural chiptune SFX engine built purely on the Web Audio API.
 * No samples are loaded: every sound is synthesized from oscillators and noise.
 */
class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private humGain: GainNode | null = null;
  private humSource: AudioBufferSourceNode | null = null;
  private volume = 0.6;
  private muted = false;
  private humLevel = 0;
  private humEnabled = true;
  private lastPlayed = new Map<SfxCue, number>();

  private ensure(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.applyVolume();
      const len = this.ctx.sampleRate * 2;
      this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  unlock(): void {
    this.ensure();
    this.syncHum();
  }

  private applyVolume(): void {
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume * 0.5, this.ctx.currentTime, 0.02);
  }

  configure(volume: number, muted: boolean, humEnabled: boolean): void {
    this.volume = volume;
    this.muted = muted;
    this.humEnabled = humEnabled;
    this.applyVolume();
    this.syncHum();
  }

  setHumLevel(level: number): void {
    this.humLevel = Math.max(0, Math.min(1, level));
    this.syncHum();
  }

  private syncHum(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noiseBuffer) return;
    if (!this.humSource) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 220;
      lp.Q.value = 0.8;
      this.humGain = ctx.createGain();
      this.humGain.gain.value = 0;
      src.connect(lp).connect(this.humGain).connect(this.master);
      src.start();
      this.humSource = src;
    }
    const target = this.humEnabled ? this.humLevel * 0.12 : 0;
    this.humGain?.gain.setTargetAtTime(target, ctx.currentTime, 0.4);
  }

  private tone({ freq, to, type = 'square', dur, gain = 0.25, delay = 0, attack = 0.004 }: ToneOpts): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private noise({ dur, gain = 0.2, delay = 0, filter = 'highpass', freq = 2000 }: NoiseOpts): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noiseBuffer) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.02);
  }

  private arp(notes: number[], step: number, type: OscillatorType = 'square', gain = 0.18): void {
    notes.forEach((n, i) => this.tone({ freq: n, type, dur: step * 1.6, gain, delay: i * step }));
  }

  play(cue: SfxCue): void {
    if (this.muted) return;
    const ctx = this.ensure();
    if (!ctx) return;
    // Rate-limit spammy cues.
    const nowMs = performance.now();
    const minGap = cue === 'coin' || cue === 'click' ? 40 : cue === 'sell' ? 90 : 120;
    if (nowMs - (this.lastPlayed.get(cue) ?? 0) < minGap) return;
    this.lastPlayed.set(cue, nowMs);

    switch (cue) {
      case 'click':
        this.noise({ dur: 0.02, gain: 0.25, freq: 4000 });
        this.tone({ freq: 1400, type: 'square', dur: 0.03, gain: 0.08 });
        break;
      case 'switch':
        this.noise({ dur: 0.018, gain: 0.35, freq: 3500 });
        this.tone({ freq: 220, to: 90, type: 'square', dur: 0.05, gain: 0.12, delay: 0.012 });
        this.noise({ dur: 0.012, gain: 0.2, freq: 5000, delay: 0.05 });
        break;
      case 'install':
        this.noise({ dur: 0.03, gain: 0.3, freq: 2500 });
        this.tone({ freq: 300, to: 620, type: 'square', dur: 0.08, gain: 0.12, delay: 0.02 });
        break;
      case 'buy':
        this.arp([523, 659, 784], 0.055);
        break;
      case 'sell':
        this.tone({ freq: 988, type: 'square', dur: 0.06, gain: 0.14 });
        this.tone({ freq: 1319, type: 'square', dur: 0.12, gain: 0.14, delay: 0.06 });
        break;
      case 'coin':
        this.tone({ freq: 1568, to: 2093, type: 'triangle', dur: 0.06, gain: 0.08 });
        break;
      case 'block':
        this.arp([523, 659, 784, 1047, 1319, 1568], 0.06, 'triangle', 0.22);
        this.noise({ dur: 0.4, gain: 0.08, freq: 6000, delay: 0.3 });
        break;
      case 'alarm':
        [0, 0.18, 0.36].forEach((d) => {
          this.tone({ freq: 880, type: 'square', dur: 0.08, gain: 0.12, delay: d });
          this.tone({ freq: 660, type: 'square', dur: 0.08, gain: 0.12, delay: d + 0.09 });
        });
        break;
      case 'raid':
        [0, 0.5].forEach((d) => {
          this.tone({ freq: 420, to: 920, type: 'sawtooth', dur: 0.25, gain: 0.12, delay: d });
          this.tone({ freq: 920, to: 420, type: 'sawtooth', dur: 0.25, gain: 0.12, delay: d + 0.25 });
        });
        break;
      case 'event':
        this.tone({ freq: 440, type: 'triangle', dur: 0.3, gain: 0.2 });
        this.tone({ freq: 554, type: 'triangle', dur: 0.3, gain: 0.2, delay: 0.15 });
        this.tone({ freq: 659, type: 'triangle', dur: 0.45, gain: 0.2, delay: 0.3 });
        break;
      case 'shutdown':
        this.tone({ freq: 440, to: 50, type: 'sawtooth', dur: 0.7, gain: 0.18 });
        this.noise({ dur: 0.3, gain: 0.15, filter: 'lowpass', freq: 800, delay: 0.1 });
        break;
      case 'restart':
        this.tone({ freq: 220, to: 660, type: 'square', dur: 0.18, gain: 0.1 });
        break;
      case 'error':
        this.tone({ freq: 150, type: 'square', dur: 0.1, gain: 0.16 });
        this.tone({ freq: 110, type: 'square', dur: 0.14, gain: 0.16, delay: 0.1 });
        break;
      case 'bsod':
        this.tone({ freq: 70, type: 'sawtooth', dur: 0.8, gain: 0.25 });
        this.noise({ dur: 0.5, gain: 0.3, filter: 'bandpass', freq: 1200 });
        this.tone({ freq: 1000, type: 'square', dur: 0.12, gain: 0.08, delay: 0.9 });
        break;
      case 'success':
        this.arp([660, 880, 1320], 0.07, 'triangle', 0.2);
        break;
      case 'unlock':
        this.arp([784, 988, 1175, 1568], 0.07, 'square', 0.14);
        break;
      case 'halving':
        this.arp([1047, 784, 523, 392, 523, 784, 1047, 1568, 2093], 0.09, 'triangle', 0.22);
        this.tone({ freq: 65, type: 'sawtooth', dur: 1.2, gain: 0.15 });
        break;
      case 'contract':
        // Two-bar "order fulfilled" fanfare.
        this.arp([392, 523, 659], 0.07, 'square', 0.13);
        this.tone({ freq: 784, type: 'triangle', dur: 0.32, gain: 0.2, delay: 0.24 });
        this.tone({ freq: 1047, type: 'triangle', dur: 0.4, gain: 0.16, delay: 0.32 });
        break;
      case 'claim':
        // Cash-register: drawer clunk + bell.
        this.noise({ dur: 0.05, gain: 0.3, filter: 'lowpass', freq: 900 });
        this.tone({ freq: 1760, type: 'triangle', dur: 0.25, gain: 0.16, delay: 0.05 });
        this.tone({ freq: 2637, type: 'triangle', dur: 0.35, gain: 0.12, delay: 0.1 });
        break;
      case 'boot':
        this.tone({ freq: 1000, type: 'square', dur: 0.14, gain: 0.1 });
        break;
      case 'start':
        // Title screen "insert coin": PC speaker beep, then a rising power-on arpeggio.
        this.tone({ freq: 1000, type: 'square', dur: 0.08, gain: 0.08 });
        this.arp([262, 392, 523, 784], 0.06, 'square', 0.12);
        this.tone({ freq: 1047, type: 'triangle', dur: 0.35, gain: 0.16, delay: 0.26 });
        break;
      default:
        break;
    }
  }
}

export const audioEngine = new AudioEngine();

/** Returns a stable `play(cue)` function. */
export function useAudioFx(): { play: (cue: SfxCue) => void } {
  const play = useCallback((cue: SfxCue) => audioEngine.play(cue), []);
  return { play };
}

/** Mount once: routes store SFX cues to the engine and syncs settings & fan hum. */
export function useSfxBridge(): void {
  const volume = useGameStore((s) => s.settings.volume);
  const muted = useGameStore((s) => s.settings.muted);
  const hum = useGameStore((s) => s.settings.ambientHum);

  useEffect(() => {
    audioEngine.configure(volume, muted, hum);
  }, [volume, muted, hum]);

  useEffect(() => {
    const off = sfxBus.on((cue) => audioEngine.play(cue));
    const unlock = () => audioEngine.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    const humTimer = setInterval(() => {
      const s = useGameStore.getState();
      // Rigs are not running behind the title menu: no fan hum there.
      const room = s.screen === 'game' ? s.live.rooms[s.activeRoom] : undefined;
      const capacity = room?.capacity ?? 1;
      audioEngine.setHumLevel(room ? Math.min(1, 0.25 + (room.load / capacity) * 1.5) * (room.racksOnline > 0 ? 1 : 0) : 0);
    }, 1000);
    return () => {
      off();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      clearInterval(humTimer);
    };
  }, []);
}
