import { db, doc, setDoc, getDoc, deleteDoc, updateDoc } from "./firebase.js";
import { state, OWNER_QUEUE_KEY, CLIENT_QUEUE_KEY, CLIENT_NAME_KEY } from "./state.js";
import { randomId, buildJoinLink, normalizeQueue } from "./utils.js";
import { startRealtime } from "./realtime.js";
import { getUser } from "./auth.js";
import {
  views,
  els,
  setNotice,
  clearNotice,
  switchView,
  renderQr,
  renderJoinSummary,
  renderJoinStatus,
  renderMyQueueDetails,
  renderCreateMonitor,
  startQueueTimer,
  stopQueueTimer,
  resetCreateView
} from "./ui.js";

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

async function openQueueForJoin(locatorOrQueueId) {
  const queueId = parseQueueIdFromLocator(locatorOrQueueId);
  if (!queueId) {
    setNotice("Enter a queue link or code");
    return false;
  }

  try {
    const ref = doc(db, "queues", queueId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      setNotice("Queue not found");
      return false;
    }

    const queue = normalizeQueue(snap.data(), queueId);
    state.currentQueueId = queueId;
    localStorage.setItem(CLIENT_QUEUE_KEY, queueId);

    renderJoinSummary(queue);
    renderJoinStatus(queue);
    renderMyQueueDetails(queue);

    const user = getUser();
    const savedName = localStorage.getItem(CLIENT_NAME_KEY);
    if (savedName) {
      els.nameInput.value = savedName;
    } else if (user && user.displayName) {
      els.nameInput.value = user.displayName;
    }

    history.replaceState({}, "", `${window.location.pathname}?queue=${encodeURIComponent(queueId)}`);
    switchView(views.join);
    startRealtime();
    clearNotice();
    return true;
  } catch {
    setNotice("Error opening queue");
    return false;
  }
}

async function restoreOwnerQueueFromSession() {
  const storedQueueId = sessionStorage.getItem(OWNER_QUEUE_KEY);
  if (!storedQueueId) {
    return false;
  }

  try {
    const ref = doc(db, "queues", storedQueueId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      sessionStorage.removeItem(OWNER_QUEUE_KEY);
      return false;
    }
    const queue = normalizeQueue(snap.data(), storedQueueId);

    state.currentQueueId = storedQueueId;
    state.currentJoinLink = buildJoinLink(storedQueueId);
    els.createQueueName.textContent = queue.title;
    els.queueLink.textContent = state.currentJoinLink;
    renderQr(state.currentJoinLink);
    els.createSetupPanel.classList.add("hidden");
    els.createResult.classList.remove("hidden");
    state.ownerQueueActive = true;
    switchView(views.create);
    history.pushState({ ownerQueueGuard: true }, "", window.location.href);
    renderCreateMonitor(queue);
    startQueueTimer(queue.createdAt);
    startRealtime();
    return true;
  } catch {
    return false;
  }
}

async function endQueueAndReturnHome() {
  const confirmed = window.confirm("Going back will end this queue for everyone. Continue?");
  if (!confirmed) {
    return false;
  }

  try {
    if (state.currentQueueId) {
      await deleteDoc(doc(db, "queues", state.currentQueueId));
    }
  } catch {
    setNotice("Error ending queue");
    return false;
  }

  if (state.unsubscribe) {
    state.unsubscribe();
    state.unsubscribe = null;
  }

  state.currentQueueId = null;
  resetCreateView();
  clearNotice();
  switchView(views.home);
  history.replaceState({}, "", window.location.pathname);
  stopQueueTimer();
  return true;
}

// 🔥 CREATE QUEUE
async function createQueue() {
  const user = getUser();
  if (!user) {
    setNotice("Sign in with Google to create a queue");
    return;
  }

  const title = els.titleInput.value.trim();
  if (!title) {
    setNotice("Enter a queue name");
    return;
  }

  try {
    const queue = {
      id: randomId(),
      title,
      createdAt: Date.now(),
      servingName: "-",
      servingMemberId: null,
      servingStartedAt: null,
      totalServeMs: 0,
      completedServeCount: 0,
      avgMinutes: 0,
      members: []
    };

    await setDoc(doc(db, "queues", queue.id), queue);

    state.currentQueueId = queue.id;

    const link = buildJoinLink(queue.id);
    state.currentJoinLink = link;
    els.createQueueName.textContent = queue.title;
    els.queueLink.textContent = link;
    renderQr(link);
    els.createSetupPanel.classList.add("hidden");
    els.createResult.classList.remove("hidden");
    state.ownerQueueActive = true;
    sessionStorage.setItem(OWNER_QUEUE_KEY, queue.id);
    history.pushState({ ownerQueueGuard: true }, "", window.location.href);
    renderCreateMonitor(queue);
    startQueueTimer(queue.createdAt);
    startRealtime();

    clearNotice();
  } catch {
    setNotice("Error creating queue");
  }
}

// 🔥 JOIN QUEUE
async function joinQueue() {
  const user = getUser();
  if (!user) {
    setNotice("Sign in with Google to join a queue");
    return;
  }

  if (!state.currentQueueId) {
    setNotice("Open a valid queue link before joining");
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

    // prevent duplicate join
    const exists = queue.members.find(m => m.id === user.uid);

    if (!exists) {
      queue.members.push({
        id: user.uid,
        name,
        joinedAt: Date.now(),
        served: false
      });

      await updateDoc(ref, { members: queue.members });
      localStorage.setItem(CLIENT_NAME_KEY, name);
    } else {
      localStorage.setItem(CLIENT_NAME_KEY, exists.name || name);
    }

    localStorage.setItem(CLIENT_QUEUE_KEY, state.currentQueueId);
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

async function exitQueue() {
  const user = getUser();
  if (!user) {
    setNotice("You are not signed in");
    return;
  }

  if (!state.currentQueueId) {
    return;
  }

  const confirmed = window.confirm("Are you sure you want to exit this queue?");
  if (!confirmed) {
    return;
  }

  try {
    const ref = doc(db, "queues", state.currentQueueId);
    const snap = await getDoc(ref);
    const queue = snap.data();

    if (!queue) {
      setNotice("Queue not found");
      return;
    }

    const members = queue.members || [];
    const updatedMembers = members.filter(m => m.id !== user.uid);

    if (updatedMembers.length === members.length) {
      setNotice("You are not in this queue");
      return;
    }

    await updateDoc(ref, { members: updatedMembers });
    localStorage.removeItem(CLIENT_QUEUE_KEY);
    localStorage.removeItem(CLIENT_NAME_KEY);
    els.joinStatus.classList.add("hidden");
    setNotice("You exited the queue");
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
      setNotice("Queue not found");
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
      setNotice("Queue not found");
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

export {
  parseQueueIdFromLocator,
  openQueueForJoin,
  restoreOwnerQueueFromSession,
  endQueueAndReturnHome,
  createQueue,
  joinQueue,
  exitQueue,
  serveNext,
  removeClient
};
