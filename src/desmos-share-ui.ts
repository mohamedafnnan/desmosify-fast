import { decodeShareHash, encodeShareHash } from './lib/desmos-share.ts';
import type { DesmosSharePayload } from './lib/desmos-share.ts';

export type CurrentDesmosResult = Omit<DesmosSharePayload, 'version'>;

const DESMOS_CALCULATOR_URL = 'https://www.desmos.com/calculator';
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const snapshotKey = (result: CurrentDesmosResult) => JSON.stringify({ version: 1, ...result });

async function copyText(text: string, textarea: HTMLTextAreaElement | HTMLInputElement): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    textarea.focus();
    textarea.select();
    return false;
  }
}

async function copyAndOpenDesmos(textarea: HTMLTextAreaElement, status: HTMLElement) {
  const formulas = textarea.value;
  if (!formulas.trim()) return;
  // Open synchronously during the click gesture so popup blockers are less likely to stop it.
  window.open(DESMOS_CALCULATOR_URL, '_blank', 'noopener,noreferrer');
  const copied = await copyText(formulas, textarea);
  status.textContent = copied
    ? 'Formulas copied and Desmos opened. In Desmos, click an empty expression line and paste once.'
    : 'Desmos opened. The formulas are selected here; copy them, then paste once into an empty Desmos expression line.';
}

