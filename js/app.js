import { state, CLIENT_QUEUE_KEY, CLIENT_NAME_KEY, getScopedClientQueueKey, getOrCreateGuestUserId } from "./state.js";
import {
  views,
  els,
  setNotice,
  clearNotice,
  switchView,
  setLiveQueueMode,
  resetCreateView
} from "./ui.js";
import { login, logout, getUser, initAuth } from "./auth.js";

window.__dqAppReady = false;
const MODULE_VERSION = "2026.03.21.2";

const SETTINGS_REMEMBER_NAME_KEY = "dqRememberName";

let queueServiceModulePromise = null;
let realtimeModulePromise = null;
let joinScannerStream = null;
let joinScannerFrameRequest = null;
let joinScannerActive = false;
let myQueueBackGuardActive = false;
const GOOGLE_ACCOUNT_LOGO_URL = "https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg";
const ACCOUNT_AVATAR_KEY = "dq_account_avatar";

const accountMenuBtn = document.getElementById("accountMenuBtn");
const accountMenu = document.getElementById("accountMenu");
const accountHub = document.querySelector(".account-hub");
const accountMenuState = document.getElementById("accountMenuState");
const accountAvatar = document.getElementById("accountAvatar");
const menuSignIn = document.getElementById("menuSignIn");
const menuSettings = document.getElementById("menuSettings");
const menuLogout = document.getElementById("menuLogout");
const homeAuthMessage = document.getElementById("homeAuthMessage");
const settingsModal = document.getElementById("settingsModal");
const closeSettingsBtn = document.getElementById("closeSettingsBtn");
const saveSettingsBtn = document.getElementById("saveSettingsBtn");
const settingsDisplayName = document.getElementById("settingsDisplayName");
const settingsRememberName = document.getElementById("settingsRememberName");
const goCreateBtn = document.getElementById("goCreate");
const createBtn = document.getElementById("createBtn");
const createOwnerLimitHint = document.getElementById("createOwnerLimitHint");
const createOwnerLimitHintMessage = document.getElementById("createOwnerLimitHintMessage");
const hintGoToQueueBtn = document.getElementById("hintGoToQueueBtn");
const hintEndQueueBtn = document.getElementById("hintEndQueueBtn");

let activeOwnerQueueId = "";

async function getQueueService() {
  if (!queueServiceModulePromise) {
    queueServiceModulePromise = import(`./queueService.js?v=${MODULE_VERSION}`);
  }
  return queueServiceModulePromise;
}

async function getRealtime() {
  if (!realtimeModulePromise) {
    realtimeModulePromise = import(`./realtime.js?v=${MODULE_VERSION}`);
  }
  return realtimeModulePromise;
}

function goHome() {
  stopJoinScanner();
  history.replaceState({}, "", window.location.pathname);
  state.ownerQueueActive = false;
  setLiveQueueMode(false);
  clearNotice();
  switchView(views.home);
}

function resolveUserAvatar(user) {
  if (!user) {
    return "";
  }

  const primaryPhoto = typeof user.photoURL === "string" ? user.photoURL.trim() : "";
  if (primaryPhoto) {
    return primaryPhoto;
  }

  const providerPhoto = Array.isArray(user.providerData)
    ? user.providerData.find((provider) => provider?.providerId === "google.com" && typeof provider.photoURL === "string" && provider.photoURL.trim())?.photoURL?.trim()
    : "";

  return providerPhoto || "";
}

function closeAccountMenu() {
  if (!accountMenu || !accountMenuBtn) {
    return;
  }
  accountMenu.classList.add("hidden");
  accountMenuBtn.classList.remove("active");
  accountMenuBtn.setAttribute("aria-expanded", "false");
}

function closeQueueRowMenus() {
  const menus = document.querySelectorAll(".row-menu");
  menus.forEach((menu) => {
    menu.classList.add("hidden");
  });

  const triggers = document.querySelectorAll(".row-menu-trigger");
  triggers.forEach((trigger) => {
    trigger.setAttribute("aria-expanded", "false");
  });
}

