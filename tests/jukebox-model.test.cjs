const { test } = require("node:test");
const assert = require("node:assert/strict");
const { OfficeJukebox, TRACKS } = require("../web/js/jukebox.js");

function audioHarness(resume) {
  const contexts = [];
  class Context {
    constructor() {
      this.currentTime = 0;
      this.state = "suspended";
      this.destination = {};
      this.oscillators = [];
      contexts.push(this);
    }
    async resume() {
      if (resume) await resume();
      this.state = "running";
    }
    async close() {
      this.state = "closed";
    }
    createGain() {
      return {
        gain: {
          setValueAtTime() {},
          linearRampToValueAtTime() {},
          exponentialRampToValueAtTime() {},
        },
        connect() {},
        disconnect() {},
      };
    }
    createOscillator() {
      const oscillator = {
        frequency: { value: 0 },
        connect() {},
        disconnect() {
          this.disconnected = true;
        },
        start(at) {
          this.at = at;
        },
        stop(at) {
          this.stoppedAt = at;
        },
      };
      this.oscillators.push(oscillator);
      return oscillator;
    }
  }
  return {
    contexts,
    AudioContextClass: Context,
    setTimer: () => 1,
    clearTimer() {},
  };
}
test("each original track schedules audible notes and stop releases the audio graph", async () => {
  const harness = audioHarness(),
    player = new OfficeJukebox(harness);
  for (const track of TRACKS) {
    assert.equal(await player.play(track.id, 0.1), true);
    const context = harness.contexts.at(-1);
    assert.ok(context.oscillators.length > 0);
    assert.ok(
      context.oscillators.every(
        (node) => node.frequency.value > 0 && node.stoppedAt > node.at,
      ),
    );
    assert.equal(player.snapshot().playing, true);
    player.stop();
    assert.equal(context.state, "closed");
    assert.ok(context.oscillators.every((node) => node.disconnected));
    assert.equal(player.snapshot().activeVoices, 0);
  }
});
test("a late audio resume cannot restart playback after stop", async () => {
  let resolve;
  const harness = audioHarness(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const player = new OfficeJukebox(harness);
  const start = player.play(TRACKS[0].id, 0.1);
  player.stop();
  resolve();
  assert.equal(await start, false);
  assert.equal(player.snapshot().playing, false);
  assert.equal(harness.contexts[0].state, "closed");
  assert.equal(harness.contexts[0].oscillators.length, 0);
});
test("invalid tracks and rejected audio report a recoverable failure", async () => {
  const player = new OfficeJukebox(
    audioHarness(() => Promise.reject(new Error("blocked"))),
  );
  assert.equal(await player.play("missing", 1), false);
  assert.equal(await player.play(TRACKS[0].id, 1), false);
  assert.equal(player.snapshot().playing, false);
  assert.equal(player.snapshot().activeVoices, 0);
  assert.ok(player.snapshot().error);
});
