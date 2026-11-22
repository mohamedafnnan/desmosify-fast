import { clipExpressions, frameExpressions } from './lib/desmos.ts';
import { DEFAULT_COLOR, FrameRenderer, lineWidthFor } from './lib/draw.ts';
import { DEFAULT_PROCESS } from './lib/frame.ts';
import { initializeSettingsUI } from './settings-ui.ts';
import type { Params, SourceInfo } from './lib/types.ts';
import { collectFrames, renderVideo } from './orchestrator.ts';
import type { Progress, RunStats } from './orchestrator.ts';
import { probe } from './probe.ts';
import { parseDesmosImport } from './lib/desmos-import.ts';
import { parseDesmosGraphLink } from './lib/desmos-links.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const num = (id: string) => Number($<HTMLInputElement>(id).value);
const checked = (id: string) => $<HTMLInputElement>(id).checked;
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

const fileInput = $<HTMLInputElement>('file');
const drop = $<HTMLLabelElement>('drop');
const renderBtn = $<HTMLButtonElement>('render');
const convertBtn = $<HTMLButtonElement>('convert');
const cancelBtn = $<HTMLButtonElement>('cancel');
const notice = $<HTMLParagraphElement>('notice');
const progressBox = $<HTMLDivElement>('progress');
const barFill = $<HTMLDivElement>('barFill');
const progressText = $<HTMLSpanElement>('progressText');
const sizeSelect = $<HTMLSelectElement>('size');
const videoPresetSelect = $<HTMLSelectElement>('videoPreset');
const audioInput = $<HTMLInputElement>('audio');
const audioHelp = $<HTMLElement>('audioHelp');
const audioOption = document.querySelector<HTMLElement>('.audio-option')!;
const progressBar = document.querySelector<HTMLElement>('.bar')!;

let file: File | null = null;
let info: SourceInfo | null = null;
let abort: AbortController | null = null;
let videoUrl: string | null = null;

type Clip = { frames: Float32Array[]; traceW: number; traceH: number; fps: number };
let clip: Clip | null = null;
let frameIndex = 0;
let timer: number | null = null;
let previewRenderer: FrameRenderer | null = null;

$<HTMLInputElement>('threads').value = String(Math.max(1, Math.min((navigator.hardwareConcurrency || 4) - 1, 12)));
const settingsUi = initializeSettingsUI();

function showNotice(message: string, error = false) {
  notice.textContent = message;
  notice.hidden = !message;
  notice.classList.toggle('error', error);
  notice.setAttribute('role', error ? 'alert' : 'status');
  notice.setAttribute('aria-live', error ? 'assertive' : 'polite');
}

function busy(on: boolean) {
  renderBtn.disabled = on || !file;
  convertBtn.disabled = on || !file;
  cancelBtn.hidden = !on;
  progressBox.hidden = !on && progressBox.hidden;
}