function toggleQueueRowMenu(memberId) {
  if (!memberId) {
    return;
  }

  const menu = document.querySelector(`[data-member-menu="${memberId}"]`);
  const trigger = document.querySelector(`[data-menu-trigger="${memberId}"]`);
  if (!menu || !trigger) {
    return;
  }

  const willOpen = menu.classList.contains("hidden");
  closeQueueRowMenus();

  if (willOpen) {
    menu.classList.remove("hidden");
    trigger.setAttribute("aria-expanded", "true");
  }
}

function bindQueueListActions(listElement) {
  if (!listElement) {
    return;
  }

  listElement.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const menuTrigger = target.closest("[data-menu-trigger]");
    if (menuTrigger instanceof HTMLElement) {
      const memberId = menuTrigger.getAttribute("data-menu-trigger");
      toggleQueueRowMenu(memberId);
      return;
    }

    const removeButton = target.closest("[data-remove-member-id]");
    if (removeButton instanceof HTMLElement) {
      const memberId = removeButton.getAttribute("data-remove-member-id");
      closeQueueRowMenus();
      if (!memberId) {
        return;
      }
      getQueueService().then(({ removeClient }) => {
        removeClient(memberId);
      });
      return;
    }

    const banButton = target.closest("[data-ban-member-id]");
    if (banButton instanceof HTMLElement) {
      const memberId = banButton.getAttribute("data-ban-member-id");
      closeQueueRowMenus();
      if (!memberId) {
        return;
      }
      getQueueService().then(({ banClient }) => {
        banClient(memberId);
      });
    }
  });
}

function openAccountMenu() {
  if (!accountMenu || !accountMenuBtn) {
    return;
  }
  accountMenu.classList.remove("hidden");
  accountMenuBtn.classList.add("active");
  accountMenuBtn.setAttribute("aria-expanded", "true");
}

function toggleAccountMenu() {
  if (!accountMenu || accountMenu.classList.contains("hidden")) {
    openAccountMenu();
    return;
  }
  closeAccountMenu();
}

function updateAccountHubVisibility() {
  if (!accountHub || !accountMenuBtn) {
    return;
  }

  const isOwnerLiveQueue = Boolean(views.create && !views.create.hidden && state.ownerQueueActive);
  const isMemberInQueue = Boolean(views.myQueue && !views.myQueue.hidden);
  const isMonitorLiveQueue = Boolean(views.monitor && !views.monitor.hidden);
  const shouldLockDropdown = isOwnerLiveQueue || isMemberInQueue || isMonitorLiveQueue;

  accountHub.classList.remove("hidden");
  accountHub.classList.toggle("locked", shouldLockDropdown);
  accountMenuBtn.disabled = shouldLockDropdown;
  accountMenuBtn.setAttribute("aria-disabled", String(shouldLockDropdown));

  if (shouldLockDropdown) {
    closeAccountMenu();
  }
}

function openSettingsModal() {
  if (!settingsModal) {
    return;
  }
  const storedName = localStorage.getItem(CLIENT_NAME_KEY) || "";
  const shouldRemember = localStorage.getItem(SETTINGS_REMEMBER_NAME_KEY) !== "0";
  if (settingsDisplayName) {
    settingsDisplayName.value = storedName;
  }
  if (settingsRememberName) {
    settingsRememberName.checked = shouldRemember;
  }
  settingsModal.classList.remove("hidden");
}

function closeSettingsModal() {
  if (!settingsModal) {
    return;
  }
  settingsModal.classList.add("hidden");
}

function applySavedNamePreference() {
  const savedName = localStorage.getItem(CLIENT_NAME_KEY);
  if (savedName && els.nameInput) {
    els.nameInput.value = savedName;
  }
}

function setCreateLimitHint(message = "") {
  if (!createOwnerLimitHint) {
    return;
  }

  const text = String(message || "").trim();
  if (createOwnerLimitHintMessage) {
    createOwnerLimitHintMessage.textContent = text;
  }
  createOwnerLimitHint.classList.toggle("hidden", !text);
}

function applyCreateAvailability() {
  if (!createBtn) {
    return;
  }

  const hasActiveOwnerQueue = Boolean(activeOwnerQueueId);
  createBtn.disabled = hasActiveOwnerQueue;
  createBtn.setAttribute("aria-disabled", String(hasActiveOwnerQueue));

  if (hasActiveOwnerQueue) {
    setCreateLimitHint(`You already have an active queue (${activeOwnerQueueId}).`);
    return;
  }

  setCreateLimitHint("");
}

