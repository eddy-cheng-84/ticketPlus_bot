async function enablePanelOnActionClick() {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (error) {
    console.error('Failed to enable side panel action click behavior.', error);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  enablePanelOnActionClick();
});

chrome.runtime.onStartup.addListener(() => {
  enablePanelOnActionClick();
});
