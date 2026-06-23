const CHARLY = "http://127.0.0.1:8765";

const titleEl = document.getElementById("page-title");
const urlEl = document.getElementById("page-url");
const folderEl = document.getElementById("folder");
const clipBtn = document.getElementById("clip");
const statusEl = document.getElementById("status");
const footEl = document.getElementById("foot");

let tab = null;

function setStatus(kind, msg) {
  if (!kind) {
    statusEl.hidden = true;
    return;
  }
  statusEl.hidden = false;
  statusEl.className = `status ${kind}`;
  statusEl.textContent = msg;
}

async function getActiveTab() {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  return t;
}

// Build the dropdown: Inbox + library root + every existing subfolder.
function fillFolders(data, lastUsed) {
  folderEl.innerHTML = "";
  const add = (value, label) => {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    folderEl.appendChild(o);
  };
  add("Inbox", "📥  Inbox (default)");
  add("", `🏠  ${data.library || "Library"} (root)`);
  for (const rel of data.folders || []) {
    if (rel === "Inbox") continue; // already offered above
    const depth = rel.split("/").length - 1;
    add(rel, `${"  ".repeat(depth + 1)}${rel.split("/").pop()}`);
  }
  const has = [...folderEl.options].some((o) => o.value === lastUsed);
  folderEl.value = has ? lastUsed : "Inbox";
  folderEl.disabled = false;
}

async function init() {
  tab = await getActiveTab();
  titleEl.textContent = tab?.title || "Untitled page";
  urlEl.textContent = tab?.url || "";

  if (!tab?.url || !/^https?:/i.test(tab.url)) {
    setStatus("err", "This page can't be clipped (only http/https links).");
    return;
  }

  const { lastFolder } = await chrome.storage.sync.get("lastFolder");
  try {
    const res = await fetch(`${CHARLY}/folders`);
    if (res.status === 409) {
      setStatus("err", "Open Charly and choose a library folder first.");
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    fillFolders(data, lastFolder ?? "Inbox");
    clipBtn.disabled = false;
    footEl.textContent = "Charly is running ✓";
  } catch (e) {
    setStatus(
      "err",
      "Couldn't reach Charly. Make sure the Charly app is open, then reopen this popup."
    );
  }
}

clipBtn.addEventListener("click", async () => {
  clipBtn.disabled = true;
  folderEl.disabled = true;
  setStatus("busy", "Clipping…");
  const folder = folderEl.value;
  try {
    const res = await fetch(`${CHARLY}/clip`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: tab.url, title: tab.title, folder }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    await chrome.storage.sync.set({ lastFolder: folder });
    const where = folder === "" ? "library root" : folder;
    const what = data.kind === "pdf" ? "PDF saved" : "Link saved";
    setStatus("ok", `${what} to ${where}: ${data.file}`);
  } catch (e) {
    setStatus("err", String(e.message || e));
    clipBtn.disabled = false;
    folderEl.disabled = false;
  }
});

init();