async function refreshCreateAvailability() {
  try {
    const { getActiveOwnerQueueIdForCurrentUser } = await getQueueService();
    activeOwnerQueueId = await getActiveOwnerQueueIdForCurrentUser();
  } catch {
    activeOwnerQueueId = "";
  }

  applyCreateAvailability();
}

async function shareQueueLink() {
  if (!state.currentJoinLink) {
    setNotice("Queue link is not ready yet");
    return;
  }

  const queueName = (els.createQueueName?.textContent || "Queue").trim() || "Queue";
  const queueDate = (els.createStartDate?.textContent || "-").trim() || "-";
  const queueTime = (els.createStartTime?.textContent || "-").trim() || "-";
  const queueDateTime = `${queueDate} ${queueTime}`.trim();
  const shareBody = [
    `Queue Name: ${queueName}`,
    `Date & Time: ${queueDateTime}`,
    "Scan QR code or click the link to join",
    state.currentJoinLink
  ].join("\n");

  const sharePayload = {
    title: "Join my queue",
    text: shareBody
  };

  if (navigator.share) {
    try {
      await navigator.share(sharePayload);
      setNotice("Queue link shared");
      return;
    } catch {
      setNotice("Sharing was canceled");
      return;
    }
  }

  setNotice("Sharing is not supported on this device");
}

async function shareQueueQr() {
  if (!state.currentJoinLink || !state.currentQrUrl) {
    setNotice("Queue QR is not ready yet");
    return;
  }

  const queueName = (els.createQueueName?.textContent || "Queue").trim() || "Queue";
  const queueDate = (els.createStartDate?.textContent || "-").trim() || "-";
  const queueTime = (els.createStartTime?.textContent || "-").trim() || "-";
  const queueDateTime = `${queueDate} ${queueTime}`.trim();
  const shareText = [
    `Queue Name: ${queueName}`,
    `Date & Time: ${queueDateTime}`,
    "Scan QR code or click the link to join",
    state.currentJoinLink
  ].join("\n");

  if (!navigator.share) {
    setNotice("Sharing is not supported on this device");
    return;
  }

  try {
    const response = await fetch(state.currentQrUrl, { mode: "cors" });
    if (!response.ok) {
      throw new Error("qr_fetch_failed");
    }

    const qrBlob = await response.blob();
    const qrFile = new File([qrBlob], "queue-qr.png", { type: qrBlob.type || "image/png" });
    const payloadWithFile = {
      title: "Join my queue",
      text: shareText,
      files: [qrFile]
    };

    if (navigator.canShare && navigator.canShare({ files: [qrFile] })) {
      await navigator.share(payloadWithFile);
      setNotice("Queue QR shared");
      return;
    }

    await navigator.share({
      title: "Join my queue",
      text: shareText
    });
    setNotice("Queue details shared");
  } catch {
    setNotice("Sharing was canceled");
  }
}

function isMobileDevice() {
  const ua = navigator.userAgent || "";
  return /Android|iPhone|iPad|iPod|Mobi/i.test(ua) || window.matchMedia("(pointer:coarse)").matches;
}

function setJoinEntryMode() {
  const mobile = isMobileDevice();
  if (els.joinEntryCopy) {
    els.joinEntryCopy.textContent = mobile
      ? "Scan a queue QR code or enter a queue code to continue."
      : "Enter a queue code to continue.";
  }

  if (els.joinEntryScannerActions) {
    els.joinEntryScannerActions.classList.toggle("hidden", !mobile);
  }

  if (els.joinManualPanel) {
    els.joinManualPanel.classList.toggle("hidden", mobile);
  }

  if (els.joinScannerPanel) {
    els.joinScannerPanel.classList.add("hidden");
  }

  if (els.joinScannerStatus) {
    els.joinScannerStatus.textContent = "Point your camera at a queue QR code.";
  }
}

function showJoinEntryView() {
  stopJoinScanner();
  setJoinEntryMode();
  if (els.joinQueueLocatorInput) {
    els.joinQueueLocatorInput.value = "";
  }
  clearNotice();
  switchView(views.joinEntry);
}

