import { checkSupport, compressToTarget } from './compress.js';

const $ = (id) => document.getElementById(id);
const MB = 1_000_000; // Discordの「MB」が10^6か2^20か不明なので，小さいほう（10^6）で計算する
const fmtMB = (b) => (b / MB).toFixed(1) + 'MB';
const fmtKbps = (b) => Math.round(b / 1000) + 'kbps';

let controller = null;
let lastUrl = null;

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

(async () => {
  const s = await checkSupport();
  if (!s.ok) {
    $('support').hidden = false;
    $('support').className = 'card warn';
    $('support').textContent = s.reason + '．AndroidやWindowsではChromeかEdge，iPhoneでは最新のiOSのSafariで開いてください．';
  }
  // Androidの共有メニューから渡された動画を受け取る
  if (new URLSearchParams(location.search).has('shared')) {
    const file = await takeSharedFile();
    if (file) start(file);
    history.replaceState(null, '', location.pathname);
  }
})();

async function takeSharedFile() {
  const cache = await caches.open('shared-files');
  const res = await cache.match('shared-file');
  if (!res) return null;
  await cache.delete('shared-file');
  const name = decodeURIComponent(res.headers.get('x-file-name') || 'shared.mp4');
  return new File([await res.blob()], name, { type: res.headers.get('content-type') || 'video/mp4' });
}

$('file').addEventListener('change', (e) => {
  const f = e.target.files?.[0];
  if (f) start(f);
  e.target.value = '';
});
const drop = $('drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  const f = e.dataTransfer.files?.[0];
  if (f) start(f);
});
$('cancel').addEventListener('click', () => controller?.abort());

async function start(file) {
  if (controller) return; // 処理中は受け付けない
  const targetBytes = Number($('target').value) * MB;
  $('result').hidden = true;
  $('job').hidden = false;
  $('warn').hidden = true;
  $('planinfo').textContent = '';
  $('fileinfo').textContent = `${file.name}（${fmtMB(file.size)}）`;
  $('status').textContent = '動画を読んでいます…';
  $('progress').value = 0;
  $('cancel').hidden = false;

  controller = new AbortController();
  let wakeLock = null;
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
  const t0 = performance.now();

  try {
    const r = await compressToTarget(file, targetBytes, {
      signal: controller.signal,
      onPlan: (p, info) => {
        $('planinfo').textContent =
          `${Math.round(info.duration)}秒，${info.width}×${info.height}，${Math.round(info.fps)}fps → ` +
          `${p.width}×${p.height}，${p.fps}fps，映像${fmtKbps(p.videoBps)}` +
          (p.audioBps ? `，音声${fmtKbps(p.audioBps)}` : '');
        if (p.lowQuality) {
          $('warn').hidden = false;
          $('warn').textContent = '画質がかなり落ちます．動画を短く切り取るか，リンクでの共有を勧めます．';
        }
      },
      onProgress: (x, pass) => {
        $('progress').value = x;
        $('status').textContent = (pass === 2 ? '目標を少し超えたので，やり直しています… ' : '圧縮しています… ') +
          Math.round(x * 100) + '%（画面を閉じないでください）';
      },
    });
    showResult(file, r, targetBytes, (performance.now() - t0) / 1000);
  } catch (e) {
    $('status').textContent = controller.signal.aborted ? '中止しました．' : 'エラー：' + (e?.message || e);
    console.error(e);
  } finally {
    controller = null;
    $('cancel').hidden = true;
    try { await wakeLock?.release(); } catch {}
  }
}

function showResult(file, r, targetBytes, secs) {
  $('job').hidden = r.skipped;
  $('status').textContent = r.skipped ? '' : `完了（${Math.round(secs)}秒）`;
  $('progress').value = 1;
  const ok = r.blob.size <= targetBytes;
  $('resultinfo').textContent = r.skipped
    ? `元のファイルが上限以下（${fmtMB(file.size)}）なので，そのまま送れます．`
    : `${fmtMB(file.size)} → ${fmtMB(r.blob.size)}` + (ok ? '' : `（目標の${fmtMB(targetBytes)}を超えています）`);

  const base = file.name.replace(/\.[^.]+$/, '');
  const out = r.skipped ? file : new File([r.blob], `${base}_discord.mp4`, { type: 'video/mp4' });
  if (lastUrl) URL.revokeObjectURL(lastUrl);
  lastUrl = URL.createObjectURL(out);
  $('preview').src = lastUrl;
  $('download').href = lastUrl;
  $('download').download = out.name;

  const share = $('share');
  share.hidden = !(navigator.canShare && navigator.canShare({ files: [out] }));
  share.onclick = () => navigator.share({ files: [out] }).catch(() => {});
  $('result').hidden = false;
  window.__lastResult = { size: r.blob.size, plan: r.plan, passes: r.passes, aac: r.aac, secs, skipped: !!r.skipped };
}
