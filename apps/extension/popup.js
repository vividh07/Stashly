import {
  DEFAULT_ORIGIN,
  getVaultOrigin,
  isCapturableUrl,
  saveToVault,
} from './lib/capture.js';

const originInput = document.getElementById('origin');
const saveBtn = document.getElementById('save');
const statusEl = document.getElementById('status');

function setStatus(text, kind = '') {
  statusEl.textContent = text;
  statusEl.className = `status${kind ? ` ${kind}` : ''}`;
}

async function loadOrigin() {
  const origin = await getVaultOrigin();
  originInput.value = origin;
}

async function persistOrigin() {
  const value = originInput.value.trim() || DEFAULT_ORIGIN;
  const normalized = value.replace(/\/$/, '');
  await chrome.storage.sync.set({ vaultOrigin: normalized });
  originInput.value = normalized;
  return normalized;
}

originInput.addEventListener('change', () => {
  void persistOrigin().then(() => setStatus('Vault origin saved.'));
});

saveBtn.addEventListener('click', async () => {
  saveBtn.disabled = true;
  setStatus('Saving…');

  try {
    await persistOrigin();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) {
      setStatus('No active tab.', 'err');
      return;
    }
    if (!isCapturableUrl(tab.url)) {
      setStatus('This page cannot be saved (restricted URL).', 'err');
      return;
    }

    const result = await saveToVault(
      { url: tab.url, title: tab.title || '', text: '' },
      { preferApi: true },
    );

    if (result.method === 'api') {
      setStatus('Saved to vault via API.', 'ok');
    } else {
      setStatus('Opened vault capture tab — confirm in the modal.', 'ok');
    }
  } catch (err) {
    setStatus(err instanceof Error ? err.message : 'Save failed.', 'err');
  } finally {
    saveBtn.disabled = false;
  }
});

void loadOrigin();