async function continueJoinEntry(locatorValue) {
  const locator = String(locatorValue || els.joinQueueLocatorInput?.value || "").trim();
  if (!locator) {
    setNotice("Enter a queue code");
    return;
  }

  const { openQueueForJoin } = await getQueueService();
  await openQueueForJoin(locator);
}

function stopJoinScanner() {
  joinScannerActive = false;
  if (views.joinEntry) {
    views.joinEntry.classList.remove("scanner-active");
  }
  if (joinScannerFrameRequest) {
    cancelAnimationFrame(joinScannerFrameRequest);
    joinScannerFrameRequest = null;
  }
  if (joinScannerStream) {
    joinScannerStream.getTracks().forEach(track => track.stop());
    joinScannerStream = null;
  }
  if (els.joinQrVideo) {
    els.joinQrVideo.srcObject = null;
  }
  if (els.joinScannerPanel) {
    els.joinScannerPanel.classList.remove("scanner-compact");
    els.joinScannerPanel.classList.add("hidden");
  }
  if (isMobileDevice() && els.joinEntryScannerActions) {
    els.joinEntryScannerActions.classList.remove("hidden");
  }
}

async function startJoinScanner() {
  if (!isMobileDevice()) {
    return;
  }

  stopJoinScanner();

  try {
    const supportsBarcodeDetector = "BarcodeDetector" in window;
    const detector = supportsBarcodeDetector ? new window.BarcodeDetector({ formats: ["qr_code"] }) : null;
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false
    });

    joinScannerStream = stream;
    joinScannerActive = true;

    if (els.joinQrVideo) {
      els.joinQrVideo.srcObject = stream;
      await els.joinQrVideo.play();
    }

    if (els.joinScannerPanel) {
      els.joinScannerPanel.classList.remove("hidden");
    }
    if (views.joinEntry) {
      views.joinEntry.classList.add("scanner-active");
    }
    if (els.joinEntryScannerActions) {
      els.joinEntryScannerActions.classList.add("hidden");
    }
    if (els.joinManualPanel) {
      els.joinManualPanel.classList.add("hidden");
    }
    if (els.joinScannerStatus) {
      els.joinScannerStatus.textContent = supportsBarcodeDetector
        ? "Scanning..."
        : "Camera preview open. Auto-scan is not supported on this device.";
    }

    if (!detector) {
      return;
    }

    const scan = async () => {
      if (!joinScannerActive || !els.joinQrVideo) {
        return;
      }

      try {
        const barcodes = await detector.detect(els.joinQrVideo);
        const first = barcodes.find(code => code.rawValue);
        if (first && first.rawValue) {
          if (els.joinScannerStatus) {
            els.joinScannerStatus.textContent = "Queue QR detected. Opening queue...";
          }
          stopJoinScanner();
          await continueJoinEntry(first.rawValue);
          return;
        }
      } catch {
        // keep scanning frame-by-frame
      }

      joinScannerFrameRequest = requestAnimationFrame(() => {
        scan();
      });
    };

    scan();
  } catch {
    stopJoinScanner();
    setNotice("Could not open camera. Use queue code entry.");
    if (els.joinManualPanel) {
      els.joinManualPanel.classList.remove("hidden");
    }
  }
}

// 🔁 INIT
async function initFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("queue");
  const mode = params.get("mode");
  const { openQueueForJoin, openQueueForOwner } = await getQueueService();
  const user = getUser();

  if (!id) {
    const savedName = localStorage.getItem(CLIENT_NAME_KEY);
    if (savedName) {
      els.nameInput.value = savedName;
    } else if (user && user.displayName) {
      els.nameInput.value = user.displayName;
    }

    goHome();
    return;
  }

  state.currentQueueId = id;
  if (mode !== "monitor" && mode !== "owner" && state.userId) {
    localStorage.setItem(getScopedClientQueueKey(state.userId), id);
    localStorage.setItem(CLIENT_QUEUE_KEY, id);
  }
  const savedName = localStorage.getItem(CLIENT_NAME_KEY);
  if (savedName) {
    els.nameInput.value = savedName;
  } else if (user && user.displayName) {
    els.nameInput.value = user.displayName;
  }

  if (mode === "owner") {
    const opened = await openQueueForOwner(id);
    if (!opened) {
      goHome();
    }
  } else if (mode === "monitor") {
    switchView(views.monitor);
    const { startRealtime } = await getRealtime();
    startRealtime();
  } else {
    await openQueueForJoin(id);
  }
}

