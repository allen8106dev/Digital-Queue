import { DEFAULT_AVG_MINUTES } from "./state.js";

function randomId(size = 8) {
  return Math.random().toString(36).slice(2, 2 + size);
}

function buildJoinLink(id) {
  return `${window.location.origin}${window.location.pathname}?queue=${id}`;
}

function buildQrUrl(link) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(link)}`;
}

function getAverageMinutes(queue) {
  if ((queue.completedServeCount || 0) > 0 && (queue.totalServeMs || 0) > 0) {
    return queue.totalServeMs / queue.completedServeCount / 60000;
  }

  if (Number(queue.avgMinutes) > 0) {
    return Number(queue.avgMinutes);
  }

  return DEFAULT_AVG_MINUTES;
}

function formatMinutes(value) {
  const rounded = Math.max(1, Math.round(value));
  return `${rounded} min`;
}

function normalizeQueue(queue, id = "") {
  const safeQueue = queue || {};
  const createdAt = Number(safeQueue.createdAt) || Date.now();
  const lastActivityAt = Number(safeQueue.lastActivityAt) || createdAt;
  return {
    id: safeQueue.id || id,
    title: safeQueue.title || "Queue",
    ownerId: typeof safeQueue.ownerId === "string" ? safeQueue.ownerId : "",
    bannedUserIds: Array.isArray(safeQueue.bannedUserIds) ? safeQueue.bannedUserIds : [],
    members: Array.isArray(safeQueue.members) ? safeQueue.members : [],
    servingName: safeQueue.servingName || "-",
    servingMemberId: safeQueue.servingMemberId || null,
    servingStartedAt: Number(safeQueue.servingStartedAt) || null,
    totalServeMs: Number(safeQueue.totalServeMs) || 0,
    completedServeCount: Number(safeQueue.completedServeCount) || 0,
    avgMinutes: Number(safeQueue.avgMinutes) || 0,
    createdAt,
    lastActivityAt
  };
}

function formatElapsed(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function getQueueOrder(queue) {
  const unserved = (queue.members || []).filter(m => !m.served);
  const servingIndex = unserved.findIndex(m => m.id === queue.servingMemberId);

  if (servingIndex > -1) {
    const [servingMember] = unserved.splice(servingIndex, 1);
    return [servingMember, ...unserved];
  }

  return unserved;
}

function calculateWaitMinutes(queue, memberId) {
  const order = getQueueOrder(queue);
  const index = order.findIndex(m => m.id === memberId);

  if (index < 0) {
    return null;
  }

  const avgMinutes = getAverageMinutes(queue);
  const isServing = queue.servingMemberId === memberId;
  const waitingAhead = Math.max(0, index - (queue.servingMemberId ? 1 : 0));

  return {
    position: index + 1,
    isServing,
    estimatedMinutes: waitingAhead * avgMinutes
  };
}

function legacyCopyText(text) {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.focus();
  area.select();

  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }

  document.body.removeChild(area);
  return copied;
}

async function copyText(text, successMessage, setNotice) {
  if (!text) {
    setNotice("Nothing to copy yet");
    return;
  }

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const copied = legacyCopyText(text);
      if (!copied) {
        throw new Error("Clipboard unavailable");
      }
    }
    setNotice(successMessage);
  } catch {
    const copied = legacyCopyText(text);
    if (copied) {
      setNotice(successMessage);
    } else {
      setNotice("Copy failed");
    }
  }
}

export {
  randomId,
  buildJoinLink,
  buildQrUrl,
  getAverageMinutes,
  formatMinutes,
  normalizeQueue,
  formatElapsed,
  getQueueOrder,
  calculateWaitMinutes,
  legacyCopyText,
  copyText
};