export function initializeDesmosShareUI(getCurrentResult: () => CurrentDesmosResult | null) {
  const previewFormulas = byId<HTMLTextAreaElement>('latex');
  const copyOpenDesmos = byId<HTMLButtonElement>('copyOpenDesmos');
  const copyStatus = byId<HTMLElement>('desmosOpenStatus');
  const createShareLink = byId<HTMLButtonElement>('createShareLink');
  const shareLinkOutput = byId<HTMLElement>('shareLinkOutput');
  const shareLink = byId<HTMLInputElement>('shareLink');
  const copyShareLink = byId<HTMLButtonElement>('copyShareLink');
  const shareLinkStatus = byId<HTMLElement>('shareLinkStatus');
  const sharedResult = byId<HTMLElement>('sharedResult');
  const sharedTitle = byId<HTMLHeadingElement>('sharedTitle');
  const sharedMeta = byId<HTMLElement>('sharedMeta');
  const sharedInstructions = byId<HTMLElement>('sharedInstructions');
  const sharedFormulas = byId<HTMLTextAreaElement>('sharedFormulas');
  const sharedStatus = byId<HTMLElement>('sharedStatus');
  const copyOpenShared = byId<HTMLButtonElement>('copyOpenShared');
  const copySharedFormulas = byId<HTMLButtonElement>('copySharedFormulas');
  const copyCurrentShareLink = byId<HTMLButtonElement>('copyCurrentShareLink');
  let activeLinkSnapshot = '';

  copyOpenDesmos.addEventListener('click', () => void copyAndOpenDesmos(previewFormulas, copyStatus));
  copyOpenShared.addEventListener('click', () => void copyAndOpenDesmos(sharedFormulas, sharedStatus));

  copySharedFormulas.addEventListener('click', async () => {
    const copied = await copyText(sharedFormulas.value, sharedFormulas);
    sharedStatus.textContent = copied
      ? 'Formulas copied. Open Desmos, click an empty expression line, and paste once.'
      : 'The formulas are selected. Copy them, then paste into an empty Desmos expression line.';
  });

  createShareLink.addEventListener('click', async () => {
    const current = getCurrentResult();
    if (!current) return;
    createShareLink.disabled = true;
    shareLinkStatus.textContent = 'Preparing a compact share link…';
    try {
      const fragment = await encodeShareHash({ version: 1, ...current });
      const resultUrl = new URL(window.location.href);
      resultUrl.hash = fragment.slice(1);
      shareLink.value = resultUrl.toString();
      shareLinkOutput.hidden = false;
      activeLinkSnapshot = snapshotKey(current);
      const copied = await copyText(shareLink.value, shareLink);
      shareLinkStatus.textContent = copied
        ? 'Share link copied. It reopens these exact formulas and setup; the original video is not included.'
        : 'The share link is selected below. Copy it to share the exact formulas and setup; the original video is not included.';
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not create this share link.';
      shareLinkStatus.textContent = message;
    } finally {
      createShareLink.disabled = false;
    }
  });

  copyShareLink.addEventListener('click', async () => {
    if (!shareLink.value) return;
    const copied = await copyText(shareLink.value, shareLink);
    shareLinkStatus.textContent = copied
      ? 'Share link copied. Anyone with it can reopen and copy these formulas.'
      : 'The share link is selected. Copy it to share the drawing.';
  });

  copyCurrentShareLink.addEventListener('click', async () => {
    const copied = await copyText(window.location.href, sharedFormulas);
    sharedStatus.textContent = copied
      ? 'This Desmosify result link was copied.'
      : 'The formulas are selected. Copy the page URL from your browser’s address bar to share this result link.';
  });

  function invalidateIfChanged(current: CurrentDesmosResult) {
    if (!activeLinkSnapshot || snapshotKey(current) === activeLinkSnapshot) return;
    activeLinkSnapshot = '';
    shareLink.value = '';
    shareLinkOutput.hidden = true;
    shareLinkStatus.textContent = 'The drawing changed, so its old link was cleared. Create a new share link for the updated formulas.';
  }

  async function loadSharedResult() {
    if (!window.location.hash.startsWith('#desmosify=')) return;
    sharedResult.hidden = false;
    byId<HTMLElement>('workspace').hidden = true;
    try {
      const payload = await decodeShareHash(window.location.hash);
      if (!payload) throw new Error('This link does not contain a shared drawing.');
      sharedTitle.textContent = payload.mode === 'clip' ? 'Ready-to-paste animated drawing' : 'Ready-to-paste Desmos drawing';
      sharedMeta.textContent = payload.mode === 'clip'
        ? `${payload.frameCount} pictures at ${payload.fps} pictures per second · drawing bounds x 0 to ${payload.width}, y 0 to ${payload.height}`
        : `One picture · drawing bounds x 0 to ${payload.width}, y 0 to ${payload.height}`;
      sharedInstructions.textContent = payload.mode === 'clip'
        ? `Copy & Open Desmos opens a blank graph with these formulas on your clipboard. Paste once into an empty expression line. Set Graph Settings to x: 0 to ${payload.width}, y: 0 to ${payload.height}. Set the f slider to minimum 1, maximum ${payload.frameCount}, step 1, then press play.`
        : `Copy & Open Desmos opens a blank graph with these formulas on your clipboard. Paste once into an empty expression line, then set Graph Settings to x: 0 to ${payload.width}, y: 0 to ${payload.height}.`;
      sharedFormulas.value = payload.formulas;
      sharedFormulas.hidden = false;
      copyOpenShared.disabled = false;
      copySharedFormulas.disabled = false;
      copyCurrentShareLink.disabled = false;
      sharedStatus.textContent = 'This link contains formulas and graph setup, not the original video. Use Desmos’s Share menu after pasting if you need a native Desmos graph link.';
    } catch (error) {
      sharedTitle.textContent = 'This drawing link could not be opened';
      sharedMeta.textContent = 'The link may be incomplete or too large. Ask the sender for the full link, or return to the converter and make a simpler drawing.';
      sharedInstructions.textContent = '';
      sharedFormulas.hidden = true;
      copyOpenShared.disabled = true;
      copySharedFormulas.disabled = true;
      copyCurrentShareLink.disabled = true;
      sharedStatus.textContent = error instanceof Error ? error.message : 'This drawing link is damaged or incomplete.';
    }
  }

  void loadSharedResult();
  return { invalidateIfChanged };
}
