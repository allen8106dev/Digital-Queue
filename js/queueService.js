import { db, doc, setDoc, getDoc, deleteDoc, updateDoc, firebaseConfig } from "./firebase.js";
import { state, OWNER_QUEUE_KEY, OWNER_USER_KEY, CLIENT_QUEUE_KEY, CLIENT_NAME_KEY, getScopedClientQueueKey } from "./state.js";
import { randomId, buildJoinLink, normalizeQueue } from "./utils.js";
import { startRealtime } from "./realtime.js";
import { getUser } from "./auth.js";
import {
  views,
  els,
  setNotice,
  clearNotice,
  switchView,
  setLiveQueueMode,
  renderQr,
  renderQueueDetailsMeta,
  renderJoinSummary,
  renderJoinStatus,
  renderMyQueueDetails,
  renderCreateMonitor,
  startQueueTimer,
  stopQueueTimer,
  resetCreateView
} from "./ui.js";

function notifyQueueEndedAndReturnHome() {
  if (typeof window.__dqGoHome === "function") {
    window.__dqGoHome();
  } else {
    switchView(views.home);
    history.replaceState({}, "", window.location.pathname);
  }
  setNotice("Queue ended");
}

async function setOwnerSessionQueue(userId, queueId) {
  void userId;
  void queueId;
}

async function setClientSessionQueue(userId, queueId) {
  void userId;
  void queueId;
}

