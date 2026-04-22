#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

const root = path.resolve(__dirname, '..');
const tmpRoot = path.join(root, '.ci-tmp', 'native-audio-smoke');
const budgetPath = path.join(root, 'scripts', 'baselines', 'native-audio-smoke-budget.json');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseFlags(argv) {
  const args = new Set(argv || []);
  return {
    strict: args.has('--strict') || process.env.AURIVO_REQUIRE_NATIVE_AUDIO_SMOKE === '1',
    json: args.has('--json')
  };
}

function loadBudget() {
  if (!fs.existsSync(budgetPath)) {
    return {
      maxInitMs: 2500,
      maxStartLatencyMs: 800,
      maxStallEvents: 2,
      maxBackwardJumps: 0,
      minObservedAdvanceMs: 400
    };
  }
  return JSON.parse(fs.readFileSync(budgetPath, 'utf8'));
}

function writeStereoSineWave(filePath, {
  durationSec = 2.6,
  sampleRate = 44100,
  frequencyHz = 440,
  amplitude = 0.42
} = {}) {
  const channels = 2;
  const bitsPerSample = 16;
  const blockAlign = channels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const totalFrames = Math.max(1, Math.floor(durationSec * sampleRate));
  const dataSize = totalFrames * blockAlign;
  const buffer = Buffer.alloc(44 + dataSize);

  let o = 0;
  buffer.write('RIFF', o); o += 4;
  buffer.writeUInt32LE(36 + dataSize, o); o += 4;
  buffer.write('WAVE', o); o += 4;

  buffer.write('fmt ', o); o += 4;
  buffer.writeUInt32LE(16, o); o += 4;
  buffer.writeUInt16LE(1, o); o += 2;
  buffer.writeUInt16LE(channels, o); o += 2;
  buffer.writeUInt32LE(sampleRate, o); o += 4;
  buffer.writeUInt32LE(byteRate, o); o += 4;
  buffer.writeUInt16LE(blockAlign, o); o += 2;
  buffer.writeUInt16LE(bitsPerSample, o); o += 2;

  buffer.write('data', o); o += 4;
  buffer.writeUInt32LE(dataSize, o); o += 4;

  for (let i = 0; i < totalFrames; i += 1) {
    const t = i / sampleRate;
    const env = i < sampleRate * 0.05
      ? (i / (sampleRate * 0.05))
      : (i > totalFrames - sampleRate * 0.05 ? ((totalFrames - i) / (sampleRate * 0.05)) : 1);
    const s = Math.sin(2 * Math.PI * frequencyHz * t) * amplitude * Math.max(0, Math.min(1, env));
    const v = Math.max(-1, Math.min(1, s));
    const i16 = Math.round(v * 32767);
    buffer.writeInt16LE(i16, o); o += 2;
    buffer.writeInt16LE(i16, o); o += 2;
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buffer);
}

