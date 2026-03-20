const OWNER_QUEUE_KEY = "dq_owner_queue_id";
const CLIENT_QUEUE_KEY = "dq_client_queue_id";
const CLIENT_NAME_KEY = "dq_client_name";
const DEFAULT_AVG_MINUTES = 2;

const state = {
  currentQueueId: null,
  currentJoinLink: "",
  currentQrUrl: "",
  ownerQueueActive: false,
  unsubscribe: null,
  queueTimerInterval: null,
  queueStartedAt: null,
  userId: localStorage.getItem("dq_user")
};

// ✅ persistent user ID
if (!state.userId) {
  state.userId = Math.random().toString(36).slice(2);
  localStorage.setItem("dq_user", state.userId);
}

export {
  state,
  OWNER_QUEUE_KEY,
  CLIENT_QUEUE_KEY,
  CLIENT_NAME_KEY,
  DEFAULT_AVG_MINUTES
};
