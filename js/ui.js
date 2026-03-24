import { state, OWNER_QUEUE_KEY, OWNER_USER_KEY, CLIENT_NAME_KEY } from "./state.js";
import {
  buildQrUrl,
  calculateWaitMinutes,
  getAverageMinutes,
  formatMinutes,
  formatElapsed,
  getQueueOrder
} from "./utils.js";

const views = {
  home: document.getElementById("homeView"),
  create: document.getElementById("createView"),
  joinEntry: document.getElementById("joinEntryView"),
  join: document.getElementById("joinView"),
  myQueue: document.getElementById("myQueueView"),
  monitor: document.getElementById("monitorView")
};

const appShell = document.getElementById("appShell");
const heroSection = document.getElementById("heroSection");

const els = {
  notice: document.getElementById("globalNotice"),
  titleInput: document.getElementById("titleInput"),
  createResult: document.getElementById("createResult"),
  createSetupPanel: document.getElementById("createSetupPanel"),
  queueLink: document.getElementById("queueLink"),
  qr: document.getElementById("qr"),
  shareLinkBtn: document.getElementById("shareLinkBtn"),
  shareQrBtn: document.getElementById("shareQrBtn"),
  queueDetailsDrawer: document.getElementById("queueDetailsDrawer"),
  queueDetailsToggle: document.getElementById("queueDetailsToggle"),
  myQueueDetailsDrawer: document.getElementById("myQueueDetailsDrawer"),
  myQueueDetailsToggle: document.getElementById("myQueueDetailsToggle"),
  createStartDate: document.getElementById("createStartDate"),
  createStartTime: document.getElementById("createStartTime"),
  endQueueBtn: document.getElementById("endQueueBtn"),
  createQueueName: document.getElementById("createQueueName"),
  createQueueCode: document.getElementById("createQueueCode"),
  joinQueueName: document.getElementById("joinQueueName"),
  joinQueueCode: document.getElementById("joinQueueCode"),
  joinStartDate: document.getElementById("joinStartDate"),
  joinStartTime: document.getElementById("joinStartTime"),
  joinEntryCopy: document.getElementById("joinEntryCopy"),
  joinEntryScannerActions: document.getElementById("joinEntryScannerActions"),
  joinManualPanel: document.getElementById("joinManualPanel"),
  joinQueueLocatorInput: document.getElementById("joinQueueLocatorInput"),
  joinEntryContinueBtn: document.getElementById("joinEntryContinueBtn"),
  joinEntryBackBtn: document.getElementById("joinEntryBackBtn"),
  openScannerBtn: document.getElementById("openScannerBtn"),
  showManualJoinBtn: document.getElementById("showManualJoinBtn"),
  joinScannerPanel: document.getElementById("joinScannerPanel"),
  joinQrVideo: document.getElementById("joinQrVideo"),
  joinScannerStatus: document.getElementById("joinScannerStatus"),
  closeScannerBtn: document.getElementById("closeScannerBtn"),
  nameInput: document.getElementById("nameInput"),
  joinStatus: document.getElementById("joinStatus"),
  myQueueName: document.getElementById("myQueueName"),
  myQueueCode: document.getElementById("myQueueCode"),
  myQueueDay: document.getElementById("myQueueDay"),
  myQueueDate: document.getElementById("myQueueDate"),
  myQueuePosition: document.getElementById("myQueuePosition"),
  myQueueEta: document.getElementById("myQueueEta"),
  myQueueStatus: document.getElementById("myQueueStatus"),
  myQueueNote: document.getElementById("myQueueNote"),
  queueTitle: document.getElementById("queueTitle"),
  nextBtn: document.getElementById("nextBtn"),
  metricTotal: document.getElementById("metricTotal"),
  metricServing: document.getElementById("metricServing"),
  metricAvg: document.getElementById("metricAvg"),
  metricTimer: document.getElementById("metricTimer"),
  queueList: document.getElementById("queueList"),
  emptyQueue: document.getElementById("emptyQueue"),
  createMonitorPanel: document.getElementById("createMonitorPanel"),
  createNextBtn: document.getElementById("createNextBtn"),
  createMetricTotal: document.getElementById("createMetricTotal"),
  createMetricServing: document.getElementById("createMetricServing"),
  createMetricAvg: document.getElementById("createMetricAvg"),
  createMetricTimer: document.getElementById("createMetricTimer"),
  createMonitorList: document.getElementById("createMonitorList"),
  createMonitorEmpty: document.getElementById("createMonitorEmpty"),
  monitorEndQueueBtn: document.getElementById("monitorEndQueueBtn"),
  createEndQueueBtn: document.getElementById("createEndQueueBtn"),
  createQueueTitle: document.getElementById("createQueueTitle")
};

