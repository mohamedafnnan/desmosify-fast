type SettingValue = string | boolean;
type SettingsSnapshot = Record<string, SettingValue>;

const STORAGE_KEY = 'desmosify-fast.settings.v1';
const IDS = ['size', 'detail', 'lineWidth', 'threads', 'cutoff', 'smooth', 'grid', 'dedup', 'vfr', 'audio', 'frames', 'fps', 'width', 'budget', 'slots'] as const;
const RANGE_IDS = ['detail', 'cutoff'] as const;

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
  const outputId = id === 'detail' ? 'detailValue' : 'cutoffValue';
  const output = element<HTMLOutputElement>(outputId);
  const value = Number(control.value);
  output.textContent = id === 'detail' ? `${value.toFixed(2).replace(/\.?0+$/, '')}×` : value.toFixed(2);
}

function safeValue(control: HTMLInputElement | HTMLSelectElement, value: SettingValue, fallback: string): string {
  const raw = String(value);
  if (control instanceof HTMLSelectElement) {
    return Array.from(control.options).some((option) => option.value === raw) ? raw : fallback;
  }
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
  const threadInput = element<HTMLInputElement>('threads');

  if (!threadInput.value) threadInput.value = String(Math.max(1, Math.min((navigator.hardwareConcurrency || 4) - 1, 12)));

  const defaults = readCurrent('source');
  let preferredSize = 'source';
  let undoSnapshot: SettingsSnapshot | null = null;
  let saveTimer: number | null = null;

  const setStatus = (message: string) => { status.textContent = message; };
  const snapshot = () => readCurrent(preferredSize || sizeSelect.value);

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

  const apply = (values: SettingsSnapshot) => {
    for (const id of IDS) {
      const control = input(id);
      const value = values[id];
      if (value === undefined) continue;
      if (control instanceof HTMLInputElement && control.type === 'checkbox') {
        control.checked = value === true || value === 'true';
      } else if (id === 'size') {
        preferredSize = String(value);
        control.value = safeValue(control, value, 'source');
      } else {
        const fallback = String(defaults[id] ?? '');
        control.value = safeValue(control, value, fallback);
      }
    }
    for (const id of RANGE_IDS) updateReadout(id);
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
      apply(saved);
      setStatus('Your last choices were brought back from this browser. Your video is never saved.');
    } else {
      setStatus('Your choices save only in this browser. Your video is never saved.');
    }
  } catch {
    setStatus('Your choices save only in this browser. Your video is never saved.');
  }

  const syncSizePreference = () => {
    const exists = Array.from(sizeSelect.options).some((option) => option.value === preferredSize);
    if (exists) {
      sizeSelect.value = preferredSize;
      return;
    }
    sizeSelect.value = 'source';
    if (preferredSize !== 'source') {
      preferredSize = 'source';
      setStatus('This clip cannot use that size, so its original size is selected.');
      scheduleSave(true);
    }
  };

  for (const id of IDS) {
    const control = input(id);
    if (id === 'size') {
      control.addEventListener('change', () => {
        preferredSize = sizeSelect.value;
        scheduleSave();
      });
    } else if ((RANGE_IDS as readonly string[]).includes(id)) {
      control.addEventListener('input', () => {
        updateReadout(id as (typeof RANGE_IDS)[number]);
        scheduleSave();
      });
      control.addEventListener('change', () => scheduleSave());
    } else {
      control.addEventListener('change', () => scheduleSave());
    }
  }

  element<HTMLButtonElement>('cancelReset').addEventListener('click', () => dialog.close());
  resetButton.addEventListener('click', () => dialog.showModal());
  element<HTMLButtonElement>('confirmReset').addEventListener('click', () => {
    undoSnapshot = snapshot();
    apply(defaults);
    syncSizePreference();
    undoButton.hidden = false;
    dialog.close();
    writeSettings('Settings reset. You can undo this change.');
  });
  undoButton.addEventListener('click', () => {
    if (!undoSnapshot) return;
    const previous = undoSnapshot;
    undoSnapshot = null;
    apply(previous);
    syncSizePreference();
    undoButton.hidden = true;
    writeSettings('Your previous settings are back. Saved on this device.');
  });

  for (const id of RANGE_IDS) updateReadout(id);
  return { syncSizePreference };
}
