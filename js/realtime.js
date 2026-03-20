import { db, doc, getDoc, onSnapshot } from "./firebase.js";
import { state, CLIENT_QUEUE_KEY, getScopedClientQueueKey } from "./state.js";
import { normalizeQueue } from "./utils.js";
import {
  views,
  els,
  setNotice,
  renderJoinSummary,
  renderJoinStatus,
  renderMyQueueDetails,
  renderCreateMonitor,
  renderMonitor,
  startQueueTimer,
  stopQueueTimer
} from "./ui.js";

function startRealtime() {
  if (state.unsubscribe) {
    state.unsubscribe();
  }

  const ref = doc(db, "queues", state.currentQueueId);

  state.unsubscribe = onSnapshot(ref, (snap) => {
    if (!snap.exists()) {
      if (localStorage.getItem(CLIENT_QUEUE_KEY) === state.currentQueueId) {
        localStorage.removeItem(CLIENT_QUEUE_KEY);
      }
      if (state.userId) {
        const scopedKey = getScopedClientQueueKey(state.userId);
        if (localStorage.getItem(scopedKey) === state.currentQueueId) {
          localStorage.removeItem(scopedKey);
        }
      }
      stopQueueTimer();
      setNotice("Queue not found");
      return;
    }
    const queue = normalizeQueue(snap.data(), state.currentQueueId);
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
      setNotice("Queue not found");
      return;
    }
    const queue = normalizeQueue(snap.data(), state.currentQueueId);
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