function parseQueueIdFromLocator(locator) {
  const raw = String(locator || "").trim();
  if (!raw) {
    return "";
  }

  try {
    const parsed = new URL(raw, window.location.origin);
    const byQuery = parsed.searchParams.get("queue");
    if (byQuery) {
      return byQuery.trim();
    }
  } catch {
    // ignore invalid URL and fall through to lightweight parsing
  }

  const queryMatch = raw.match(/[?&]queue=([^&#]+)/i);
  if (queryMatch && queryMatch[1]) {
    try {
      return decodeURIComponent(queryMatch[1]).trim();
    } catch {
      return queryMatch[1].trim();
    }
  }

  return raw;
}

function setStoredClientQueueId(userId, queueId) {
  if (!userId || !queueId) {
    return;
  }
  localStorage.setItem(getScopedClientQueueKey(userId), queueId);
  localStorage.setItem(CLIENT_QUEUE_KEY, queueId);
}

function getStoredClientQueueId(userId) {
  if (!userId) {
    return localStorage.getItem(CLIENT_QUEUE_KEY) || "";
  }

  const scoped = localStorage.getItem(getScopedClientQueueKey(userId));
  if (scoped) {
    return scoped;
  }

  return localStorage.getItem(CLIENT_QUEUE_KEY) || "";
}

function clearStoredClientQueueId(userId) {
  if (userId) {
    localStorage.removeItem(getScopedClientQueueKey(userId));
  }
  localStorage.removeItem(CLIENT_QUEUE_KEY);
}

function renderOwnerQueueWorkspace(queue, queueId) {
  state.currentQueueId = queueId;
  state.currentJoinLink = buildJoinLink(queueId);
  els.createQueueName.textContent = queue.title;
  if (els.createQueueTitle) {
    els.createQueueTitle.textContent = queue.title;
  }
  els.queueLink.innerHTML = `<a href="${state.currentJoinLink}" target="_blank" rel="noopener noreferrer">${state.currentJoinLink}</a>`;
  renderQr(state.currentJoinLink);
  renderQueueDetailsMeta(queue);
  els.createSetupPanel.classList.add("hidden");
  els.createResult.classList.remove("hidden");
  setLiveQueueMode(true);
  state.ownerQueueActive = true;
  switchView(views.create);
  history.replaceState({}, "", `${window.location.pathname}?queue=${encodeURIComponent(queueId)}&mode=owner`);
  renderCreateMonitor(queue);
  startQueueTimer(queue.createdAt);
  startRealtime();
}

async function openQueueForJoin(locatorOrQueueId, options = {}) {
  const queueId = parseQueueIdFromLocator(locatorOrQueueId);
  if (!queueId) {
    setNotice("Enter a queue code");
    return false;
  }

  const requireMembership = Boolean(options.requireMembership);

  try {
    const ref = doc(db, "queues", queueId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      setNotice("Queue not found");
      return false;
    }

    const queue = normalizeQueue(snap.data(), queueId);
    const user = getUser();
    const activeUserId = state.userId || user?.uid || "";

    if (activeUserId && queue.ownerId === activeUserId) {
      const openedOwner = await openQueueForOwner(queueId);
      if (!openedOwner) {
        setNotice("Only the queue creator can manage this queue");
      }
      return openedOwner;
    }

    state.currentQueueId = queueId;
    if (activeUserId) {
      setStoredClientQueueId(activeUserId, queueId);
    }

    renderJoinSummary(queue);
    renderJoinStatus(queue);
    renderMyQueueDetails(queue);

    const existingMember = (queue.members || []).find(m => m.id === activeUserId);
    if (requireMembership && activeUserId && !existingMember) {
      clearStoredClientQueueId(activeUserId);
      if (user?.uid) {
        await setClientSessionQueue(user.uid, null);
      }
      return false;
    }

    const savedName = localStorage.getItem(CLIENT_NAME_KEY);
    if (existingMember && existingMember.name) {
      els.nameInput.value = existingMember.name;
      localStorage.setItem(CLIENT_NAME_KEY, existingMember.name);
    } else if (savedName) {
      els.nameInput.value = savedName;
    } else if (user && user.displayName) {
      els.nameInput.value = user.displayName;
    }

    history.replaceState({}, "", `${window.location.pathname}?queue=${encodeURIComponent(queueId)}`);
    switchView(existingMember ? views.myQueue : views.join);
    startRealtime();
    clearNotice();
    return true;
  } catch {
    setNotice("Error opening queue");
    return false;
  }
}

async function restoreOwnerQueueFromSession() {
  const user = getUser();
  const storedQueueId = localStorage.getItem(OWNER_QUEUE_KEY);
  const storedOwnerUserId = localStorage.getItem(OWNER_USER_KEY);

  if (!user || !user.uid) {
    return false;
  }

  if (storedOwnerUserId && storedOwnerUserId !== user.uid) {
    localStorage.removeItem(OWNER_QUEUE_KEY);
    localStorage.removeItem(OWNER_USER_KEY);
  }

  const scopedStoredQueueId =
    storedOwnerUserId && storedOwnerUserId !== user.uid
      ? ""
      : storedQueueId;

  if (!scopedStoredQueueId) {
    return false;
  }

  try {
    const ref = doc(db, "queues", scopedStoredQueueId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      localStorage.removeItem(OWNER_QUEUE_KEY);
      localStorage.removeItem(OWNER_USER_KEY);
      await setOwnerSessionQueue(user.uid, null);
      return false;
    }
    const queueData = snap.data() || {};
    const queueOwnerId = typeof queueData.ownerId === "string" ? queueData.ownerId : "";
    if (queueOwnerId && queueOwnerId !== user.uid) {
      await setOwnerSessionQueue(user.uid, null);
      return false;
    }

    await setOwnerSessionQueue(user.uid, scopedStoredQueueId);
    const queue = normalizeQueue(queueData, scopedStoredQueueId);
    renderOwnerQueueWorkspace(queue, scopedStoredQueueId);
    return true;
  } catch {
    return false;
  }
}

async function restoreClientQueueFromSession() {
  const user = getUser();
  const activeUserId = state.userId || user?.uid || "";
  if (!activeUserId) {
    return false;
  }

  const localQueueId = getStoredClientQueueId(activeUserId);
  if (localQueueId) {
    const openedLocal = await openQueueForJoin(localQueueId, { requireMembership: true });
    if (openedLocal) {
      if (user?.uid) {
        await setClientSessionQueue(user.uid, localQueueId);
      }
      return true;
    }
    clearStoredClientQueueId(activeUserId);
  }

  return false;
}

async function openQueueForOwner(queueId) {
  const user = getUser();
  const activeOwnerId = state.userId || user?.uid || "";
  if (!activeOwnerId) {
    setNotice("Could not verify queue owner identity");
    return false;
  }

  try {
    const ref = doc(db, "queues", queueId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      if (localStorage.getItem(OWNER_QUEUE_KEY) === queueId) {
        localStorage.removeItem(OWNER_QUEUE_KEY);
        localStorage.removeItem(OWNER_USER_KEY);
      }
      setNotice("Queue ended");
      return false;
    }

    const queueData = snap.data() || {};
    if (queueData.ownerId && queueData.ownerId !== activeOwnerId) {
      setNotice("Only the queue creator can manage this queue");
      return false;
    }

    localStorage.setItem(OWNER_QUEUE_KEY, queueId);
    localStorage.setItem(OWNER_USER_KEY, activeOwnerId);
    if (user?.uid) {
      await setOwnerSessionQueue(user.uid, queueId);
    }

    const queue = normalizeQueue(queueData, queueId);
    renderOwnerQueueWorkspace(queue, queueId);
    clearNotice();
    return true;
  } catch {
    setNotice("Error opening owner queue");
    return false;
  }
}

async function endQueueById(queueId) {
  if (!queueId) {
    return false;
  }

  try {
    const user = getUser();
    await deleteDoc(doc(db, "queues", queueId));
    if (localStorage.getItem(OWNER_QUEUE_KEY) === queueId) {
      localStorage.removeItem(OWNER_QUEUE_KEY);
      localStorage.removeItem(OWNER_USER_KEY);
    }
    if (user?.uid) {
      await setOwnerSessionQueue(user.uid, null);
    }
    return true;
  } catch {
    return false;
  }
}

async function endQueueAndReturnHome() {
  const confirmed = window.confirm("Ending this queue will close the live monitor. Continue?");
  if (!confirmed) {
    return false;
  }

  if (state.unsubscribe) {
    state.unsubscribe();
    state.unsubscribe = null;
  }

  try {
    if (state.currentQueueId) {
      await deleteDoc(doc(db, "queues", state.currentQueueId));
    }
  } catch {
    setNotice("Error ending queue");
    return false;
  }

  state.currentQueueId = null;
  localStorage.removeItem(OWNER_QUEUE_KEY);
  localStorage.removeItem(OWNER_USER_KEY);
  const user = getUser();
  if (user?.uid) {
    await setOwnerSessionQueue(user.uid, null);
  }
  resetCreateView();
  clearNotice();
  stopQueueTimer();

  switchView(views.home);
  history.replaceState({}, "", window.location.pathname);
  setNotice("Queue ended");

  return true;
}

async function endOwnerQueueOnTabClose() {
  const user = getUser();
  const activeUserId = state.userId || user?.uid || "";
  if (!activeUserId) {
    return false;
  }

  const storedQueueId = localStorage.getItem(OWNER_QUEUE_KEY) || "";
  const storedOwnerUserId = localStorage.getItem(OWNER_USER_KEY) || "";
  const queueId = storedQueueId || (state.ownerQueueActive ? state.currentQueueId : "");

  if (!queueId || storedOwnerUserId !== activeUserId) {
    return false;
  }

  const cleanupLocalOwnerState = () => {
    if (localStorage.getItem(OWNER_QUEUE_KEY) === queueId) {
      localStorage.removeItem(OWNER_QUEUE_KEY);
      localStorage.removeItem(OWNER_USER_KEY);
    }
  };

  try {
    await deleteDoc(doc(db, "queues", queueId));
  } catch {
    // Keepalive REST fallback gives another chance during tab close.
    try {
      const endpoint = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(firebaseConfig.projectId)}/databases/(default)/documents/queues/${encodeURIComponent(queueId)}?key=${encodeURIComponent(firebaseConfig.apiKey)}`;
      fetch(endpoint, {
        method: "DELETE",
        keepalive: true,
        mode: "cors"
      });
    } catch {
      // ignore close-time cleanup failures
    }
  }

  cleanupLocalOwnerState();
  if (user?.uid) {
    await setOwnerSessionQueue(user.uid, null);
  }
  return true;
}

// 🔥 CREATE QUEUE
async function createQueue() {
  const user = getUser();
  const activeOwnerId = state.userId || user?.uid || "";
  if (!activeOwnerId) {
    setNotice("Could not determine queue owner identity");
    return;
  }

  // Check if user already has an active owner queue
  const existingQueueId = localStorage.getItem(OWNER_QUEUE_KEY);
  const existingUserId = localStorage.getItem(OWNER_USER_KEY);
  
  if (existingQueueId && existingUserId === activeOwnerId) {
    // Reuse existing queue only if it still exists; otherwise clear stale local state.
    const openedExisting = await openQueueForOwner(existingQueueId);
    if (openedExisting) {
      return;
    }

    if (localStorage.getItem(OWNER_QUEUE_KEY) === existingQueueId) {
      localStorage.removeItem(OWNER_QUEUE_KEY);
      localStorage.removeItem(OWNER_USER_KEY);
    }
  }

  const title = els.titleInput.value.trim();
  if (!title) {
    setNotice("Enter a queue name");
    return;
  }

  const queue = {
    id: randomId(),
    title,
    ownerId: activeOwnerId,
    createdAt: Date.now(),
    servingName: "-",
    servingMemberId: null,
    servingStartedAt: null,
    totalServeMs: 0,
    completedServeCount: 0,
    avgMinutes: 0,
    bannedUserIds: [],
    members: []
  };

  try {
    await setDoc(doc(db, "queues", queue.id), queue);
  } catch (error) {
    const details = error && typeof error.message === "string" ? `: ${error.message}` : "";
    setNotice(`Error creating queue${details}`);
    console.error("Create queue failed", error);
    return;
  }

  try {
    localStorage.setItem(OWNER_QUEUE_KEY, queue.id);
    localStorage.setItem(OWNER_USER_KEY, activeOwnerId);
    if (user?.uid) {
      await setOwnerSessionQueue(user.uid, queue.id);
    }
    await openQueueForOwner(queue.id);
  } catch (error) {
    // Queue was created, but a client-side UI/realtime step failed.
    console.error("Queue created but post-create UI update failed", error);
    setNotice("Queue created, but the page failed to update. Refresh to continue.");
  }
}

// 🔥 JOIN QUEUE
async function joinQueue() {
  const user = getUser();
  const activeUserId = state.userId || user?.uid || "";
  if (!activeUserId) {
    setNotice("Could not determine your queue identity");
    return;
  }

  if (!state.currentQueueId) {
    setNotice("Open a valid queue code before joining");
    return;
  }

  const name = els.nameInput.value.trim();
  if (!name) {
    setNotice("Enter your name");
    return;
  }

  try {
    const ref = doc(db, "queues", state.currentQueueId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      setNotice("Queue not found");
      return;
    }
    const queue = normalizeQueue(snap.data(), state.currentQueueId);

    if ((queue.bannedUserIds || []).includes(activeUserId)) {
      setNotice("You are banned from this queue");
      return;
    }

    // prevent duplicate join
    const exists = queue.members.find(m => m.id === activeUserId);

    if (!exists) {
      queue.members.push({
        id: activeUserId,
        name,
        joinedAt: Date.now(),
        served: false
      });

      await updateDoc(ref, { members: queue.members });
      localStorage.setItem(CLIENT_NAME_KEY, name);
    } else {
      localStorage.setItem(CLIENT_NAME_KEY, exists.name || name);
    }

    setStoredClientQueueId(activeUserId, state.currentQueueId);
    if (user?.uid) {
      await setClientSessionQueue(user.uid, state.currentQueueId);
    }
    els.nameInput.value = localStorage.getItem(CLIENT_NAME_KEY) || name;

    renderJoinSummary(queue);
    renderJoinStatus(queue);
    renderMyQueueDetails(queue);
    switchView(views.myQueue);
    setNotice("Joined queue");
  } catch {
    setNotice("Error joining queue");
  }
}

async function exitQueue(options = {}) {
  const skipConfirmation = Boolean(options.skipConfirmation);
  const skipReload = Boolean(options.skipReload);
  const user = getUser();
  const activeUserId = state.userId || user?.uid || "";
  if (!activeUserId) {
    setNotice("Could not determine your queue identity");
    return;
  }

  if (!state.currentQueueId) {
    return;
  }

  if (!skipConfirmation) {
    const confirmed = window.confirm("Exit queue now? You will lose your position.");
    if (!confirmed) {
      return;
    }
  }

  try {
    const ref = doc(db, "queues", state.currentQueueId);
    const snap = await getDoc(ref);
    const queue = snap.data();

    if (!queue) {
      notifyQueueEndedAndReturnHome();
      return;
    }

    const members = queue.members || [];
    const updatedMembers = members.filter(m => m.id !== activeUserId);

    if (updatedMembers.length === members.length) {
      setNotice("You are not in this queue");
      return;
    }

    await updateDoc(ref, { members: updatedMembers });
    clearStoredClientQueueId(activeUserId);
    if (user?.uid) {
      await setClientSessionQueue(user.uid, null);
    }
    localStorage.removeItem(CLIENT_NAME_KEY);
    if (state.unsubscribe) {
      state.unsubscribe();
      state.unsubscribe = null;
    }
    state.currentQueueId = null;
    els.joinStatus.classList.add("hidden");
    setNotice("You exited the queue");
    if (skipReload) {
      switchView(views.home);
      history.replaceState({}, "", window.location.pathname);
      return;
    }
    window.location.href = window.location.pathname;
  } catch {
    setNotice("Error exiting queue");
  }
}

// 🔥 SERVE NEXT
async function serveNext() {
  try {
    const ref = doc(db, "queues", state.currentQueueId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      notifyQueueEndedAndReturnHome();
      return;
    }
    const queue = normalizeQueue(snap.data(), state.currentQueueId);

    const now = Date.now();
    let completedServeCount = queue.completedServeCount || 0;
    let totalServeMs = queue.totalServeMs || 0;

    if (queue.servingMemberId) {
      const servingMember = queue.members.find(m => m.id === queue.servingMemberId && !m.served);
      if (servingMember) {
        servingMember.served = true;
      }

      if (queue.servingStartedAt) {
        const elapsed = Math.max(0, now - queue.servingStartedAt);
        if (elapsed > 0) {
          totalServeMs += elapsed;
          completedServeCount += 1;
        }
      }
    }

    const next = queue.members.find(m => !m.served);
    const servingName = next ? next.name : "-";
    const servingMemberId = next ? next.id : null;
    const servingStartedAt = next ? now : null;
    const avgMinutes = completedServeCount > 0 ? totalServeMs / completedServeCount / 60000 : 0;

    await updateDoc(ref, {
      members: queue.members,
      servingName,
      servingMemberId,
      servingStartedAt,
      completedServeCount,
      totalServeMs,
      avgMinutes
    });
  } catch {
    setNotice("Error updating queue");
  }
}

async function removeClient(memberId) {
  if (!state.currentQueueId || !memberId) {
    return;
  }

  try {
    const ref = doc(db, "queues", state.currentQueueId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      notifyQueueEndedAndReturnHome();
      return;
    }

    const queue = normalizeQueue(snap.data(), state.currentQueueId);
    const target = queue.members.find(m => m.id === memberId);
    if (!target) {
      setNotice("Client already removed");
      return;
    }

    const members = queue.members.filter(m => m.id !== memberId);
    let servingMemberId = queue.servingMemberId;
    let servingName = queue.servingName;
    let servingStartedAt = queue.servingStartedAt;

    if (queue.servingMemberId === memberId) {
      const next = members.find(m => !m.served) || null;
      servingMemberId = next ? next.id : null;
      servingName = next ? next.name : "-";
      servingStartedAt = next ? Date.now() : null;
    }

    await updateDoc(ref, {
      members,
      servingMemberId,
      servingName,
      servingStartedAt
    });

    setNotice(`${target.name} removed from queue`);
  } catch {
    setNotice("Error removing client");
  }
}

async function banClient(memberId) {
  if (!state.currentQueueId || !memberId) {
    return;
  }

  try {
    const ref = doc(db, "queues", state.currentQueueId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      notifyQueueEndedAndReturnHome();
      return;
    }

    const queue = normalizeQueue(snap.data(), state.currentQueueId);
    const target = queue.members.find(m => m.id === memberId);
    if (!target) {
      setNotice("Client already removed");
      return;
    }

    const members = queue.members.filter(m => m.id !== memberId);
    const bannedUserIds = Array.from(new Set([...(queue.bannedUserIds || []), memberId]));
    let servingMemberId = queue.servingMemberId;
    let servingName = queue.servingName;
    let servingStartedAt = queue.servingStartedAt;

    if (queue.servingMemberId === memberId) {
      const next = members.find(m => !m.served) || null;
      servingMemberId = next ? next.id : null;
      servingName = next ? next.name : "-";
      servingStartedAt = next ? Date.now() : null;
    }

    await updateDoc(ref, {
      members,
      bannedUserIds,
      servingMemberId,
      servingName,
      servingStartedAt
    });

    setNotice(`${target.name} was banned from this queue`);
  } catch {
    setNotice("Error banning client");
  }
}

export {
  parseQueueIdFromLocator,
  openQueueForJoin,
  openQueueForOwner,
  restoreOwnerQueueFromSession,
  restoreClientQueueFromSession,
  getStoredClientQueueId,
  clearStoredClientQueueId,
  endQueueById,
  endQueueAndReturnHome,
  endOwnerQueueOnTabClose,
  createQueue,
  joinQueue,
  exitQueue,
  serveNext,
  removeClient,
  banClient
};