async function run() {
  const flags = parseFlags(process.argv.slice(2));
  const budget = loadBudget();
  const result = {
    ok: false,
    skipped: false,
    reason: '',
    addonAvailable: false,
    initialized: false,
    metrics: {
      initMs: 0,
      startLatencyMs: 0,
      observedAdvanceMs: 0,
      stallEvents: 0,
      backwardJumps: 0,
      maxForwardJumpMs: 0,
      pcmFramesObserved: 0,
      pcmChannelsObserved: 0,
      playSamples: 0
    }
  };

  const audioEngineMod = require(path.join(root, 'audioEngine.js'));
  const engine = new audioEngineMod.AurivoAudioEngine();

  const addonReady = !!audioEngineMod._tryLoadNativeAddon?.();
  result.addonAvailable = addonReady && !!audioEngineMod.isNativeAvailable;

  if (!result.addonAvailable) {
    result.skipped = !flags.strict;
    result.reason = `native-addon-unavailable: ${audioEngineMod.lastNativeLoadError?.message || 'unknown'}`;
    if (flags.strict) throw new Error(`[native-audio-smoke] ${result.reason}`);
    return result;
  }

  const tInit = performance.now();
  const initialized = !!engine.initialize();
  result.metrics.initMs = Number((performance.now() - tInit).toFixed(2));
  result.initialized = initialized;

  if (!initialized) {
    result.skipped = !flags.strict;
    result.reason = 'engine-initialize-failed';
    if (flags.strict) throw new Error('[native-audio-smoke] engine initialize failed');
    return result;
  }

  const testWav = path.join(tmpRoot, 'smoke-tone.wav');
  writeStereoSineWave(testWav);

  const loaded = !!engine.loadFile(testWav);
  if (!loaded) {
    throw new Error('[native-audio-smoke] loadFile failed for generated wav');
  }

  const tPlay = performance.now();
  engine.play();

  let startDetected = false;
  let startDetectedAt = 0;
  let lastPos = Math.max(0, Number(engine.getPosition()) || 0);
  let stagnantTicks = 0;
  const pollMs = 25;
  const maxPoll = Math.max(1, Math.floor(2200 / pollMs));

  for (let i = 0; i < maxPoll; i += 1) {
    await sleep(pollMs);
    const pos = Math.max(0, Number(engine.getPosition()) || 0);
    const playing = !!engine.isPlaying();

    result.metrics.playSamples += 1;

    if (!startDetected && (playing || pos > 0)) {
      startDetected = true;
      startDetectedAt = performance.now();
      result.metrics.startLatencyMs = Number((startDetectedAt - tPlay).toFixed(2));
    }

    if (pos < lastPos - 20) {
      result.metrics.backwardJumps += 1;
    }

    const delta = pos - lastPos;
    if (delta > 0) {
      result.metrics.observedAdvanceMs += delta;
      result.metrics.maxForwardJumpMs = Math.max(result.metrics.maxForwardJumpMs, delta);
      stagnantTicks = 0;
    } else if (playing) {
      stagnantTicks += 1;
      if (stagnantTicks * pollMs >= 200) {
        result.metrics.stallEvents += 1;
        stagnantTicks = 0;
      }
    }

    try {
      const pcm = engine.getPCMData(512);
      const channels = Number(pcm?.channels) || 0;
      const frames = (pcm?.data && typeof pcm.data.length === 'number' && channels > 0)
        ? Math.floor(pcm.data.length / channels)
        : 0;
      if (channels > 0) result.metrics.pcmChannelsObserved = Math.max(result.metrics.pcmChannelsObserved, channels);
      if (frames > 0) result.metrics.pcmFramesObserved += frames;
    } catch {
      // best effort
    }

    lastPos = pos;
  }

  engine.stop();
  engine.cleanup();

  if (!startDetected) {
    throw new Error('[native-audio-smoke] playback did not start within timeout window');
  }

  const failures = [];
  if (result.metrics.initMs > Number(budget.maxInitMs || 2500)) {
    failures.push(`initMs ${result.metrics.initMs} > ${budget.maxInitMs}`);
  }
  if (result.metrics.startLatencyMs > Number(budget.maxStartLatencyMs || 800)) {
    failures.push(`startLatencyMs ${result.metrics.startLatencyMs} > ${budget.maxStartLatencyMs}`);
  }
  if (result.metrics.stallEvents > Number(budget.maxStallEvents || 2)) {
    failures.push(`stallEvents ${result.metrics.stallEvents} > ${budget.maxStallEvents}`);
  }
  if (result.metrics.backwardJumps > Number(budget.maxBackwardJumps || 0)) {
    failures.push(`backwardJumps ${result.metrics.backwardJumps} > ${budget.maxBackwardJumps}`);
  }
  if (result.metrics.observedAdvanceMs < Number(budget.minObservedAdvanceMs || 400)) {
    failures.push(`observedAdvanceMs ${result.metrics.observedAdvanceMs.toFixed(1)} < ${budget.minObservedAdvanceMs}`);
  }
  if (result.metrics.pcmFramesObserved <= 0) {
    failures.push('pcmFramesObserved <= 0');
  }

  if (failures.length) {
    throw new Error(`[native-audio-smoke] budget check failed: ${failures.join(', ')}`);
  }

  result.ok = true;
  result.reason = 'pass';
  return result;
}

(async () => {
  const flags = parseFlags(process.argv.slice(2));
  try {
    const result = await run();
    if (flags.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      if (result.skipped) {
        console.log(`[native-audio-smoke] SKIP: ${result.reason}`);
      } else {
        console.log(`[native-audio-smoke] PASS init=${result.metrics.initMs}ms startLatency=${result.metrics.startLatencyMs}ms stalls=${result.metrics.stallEvents} backward=${result.metrics.backwardJumps} advance=${result.metrics.observedAdvanceMs.toFixed(1)}ms pcmFrames=${result.metrics.pcmFramesObserved}`);
      }
    }
    process.exit(0);
  } catch (error) {
    const msg = error?.message || String(error);
    if (!flags.strict && /native-addon-unavailable|engine initialize failed|engine-initialize-failed/i.test(msg)) {
      console.log(`[native-audio-smoke] SKIP: ${msg}`);
      process.exit(0);
    }
    console.error(msg);
    process.exit(1);
  }
})();
