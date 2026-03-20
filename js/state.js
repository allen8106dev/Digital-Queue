const OWNER_QUEUE_KEY = "dq_owner_queue_id";
const OWNER_USER_KEY = "dq_owner_user_id";
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
  userId: null
};

function getScopedClientQueueKey(userId) {
  if (!userId) {
    return "";
  }
  return `${CLIENT_QUEUE_KEY}:${userId}`;
}

export {
  state,
  OWNER_QUEUE_KEY,
  OWNER_USER_KEY,
  CLIENT_QUEUE_KEY,
  CLIENT_NAME_KEY,
  getScopedClientQueueKey,
  DEFAULT_AVG_MINUTES
};
