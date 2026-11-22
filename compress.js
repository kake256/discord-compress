// 動画を目標サイズに収めるための変換処理（WebCodecs + Mediabunny）
import {
  Input, Output, Conversion, BlobSource, BufferTarget, Mp4OutputFormat,
  ALL_FORMATS, Quality, canEncodeVideo, canEncodeAudio,
} from 'mediabunny';
import { plan, retryVideoBps } from './plan.js';

let aacRegistered = false;
async function ensureAac() {
  if (aacRegistered) return 'native';
  if (await canEncodeAudio('aac')) { aacRegistered = true; return 'native'; }
  // ブラウザがAACのエンコードに対応していないとき（Firefoxなど）は，WASMのAACエンコーダを使う
  const { registerAacEncoder } = await import('./vendor/mediabunny-aac-encoder.min.mjs');
  registerAacEncoder();
  aacRegistered = true;
  return 'wasm';
}

export async function checkSupport() {
  if (typeof VideoEncoder === 'undefined') {
    return { ok: false, reason: 'このブラウザはWebCodecsに対応していません' };
  }
  const avc = await canEncodeVideo('avc', { width: 1280, height: 720, bitrate: 2e6 });
  if (!avc) return { ok: false, reason: 'このブラウザはH.264のエンコードに対応していません' };
  return { ok: true };
}

export async function probe(file) {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const video = await input.getPrimaryVideoTrack();
  if (!video) throw new Error('映像トラックが見つかりません');
  const audio = await input.getPrimaryAudioTrack();
  const duration = await input.computeDuration();
  const width = await video.getDisplayWidth();
  const height = await video.getDisplayHeight();
  const stats = await video.computePacketStats(100);
  return { input, video, audio, duration, width, height, fps: stats.averagePacketRate, hasAudio: !!audio };
}

async function runOnce(file, p, onProgress, signal) {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target: new BufferTarget(),
  });
  const conversion = await Conversion.init({
    input, output,
    video: {
      codec: 'avc',
      width: p.width, height: p.height, fit: 'contain',
      frameRate: p.fps,
      quality: new Quality({ bitrate: p.videoBps, bitrateMode: 'constant' }),
      forceTranscode: true,
    },
    audio: p.audioBps
      ? { codec: 'aac', quality: new Quality({ bitrate: p.audioBps }), forceTranscode: true }
      : { discard: true },
  });
  if (!conversion.isValid) {
    const why = conversion.discardedTracks.map((t) => t.reason).join(', ');
    throw new Error('この動画は変換できません（' + why + '）');
  }
  conversion.onProgress = onProgress;
  const abort = () => conversion.cancel();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    await conversion.execute();
  } finally {
    signal?.removeEventListener('abort', abort);
  }
  return new Blob([output.target.buffer], { type: 'video/mp4' });
}

/**
 * @returns {Promise<{blob: Blob, plan: object, passes: number, skipped?: boolean, aac?: string}>}
 */
export async function compressToTarget(file, targetBytes, { onProgress, onPlan, signal, override } = {}) {
  if (file.size <= targetBytes && !override) {
    return { blob: file, skipped: true, passes: 0 };
  }
  const info = await probe(file);
  let p = plan({ targetBytes, ...info });
  if (override) p = { ...p, ...override };
  const aac = info.hasAudio ? await ensureAac() : undefined;
  onPlan?.(p, info);

  let blob = await runOnce(file, p, (x) => onProgress?.(x, 1), signal);
  let passes = 1;
  if (blob.size > targetBytes) {
    // 目標を超えたら，超えた割合だけ映像ビットレートを下げて1回だけやり直す
    const videoBps = retryVideoBps(p.videoBps, p.audioBps, blob.size, targetBytes);
    p = { ...p, videoBps, retriedFrom: blob.size };
    onPlan?.(p, info);
    blob = await runOnce(file, p, (x) => onProgress?.(x, 2), signal);
    passes = 2;
  }
  return { blob, plan: p, passes, aac, info: { duration: info.duration, width: info.width, height: info.height, fps: info.fps } };
}