function fmtMs(ms: number) {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

function onProgress(p: Progress, label: string) {
  const frac = Math.min(1, Math.max(p.traced, p.encoded) / p.total);
  barFill.style.width = `${(frac * 100).toFixed(1)}%`;
  progressBar.setAttribute('aria-valuenow', String(Math.round(frac * 100)));
  const fps = p.elapsedMs > 0 ? (p.traced / p.elapsedMs) * 1000 : 0;
  const eta = fps > 0 ? ((p.total - p.traced) / fps) * 1000 : 0;
  const completed = Math.max(p.traced, p.encoded);
  progressText.textContent = `${label}: ${completed} of ${p.total} pictures · about ${fmtMs(eta)} left`;
}

function statsLine(s: RunStats, total: number, gridOn: boolean, wantedAudio: boolean) {
  const parts = [`${total} pictures made in ${fmtMs(s.elapsedMs)}`];
  if (gridOn) parts.push('graph-paper grid included');
  if (wantedAudio && s.audio !== 'none') parts.push('sound kept');
  return parts.join(' · ');
}

async function accept(f: File | undefined) {
  if (!f) return;
  showNotice('');
  stopPlayback();
  if (videoUrl) {
    URL.revokeObjectURL(videoUrl);
    videoUrl = null;
  }
  $<HTMLVideoElement>('video').removeAttribute('src');
  $<HTMLVideoElement>('video').load();
  $<HTMLElement>('result').hidden = true;
  $<HTMLElement>('preview').hidden = true;
  clip = null;
  exportCache = null;
  previewRenderer = null;
  fileInput.value = '';
  file = f;
  info = null;
  videoPresetSelect.disabled = true;
  $('fileName').textContent = f.name;
  $('fileInfo').textContent = 'Reading…';
  audioInput.disabled = true;
  audioHelp.textContent = 'Checking this video for sound…';
  audioOption.classList.add('is-unavailable');
  busy(false);
  renderBtn.disabled = convertBtn.disabled = true;
  try {
    info = await probe(f);
    $('fileInfo').textContent = `${info.width} × ${info.height} pixels · ${info.duration.toFixed(1)} seconds`;
    sizeSelect.replaceChildren(
      new Option(`Source (${info.height}p)`, 'source'),
      ...[1080, 720, 480, 360].filter((h) => h < info!.height).map((h) => new Option(`${h}p`, String(h))),
    );
    videoPresetSelect.disabled = false;
    settingsUi.syncForSource(info);
    audioInput.disabled = !info.hasAudio;
    audioInput.title = info.hasAudio ? 'Keep the sound from your original video' : 'This video does not have a sound track';
    audioOption.classList.toggle('is-unavailable', !info.hasAudio);
    audioHelp.textContent = info.hasAudio
      ? audioInput.checked ? 'Sound is on and will be kept in the finished video.' : 'Sound is available. Turn this on to keep it.'
      : 'This video has no sound track to keep.';
    busy(false);
  } catch (error) {
    file = null;
    videoPresetSelect.disabled = true;
    $('fileName').textContent = 'No usable video yet';
    $('fileInfo').textContent = '';
    console.warn('Could not open this video:', error);
    audioInput.disabled = true;
    audioHelp.textContent = 'Choose a video with sound first.';
    audioOption.classList.add('is-unavailable');
    const reason = error instanceof Error ? error.message : 'The browser could not read this file.';
    showNotice(`${reason} Open this page in an up-to-date browser and try an MP4 with H.264 video. If it still fails, share your device, OS/browser version, video format, and this message.`, true);
    busy(false);
  }
}

fileInput.addEventListener('change', () => void accept(fileInput.files?.[0]));
drop.addEventListener('dragover', (e) => (e.preventDefault(), drop.classList.add('over')));
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  void accept(e.dataTransfer?.files[0]);
});
const desmosImportFile = $<HTMLInputElement>('desmosImportFile');
const desmosImportDrop = $<HTMLLabelElement>('desmosImportDrop');
const desmosImportName = $<HTMLElement>('desmosImportName');
const desmosImportStatus = $<HTMLParagraphElement>('desmosImportStatus');
const desmosImportPreview = $<HTMLTextAreaElement>('desmosImportPreview');
const copyImportedFormulas = $<HTMLButtonElement>('copyImportedFormulas');
const desmosGraphLink = $<HTMLInputElement>('desmosGraphLink');
const openDesmosGraph = $<HTMLButtonElement>('openDesmosGraph');
const desmosGraphLinkStatus = $<HTMLParagraphElement>('desmosGraphLinkStatus');
let inspectedFormulaText = '';
function openSharedDesmosGraph() {
  const url = parseDesmosGraphLink(desmosGraphLink.value);
  if (!url) {
    desmosGraphLinkStatus.textContent = 'Paste an HTTPS Desmos Graphing Calculator share link, such as https://www.desmos.com/calculator/…';
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
  desmosGraphLinkStatus.textContent = 'Opened the shared graph in a new tab. To add it to another graph, paste its link into an empty expression line there.';
}
openDesmosGraph.addEventListener('click', openSharedDesmosGraph);
desmosGraphLink.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    openSharedDesmosGraph();
  }
});
async function inspectDesmosFile(candidate: File | undefined) {
  if (!candidate) return;
  desmosImportFile.value = '';
  desmosImportName.textContent = candidate.name;
  desmosImportStatus.textContent = 'Reading your file…';
  inspectedFormulaText = '';
  copyImportedFormulas.hidden = true;
  desmosImportPreview.hidden = true;
  try {
    const parsed = parseDesmosImport(await candidate.text(), candidate.name);
    const bounds = parsed.viewport
      ? `bounds x ${parsed.viewport.xmin} to ${parsed.viewport.xmax}, y ${parsed.viewport.ymin} to ${parsed.viewport.ymax}`
      : 'no graph bounds found';
    const sliderText = parsed.sliders.length ? `sliders/variables: ${parsed.sliders.join(', ')}` : 'no simple slider definitions found';
    const warningText = parsed.warnings.length ? ` ${parsed.warnings.join(' ')}` : '';
    desmosImportStatus.textContent = `Found ${parsed.expressions.length} formula${parsed.expressions.length === 1 ? '' : 's'} · ${bounds} · ${sliderText}.${warningText} This file has only been inspected here.`;
    inspectedFormulaText = parsed.expressions.map((expression) => expression.latex).join('\n');
    desmosImportPreview.value = inspectedFormulaText;
    desmosImportPreview.hidden = false;
    copyImportedFormulas.hidden = false;
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'The browser could not read this file.';
    desmosImportStatus.textContent = reason;
    inspectedFormulaText = '';
    desmosImportPreview.value = '';
    desmosImportPreview.hidden = true;
    copyImportedFormulas.hidden = true;
  }
}
desmosImportFile.addEventListener('change', () => void inspectDesmosFile(desmosImportFile.files?.[0]));
desmosImportDrop.addEventListener('dragover', (e) => (e.preventDefault(), desmosImportDrop.classList.add('over')));
desmosImportDrop.addEventListener('dragleave', () => desmosImportDrop.classList.remove('over'));
desmosImportDrop.addEventListener('drop', (e) => {
  e.preventDefault();
  desmosImportDrop.classList.remove('over');
  void inspectDesmosFile(e.dataTransfer?.files[0]);
});
copyImportedFormulas.addEventListener('click', async () => {
  if (!inspectedFormulaText) return;
  try {
    await navigator.clipboard.writeText(inspectedFormulaText);
    desmosImportStatus.textContent = 'Copied the formulas. Open Desmos, click an empty expression line, and paste.';
  } catch {
    desmosImportPreview.focus();
    desmosImportPreview.select();
    desmosImportStatus.textContent = 'Automatic copy was blocked. The formulas are selected; copy them and paste into an empty Desmos expression line.';
  }
});
$<HTMLInputElement>('cutoff').addEventListener('input', () => {
  $('cutoffValue').textContent = num('cutoff').toFixed(2);
});
cancelBtn.addEventListener('click', () => abort?.abort());
audioInput.addEventListener('change', () => {
  if (info?.hasAudio) audioHelp.textContent = audioInput.checked ? 'Sound is on and will be kept in the finished video.' : 'Sound is available but will be left out.';
});

