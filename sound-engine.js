/* ============================================================
   PAPERUSS 2.0 — WORKSPACE INTERACTION SOUND ENGINE
   Zero-dependency, offline-first Web Audio API Synthesizer
   ============================================================ */

(function(window) {
  'use strict';

  const STORAGE_KEY_ENABLED = 'paperuss_sound_enabled';
  const STORAGE_KEY_DRAG_ENABLED = 'paperuss_sound_drag_enabled';
  const STORAGE_KEY_VOLUME = 'paperuss_sound_volume';
  const STORAGE_KEY_PRESET = 'paperuss_sound_preset';

  let audioCtx = null;
  let enabled = localStorage.getItem(STORAGE_KEY_ENABLED) !== 'false';
  let dragEnabled = localStorage.getItem(STORAGE_KEY_DRAG_ENABLED) !== 'false';
  let volume = parseFloat(localStorage.getItem(STORAGE_KEY_VOLUME) || '0.25');
  let preset = localStorage.getItem(STORAGE_KEY_PRESET) || 'botanical_paper';

  function getAudioContext() {
    if (!audioCtx && (window.AudioContext || window.webkitAudioContext)) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioContextClass();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  function initAudioOnUserInteraction() {
    const handler = () => {
      getAudioContext();
      window.removeEventListener('pointerdown', handler);
      window.removeEventListener('keydown', handler);
    };
    window.addEventListener('pointerdown', handler, { once: true });
    window.addEventListener('keydown', handler, { once: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAudioOnUserInteraction);
  } else {
    initAudioOnUserInteraction();
  }

  const WorkspaceAudio = {
    isEnabled: () => enabled,
    isDragEnabled: () => dragEnabled,
    getVolume: () => volume,
    getPreset: () => preset,

    setEnabled(val) {
      enabled = !!val;
      localStorage.setItem(STORAGE_KEY_ENABLED, enabled ? 'true' : 'false');
    },

    setDragEnabled(val) {
      dragEnabled = !!val;
      localStorage.setItem(STORAGE_KEY_DRAG_ENABLED, dragEnabled ? 'true' : 'false');
    },

    setVolume(val) {
      volume = Math.max(0, Math.min(1, parseFloat(val) || 0));
      localStorage.setItem(STORAGE_KEY_VOLUME, volume.toString());
    },

    setPreset(name) {
      if (['botanical_paper', 'warm_wood', 'minimal_tone'].includes(name)) {
        preset = name;
        localStorage.setItem(STORAGE_KEY_PRESET, preset);
      }
    },

    playLeafSwitch() {
      if (!enabled) return;
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      const freqMultiplier = preset === 'warm_wood' ? 0.8 : (preset === 'minimal_tone' ? 1.2 : 1.0);
      osc.type = preset === 'warm_wood' ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(140 * freqMultiplier, now);
      osc.frequency.exponentialRampToValueAtTime(70 * freqMultiplier, now + 0.04);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(350, now);

      gain.gain.setValueAtTime(volume * 0.45, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.05);
    },

    playBranchCreate() {
      if (!enabled) return;
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      [528, 660, 792].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const start = now + (idx * 0.03);

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, start);

        gain.gain.setValueAtTime(volume * 0.35, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.18);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(start);
        osc.stop(start + 0.2);
      });
    },

    playTaskCheck() {
      if (!enabled) return;
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      const notes = [523.25, 783.99];
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const start = now + (idx * 0.05);

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, start);

        gain.gain.setValueAtTime(volume * 0.4, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.15);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(start);
        osc.stop(start + 0.16);
      });
    },

    playModalSlide() {
      if (!enabled) return;
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(110, now);
      osc.frequency.exponentialRampToValueAtTime(240, now + 0.035);

      gain.gain.setValueAtTime(volume * 0.35, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.045);
    },

    playSavePing() {
      if (!enabled) return;
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(520, now);

      gain.gain.setValueAtTime(volume * 0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.13);
    },

    playDragStart() {
      if (!enabled || !dragEnabled) return;
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(160, now);
      osc.frequency.exponentialRampToValueAtTime(280, now + 0.03);

      gain.gain.setValueAtTime(volume * 0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.04);
    },

    playDragHover() {
      if (!enabled || !dragEnabled) return;
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(320, now);

      gain.gain.setValueAtTime(volume * 0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.015);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.02);
    },

    playDragDrop() {
      if (!enabled || !dragEnabled) return;
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(90, now + 0.04);

      gain.gain.setValueAtTime(volume * 0.45, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.05);
    },

    playDragCancel() {
      if (!enabled || !dragEnabled) return;
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(120, now + 0.05);

      gain.gain.setValueAtTime(volume * 0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.06);
    },

    playTestSound() {
      this.playTaskCheck();
    }
  };

  window.WorkspaceAudio = WorkspaceAudio;

})(typeof window !== 'undefined' ? window : this);