function setLiveQueueMode(enabled) {
  document.body.classList.toggle("live-queue-mode", enabled);
  appShell?.classList.toggle("live-queue-shell", enabled);
  heroSection?.classList.toggle("hidden", enabled);
  views.create.classList.toggle("live-monitor-view", enabled);
}

function renderQueueDetailsMeta(queue) {
  els.createQueueName.textContent = queue.title || "Queue";
  els.createQueueCode.textContent = queue.id || state.currentQueueId || "-";
  const createdAt = Number(queue.createdAt);
  if (!Number.isFinite(createdAt) || createdAt <= 0) {
    els.createStartDate.textContent = "-";
    els.createStartTime.textContent = "-";
    return;
  }
  const startedAt = new Date(createdAt);
  els.createStartDate.textContent = startedAt.toLocaleDateString();
  els.createStartTime.textContent = startedAt.toLocaleTimeString();
}

function setNotice(msg) {
  showToast(msg, "info");
}

function clearNotice() {
  // Toasts auto-clear now
}

function showToast(message, type = "info", duration = 4000) {
  const toastContainer = document.getElementById("toastContainer");
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  
  toastContainer.appendChild(toast);
  
  // Auto-remove after duration
  const timeoutId = setTimeout(() => {
    toast.classList.add("removing");
    setTimeout(() => {
      toast.remove();
    }, 300); // Match animation duration
  }, duration);
  
  // Allow manual removal
  toast.addEventListener("click", () => {
    clearTimeout(timeoutId);
    toast.classList.add("removing");
    setTimeout(() => {
      toast.remove();
    }, 300);
  });
  
  return toast;
}

function switchView(target) {
  Object.values(views).forEach(v => {
    v.style.display = "none";
    v.hidden = true;
  });
  target.hidden = false;
  target.style.display = "block";

  const activeView = Object.entries(views).find(([, view]) => view === target)?.[0] || "unknown";
  document.dispatchEvent(new CustomEvent("dq:view-change", { detail: { view: activeView } }));
}

function renderJoinStatus(queue) {
  const wait = calculateWaitMinutes(queue, state.userId);
  const me = (queue.members || []).find(m => m.id === state.userId);

  if (!wait || !me) {
    els.joinStatus.classList.add("hidden");
    return;
  }

  if (wait.isServing) {
    els.joinStatus.textContent = `${me.name} is currently being served in ${queue.title}.`;
    els.joinStatus.classList.remove("hidden");
    return;
  }

  const rounded = Math.max(0, Math.round(wait.estimatedMinutes));
  const minuteLabel = rounded === 1 ? "minute" : "minutes";
  els.joinStatus.textContent = `${me.name} is #${wait.position} in ${queue.title}. Estimated wait: ${rounded} ${minuteLabel}.`;
  els.joinStatus.classList.remove("hidden");
}

function renderJoinSummary(queue) {
  els.joinQueueName.textContent = queue.title || "Queue";
  els.joinQueueCode.textContent = queue.id || state.currentQueueId || "-";
  const createdAt = Number(queue.createdAt);
  if (!Number.isFinite(createdAt) || createdAt <= 0) {
    els.joinStartDate.textContent = "-";
    els.joinStartTime.textContent = "-";
    return;
  }
  const startedAt = new Date(createdAt);
  els.joinStartDate.textContent = startedAt.toLocaleDateString();
  els.joinStartTime.textContent = startedAt.toLocaleTimeString();
}

