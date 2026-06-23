const CHARLY = "http://127.0.0.1:8765";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "charly-clip-page",
    title: "Clip this page to Charly",
    contexts: ["page"],
  });
  chrome.contextMenus.create({
    id: "charly-clip-link",
    title: "Clip this link to Charly",
    contexts: ["link"],
  });
});

// Briefly flash the toolbar badge so context-menu clips give feedback.
async function flash(text, color) {
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 2500);
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const url = info.linkUrl || info.pageUrl || tab?.url;
  if (!url || !/^https?:/i.test(url)) {
    flash("!", "#c0392b");
    return;
  }
  const title = info.linkUrl ? info.selectionText || undefined : tab?.title;
  const { lastFolder } = await chrome.storage.sync.get("lastFolder");
  try {
    const res = await fetch(`${CHARLY}/clip`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, title, folder: lastFolder ?? "Inbox" }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    flash("✓", "#1a7f4b");
  } catch (e) {
    flash("!", "#c0392b");
  }
});
