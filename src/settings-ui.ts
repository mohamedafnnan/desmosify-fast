type SettingValue = string | boolean;
type SettingsSnapshot = Record<string, SettingValue>;
import type { SourceInfo } from './lib/types.ts';

type VideoPreset = 'fidelity' | 'balanced' | 'clean' | 'custom';
type DesmosPreset = 'medium' | 'small' | 'pixels' | 'detail' | 'long' | 'smooth' | 'ultra' | 'custom';

const STORAGE_KEY = 'desmosify-fast.settings.v1';
const IDS = ['size', 'detail', 'lineWidth', 'threads', 'cutoff', 'curveTolerance', 'smooth', 'grid', 'dedup', 'preserveLines', 'vfr', 'audio', 'frames', 'fps', 'width', 'budget', 'slots', 'videoPreset', 'desmosPreset'] as const;
const RANGE_IDS = ['detail', 'cutoff', 'curveTolerance'] as const;
const VIDEO_PRESET_TEXT: Record<VideoPreset, string> = {
  fidelity: 'Keeps the original size, looks harder for small lines, keeps short outlines, and does not reuse nearby frames. This is the closest structural match, but it is the slowest.',
  balanced: 'Uses up to 720p with normal detail and may reuse nearly identical frames. This is a good everyday balance.',
  clean: 'Uses up to 720p and removes more faint or tiny details. Choose this when busy backgrounds become distracting.',
  custom: 'Your own video settings. Change the size or sliders to make a different look.',
};
const DESMOS_PRESET_TEXT: Record<DesmosPreset, string> = {
  medium: 'Up to 40 pictures (about 5 seconds at 8 FPS), 200 pixels wide. A good balance of clip length and detail.',
  small: 'Up to 20 pictures (about 2.5 seconds at 8 FPS), 160 pixels wide. Makes a smaller formula and a shorter clip.',
  pixels: 'Up to 40 pictures, 320 pixels wide, with a larger point limit. The copied formula will be bigger.',
  detail: 'Up to 24 pictures (about 3 seconds at 8 FPS). A shorter clip gives each picture more room for points and shapes.',
  long: 'Up to 80 pictures (about 10 seconds at 8 FPS). The same point limit is spread across more pictures, so each may show fewer details.',
  smooth: 'Uses the whole clip at up to 8 FPS and up to 640 pixels wide. It skips some source frames to make a smaller formula that may play more smoothly.',
  ultra: 'Uses the frame count and average rate reported for this video, at full video width, with no fixed frame-count ceiling. Variable-frame-rate video is sampled at even timestamps. Long clips make a much bigger formula.',
  custom: 'Your own Desmos settings. Change the numbers in More Desmos settings to fine-tune them.',
};
const VIDEO_VALUES: Record<Exclude<VideoPreset, 'custom'>, { size: string; detail: string; cutoff: string; smooth: boolean; dedup: boolean; preserveLines: boolean; target?: number }> = {
  fidelity: { size: 'source', detail: '1.5', cutoff: '0.05', smooth: true, dedup: false, preserveLines: true },
  balanced: { size: '720', detail: '1', cutoff: '0.10', smooth: true, dedup: true, preserveLines: false, target: 720 },
  clean: { size: '720', detail: '0.75', cutoff: '0.18', smooth: true, dedup: true, preserveLines: false, target: 720 },
};
const DESMOS_VALUES: Record<Exclude<DesmosPreset, 'custom'>, { frames: string; fps: string; width: string; budget: string; slots: string; curveTolerance: string }> = {
  medium: { frames: '40', fps: '8', width: '200', budget: '9000', slots: '48', curveTolerance: '0.6' },
  small: { frames: '20', fps: '8', width: '160', budget: '6000', slots: '32', curveTolerance: '0.9' },
  pixels: { frames: '40', fps: '8', width: '320', budget: '9800', slots: '64', curveTolerance: '0.4' },
  detail: { frames: '24', fps: '8', width: '280', budget: '9800', slots: '96', curveTolerance: '0.3' },
  long: { frames: '80', fps: '8', width: '200', budget: '9800', slots: '48', curveTolerance: '0.6' },
  smooth: { frames: '720', fps: '8', width: '640', budget: '9000', slots: '48', curveTolerance: '0.6' },
  ultra: { frames: '1', fps: '8', width: '640', budget: '9800', slots: '128', curveTolerance: '0.6' },
};

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing settings control: ${id}`);
  return found as T;
}

function input(id: string): HTMLInputElement | HTMLSelectElement {
  return element<HTMLInputElement | HTMLSelectElement>(id);
}

function readCurrent(preferredSize: string): SettingsSnapshot {
  const values: SettingsSnapshot = {};
  for (const id of IDS) {
    const control = input(id);
    if (control instanceof HTMLInputElement && control.type === 'checkbox') values[id] = control.checked;
    else values[id] = id === 'size' ? preferredSize : control.value;
  }
  return values;
}

function updateReadout(id: (typeof RANGE_IDS)[number]) {
  const control = input(id) as HTMLInputElement;
  const outputId = id === 'detail' ? 'detailValue' : id === 'cutoff' ? 'cutoffValue' : 'curveToleranceValue';
  const output = element<HTMLOutputElement>(outputId);
  const value = Number(control.value);
  output.textContent = id === 'detail' ? `${value.toFixed(2).replace(/\.?0+$/, '')}×` : value.toFixed(2);
}

function safeValue(control: HTMLInputElement | HTMLSelectElement, value: SettingValue, fallback: string): string {
  const raw = String(value);
  if (control instanceof HTMLSelectElement) return Array.from(control.options).some((option) => option.value === raw) ? raw : fallback;
  const number = Number(raw);
  if (!Number.isFinite(number)) return fallback;
  const min = control.min === '' ? -Infinity : Number(control.min);
  const max = control.max === '' ? Infinity : Number(control.max);
  const bounded = Math.min(max, Math.max(min, number));
  const step = control.step === '' || control.step === 'any' ? 0 : Number(control.step);
  if (!Number.isFinite(step) || step <= 0 || !Number.isFinite(min)) return String(bounded);
  const stepped = min + Math.round((bounded - min) / step) * step;
  return String(Number(Math.min(max, Math.max(min, stepped)).toFixed(4)));
}

export function initializeSettingsUI() {
  const status = element<HTMLParagraphElement>('settingsStatus');
  const resetButton = element<HTMLButtonElement>('resetSettings');
  const undoButton = element<HTMLButtonElement>('undoReset');
  const dialog = element<HTMLDialogElement>('resetDialog');
  const sizeSelect = element<HTMLSelectElement>('size');
  const videoPreset = element<HTMLSelectElement>('videoPreset');
  const desmosPreset = element<HTMLSelectElement>('desmosPreset');
  const videoHelp = element<HTMLParagraphElement>('videoPresetHelp');
  const desmosHelp = element<HTMLParagraphElement>('desmosPresetHelp');
  const threadInput = element<HTMLInputElement>('threads');

  if (!threadInput.value) threadInput.value = String(Math.max(1, Math.min((navigator.hardwareConcurrency || 4) - 1, 12)));

  const defaults = readCurrent('source');
  let preferredSize = 'source';
  let sourceHeight: number | null = null;
  let sourceInfo: SourceInfo | null = null;
  let undoSnapshot: SettingsSnapshot | null = null;
  let audioPreferenceSet = false;
  let saveTimer: number | null = null;

  const setStatus = (message: string) => { status.textContent = message; };
  const snapshot = () => ({ ...readCurrent(preferredSize || sizeSelect.value), audioPreferenceSet });
  const showVideoHelp = (note = '') => {
    videoHelp.textContent = sourceHeight === null
      ? 'Choose a video first to use a video quality preset.'
      : `${VIDEO_PRESET_TEXT[videoPreset.value as VideoPreset]}${note ? ` ${note}` : ''}`;
  };
  const showDesmosHelp = () => {
    desmosHelp.textContent = desmosPreset.value === 'smooth' && !sourceInfo
      ? 'Choose a video to use its full duration at up to 8 pictures per second. This skips some source frames to make a smaller formula.'
      : desmosPreset.value === 'smooth' && sourceInfo
        ? `Uses the whole ${sourceInfo.duration.toFixed(1)}-second clip at up to ${Math.min(8, sourceInfo.fps).toFixed(1)} pictures per second and up to ${Math.min(640, sourceInfo.width)} pixels wide. It skips some source frames to make a smaller formula.`
      : desmosPreset.value === 'ultra' && !sourceInfo
      ? 'Choose a video to use its reported frame count at the source rate and full pixel width. There is no fixed 2,160-frame ceiling. Long clips make a much bigger formula.'
      : desmosPreset.value === 'ultra' && sourceInfo
        ? `Uses ${Math.round(sourceInfo.frameCount)} source-reported samples at ${sourceInfo.fps.toFixed(2)} FPS and the full ${sourceInfo.width}-pixel width. This is the source count, not a 2,160-frame app cap. Variable-frame-rate video is sampled at even timestamps; long formulas can be very large.`
        : DESMOS_PRESET_TEXT[desmosPreset.value as DesmosPreset];
  };

  const writeSettings = (message: string) => {
    if (saveTimer !== null) window.clearTimeout(saveTimer);
    saveTimer = null;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot()));
      setStatus(message);
    } catch {
      setStatus('Your settings work, but this browser could not save them for next time.');
    }
  };
  const scheduleSave = (keepUndo = false) => {
    if (!keepUndo) {
      undoSnapshot = null;
      undoButton.hidden = true;
    }
    if (saveTimer !== null) window.clearTimeout(saveTimer);
    setStatus('Saving your choices on this device…');
    saveTimer = window.setTimeout(() => writeSettings('Saved on this device.'), 350);
  };

  const applyVideoPreset = (preset: Exclude<VideoPreset, 'custom'>) => {
    const values = VIDEO_VALUES[preset];
    const target = values.target;
    const useSource = target !== undefined && sourceHeight !== null && sourceHeight <= target;
    preferredSize = useSource ? 'source' : values.size;
    sizeSelect.value = Array.from(sizeSelect.options).some((option) => option.value === preferredSize) ? preferredSize : 'source';
    input('detail').value = values.detail;
    input('cutoff').value = values.cutoff;
    (input('smooth') as HTMLInputElement).checked = values.smooth;
    (input('dedup') as HTMLInputElement).checked = values.dedup;
    (input('preserveLines') as HTMLInputElement).checked = values.preserveLines;
    for (const id of RANGE_IDS) updateReadout(id);
    showVideoHelp(useSource ? `This video is ${sourceHeight}p, so it keeps its original size.` : '');
  };
  const applyDesmosPreset = (preset: Exclude<DesmosPreset, 'custom'>) => {
    for (const [id, value] of Object.entries(DESMOS_VALUES[preset])) input(id).value = value;
    if (preset === 'ultra' && sourceInfo) {
      input('frames').value = String(Math.max(1, Math.round(sourceInfo.frameCount)));
      input('fps').value = String(sourceInfo.fps);
      (input('frames') as HTMLInputElement).max = String(Math.max(1, Math.round(sourceInfo.frameCount)));
      input('width').value = String(sourceInfo.width);
      (input('width') as HTMLInputElement).max = String(sourceInfo.width);
    } else if (preset === 'smooth' && sourceInfo) {
      const fps = Math.min(8, sourceInfo.fps);
      input('fps').value = String(fps);
      input('frames').value = String(Math.max(1, Math.round(sourceInfo.duration * fps)));
      input('width').value = String(Math.max(48, Math.min(640, sourceInfo.width)));
      (input('frames') as HTMLInputElement).max = String(Math.max(1, Math.round(sourceInfo.frameCount)));
      (input('width') as HTMLInputElement).max = '640';
    } else if (preset !== 'ultra') {
      (input('width') as HTMLInputElement).max = '640';
    }
    showDesmosHelp();
  };
  const syncForSource = (source: SourceInfo) => {
    sourceHeight = source.height;
    sourceInfo = source;
    if (desmosPreset.value === 'ultra' || desmosPreset.value === 'smooth') {
      applyDesmosPreset(desmosPreset.value as 'ultra' | 'smooth');
    }
    if (videoPreset.value !== 'custom') {
      applyVideoPreset(videoPreset.value as Exclude<VideoPreset, 'custom'>);
      return;
    }
    const available = Array.from(sizeSelect.options).some((option) => option.value === preferredSize);
    if (available) sizeSelect.value = preferredSize;
    else {
      sizeSelect.value = 'source';
      setStatus('This clip cannot use that size, so its original size is selected.');
      scheduleSave(true);
    }
  };

  const apply = (values: SettingsSnapshot) => {
    for (const id of IDS) {
      if (id === 'videoPreset' || id === 'desmosPreset') continue;
      const control = input(id);
      const value = values[id];
      if (value === undefined) continue;
      if (control instanceof HTMLInputElement && control.type === 'checkbox') control.checked = value === true || value === 'true';
      else if (id === 'size') {
        preferredSize = String(value);
        control.value = safeValue(control, value, 'source');
      } else {
        const fallback = String(defaults[id] ?? '');
        control.value = safeValue(control, value, fallback);
      }
    }
    videoPreset.value = String(values.videoPreset ?? 'custom');
    desmosPreset.value = String(values.desmosPreset ?? 'custom');
    if (desmosPreset.value === 'full') desmosPreset.value = 'ultra';
    const oldPresetMap: Record<string, string> = { source: 'fidelity', quality: 'fidelity', detail: 'balanced', '720': 'balanced', '360': 'clean' };
    videoPreset.value = oldPresetMap[videoPreset.value] ?? videoPreset.value;
    if (!['fidelity', 'balanced', 'clean', 'custom'].includes(videoPreset.value)) videoPreset.value = 'custom';
    if (!['medium', 'small', 'pixels', 'detail', 'long', 'smooth', 'ultra', 'custom'].includes(desmosPreset.value)) desmosPreset.value = 'custom';
    for (const id of RANGE_IDS) updateReadout(id);
    showVideoHelp();
    showDesmosHelp();
  };

  try {
    const savedText = window.localStorage.getItem(STORAGE_KEY);
    if (savedText) {
      const parsed = JSON.parse(savedText) as Record<string, unknown>;
      const saved: SettingsSnapshot = {};
      for (const id of IDS) {
        const value = parsed[id];
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') saved[id] = String(value);
      }
      audioPreferenceSet = parsed.audioPreferenceSet === true;
      if (!audioPreferenceSet && parsed.audio === false) saved.audio = true;
      apply(saved);
      setStatus('Your last choices were brought back from this browser. Your video is never saved.');
    } else {
      setStatus('Your choices save only in this browser. Your video is never saved.');
      showVideoHelp();
      showDesmosHelp();
    }
  } catch {
    setStatus('Your choices save only in this browser. Your video is never saved.');
    showVideoHelp();
    showDesmosHelp();
  }

  for (const id of IDS) {
    const control = input(id);
    if (id === 'size') {
      control.addEventListener('change', () => {
        preferredSize = sizeSelect.value;
        videoPreset.value = 'custom';
        showVideoHelp();
        scheduleSave();
      });
    } else if ((RANGE_IDS as readonly string[]).includes(id)) {
      control.addEventListener('input', () => {
        updateReadout(id as (typeof RANGE_IDS)[number]);
        if (id === 'curveTolerance') {
          desmosPreset.value = 'custom';
          showDesmosHelp();
        } else {
          videoPreset.value = 'custom';
          showVideoHelp();
        }
        scheduleSave();
      });
      control.addEventListener('change', () => scheduleSave());
    } else if (['frames', 'fps', 'width', 'budget', 'slots'].includes(id)) {
      control.addEventListener('input', () => {
        desmosPreset.value = 'custom';
        showDesmosHelp();
        scheduleSave();
      });
      control.addEventListener('change', () => scheduleSave());
    } else if (id === 'audio') {
      control.addEventListener('change', () => {
        audioPreferenceSet = true;
        scheduleSave();
      });
    } else if (id === 'preserveLines') {
      control.addEventListener('change', () => {
        videoPreset.value = 'custom';
        desmosPreset.value = 'custom';
        showVideoHelp();
        showDesmosHelp();
        scheduleSave();
      });
    } else if (id !== 'videoPreset' && id !== 'desmosPreset') control.addEventListener('change', () => scheduleSave());
  }
  videoPreset.addEventListener('change', () => {
    const value = videoPreset.value as VideoPreset;
    if (value !== 'custom') applyVideoPreset(value);
    else showVideoHelp();
    scheduleSave();
  });
  desmosPreset.addEventListener('change', () => {
    const value = desmosPreset.value as DesmosPreset;
    if (value !== 'custom') applyDesmosPreset(value);
    else showDesmosHelp();
    scheduleSave();
  });

  element<HTMLButtonElement>('cancelReset').addEventListener('click', () => dialog.close());
  resetButton.addEventListener('click', () => dialog.showModal());
  element<HTMLButtonElement>('confirmReset').addEventListener('click', () => {
    undoSnapshot = snapshot();
    apply(defaults);
    if (sourceInfo !== null) syncForSource(sourceInfo);
    else applyVideoPreset('fidelity');
    undoButton.hidden = false;
    dialog.close();
    writeSettings('Settings reset. You can undo this change.');
  });
  undoButton.addEventListener('click', () => {
    if (!undoSnapshot) return;
    const previous = undoSnapshot;
    undoSnapshot = null;
    apply(previous);
    if (sourceInfo !== null) syncForSource(sourceInfo);
    undoButton.hidden = true;
    writeSettings('Your previous settings are back. Saved on this device.');
  });

  for (const id of RANGE_IDS) updateReadout(id);
  return { syncForSource };
}