function renderMyQueueDetails(queue) {
  const wait = calculateWaitMinutes(queue, state.userId);
  const me = (queue.members || []).find(m => m.id === state.userId);

  els.myQueueName.textContent = queue.title || "Queue";
  els.myQueueCode.textContent = queue.id || state.currentQueueId || "-";
  const createdAt = Number(queue.createdAt);
  if (!Number.isFinite(createdAt) || createdAt <= 0) {
    els.myQueueDay.textContent = "-";
    els.myQueueDate.textContent = "-";
  } else {
    const startedAt = new Date(createdAt);
    els.myQueueDay.textContent = startedAt.toLocaleDateString(undefined, { weekday: "long" });
    els.myQueueDate.textContent = startedAt.toLocaleDateString();
  }

  if (!me) {
    els.myQueuePosition.textContent = "-";
    els.myQueueEta.textContent = "-";
    els.myQueueStatus.textContent = "-";
    els.myQueueNote.textContent = "You are not currently in this queue.";
    return;
  }

  if (me.served) {
    els.myQueuePosition.textContent = "-";
    els.myQueueEta.textContent = "-";
    els.myQueueStatus.textContent = "Served";
    els.myQueueNote.textContent = "You have already been served.";
    return;
  }

  if (!wait) {
    els.myQueuePosition.textContent = "-";
    els.myQueueEta.textContent = "-";
    els.myQueueStatus.textContent = "-";
    els.myQueueNote.textContent = "Waiting for queue details...";
    return;
  }

  els.myQueuePosition.textContent = String(wait.position);

  if (wait.isServing) {
    els.myQueueEta.textContent = "Now";
    els.myQueueStatus.textContent = "Serving";
    els.myQueueNote.textContent = "It is your turn now.";
    return;
  }

  const rounded = Math.max(0, Math.round(wait.estimatedMinutes));
  const minuteLabel = rounded === 1 ? "minute" : "minutes";
  els.myQueueEta.textContent = `${rounded} ${minuteLabel}`;
  els.myQueueStatus.textContent = "Waiting";
  els.myQueueNote.textContent = "Live updates are active.";
}

function renderQr(link) {
  state.currentQrUrl = buildQrUrl(link);
  els.qr.innerHTML = `<img src="${state.currentQrUrl}" alt="Queue QR code">`;
}

function updateQueueTimer() {
  if (!state.queueStartedAt) {
    els.createMetricTimer.textContent = "00:00:00";
    els.metricTimer.textContent = "00:00:00";
    return;
  }

  const elapsed = Date.now() - state.queueStartedAt;
  const value = formatElapsed(elapsed);
  els.createMetricTimer.textContent = value;
  els.metricTimer.textContent = value;
}

function startQueueTimer(createdAt) {
  state.queueStartedAt = createdAt;
  if (state.queueTimerInterval) {
    clearInterval(state.queueTimerInterval);
    state.queueTimerInterval = null;
  }
  updateQueueTimer();
  state.queueTimerInterval = window.setInterval(updateQueueTimer, 1000);
}

function stopQueueTimer() {
  state.queueStartedAt = null;
  if (state.queueTimerInterval) {
    clearInterval(state.queueTimerInterval);
    state.queueTimerInterval = null;
  }
  updateQueueTimer();
}

function formatJoinedAtLabel(joinedAt) {
  const parsed = Number(joinedAt);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return "-";
  }
  return new Date(parsed).toLocaleTimeString();
}

