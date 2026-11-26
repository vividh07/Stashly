import { isCapturableUrl, saveToVault } from './lib/capture.js';

const MENU_PAGE = 'aether-save-page';
const MENU_LINK = 'aether-save-link';
const MENU_SELECTION = 'aether-save-selection';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_PAGE,
    title: 'Save to Aether Vault',
    contexts: ['page'],
  });
  chrome.contextMenus.create({
    id: MENU_LINK,
    title: 'Save to Aether Vault',
    contexts: ['link'],
  });
  chrome.contextMenus.create({
    id: MENU_SELECTION,
    title: 'Save to Aether Vault',
    contexts: ['selection'],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  let payload = { url: '', title: '', text: '' };

  if (info.menuItemId === MENU_LINK) {
    payload = {
      url: info.linkUrl || '',
      title: (info.linkText || info.selectionText || '').trim(),
      text: '',
    };
  } else if (info.menuItemId === MENU_SELECTION) {
    payload = {
      url: tab?.url || '',
      title: tab?.title || '',
      text: info.selectionText || '',
    };
  } else {
    payload = {
      url: tab?.url || '',
      title: tab?.title || '',
      text: '',
    };
  }

  if (payload.url && !isCapturableUrl(payload.url) && !payload.text.trim()) return;

  void saveToVault(payload);
});