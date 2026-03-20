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
  createStartTime: document.getElementById("createStartTime"),
  endQueueBtn: document.getElementById("endQueueBtn"),
  createQueueName: document.getElementById("createQueueName"),
  joinQueueName: document.getElementById("joinQueueName"),
  joinQueueCode: document.getElementById("joinQueueCode"),
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
  myQueueUserName: document.getElementById("myQueueUserName"),
  myQueuePosition: document.getElementById("myQueuePosition"),
  myQueueEta: document.getElementById("myQueueEta"),
  myQueueServing: document.getElementById("myQueueServing"),
  myQueueNote: document.getElementById("myQueueNote"),
  queueTitle: document.getElementById("queueTitle"),
  nextBtn: document.getElementById("nextBtn"),
  metricTotal: document.getElementById("metricTotal"),
  metricServing: document.getElementById("metricServing"),
  metricAvg: document.getElementById("metricAvg"),
  metricPos: document.getElementById("metricPos"),
  metricTimer: document.getElementById("metricTimer"),
  queueList: document.getElementById("queueList"),
  emptyQueue: document.getElementById("emptyQueue"),
  createMonitorPanel: document.getElementById("createMonitorPanel"),
  createNextBtn: document.getElementById("createNextBtn"),
  createRefreshBtn: document.getElementById("createRefreshBtn"),
  createMetricTotal: document.getElementById("createMetricTotal"),
  createMetricServing: document.getElementById("createMetricServing"),
  createMetricAvg: document.getElementById("createMetricAvg"),
  createMetricPos: document.getElementById("createMetricPos"),
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
  const createdAt = Number(queue.createdAt);
  if (!Number.isFinite(createdAt) || createdAt <= 0) {
    els.createStartTime.textContent = "-";
    return;
  }
  const startedAt = new Date(createdAt);
  els.createStartTime.textContent = startedAt.toLocaleString();
}

function setNotice(msg) {
  els.notice.textContent = msg;
  els.notice.classList.remove("hidden");
}

function clearNotice() {
  els.notice.classList.add("hidden");
}

function switchView(target) {
  Object.values(views).forEach(v => {
    v.style.display = "none";
    v.hidden = true;
  });
  target.hidden = false;
  target.style.display = "block";
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
}