function buildQueueTableRow(member, index, queue) {
  const row = document.createElement("div");
  row.className = "queue-table-row";
  const isServing = queue?.servingMemberId === member.id && !member.served;
  if (isServing) {
    row.classList.add("serving");
  } else if (member.served) {
    row.classList.add("served");
  }
  row.setAttribute("data-member-id", member.id);
  row.innerHTML = `
    <div class="queue-table-main">
      <span class="queue-sr">${index + 1}</span>
      <span class="queue-name">${member.name}</span>
    </div>
    <div class="queue-table-actions">
      <button class="row-menu-trigger" type="button" aria-haspopup="true" aria-expanded="false" data-menu-trigger="${member.id}" aria-label="Open queue row menu">
        <span aria-hidden="true">...</span>
      </button>
      <div class="row-menu hidden" data-member-menu="${member.id}">
        <button class="row-menu-item muted" type="button" disabled>Joined at ${formatJoinedAtLabel(member.joinedAt)}</button>
        <button class="row-menu-item danger" type="button" data-remove-member-id="${member.id}">Remove</button>
        <button class="row-menu-item warn" type="button" data-ban-member-id="${member.id}">Ban User</button>
      </div>
    </div>
  `;
  return row;
}

function getCalculatedAverageMinutes(queue) {
  const completedServeCount = Number(queue?.completedServeCount) || 0;
  const totalServeMs = Number(queue?.totalServeMs) || 0;

  if (completedServeCount > 0 && totalServeMs > 0) {
    return totalServeMs / completedServeCount / 60000;
  }

  const persistedAverage = Number(queue?.avgMinutes);
  if (persistedAverage > 0) {
    return persistedAverage;
  }

  return null;
}

function renderCreateMonitor(queue) {
  const members = queue.members || [];
  const waiting = getQueueOrder(queue);
  const avgMinutes = getCalculatedAverageMinutes(queue);

  renderQueueDetailsMeta(queue);

  els.createMetricTotal.textContent = waiting.length;
  els.createMetricServing.textContent = queue.servingName || "-";
  els.createMetricAvg.textContent = avgMinutes === null ? "-" : formatMinutes(avgMinutes);

  els.createMonitorList.innerHTML = "";
  members.forEach((m, i) => {
    els.createMonitorList.appendChild(buildQueueTableRow(m, i, queue));
  });

  els.createMonitorEmpty.classList.toggle("hidden", members.length > 0);
}

function renderMonitor(queue) {
  const members = queue.members || [];
  const waiting = getQueueOrder(queue);
  const avgMinutes = getCalculatedAverageMinutes(queue);

  els.queueTitle.textContent = queue.title;
  els.metricTotal.textContent = waiting.length;
  els.metricServing.textContent = queue.servingName || "-";
  els.metricAvg.textContent = avgMinutes === null ? "-" : formatMinutes(avgMinutes);

  els.queueList.innerHTML = "";

  members.forEach((m, i) => {
    els.queueList.appendChild(buildQueueTableRow(m, i, queue));
  });

  els.emptyQueue.classList.toggle("hidden", members.length > 0);
}

function resetCreateView() {
  els.createSetupPanel.classList.remove("hidden");
  els.createResult.classList.add("hidden");
  const queueDetailsPanel = document.getElementById("queueDetailsPanel");
  if (queueDetailsPanel) {
    queueDetailsPanel.classList.add("hidden");
  }
  if (els.queueDetailsToggle) {
    els.queueDetailsToggle.setAttribute("aria-expanded", "false");
  }
  els.titleInput.value = "";
  els.queueLink.innerHTML = "";
  els.qr.innerHTML = "";
  state.currentJoinLink = "";
  state.currentQrUrl = "";
  state.ownerQueueActive = false;
  localStorage.removeItem(OWNER_QUEUE_KEY);
  localStorage.removeItem(OWNER_USER_KEY);
  els.createQueueName.textContent = "-";
  els.createQueueCode.textContent = "-";
  els.createStartDate.textContent = "-";
  els.createStartTime.textContent = "-";
  setLiveQueueMode(false);
  stopQueueTimer();
}

export {
  views,
  els,
  setNotice,
  clearNotice,
  showToast,
  switchView,
  setLiveQueueMode,
  renderQueueDetailsMeta,
  renderJoinStatus,
  renderJoinSummary,
  renderMyQueueDetails,
  renderQr,
  updateQueueTimer,
  startQueueTimer,
  stopQueueTimer,
  renderCreateMonitor,
  renderMonitor,
  resetCreateView
};
