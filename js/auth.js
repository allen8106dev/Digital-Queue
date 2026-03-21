import { auth, provider } from "./firebase.js";
import {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

let currentUser = null;
let unsubscribeAuth = null;
let redirectResultHandled = false;

function shouldUseRedirectFallback(error) {
  const code = typeof error?.code === "string" ? error.code : "";
  return code === "auth/popup-blocked"
    || code === "auth/popup-closed-by-user"
    || code === "auth/cancelled-popup-request"
    || code === "auth/operation-not-supported-in-this-environment";
}

async function handleRedirectResultOnce() {
  if (redirectResultHandled) {
    return;
  }

  redirectResultHandled = true;
  try {
    const result = await getRedirectResult(auth);
    if (result?.user) {
      currentUser = result.user;
    }
  } catch (error) {
    console.error("Redirect login error:", error);
  }
}

async function login() {
  try {
    const result = await signInWithPopup(auth, provider);
    currentUser = result.user;
    return currentUser;
  } catch (error) {
    if (shouldUseRedirectFallback(error)) {
      await signInWithRedirect(auth, provider);
      return null;
    }
    console.error("Login error:", error);
    throw error;
  }
}

async function logout() {
  try {
    await signOut(auth);
    currentUser = null;
  } catch (error) {
    console.error("Logout error:", error);
    throw error;
  }
}

function getUser() {
  return currentUser;
}

function initAuth(callback) {
  handleRedirectResultOnce();
  unsubscribeAuth = onAuthStateChanged(auth, (user) => {
    currentUser = user;
    if (callback) {
      callback(user);
    }
  });
}

export { login, logout, getUser, initAuth };
