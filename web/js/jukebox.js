/* Original, locally synthesized music. Playback only begins after a gesture. */
"use strict";
(() => {
  const TRACKS = Object.freeze([
    {
      id: "window-seat",
      name: "Window seat",
      detail: "Soft keys · 72 BPM",
      bpm: 72,
      wave: "sine",
      melody: [
        72,
        76,
        79,
        null,
        76,
        74,
        72,
        67,
        69,
        72,
        76,
        null,
        74,
        71,
        67,
        null,
      ],
      bass: [48, 48, 45, 43],
    },
    {
      id: "night-shift",
      name: "Night shift",
      detail: "Quiet synth · 64 BPM",
      bpm: 64,
      wave: "triangle",
      melody: [
        64,
        null,
        67,
        71,
        69,
        null,
        67,
        64,
        62,
        64,
        67,
        null,
        66,
        62,
        59,
        null,
      ],
      bass: [40, 43, 45, 47],
    },
    {
      id: "rainy-break",
      name: "Rainy break",
      detail: "Warm plucks · 84 BPM",
      bpm: 84,
      wave: "sine",
      melody: [
        65,
        69,
        72,
        74,
        null,
        72,
        69,
        67,
        64,
        67,
        71,
        72,
        null,
        71,
        67,
        64,
      ],
      bass: [41, 41, 40, 43],
    },
  ]);
  const volumeOf = (value) =>
    Number.isFinite(value) ? Math.max(0, Math.min(0.5, value)) : 0.12;
  class OfficeJukebox {
    constructor(options = {}) {
      this.AudioContextClass =
        options.AudioContextClass ||
        globalThis.AudioContext ||
        globalThis.webkitAudioContext;
      // Native Window timers require their Window receiver. Keep the default
      // calls lexical so invoking them through this instance is safe.
      this.setTimer =
        options.setTimer || ((callback, delay) => setInterval(callback, delay));
      this.clearTimer = options.clearTimer || ((timer) => clearInterval(timer));
      this.onChange = options.onChange || (() => {});
      this.voices = new Set();
      this.generation = 0;
      this.playing = false;
      this.volume = 0.12;
      this.trackId = TRACKS[0].id;
      this.error = "";
      this.noteCount = 0;
    }
    snapshot() {
      return {
        playing: this.playing,
        trackId: this.trackId,
        volume: this.volume,
        contextState: this.context?.state || "closed",
        activeVoices: this.voices.size,
        noteCount: this.noteCount,
        error: this.error,
      };
    }
    stop() {
      this.generation++;
      this.playing = false;
      if (this.timer) this.clearTimer(this.timer);
      this.timer = null;
      for (const voice of this.voices) {
        try {
          voice.oscillator.stop();
        } catch {}
        voice.oscillator.disconnect();
        voice.gain.disconnect();
      }
      this.voices.clear();
      this.master?.disconnect();
      this.master = null;
      const context = this.context;
      this.context = null;
      if (context && context.state !== "closed")
        context.close().catch(() => {});
      this.onChange();
    }
    setVolume(value) {
      this.volume = volumeOf(value);
      if (this.master && this.context)
        this.master.gain.setValueAtTime(this.volume, this.context.currentTime);
      this.onChange();
    }
    note(midi, at, duration, type, level) {
      if (midi === null || !this.context || !this.master) return;
      const oscillator = this.context.createOscillator(),
        gain = this.context.createGain();
      const voice = { oscillator, gain };
      oscillator.type = type;
      oscillator.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
      gain.gain.setValueAtTime(0.001, at);
      gain.gain.linearRampToValueAtTime(level, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, at + duration);
      oscillator.connect(gain);
      gain.connect(this.master);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
        this.voices.delete(voice);
      };
      this.voices.add(voice);
      oscillator.start(at);
      oscillator.stop(at + duration + 0.02);
      this.noteCount++;
    }
    schedule() {
      if (!this.playing || !this.context) return;
      const track = TRACKS.find((item) => item.id === this.trackId),
        step = 30 / track.bpm;
      // Do not create a catch-up burst if a background tab throttled the timer.
      if (this.nextAt < this.context.currentTime)
        this.nextAt = this.context.currentTime + 0.03;
      while (this.nextAt < this.context.currentTime + 0.25) {
        const index = this.beat % track.melody.length;
        this.note(
          track.melody[index],
          this.nextAt,
          step * 0.85,
          track.wave,
          0.2,
        );
        if (index % 4 === 0)
          this.note(
            track.bass[Math.floor(index / 4)],
            this.nextAt,
            step * 3.6,
            "sine",
            0.15,
          );
        this.beat++;
        this.nextAt += step;
      }
    }
    async play(id, volume = this.volume) {
      this.stop();
      this.error = "";
      if (!TRACKS.some((track) => track.id === id) || !this.AudioContextClass) {
        this.error = "Audio is unavailable in this browser.";
        this.onChange();
        return false;
      }
      this.trackId = id;
      this.volume = volumeOf(volume);
      const generation = this.generation;
      let context;
      try {
        context = new this.AudioContextClass();
        this.context = context;
        await context.resume();
        if (generation !== this.generation || this.context !== context) {
          if (context.state !== "closed") await context.close();
          return false;
        }
        if (context.state !== "running")
          throw new Error("Audio was not allowed");
        this.master = context.createGain();
        this.master.gain.setValueAtTime(this.volume, context.currentTime);
        this.master.connect(context.destination);
        this.beat = 0;
        this.nextAt = context.currentTime + 0.03;
        this.noteCount = 0;
        this.playing = true;
        this.schedule();
        this.timer = this.setTimer(() => this.schedule(), 100);
        this.onChange();
        return true;
      } catch {
        if (generation === this.generation) {
          this.stop();
          this.error =
            "Playback could not start. Try Play again, or check your browser’s sound permission.";
          this.onChange();
        }
        return false;
      }
    }
  }
  if (typeof module !== "undefined" && module.exports)
    module.exports = { OfficeJukebox, TRACKS };
  if (typeof document === "undefined") return;
  const byId = (id) => document.getElementById(id),
    player = new OfficeJukebox({ onChange: render });
  const trackList = byId("jukebox-tracks"),
    volumeInput = byId("jukebox-volume");
  const preferenceErrors = new Map();
  let trackDraft = null,
    volumeDraft = null,
    trackRevision = 0,
    volumeRevision = 0;
  let starting = false,
    startSequence = 0;
  for (const track of TRACKS) {
    const option = document.createElement("option");
    option.value = track.id;
    option.textContent = track.name + " · " + track.detail;
    trackList.append(option);
  }
  function render() {
    const state = player.snapshot();
    byId("jukebox-play").textContent =
      state.playing || starting ? "Stop music" : "Play music";
    byId("jukebox-play").setAttribute(
      "aria-pressed",
      String(state.playing || starting),
    );
    byId("jukebox-status").textContent =
      state.error ||
      [...preferenceErrors.values()].join(" ") ||
      (starting
        ? "Starting music…"
        : state.playing
          ? "Playing " + TRACKS.find((track) => track.id === state.trackId).name
          : "Stopped. Choose a track, then press Play.");
    byId("jukebox-disc").classList.toggle(
      "is-playing",
      state.playing && !window.officeScene?.paused,
    );
    if (window.officeScene) window.officeScene.musicPlaying = state.playing;
  }
  function sync() {
    if (!settings.sound && (player.playing || player.context)) {
      starting = false;
      player.stop();
    }
    // Polls and unrelated saves may refresh preferences while a range is being
    // dragged. Keep that preview until its own write has settled.
    const volume = volumeDraft ?? settings.music_volume;
    player.setVolume(volume);
    trackList.value = trackDraft ?? settings.music_track;
    volumeInput.value = Math.round(volume * 100);
    byId("jukebox-volume-label").textContent = Math.round(volume * 100) + "%";
    render();
  }
  function stopPlayback() {
    startSequence++;
    starting = false;
    player.stop();
  }
  async function start() {
    const id = trackList.value,
      volume = Number(volumeInput.value) / 100;
    const sequence = ++startSequence;
    starting = true;
    preferenceErrors.delete("sound");
    // Calling play before any network await keeps AudioContext creation inside
    // this click gesture. The normal settings queue persists the preference.
    const playback = player.play(id, volume);
    const saved = updateSetting("sound", true);
    const [played, persisted] = await Promise.all([playback, saved]);
    if (sequence !== startSequence) return;
    starting = false;
    if (!played || !persisted) player.stop();
    if (!persisted)
      preferenceErrors.set(
        "sound",
        "Sound preference was not saved. Reconnect and try Play again.",
      );
    render();
  }
  byId("jukebox-play").onclick = () =>
    player.playing || player.context || starting ? stopPlayback() : start();
  trackList.onchange = async () => {
    const selected = trackList.value,
      revision = ++trackRevision;
    trackDraft = selected;
    preferenceErrors.delete("track");
    stopPlayback();
    const saved = await updateSetting("music_track", selected);
    if (revision !== trackRevision) return;
    trackDraft = null;
    if (!saved) {
      // Play may have been pressed while this selection was saving. Do not
      // leave that unsaved track playing behind a restored selector.
      if (player.trackId === selected) stopPlayback();
      preferenceErrors.set(
        "track",
        "Track was not saved. The previous saved track is selected.",
      );
    }
    sync();
  };
  volumeInput.oninput = (event) => {
    volumeRevision++;
    volumeDraft = Number(event.target.value) / 100;
    preferenceErrors.delete("volume");
    player.setVolume(volumeDraft);
    byId("jukebox-volume-label").textContent = event.target.value + "%";
  };
  volumeInput.onchange = async (event) => {
    const revision = ++volumeRevision;
    volumeDraft = Number(event.target.value) / 100;
    const saved = await updateSetting("music_volume", volumeDraft);
    if (revision !== volumeRevision) return;
    volumeDraft = null;
    if (!saved)
      preferenceErrors.set(
        "volume",
        "Volume was not saved. The previous saved volume is restored.",
      );
    else preferenceErrors.delete("volume");
    sync();
  };
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopPlayback();
  });
  window.addEventListener("pagehide", stopPlayback);
  window.officeJukebox = {
    open() {
      openSheet("sheet-jukebox");
      sync();
    },
    stop: stopPlayback,
    sync,
    snapshot: () => player.snapshot(),
  };
  sync();
})();
