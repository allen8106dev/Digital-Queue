const OWNER_QUEUE_KEY = "dq_owner_queue_id";
const OWNER_USER_KEY = "dq_owner_user_id";
const CLIENT_QUEUE_KEY = "dq_client_queue_id";
const CLIENT_NAME_KEY = "dq_client_name";
const GUEST_USER_KEY = "dq_guest_user_id";
const DEFAULT_AVG_MINUTES = 2;

const state = {
  currentQueueId: null,
  currentJoinLink: "",
  currentQrUrl: "",
  ownerQueueActive: false,
  unsubscribe: null,
  queueTimerInterval: null,
  queueStartedAt: null,
  userId: null
};

function getScopedClientQueueKey(userId) {
  if (!userId) {
    return "";
  }
  return `${CLIENT_QUEUE_KEY}:${userId}`;
}

function createGuestUserId() {
  return `guest_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function getOrCreateGuestUserId() {
  const existing = localStorage.getItem(GUEST_USER_KEY);
  if (existing) {
    return existing;
  }

  const guestUserId = createGuestUserId();
  localStorage.setItem(GUEST_USER_KEY, guestUserId);
  return guestUserId;
}

export {
  state,
  OWNER_QUEUE_KEY,
  OWNER_USER_KEY,
  CLIENT_QUEUE_KEY,
  CLIENT_NAME_KEY,
  GUEST_USER_KEY,
  getScopedClientQueueKey,
  getOrCreateGuestUserId,
  DEFAULT_AVG_MINUTES
};
