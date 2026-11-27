import { doc, getDoc, getDocFromCache } from "firebase/firestore";
import { auth, db } from "../firebase/config";

const isNetworkError = (error) =>
  error?.code === "unavailable" ||
  error?.code === "deadline-exceeded" ||
  error?.code === "auth/network-request-failed" ||
  (typeof navigator !== "undefined" && !navigator.onLine);

export async function getUserRole(user) {
  if (!user) {
    throw new Error("You are not signed in.");
  }

  const userRef = doc(db, "users", user.uid);
  let userSnapshot;

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    try {
      userSnapshot = await getDocFromCache(userRef);
    } catch {
      throw new Error(
        "No saved account information is available offline. Connect to the internet and sign in first."
      );
    }
  } else {
    try {
      userSnapshot = await getDoc(userRef);
    } catch (error) {
      if (!isNetworkError(error)) {
        throw error;
      }

      try {
        userSnapshot = await getDocFromCache(userRef);
      } catch {
        throw new Error(
          "Unable to verify your saved account offline. Reconnect and try again."
        );
      }
    }
  }

  if (!userSnapshot.exists()) {
    throw new Error("User account information was not found.");
  }

  return userSnapshot.data().role;
}

export async function getCurrentUserInfo() {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error("User is not logged in.");
  }

  let userData = {};
  try {
    const userSnapshot = await getDocFromCache(
      doc(db, "users", currentUser.uid)
    );
    if (userSnapshot.exists()) {
      userData = userSnapshot.data();
    }
  } catch {
    // The signed-in Firebase user is enough to record a local-first action.
  }

  return {
    userId: currentUser.uid,
    email: userData.email || currentUser.email || "",
    role: userData.role || "unknown",
  };
}