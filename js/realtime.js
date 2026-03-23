import { db, doc, getDoc, deleteDoc, onSnapshot } from "./firebase.js";
import { state, OWNER_QUEUE_KEY, OWNER_USER_KEY, CLIENT_QUEUE_KEY, getScopedClientQueueKey } from "./state.js";
import { normalizeQueue } from "./utils.js";
import {
  views,
  els,
  setNotice,
  showToast,
  renderJoinSummary,
  renderJoinStatus,
  renderMyQueueDetails,
  renderCreateMonitor,
  renderMonitor,
  startQueueTimer,
  stopQueueTimer,
  resetCreateView
} from "./ui.js";

const INACTIVITY_WARNING_MS = 25 * 60 * 1000;
const INACTIVITY_END_MS = 30 * 60 * 1000;
const MAX_QUEUE_LIFETIME_MS = 6 * 60 * 60 * 1000;
const LIFECYCLE_CHECK_INTERVAL_MS = 15 * 1000;

function stopLifecycleInterval() {
  if (state.realtimeLifecycleInterval) {
    clearInterval(state.realtimeLifecycleInterval);
    state.realtimeLifecycleInterval = null;
  }
}

function resetLifecycleState() {
  stopLifecycleInterval();
  state.latestQueueSnapshot = null;
  state.inactivityWarningKey = "";
  state.autoEndInProgress = false;
  state.queueEndNoticeOverride = "";
}

async function autoEndQueue(queueId, reason) {
  if (!queueId || state.autoEndInProgress) {
    return;
  }

  state.autoEndInProgress = true;
  state.queueEndNoticeOverride = reason === "hard-limit"
    ? "Queue ended: maximum 6-hour limit reached"
    : "Queue ended due to inactivity";
  try {
    await deleteDoc(doc(db, "queues", queueId));
    handleMissingQueue();
  } catch {
    state.autoEndInProgress = false;
    state.queueEndNoticeOverride = "";
  }
}

function evaluateQueueLifecycle(queue) {
  if (!queue || !queue.id) {
    return;
  }

  const now = Date.now();
  const createdAt = Number(queue.createdAt) || now;
  if (now - createdAt >= MAX_QUEUE_LIFETIME_MS) {
    void autoEndQueue(queue.id, "hard-limit");
    return;
  }

  const lastActivityAt = Number(queue.lastActivityAt) || createdAt;
  const inactiveForMs = Math.max(0, now - lastActivityAt);
  const warningKey = `${queue.id}:${lastActivityAt}`;

  if (inactiveForMs >= INACTIVITY_END_MS) {
    void autoEndQueue(queue.id, "inactivity");
    return;
  }

  if (inactiveForMs >= INACTIVITY_WARNING_MS && state.inactivityWarningKey !== warningKey) {
    state.inactivityWarningKey = warningKey;
    showToast("No activity detected. Queue will end in 5 minutes due to inactivity.", "info", 7000);
    return;
  }

  if (inactiveForMs < INACTIVITY_WARNING_MS && state.inactivityWarningKey === warningKey) {
    state.inactivityWarningKey = "";
  }
}

function startLifecycleChecks() {
  stopLifecycleInterval();
  state.realtimeLifecycleInterval = window.setInterval(() => {
    evaluateQueueLifecycle(state.latestQueueSnapshot);
  }, LIFECYCLE_CHECK_INTERVAL_MS);
}

function handleMissingQueue(noticeMessage = "Queue ended") {
  const endedQueueId = state.currentQueueId;

  // Ignore stale duplicate callbacks after local cleanup already completed.
  if (!endedQueueId) {
    return;
  }

  if (localStorage.getItem(CLIENT_QUEUE_KEY) === endedQueueId) {
    localStorage.removeItem(CLIENT_QUEUE_KEY);
  }
  if (state.userId) {
    const scopedKey = getScopedClientQueueKey(state.userId);
    if (localStorage.getItem(scopedKey) === endedQueueId) {
      localStorage.removeItem(scopedKey);
    }
  }
  if (localStorage.getItem(OWNER_QUEUE_KEY) === endedQueueId) {
    localStorage.removeItem(OWNER_QUEUE_KEY);
    localStorage.removeItem(OWNER_USER_KEY);
  }

  stopQueueTimer();
  resetCreateView();
  resetLifecycleState();
  if (state.unsubscribe) {
    state.unsubscribe();
    state.unsubscribe = null;
  }
  state.currentQueueId = null;
  state.ownerQueueActive = false;

  const isInActiveQueueView =
    (views.join && views.join.style.display !== "none") ||
    (views.myQueue && views.myQueue.style.display !== "none") ||
    (views.monitor && views.monitor.style.display !== "none") ||
    (views.create && views.create.style.display !== "none");

  if (isInActiveQueueView && typeof window.__dqGoHome === "function") {
    window.__dqGoHome();
  }

  const resolvedNotice = state.queueEndNoticeOverride || noticeMessage;
  state.queueEndNoticeOverride = "";

  if (resolvedNotice) {
    setNotice(resolvedNotice);
  }
}

function startRealtime() {
  if (state.unsubscribe) {
    state.unsubscribe();
  }
  resetLifecycleState();

  if (!state.currentQueueId) {
    return;
  }

  const ref = doc(db, "queues", state.currentQueueId);
  startLifecycleChecks();

  state.unsubscribe = onSnapshot(ref, (snap) => {
    if (!snap.exists()) {
      handleMissingQueue();
      return;
    }
    const queue = normalizeQueue(snap.data(), state.currentQueueId);
    state.latestQueueSnapshot = queue;
    evaluateQueueLifecycle(queue);
    renderJoinSummary(queue);
    const userStillInQueue = (queue.members || []).some(m => m.id === state.userId);
    if (!userStillInQueue && localStorage.getItem(CLIENT_QUEUE_KEY) === state.currentQueueId) {
      localStorage.removeItem(CLIENT_QUEUE_KEY);
    }
    if (!userStillInQueue && state.userId) {
      const scopedKey = getScopedClientQueueKey(state.userId);
      if (localStorage.getItem(scopedKey) === state.currentQueueId) {
        localStorage.removeItem(scopedKey);
      }
    }
    startQueueTimer(queue.createdAt);

    if (views.monitor.style.display !== "none") {
      renderMonitor(queue);
    }

    if (views.join.style.display !== "none") {
      renderJoinStatus(queue);
    }

    if (views.myQueue.style.display !== "none") {
      renderMyQueueDetails(queue);
    }

    if (views.create.style.display !== "none" && !els.createResult.classList.contains("hidden")) {
      renderCreateMonitor(queue);
    }
  });
}

async function refreshCurrentQueue() {
  if (!state.currentQueueId) {
    return;
  }

  try {
    const ref = doc(db, "queues", state.currentQueueId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      handleMissingQueue();
      return;
    }
    const queue = normalizeQueue(snap.data(), state.currentQueueId);
    state.latestQueueSnapshot = queue;
    evaluateQueueLifecycle(queue);
    startQueueTimer(queue.createdAt);
    renderJoinSummary(queue);

    if (views.create.style.display !== "none") {
      renderCreateMonitor(queue);
    }

    if (views.monitor.style.display !== "none") {
      renderMonitor(queue);
    }
  } catch {
    setNotice("Error refreshing queue");
  }
}

export { startRealtime, refreshCurrentQueue };
