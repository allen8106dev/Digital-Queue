import { state, CLIENT_QUEUE_KEY, CLIENT_NAME_KEY, getScopedClientQueueKey } from "./state.js";
import {
  views,
  els,
  setNotice,
  clearNotice,
  switchView
} from "./ui.js";
import { login, logout, getUser, initAuth } from "./auth.js";

window.__dqAppReady = false;

const SETTINGS_REMEMBER_NAME_KEY = "dqRememberName";

let queueServiceModulePromise = null;
let realtimeModulePromise = null;
let joinScannerStream = null;
let joinScannerFrameRequest = null;
let joinScannerActive = false;
const GOOGLE_ACCOUNT_LOGO_URL = "https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg";
const ACCOUNT_AVATAR_KEY = "dq_account_avatar";

const accountMenuBtn = document.getElementById("accountMenuBtn");
const accountMenu = document.getElementById("accountMenu");
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
let ownerTabWatchInterval = null;

function stopOwnerTabWatch() {
  if (ownerTabWatchInterval) {
    clearInterval(ownerTabWatchInterval);
    ownerTabWatchInterval = null;
  }
}

window.__dqRegisterOwnerTab = (queueId, ownerTabWindow) => {
  stopOwnerTabWatch();
  if (!queueId || !ownerTabWindow) {
    return;
  }

  ownerTabWatchInterval = window.setInterval(async () => {
    if (!ownerTabWindow.closed) {
      return;
    }

    stopOwnerTabWatch();
    const { endQueueById } = await getQueueService();
    await endQueueById(queueId);
  }, 1000);
};

async function getQueueService() {
  if (!queueServiceModulePromise) {
    queueServiceModulePromise = import("./queueService.js");
  }
  return queueServiceModulePromise;
}

async function getRealtime() {
  if (!realtimeModulePromise) {
    realtimeModulePromise = import("./realtime.js");
  }
  return realtimeModulePromise;
}

function goHome() {
  stopJoinScanner();
  history.replaceState({}, "", window.location.pathname);
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

async function shareQueueLink() {
  if (!state.currentJoinLink) {
    setNotice("Queue link is not ready yet");
    return;
  }

  const sharePayload = {
    title: "Join my queue",
    text: "Use this link to join the queue",
    url: state.currentJoinLink
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
  const shareText = `Scan to join ${queueName}`;

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
      text: `${shareText}\n${state.currentJoinLink}`,
      url: state.currentJoinLink
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
      ? "Scan a queue QR code or enter a queue link/code to continue."
      : "Enter a queue link or queue code to continue.";
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
    setNotice("Enter a queue link or code");
    return;
  }

  const { openQueueForJoin } = await getQueueService();
  await openQueueForJoin(locator);
}

function stopJoinScanner() {
  joinScannerActive = false;
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
    els.joinScannerPanel.classList.add("hidden");
  }
}