function baseParams(traceW: number, traceH: number, fps: number, curveTolerance = DEFAULT_PROCESS.tolerance): Params {
  return {
    traceW,
    traceH,
    fps,
    cutoff: num('cutoff'),
    smooth: checked('smooth'),
    minLength: checked('preserveLines') ? 3 : Math.max(3, Math.round(traceW / 160)),
    tolerance: curveTolerance,
    dedup: checked('dedup'),
    dedupMean: 0.6,
  };
}

function totalFrames(i: SourceInfo, fps: number, limit = Infinity) {
  return Math.max(1, Math.min(limit, Math.floor(i.duration * fps), Math.round(i.frameCount * (fps / i.fps))));
}

async function runRender() {
  if (!file || !info) return;
  const height = sizeSelect.value === 'source' ? info.height : Number(sizeSelect.value);
  const outH = even(height);
  const outW = even((height * info.width) / info.height);
  const detail = num('detail');
  const traceW = Math.max(48, Math.round(outW * detail));
  const traceH = Math.max(48, Math.round(outH * detail));
  const fps = info.fps;
  const total = totalFrames(info, fps);

  const controller = (abort = new AbortController());
  lastGrid = checked('grid');
  lastAudio = checked('audio');
  showNotice('');
  $<HTMLElement>('result').hidden = true;
  progressBox.hidden = false;
  barFill.style.width = '0';
  progressBar.setAttribute('aria-valuenow', '0');
  busy(true);
  try {
    const { blob, stats } = await renderVideo({
      file,
      params: baseParams(traceW, traceH, fps),
      total,
      threads: num('threads'),
      outW,
      outH,
      style: { grid: checked('grid'), color: DEFAULT_COLOR, lineWidth: lineWidthFor(outH, num('lineWidth')) },
      vfr: checked('vfr'),
      audio: checked('audio') && info.hasAudio ? file : null,
      signal: controller.signal,
      onProgress: (p) => onProgress(p, 'Finding the lines'),
      onNotice: (m) => showNotice(m),
    });
    showResult(blob, stats, total);
  } catch (error) {
    if ((error as DOMException).name === 'AbortError') showNotice('Stopped. Your original video is safe.');
    else {
      console.error('Making the line-art video failed:', error);
      showNotice('We could not make this video. Try a shorter clip or choose a smaller video size.', true);
    }
  } finally {
    progressBox.hidden = true;
    busy(false);
  }
}