function renderMyQueueDetails(queue) {
  const wait = calculateWaitMinutes(queue, state.userId);
  const me = (queue.members || []).find(m => m.id === state.userId);

  els.myQueueName.textContent = queue.title || "Queue";
  els.myQueueCode.textContent = queue.id || state.currentQueueId || "-";
  els.myQueueServing.textContent = queue.servingName || "-";

  if (!me || !wait) {
    els.myQueueUserName.textContent = localStorage.getItem(CLIENT_NAME_KEY) || "-";
    els.myQueuePosition.textContent = "-";
    els.myQueueEta.textContent = "-";
    els.myQueueNote.textContent = "You are not currently in this queue.";
    return;
  }

  els.myQueueUserName.textContent = me.name;
  els.myQueuePosition.textContent = String(wait.position);

  if (wait.isServing) {
    els.myQueueEta.textContent = "Now";
    els.myQueueNote.textContent = `${me.name}, it is your turn now.`;
    return;
  }

  const rounded = Math.max(0, Math.round(wait.estimatedMinutes));
  const minuteLabel = rounded === 1 ? "minute" : "minutes";
  els.myQueueEta.textContent = `${rounded} ${minuteLabel}`;
  els.myQueueNote.textContent = `${me.name}, you are #${wait.position} in ${queue.title}.`;
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

function renderCreateMonitor(queue) {
  const members = queue.members || [];
  const waiting = getQueueOrder(queue);
  const myIndex = waiting.findIndex(m => m.id === state.userId);
  const avgMinutes = getAverageMinutes(queue);

  renderQueueDetailsMeta(queue);

  els.createMetricTotal.textContent = waiting.length;
  els.createMetricServing.textContent = queue.servingName || "-";
  els.createMetricAvg.textContent = formatMinutes(avgMinutes);
  els.createMetricPos.textContent = myIndex >= 0 ? myIndex + 1 : "-";

  els.createMonitorList.innerHTML = "";
  members.forEach((m, i) => {
    const row = document.createElement("div");
    row.className = "queue-row";
    const isServing = queue.servingMemberId === m.id && !m.served;
    const queuePos = waiting.findIndex(w => w.id === m.id);
    const estimatedMinutes = queuePos > 0 ? Math.max(1, Math.round((queuePos - 1) * avgMinutes)) : 0;
    row.innerHTML = `
      <div>
        <strong>${i + 1}. ${m.name}</strong>
        <small>${isServing ? "In service" : m.served ? "Completed" : `ETA ${estimatedMinutes} min`}</small>
      </div>
      <div class="row-actions">
        <span class="chip ${m.served ? "served" : isServing ? "served" : "waiting"}">
          ${m.served ? "Served" : isServing ? "Serving" : "Waiting"}
        </span>
        <button class="btn-danger" data-remove-member-id="${m.id}" type="button">Remove</button>
      </div>
      `;
    els.createMonitorList.appendChild(row);
  });

  els.createMonitorEmpty.classList.toggle("hidden", members.length > 0);
}

function renderMonitor(queue) {
  const members = queue.members || [];
  const waiting = getQueueOrder(queue);
  const avgMinutes = getAverageMinutes(queue);

  const myIndex = waiting.findIndex(m => m.id === state.userId);

  els.queueTitle.textContent = queue.title;
  els.metricTotal.textContent = waiting.length;
  els.metricServing.textContent = queue.servingName || "-";
  els.metricAvg.textContent = formatMinutes(avgMinutes);
  els.metricPos.textContent = myIndex >= 0 ? myIndex + 1 : "-";

  els.queueList.innerHTML = "";

  members.forEach((m, i) => {
    const row = document.createElement("div");
    row.className = "queue-row";
    const isServing = queue.servingMemberId === m.id && !m.served;
    const queuePos = waiting.findIndex(w => w.id === m.id);
    const estimatedMinutes = queuePos > 0 ? Math.max(1, Math.round((queuePos - 1) * avgMinutes)) : 0;
    row.innerHTML = `
        <div>
          <strong>${i + 1}. ${m.name}</strong>
          <small>${isServing ? "In service" : m.served ? "Completed" : `ETA ${estimatedMinutes} min`}</small>
        </div>
        <div class="row-actions">
          <span class="chip ${m.served ? "served" : isServing ? "served" : "waiting"}">
            ${m.served ? "Served" : isServing ? "Serving" : "Waiting"}
          </span>
          <button class="btn-danger" data-remove-member-id="${m.id}" type="button">Remove</button>
        </div>
        `;
    els.queueList.appendChild(row);
  });

  els.emptyQueue.classList.toggle("hidden", members.length > 0);
}

function resetCreateView() {
  els.createSetupPanel.classList.remove("hidden");
  els.createResult.classList.add("hidden");
  els.queueDetailsDrawer?.classList.remove("minimized");
  if (els.queueDetailsToggle) {
    els.queueDetailsToggle.setAttribute("aria-expanded", "true");
  }
  els.titleInput.value = "";
  els.queueLink.textContent = "";
  els.qr.innerHTML = "";
  state.currentJoinLink = "";
  state.currentQrUrl = "";
  state.ownerQueueActive = false;
  localStorage.removeItem(OWNER_QUEUE_KEY);
  localStorage.removeItem(OWNER_USER_KEY);
  els.createQueueName.textContent = "-";
  els.createStartTime.textContent = "-";
  setLiveQueueMode(false);
  stopQueueTimer();
}

export {
  views,
  els,
  setNotice,
  clearNotice,
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
