import { auth, provider } from "./firebase.js";
import { signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

let currentUser = null;
let unsubscribeAuth = null;

async function login() {
  try {
    const result = await signInWithPopup(auth, provider);
    currentUser = result.user;
    return currentUser;
  } catch (error) {
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
  unsubscribeAuth = onAuthStateChanged(auth, (user) => {
    currentUser = user;
    if (callback) {
      callback(user);
    }
  });
}

export { login, logout, getUser, initAuth };
