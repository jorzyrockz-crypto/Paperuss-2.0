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
  let enabled = localStorage.getItem(STORAGE_KEY_ENABLED) !== 'false'; // Default: enabled
  let dragEnabled = localStorage.getItem(STORAGE_KEY_DRAG_ENABLED) !== 'false'; // Default: enabled
  
  // Apply a 3x master boost because raw Web Audio sine/triangle waves at 0.2 amplitude are too quiet
  const MASTER_BOOST = 3.0;
  let rawVolume = parseFloat(localStorage.getItem(STORAGE_KEY_VOLUME) || '0.25'); // Default: 25%
  let volume = rawVolume * MASTER_BOOST;
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

  // Auto-resume AudioContext on first click or keypress
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

  function createMasterGain(ctx, duration) {
    const masterGain = ctx.createGain();
    const now = ctx.currentTime;
    masterGain.gain.setValueAtTime(volume, now);
    return masterGain;
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
      rawVolume = Math.max(0, Math.min(1, parseFloat(val) || 0));
      volume = rawVolume * MASTER_BOOST;
      localStorage.setItem(STORAGE_KEY_VOLUME, rawVolume.toString());
    },

    setPreset(name) {
      if (['botanical_paper', 'warm_wood', 'minimal_tone'].includes(name)) {
        preset = name;
        localStorage.setItem(STORAGE_KEY_PRESET, preset);
      }
    },

    // 🍃 1. Leaf Tab Switch — Soft paper / wood rustle
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

    // 🌲 2. Branch Create — Warm 528Hz acoustic harmonic chime
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

    // ☑️ 3. Task Complete — Ascending dual-tone pentatonic chime (C5 → G5)
    playTaskCheck() {
      if (!enabled) return;
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      const notes = [523.25, 783.99]; // C5, G5
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

    // 📲 4. Modal Open / Bottom Sheet Slide — Soft sine pop
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

    // 💾 5. Save Ping — Subtle 520Hz warm harmonic bell
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

    // 🤏 6. Drag Lift / Start — Soft magnetic lift tone
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

    // 🎯 7. Drag Hover / Target Switch — Micro-haptic tick
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

    // 📥 8. Drag Drop / Placement Snap — Satisfying wooden snap / paper drop
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

    // ↩️ 9. Drag Cancel / Revert — Gentle downward glide
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

    // 🗒️ 10. Note Switch — higher-pitched soft rustle (switching note cards)
    playNoteSwitch() {
      if (!enabled) return;
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const freqMult = preset === 'warm_wood' ? 0.75 : (preset === 'minimal_tone' ? 1.3 : 1.0);

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(180 * freqMult, now);
      osc.frequency.exponentialRampToValueAtTime(90 * freqMult, now + 0.055);

      filter.type = 'highpass';
      filter.frequency.setValueAtTime(500, now);

      gain.gain.setValueAtTime(volume * 0.38, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.065);
    },

    // 🗂️ 11. Leafline Nav — descending dual blip (breadcrumb navigation)
    playLeaflineNav() {
      if (!enabled) return;
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const freqMult = preset === 'warm_wood' ? 0.8 : (preset === 'minimal_tone' ? 1.2 : 1.0);

      [440 * freqMult, 300 * freqMult].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const start = now + idx * 0.04;

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, start);
        osc.frequency.exponentialRampToValueAtTime(freq * 0.75, start + 0.04);

        gain.gain.setValueAtTime(volume * 0.28, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.06);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.07);
      });
    },

    // 📐 12. Sidebar Toggle — low mechanical whoosh
    playSidebarToggle() {
      if (!enabled) return;
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const freqMult = preset === 'warm_wood' ? 0.7 : (preset === 'minimal_tone' ? 1.1 : 1.0);

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(80 * freqMult, now);
      osc.frequency.exponentialRampToValueAtTime(160 * freqMult, now + 0.07);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(600, now);

      gain.gain.setValueAtTime(volume * 0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.1);
    },

    // ❌ 13. Modal Close — gentle downward pop
    playModalClose() {
      if (!enabled) return;
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const freqMult = preset === 'warm_wood' ? 0.8 : (preset === 'minimal_tone' ? 1.2 : 1.0);

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(300 * freqMult, now);
      osc.frequency.exponentialRampToValueAtTime(120 * freqMult, now + 0.045);

      gain.gain.setValueAtTime(volume * 0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.055);
    },

    // 🗑️ 14. Delete Trash — muffled paper thud
    playDeleteTrash() {
      if (!enabled) return;
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      // Low body thud
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(100, now);
      osc.frequency.exponentialRampToValueAtTime(45, now + 0.06);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(400, now);

      gain.gain.setValueAtTime(volume * 0.5, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.08);

      // Noise crinkle layer
      const bufSize = ctx.sampleRate * 0.04;
      const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * 0.4;
      const noise = ctx.createBufferSource();
      noise.buffer = buf;
      const noiseGain = ctx.createGain();
      const noiseFilter = ctx.createBiquadFilter();
      noiseFilter.type = 'bandpass';
      noiseFilter.frequency.value = 800;
      noiseFilter.Q.value = 0.5;
      noiseGain.gain.setValueAtTime(volume * 0.18, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
      noise.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(ctx.destination);
      noise.start(now);
    },

    // 🖊️ 15. Tool Click — micro-haptic tick (toolbar buttons)
    playToolClick() {
      if (!enabled) return;
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(600, now);

      gain.gain.setValueAtTime(volume * 0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.015);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.018);
    },

    // 🔍 16. Search Pop — bright resonant ping
    playSearchPop() {
      if (!enabled) return;
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const freqMult = preset === 'warm_wood' ? 0.8 : (preset === 'minimal_tone' ? 1.3 : 1.0);

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(880 * freqMult, now);

      gain.gain.setValueAtTime(volume * 0.22, now);
      gain.gain.setValueAtTime(volume * 0.22, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.11);
    },

    // ⚠️ 17. Error Buzzer — low dull buzz
    playErrorBuzzer() {
      if (!enabled) return;
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(120, now);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(500, now);

      gain.gain.setValueAtTime(volume * 0.3, now);
      gain.gain.setValueAtTime(volume * 0.3, now + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.1);
    },

    // ☑️ 18. Checkbox Toggle — sharp pencil snap
    playCheckboxToggle() {
      if (!enabled) return;
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const freqMult = preset === 'warm_wood' ? 0.75 : (preset === 'minimal_tone' ? 1.2 : 1.0);

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(900 * freqMult, now);
      osc.frequency.exponentialRampToValueAtTime(600 * freqMult, now + 0.028);

      gain.gain.setValueAtTime(volume * 0.32, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.032);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.035);
    },

    // 📋 19. Copy/Paste — quick ascending zip
    playCopyPaste() {
      if (!enabled) return;
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const freqMult = preset === 'warm_wood' ? 0.85 : (preset === 'minimal_tone' ? 1.15 : 1.0);

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(300 * freqMult, now);
      osc.frequency.exponentialRampToValueAtTime(600 * freqMult, now + 0.04);

      gain.gain.setValueAtTime(volume * 0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.05);
    },

    // ↩️↪️ 20. Undo/Redo — short swoosh (direction-aware)
    playUndoRedo(isRedo = false) {
      if (!enabled) return;
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const freqMult = preset === 'warm_wood' ? 0.85 : (preset === 'minimal_tone' ? 1.15 : 1.0);

      const startFreq = isRedo ? 200 * freqMult : 350 * freqMult;
      const endFreq   = isRedo ? 350 * freqMult : 200 * freqMult;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(startFreq, now);
      osc.frequency.exponentialRampToValueAtTime(endFreq, now + 0.06);

      filter.type = 'bandpass';
      filter.frequency.value = 400;
      filter.Q.value = 0.8;

      gain.gain.setValueAtTime(volume * 0.28, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.08);
    },

    // 🔊 Test Preview Sound
    playTestSound() {
      this.playTaskCheck();
    }
  };

  window.WorkspaceAudio = WorkspaceAudio;

})(typeof window !== 'undefined' ? window : this);