async function startJoinScanner() {
  if (!isMobileDevice()) {
    return;
  }

  if (!("BarcodeDetector" in window)) {
    setNotice("QR scanner is not supported on this device. Use link/code entry.");
    if (els.joinManualPanel) {
      els.joinManualPanel.classList.remove("hidden");
    }
    return;
  }

  stopJoinScanner();

  try {
    const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
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
    if (els.joinManualPanel) {
      els.joinManualPanel.classList.add("hidden");
    }
    if (els.joinScannerStatus) {
      els.joinScannerStatus.textContent = "Scanning...";
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
    setNotice("Could not open camera. Use link/code entry.");
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
  const { openQueueForJoin, openQueueForOwner, restoreOwnerQueueFromSession, getStoredClientQueueId, clearStoredClientQueueId } = await getQueueService();
  const user = getUser();

  if (!id) {
    const ownerRestored = await restoreOwnerQueueFromSession();
    if (ownerRestored) {
      clearNotice();
      return;
    }

    const savedClientQueueId = getStoredClientQueueId(user?.uid);
    if (savedClientQueueId) {
      const restored = await openQueueForJoin(savedClientQueueId);
      if (restored) {
        clearNotice();
        return;
      }
      clearStoredClientQueueId(user?.uid);
    }

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
  if (mode !== "monitor" && user?.uid) {
    localStorage.setItem(getScopedClientQueueKey(user.uid), id);
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

// 🎯 NAVIGATION
document.getElementById("goCreate").onclick = () => switchView(views.create);
document.getElementById("goJoin").onclick = showJoinEntryView;
document.getElementById("toHomeFromJoin").onclick = goHome;
document.getElementById("myQueueBackBtn").onclick = () => switchView(views.join);
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
    accountMenuState.textContent = user ? user.displayName || "Signed in" : "Sign in";
  }

  if (menuSignIn) {
    menuSignIn.classList.toggle("hidden", Boolean(user));
  }

  if (menuLogout) {
    menuLogout.classList.toggle("hidden", !user);
  }

  if (homeAuthMessage) {
    homeAuthMessage.textContent = user
      ? `Welcome back, ${user.displayName || "User"}. Manage account options from the top-right menu.`
      : "Sign in from the top-right account menu to continue.";
  }

  const goCreate = document.getElementById("goCreate");
  const goJoin = document.getElementById("goJoin");
  if (goCreate && goJoin) {
    const disabled = !user;
    goCreate.disabled = disabled;
    goJoin.disabled = disabled;
    goCreate.style.opacity = disabled ? "0.5" : "1";
    goJoin.style.opacity = disabled ? "0.5" : "1";
  }
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
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeAccountMenu();
    closeSettingsModal();
  }
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

if (els.closeScannerBtn) {
  els.closeScannerBtn.onclick = () => {
    stopJoinScanner();
    if (els.joinManualPanel) {
      els.joinManualPanel.classList.remove("hidden");
    }
  };
}

window.addEventListener("popstate", async () => {
  if (!state.ownerQueueActive) {
    return;
  }

  const { endQueueAndReturnHome } = await getQueueService();
  const ended = await endQueueAndReturnHome();
  if (!ended) {
    history.pushState({ ownerQueueGuard: true }, "", window.location.href);
  }
});

window.addEventListener("beforeunload", (event) => {
  const params = new URLSearchParams(window.location.search);
  const isOwnerTab = params.get("mode") === "owner";
  if (!isOwnerTab || !state.ownerQueueActive) {
    return;
  }

  event.preventDefault();
  event.returnValue = "Closing this tab will end the queue.";
});

// 🎯 ACTIONS
document.getElementById("createBtn").onclick = async () => {
  const { createQueue } = await getQueueService();
  createQueue();
};
document.getElementById("joinBtn").onclick = async () => {
  const { joinQueue } = await getQueueService();
  joinQueue();
};
document.getElementById("nextBtn").onclick = async () => {
  const { serveNext } = await getQueueService();
  serveNext();
};
document.getElementById("exitQueueBtn").onclick = async () => {
  const { exitQueue } = await getQueueService();
  exitQueue();
};
document.getElementById("myQueueExitBtn").onclick = async () => {
  const { exitQueue } = await getQueueService();
  exitQueue();
};
document.getElementById("createNextBtn").onclick = async () => {
  const { serveNext } = await getQueueService();
  serveNext();
};
document.getElementById("createRefreshBtn").onclick = async () => {
  const { refreshCurrentQueue } = await getRealtime();
  refreshCurrentQueue();
};
document.getElementById("refreshBtn").onclick = async () => {
  const { refreshCurrentQueue } = await getRealtime();
  refreshCurrentQueue();
};
els.endQueueBtn.onclick = async () => {
  const { endQueueAndReturnHome } = await getQueueService();
  endQueueAndReturnHome();
};
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
    const isMinimized = els.queueDetailsDrawer.classList.toggle("minimized");
    els.queueDetailsToggle.setAttribute("aria-expanded", String(!isMinimized));
  };
}
els.createMonitorList.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  const memberId = target.getAttribute("data-remove-member-id");
  if (!memberId) {
    return;
  }
  getQueueService().then(({ removeClient }) => {
    removeClient(memberId);
  });
});
els.queueList.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  const memberId = target.getAttribute("data-remove-member-id");
  if (!memberId) {
    return;
  }
  getQueueService().then(({ removeClient }) => {
    removeClient(memberId);
  });
});

async function bootstrap() {
  applySavedNamePreference();

  await new Promise((resolve) => {
    initAuth((user) => {
      if (user) {
        state.userId = user.uid;
      } else {
        state.userId = null;
      }
      updateAuthButton();
      resolve();
    });
  });
  
  await initFromUrl();
  window.__dqAppReady = true;
}

bootstrap();