let lastGrid = true;
let lastAudio = false;

function showResult(blob: Blob, stats: RunStats, total: number) {
  if (videoUrl) URL.revokeObjectURL(videoUrl);
  videoUrl = URL.createObjectURL(blob);
  const ext = blob.type.includes('webm') ? 'webm' : 'mp4';
  const base = (file?.name ?? 'desmos').replace(/\.[^.]+$/, '');
  $<HTMLVideoElement>('video').src = videoUrl;
  const a = $<HTMLAnchorElement>('download');
  a.href = videoUrl;
  a.download = `${base} (desmos).${ext}`;
  $('stats').textContent = statsLine(stats, total, lastGrid, lastAudio);
  $<HTMLElement>('result').hidden = false;
  const resultHeading = $<HTMLHeadingElement>('result-heading');
  resultHeading.tabIndex = -1;
  resultHeading.focus();
  (window as unknown as { __lastRender?: unknown }).__lastRender = { bytes: blob.size, type: blob.type, stats, total };
}

async function runConvert() {
  if (!file || !info) return;
  const fullSource = $<HTMLSelectElement>('desmosPreset').value === 'ultra';
  const fps = fullSource ? info.fps : Math.min(num('fps'), info.fps);
  const traceW = Math.max(48, num('width'));
  const traceH = Math.max(48, Math.round((traceW * info.height) / info.width));
  const total = fullSource ? Math.max(1, Math.round(info.frameCount)) : totalFrames(info, fps, num('frames'));

  const controller = (abort = new AbortController());
  showNotice('');
  stopPlayback();
  $<HTMLElement>('preview').hidden = true;
  progressBox.hidden = false;
  barFill.style.width = '0';
  progressBar.setAttribute('aria-valuenow', '0');
  busy(true);
  try {
    const { frames } = await collectFrames({
      file,
      params: baseParams(traceW, traceH, fps, num('curveTolerance')),
      total,
      threads: num('threads'),
      signal: controller.signal,
      onProgress: (p) => onProgress(p, 'Finding the lines'),
    });
    clip = { frames, traceW, traceH, fps };
    openPreview();
    showNotice('Your Desmos drawing is ready. Preview it, then copy the formulas into Desmos.');
  } catch (error) {
    if ((error as DOMException).name === 'AbortError') showNotice('Stopped. Your original video is safe.');
    else {
      console.error('Making the Desmos drawing failed:', error);
      showNotice('We could not make this Desmos drawing. Try fewer pictures or a smaller drawing width.', true);
    }
  } finally {
    progressBox.hidden = true;
    busy(false);
  }
}