function getMyQueueUrl() {
  const queueId = state.currentQueueId ? encodeURIComponent(state.currentQueueId) : "";
  if (!queueId) {
    return window.location.pathname;
  }
  return `${window.location.pathname}?queue=${queueId}`;
}

function syncMyQueueBackGuard() {
  const isMyQueueActive = Boolean(views.myQueue && !views.myQueue.hidden && state.currentQueueId);

  if (isMyQueueActive && !myQueueBackGuardActive) {
    history.pushState({ dqMyQueueGuard: true }, "", getMyQueueUrl());
    myQueueBackGuardActive = true;
    return;
  }

  if (!isMyQueueActive) {
    myQueueBackGuardActive = false;
  }
}

// 🎯 NAVIGATION
if (goCreateBtn) {
  goCreateBtn.onclick = async () => {
    if (!state.ownerQueueActive) {
      resetCreateView();
    }

    await refreshCreateAvailability();

    switchView(views.create);
  };
}
document.getElementById("goJoin").onclick = showJoinEntryView;
document.getElementById("toHomeFromJoin").onclick = goHome;
const myQueueBackBtn = document.getElementById("myQueueBackBtn");
if (myQueueBackBtn) {
  myQueueBackBtn.onclick = () => switchView(views.join);
}
document.getElementById("backFromCreateSetup").onclick = goHome;
window.handleHomeJoinClick = showJoinEntryView;

function updateAuthButton() {
  const user = getUser();

  if (accountAvatar) {
    const resolvedAvatar = resolveUserAvatar(user);
    if (resolvedAvatar) {
      accountAvatar.src = resolvedAvatar;
      localStorage.setItem(ACCOUNT_AVATAR_KEY, resolvedAvatar);
    } else {
      const cachedAvatar = localStorage.getItem(ACCOUNT_AVATAR_KEY) || "";
      accountAvatar.src = cachedAvatar || GOOGLE_ACCOUNT_LOGO_URL;
    }

    accountAvatar.alt = user ? `${user.displayName || "Google"} profile photo` : "Google account";

    if (!user) {
      localStorage.removeItem(ACCOUNT_AVATAR_KEY);
    }
  }

  if (accountMenuState) {
    const isQueueContext =
      (Boolean(state.ownerQueueActive) && Boolean(views.create && !views.create.hidden)) ||
      Boolean(state.currentQueueId && (
        (views.join && !views.join.hidden) ||
        (views.myQueue && !views.myQueue.hidden) ||
        (views.monitor && !views.monitor.hidden)
      ));

    accountMenuState.textContent = user
      ? user.displayName || "Signed in"
      : (isQueueContext ? "Guest" : "Sign in");
  }

  if (menuSignIn) {
    menuSignIn.classList.toggle("hidden", Boolean(user));
  }

  if (menuLogout) {
    menuLogout.classList.toggle("hidden", !user);
  }

  if (homeAuthMessage) {
    const googleProfile = user?.providerData?.find((provider) => provider?.providerId === "google.com");
    const resolvedName = (googleProfile?.displayName || user?.displayName || user?.email || "").toString().trim();
    homeAuthMessage.textContent = user
      ? `Welcome, ${resolvedName || "User"}`
      : "Welcome";
  }

  updateAccountHubVisibility();
  void refreshCreateAvailability();
}

if (accountMenuBtn) {
  accountMenuBtn.onclick = () => {
    toggleAccountMenu();
  };
}

if (accountAvatar) {
  const cachedAvatar = localStorage.getItem(ACCOUNT_AVATAR_KEY) || "";
  accountAvatar.src = cachedAvatar || GOOGLE_ACCOUNT_LOGO_URL;
  accountAvatar.addEventListener("error", () => {
    if (accountAvatar.src !== GOOGLE_ACCOUNT_LOGO_URL) {
      accountAvatar.src = GOOGLE_ACCOUNT_LOGO_URL;
    }
  });
}

