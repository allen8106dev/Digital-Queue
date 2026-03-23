import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  updateDoc,
  query,
  where,
  limit,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getAuth,
  GoogleAuthProvider
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBRa8Sc9MXuWhpYy5fyhYi-CKBac2uLuN8",
  authDomain: "digital-queue-f4d86.firebaseapp.com",
  projectId: "digital-queue-f4d86",
  storageBucket: "digital-queue-f4d86.firebasestorage.app",
  messagingSenderId: "735217566004",
  appId: "1:735217566004:web:a508ff070222e0f4aba561",
  measurementId: "G-3R1N4E6B97"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

export {
  db,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  updateDoc,
  query,
  where,
  limit,
  onSnapshot,
  auth,
  provider,
  firebaseConfig
};
