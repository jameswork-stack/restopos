import { doc, getDocFromServer, getDocFromCache } from "firebase/firestore";
import { auth, db } from "../firebase/config";

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function readRole(snapshot) {
  if (!snapshot.exists()) throw new Error("User account information was not found.");
  const role = snapshot.data().role;
  if (role !== "admin" && role !== "staff") throw new Error("Invalid user role.");
  return role;
}

export async function getUserRole(user, { fresh = false } = {}) {
  if (!user || auth.currentUser?.uid !== user.uid) throw new Error("You are not signed in.");
  const ref = doc(db, "users", user.uid);
  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  if (!fresh) {
    const cached = await withTimeout(getDocFromCache(ref), 1500, "Local cache timed out.").catch(() => null);
    if (cached?.exists() && !cached.metadata.hasPendingWrites) return readRole(cached);
  }
  if (offline) throw new Error("No saved account information is available offline. Connect to the internet and try again.");
  const snapshot = await withTimeout(getDocFromServer(ref), 8000, "Account verification timed out. Check your connection and retry.");
  if (auth.currentUser?.uid !== user.uid) throw new Error("Your session changed. Please try again.");
  return readRole(snapshot);
}

export async function getCurrentUserInfo() {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error("User is not logged in.");
  let userData = {};
  try {
    const snapshot = await getDocFromCache(doc(db, "users", currentUser.uid));
    if (snapshot.exists()) userData = snapshot.data();
  } catch { /* Local profile may not be available. */ }
  return {
    userId: currentUser.uid,
    email: userData.email || currentUser.email || "",
    role: userData.role || "unknown",
  };
}