if (menuSignIn) {
  menuSignIn.onclick = async () => {
    closeAccountMenu();
    try {
      await login();
      updateAuthButton();
    } catch {
      setNotice("Google Sign-in failed. Please try again.");
    }
  };
}

if (menuLogout) {
  menuLogout.onclick = async () => {
    closeAccountMenu();
    try {
      await logout();
      updateAuthButton();
    } catch {
      setNotice("Log out failed. Please try again.");
    }
  };
}

if (menuSettings) {
  menuSettings.onclick = () => {
    closeAccountMenu();
    openSettingsModal();
  };
}

if (closeSettingsBtn) {
  closeSettingsBtn.onclick = () => {
    closeSettingsModal();
  };
}

if (saveSettingsBtn) {
  saveSettingsBtn.onclick = () => {
    const rememberName = Boolean(settingsRememberName?.checked);
    const enteredName = String(settingsDisplayName?.value || "").trim();

    localStorage.setItem(SETTINGS_REMEMBER_NAME_KEY, rememberName ? "1" : "0");
    if (rememberName && enteredName) {
      localStorage.setItem(CLIENT_NAME_KEY, enteredName);
      if (els.nameInput) {
        els.nameInput.value = enteredName;
      }
    }
    if (!rememberName) {
      localStorage.removeItem(CLIENT_NAME_KEY);
      if (els.nameInput) {
        els.nameInput.value = "";
      }
    }

    closeSettingsModal();
    setNotice("Settings updated.");
  };
}

if (settingsModal) {
  settingsModal.addEventListener("click", (event) => {
    if (event.target === settingsModal) {
      closeSettingsModal();
    }
  });
}

document.addEventListener("click", (event) => {
  if (!accountMenu || !accountMenuBtn) {
    return;
  }
  const target = event.target;
  if (!(target instanceof Node)) {
    return;
  }
  if (!accountMenu.contains(target) && !accountMenuBtn.contains(target)) {
    closeAccountMenu();
  }

  if (!target.closest(".queue-table-actions")) {
    closeQueueRowMenus();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeAccountMenu();
    closeSettingsModal();
    closeQueueRowMenus();
  }
});

document.addEventListener("dq:view-change", () => {
  updateAuthButton();
  updateAccountHubVisibility();
  syncMyQueueBackGuard();
  void refreshCreateAvailability();
});

if (els.joinEntryBackBtn) {
  els.joinEntryBackBtn.onclick = goHome;
}

if (els.joinEntryContinueBtn) {
  els.joinEntryContinueBtn.onclick = async () => {
    await continueJoinEntry();
  };
}

if (els.joinQueueLocatorInput) {
  els.joinQueueLocatorInput.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    await continueJoinEntry();
  });
}

if (els.showManualJoinBtn) {
  els.showManualJoinBtn.onclick = () => {
    stopJoinScanner();
    if (els.joinEntryScannerActions) {
      els.joinEntryScannerActions.classList.add("hidden");
    }
    if (els.joinManualPanel) {
      els.joinManualPanel.classList.remove("hidden");
    }
  };
}

if (els.openScannerBtn) {
  els.openScannerBtn.onclick = async () => {
    await startJoinScanner();
  };
}

const joinEntryActionBackBtn = document.getElementById("joinEntryActionBackBtn");
if (joinEntryActionBackBtn) {
  joinEntryActionBackBtn.onclick = goHome;
}

if (els.closeScannerBtn) {
  els.closeScannerBtn.onclick = () => {
    stopJoinScanner();
    setJoinEntryMode();
  };
}

window.addEventListener("popstate", async () => {
  const isMyQueueActive = Boolean(views.myQueue && !views.myQueue.hidden && state.currentQueueId);
  if (!isMyQueueActive) {
    return;
  }

  const confirmed = window.confirm("Exit queue now? You will lose your position.");
  if (!confirmed) {
    history.pushState({ dqMyQueueGuard: true }, "", getMyQueueUrl());
    myQueueBackGuardActive = true;
    return;
  }

  const { exitQueue } = await getQueueService();
  await exitQueue({ skipConfirmation: true, skipReload: true });
});

