// 目標サイズから，映像ビットレート・解像度・fps・音声ビットレートを決める．
// 設計書「圧縮の決め方」の規則をそのまま実装している．

export const MARGIN = 0.95;          // MP4の管理情報と誤差のための余裕
export const BPP_MIN = 0.07;         // 画質を保てる目安（仮の値．実動画で決め直す）
export const LOW_VIDEO_BPS = 150_000; // これ未満なら「画質がかなり落ちる」と表示する
const SHORT_SIDES = [1080, 720, 540, 480, 360];
const FPS_STEPS = [60, 30, 24];

const even = (x) => Math.max(2, Math.round(x / 2) * 2);

export function audioBitrateFor(totalBps, hasAudio) {
  if (!hasAudio) return 0;
  // 既定128kbps．映像が500kbpsを下回るなら96，200kbpsを下回るなら64．
  if (totalBps - 128_000 >= 500_000) return 128_000;
  if (totalBps - 96_000 >= 200_000) return 96_000;
  return 64_000;
}

/**
 * @param {object} p
 * @param {number} p.targetBytes 目標サイズ（バイト）
 * @param {number} p.duration 秒
 * @param {number} p.width 表示上の幅
 * @param {number} p.height 表示上の高さ
 * @param {number} p.fps 元のfps
 * @param {boolean} p.hasAudio
 */
export function plan({ targetBytes, duration, width, height, fps, hasAudio }) {
  if (!(duration > 0)) throw new Error('動画の長さを読めませんでした');
  const totalBps = (8 * MARGIN * targetBytes) / duration;
  const audioBps = audioBitrateFor(totalBps, hasAudio);
  const videoBps = Math.floor(totalBps - audioBps);
  if (videoBps <= 0) throw new Error('動画が長すぎて，目標サイズに収められません');

  const srcShort = Math.min(width, height);
  const srcFps = Math.min(fps || 30, 60);
  const shorts = [Math.min(srcShort, SHORT_SIDES[0]), ...SHORT_SIDES.filter((s) => s < srcShort)]
    .filter((v, i, a) => a.indexOf(v) === i);
  const fpsList = [srcFps, ...FPS_STEPS.filter((f) => f < srcFps)];

  const dims = (short) => {
    const scale = short / srcShort;
    return { w: even(width * scale), h: even(height * scale) };
  };
  const bpp = (d, f) => videoBps / (d.w * d.h * f);

  let chosen = null;
  // 1. 元のfpsのまま，解像度を上から順に試す
  for (const s of shorts) {
    const d = dims(s);
    if (bpp(d, srcFps) >= BPP_MIN) { chosen = { ...d, fps: srcFps }; break; }
  }
  // 2. 最小の解像度でも足りなければ，fpsを下げる
  if (!chosen) {
    const d = dims(shorts[shorts.length - 1]);
    for (const f of fpsList) {
      if (bpp(d, f) >= BPP_MIN) { chosen = { ...d, fps: f }; break; }
    }
    // 3. それでも足りなければ，最小の解像度・最小のfpsで圧縮し，警告を出す
    if (!chosen) chosen = { ...d, fps: fpsList[fpsList.length - 1] };
  }

  return {
    videoBps,
    audioBps,
    width: chosen.w,
    height: chosen.h,
    fps: chosen.fps,
    bpp: bpp({ w: chosen.w, h: chosen.h }, chosen.fps),
    lowQuality: videoBps < LOW_VIDEO_BPS,
  };
}

/** 目標を超えたときに1回だけやり直す映像ビットレート */
export function retryVideoBps(prevVideoBps, audioBps, actualBytes, targetBytes) {
  // 超えた割合だけ全体を縮め，さらに3%余裕を取る
  const ratio = (MARGIN * targetBytes) / actualBytes;
  const totalPrev = prevVideoBps + audioBps;
  return Math.floor(totalPrev * ratio * 0.97 - audioBps);
}