function openPreview() {
  if (!clip) return;
  const desmosCoordinates = document.getElementById('desmosCoordinates');
  if (desmosCoordinates) {
    desmosCoordinates.textContent = `For this drawing, set the wrench Graph Settings bounds to x: 0 to ${clip.traceW}, y: 0 to ${clip.traceH}.`;
  }
  const canvas = $<HTMLCanvasElement>('canvas');
  const pw = 720;
  const ph = even((pw * clip.traceH) / clip.traceW);
  canvas.width = pw;
  canvas.height = ph;
  previewRenderer = new FrameRenderer(pw, ph, clip.traceW, clip.traceH, { grid: checked('grid'), color: DEFAULT_COLOR, lineWidth: 2 });
  const scrub = $<HTMLInputElement>('scrub');
  scrub.max = String(clip.frames.length - 1);
  frameIndex = 0;
  $<HTMLElement>('preview').hidden = false;
  paint();
  const previewHeading = $<HTMLHeadingElement>('preview-heading');
  previewHeading.tabIndex = -1;
  previewHeading.focus();
}

function openPreviewKeepFrame() {
  const keep = frameIndex;
  openPreview();
  frameIndex = Math.min(keep, (clip?.frames.length ?? 1) - 1);
  paint();
}

function paint() {
  if (!clip || !previewRenderer) return;
  const canvas = $<HTMLCanvasElement>('canvas');
  previewRenderer.draw(canvas.getContext('2d')!, clip.frames[frameIndex]);
  $<HTMLInputElement>('scrub').value = String(frameIndex);
  $('frameLabel').textContent = `Picture ${frameIndex + 1} of ${clip.frames.length}`;
  refreshExport();
}

let exportCache: { key: string; text: string; note: string } | null = null;

function refreshExport() {
  if (!clip) return;
  const mode = $<HTMLSelectElement>('exportMode').value;
  let text: string;
  let note = '';
  if (mode === 'clip') {
    const key = `clip|${num('budget')}|${num('slots')}|${clip.frames.length}|${clip.traceW}`;
    if (exportCache?.key !== key) {
      const { lines, dropped } = clipExpressions(clip.frames, { budget: num('budget'), maxSlots: num('slots') });
      exportCache = {
        key,
        text: lines.join('\n'),
        note: `Paste into Desmos, then move the f slider from 1 to ${clip.frames.length} to play the clip.${dropped ? ` ${dropped} small shapes were skipped to fit.` : ''}`,
      };
    }
    ({ text, note } = exportCache);
  } else {
    text = frameExpressions(clip.frames[frameIndex]).join('\n');
    note = 'Paste these formulas into Desmos to draw this picture.';
  }
  const area = $<HTMLTextAreaElement>('latex');
  if (area.value !== text) area.value = text;
  $('exportNote').textContent = note;
}

function stopPlayback() {
  if (timer !== null) clearInterval(timer);
  timer = null;
  $('play').textContent = 'Play clip';
}

$('play').addEventListener('click', () => {
  if (timer !== null) return stopPlayback();
  if (!clip) return;
  $('play').textContent = 'Pause clip';
  timer = window.setInterval(() => {
    if (!clip) return;
    frameIndex = (frameIndex + 1) % clip.frames.length;
    paint();
  }, Math.max(40, 1000 / clip.fps));
});
$<HTMLInputElement>('scrub').addEventListener('input', () => {
  frameIndex = num('scrub');
  paint();
});
$('exportMode').addEventListener('change', refreshExport);
$<HTMLInputElement>('grid').addEventListener('change', () => {
  if (clip) openPreviewKeepFrame();
});
$('copy').addEventListener('click', async () => {
  const text = $<HTMLTextAreaElement>('latex').value;
  try {
    await navigator.clipboard.writeText(text);
    $('copy').textContent = 'Copied';
    $('copyStatus').textContent = 'Formulas copied. Paste them into Desmos.';
  } catch {
    $<HTMLTextAreaElement>('latex').select();
    $('copy').textContent = 'Copy formulas';
    $('copyStatus').textContent = 'Formulas selected. Use your device’s Copy command.';
  }
  setTimeout(() => ($('copy').textContent = 'Copy formulas'), 1600);
});

renderBtn.addEventListener('click', () => void runRender());
convertBtn.addEventListener('click', () => void runConvert());

$('build').textContent = `Build ${__BUILD__}`;