// 🎯 ACTIONS
if (hintGoToQueueBtn) {
  hintGoToQueueBtn.onclick = async () => {
    if (!activeOwnerQueueId) {
      setNotice("Queue ID not found");
      return;
    }

    const { openQueueForOwner } = await getQueueService();
    const opened = await openQueueForOwner(activeOwnerQueueId);
    if (!opened) {
      setNotice("Could not open your queue");
    }
  };
}

if (hintEndQueueBtn) {
  hintEndQueueBtn.onclick = async () => {
    const confirmed = window.confirm("End your active queue? This cannot be undone.");
    if (!confirmed) {
      return;
    }

    const { endQueueById } = await getQueueService();
    const ended = await endQueueById(activeOwnerQueueId);
    if (ended) {
      activeOwnerQueueId = "";
      applyCreateAvailability();
      setNotice("Queue ended");
    } else {
      setNotice("Error ending queue");
    }
  };
}

if (createBtn) {
  createBtn.onclick = async () => {
    if (createBtn.disabled) {
      setNotice("You already have an active queue");
      return;
    }

    const { createQueue } = await getQueueService();
    createQueue();
  };
}
document.getElementById("joinBtn").onclick = async () => {
  const { joinQueue } = await getQueueService();
  joinQueue();
};
document.getElementById("nextBtn").onclick = async () => {
  const { serveNext } = await getQueueService();
  serveNext();
};
if (document.getElementById("exitQueueBtn")) {
  document.getElementById("exitQueueBtn").onclick = async () => {
    const { exitQueue } = await getQueueService();
    exitQueue();
  };
}
document.getElementById("myQueueExitBtn").onclick = async () => {
  const { exitQueue } = await getQueueService();
  exitQueue();
};
document.getElementById("createNextBtn").onclick = async () => {
  const { serveNext } = await getQueueService();
  serveNext();
};
if (els.endQueueBtn) {
  els.endQueueBtn.onclick = async () => {
    const { endQueueAndReturnHome } = await getQueueService();
    endQueueAndReturnHome();
  };
}
if (els.monitorEndQueueBtn) {
  els.monitorEndQueueBtn.onclick = async () => {
    const { endQueueAndReturnHome } = await getQueueService();
    endQueueAndReturnHome();
  };
}
if (els.createEndQueueBtn) {
  els.createEndQueueBtn.onclick = async () => {
    const { endQueueAndReturnHome } = await getQueueService();
    endQueueAndReturnHome();
  };
}
// Expose goHome globally for queueService to call
window.__dqGoHome = goHome;
if (els.shareLinkBtn) {
  els.shareLinkBtn.onclick = async () => {
    await shareQueueLink();
  };
}
if (els.shareQrBtn) {
  els.shareQrBtn.onclick = async () => {
    await shareQueueQr();
  };
}
if (els.queueDetailsToggle && els.queueDetailsDrawer) {
  els.queueDetailsToggle.onclick = () => {
    const panel = document.getElementById("queueDetailsPanel");
    if (panel) {
      const isHidden = panel.classList.toggle("hidden");
      els.queueDetailsToggle.setAttribute("aria-expanded", String(!isHidden));
    }
  };
}
if (els.myQueueDetailsToggle && els.myQueueDetailsDrawer) {
  els.myQueueDetailsToggle.onclick = () => {
    const panel = document.getElementById("myQueueDetailsPanel");
    if (panel) {
      const isHidden = panel.classList.toggle("hidden");
      els.myQueueDetailsToggle.setAttribute("aria-expanded", String(!isHidden));
    }
  };
}
bindQueueListActions(els.createMonitorList);
bindQueueListActions(els.queueList);

async function bootstrap() {
  applySavedNamePreference();
  applyCreateAvailability();

  state.userId = getOrCreateGuestUserId();

  await new Promise((resolve) => {
    initAuth((user) => {
      if (user) {
        state.userId = user.uid;
      } else {
        state.userId = getOrCreateGuestUserId();
      }
      updateAuthButton();
      resolve();
    });
  });

  await refreshCreateAvailability();
  
  await initFromUrl();
  window.__dqAppReady = true;
}

bootstrap();
