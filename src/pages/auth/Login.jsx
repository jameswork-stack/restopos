import { useCallback, useEffect, useRef, useState } from "react";
import {
  browserLocalPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
} from "firebase/auth";
import { auth } from "../../firebase/config";
import { useNavigate } from "react-router-dom";
import { getUserRole } from "../../services/authService";
import "../../styles/login.css";

function Login() {
  const navigate = useNavigate();
  const loginInProgress = useRef(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  const navigateForRole = useCallback((role) => {
    if (role === "admin") {
      navigate("/dashboard", { replace: true });
    } else if (role === "staff") {
      navigate("/inventory", { replace: true });
    } else {
      setError("Invalid user role.");
    }
  }, [navigate]);

  useEffect(() => {
    let active = true;
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!active) return;
      if (!user) {
        setCheckingSession(false);
        return;
      }
      if (loginInProgress.current) {
        setCheckingSession(false);
        return;
      }

      setCheckingSession(true);
      setError("");
      try {
        const role = await getUserRole(user);
        if (active) {
          navigateForRole(role);
        }
      } catch (sessionError) {
        console.error("Could not restore saved login:", sessionError);
        if (active) {
          setError(sessionError.message || "Unable to restore your saved login.");
        }
      } finally {
        if (active) {
          setCheckingSession(false);
        }
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [navigateForRole]);

  const handleLogin = async (e) => {
    e.preventDefault();

    setError("");
    setLoading(true);
    loginInProgress.current = true;

    try {
      await setPersistence(auth, browserLocalPersistence);
      const userCredential = await signInWithEmailAndPassword(
        auth,
        email,
        password
      );

      const role = await getUserRole(userCredential.user);
      navigateForRole(role);
    } catch (loginError) {
      console.error("Login failed:", loginError);
      if (loginError?.code === "auth/network-request-failed") {
        setError(
          "Connect to the internet to sign in for the first time. Previously saved sessions can be used offline."
        );
      } else if (
        loginError?.message === "User account information was not found." ||
        loginError?.message?.includes("offline")
      ) {
        setError(loginError.message);
      } else {
        setError("Invalid email or password.");
      }
    } finally {
      loginInProgress.current = false;
      setLoading(false);
    }
  };

  if (checkingSession) {
    return (
      <div className="login-container">
        <div className="login-box">
          <p>Checking saved login...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="login-container">

      <div className="login-box">

        <h1>Login</h1>

        <form onSubmit={handleLogin}>

          <div className="input-group">
            <label>Email</label>

            <input
              type="email"
              placeholder="Enter your email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="input-group">
            <label>Password</label>

            <input
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error && (
            <p className="error-message">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
          >
            {loading ? "Logging in..." : "Login"}
          </button>

        </form>

      </div>

    </div>
  );
}

export default Login;