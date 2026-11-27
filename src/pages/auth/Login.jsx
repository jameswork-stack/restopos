import { useCallback, useEffect, useRef, useState } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { auth } from "../../firebase/config";
import { useNavigate } from "react-router-dom";
import { getUserRole } from "../../services/authService";
import "../../styles/login.css";
import logo from "../../assets/images/logo.png";

function Login() {
  const navigate = useNavigate();
  const busy = useRef(false);
  const mounted = useRef(false);
  const attempt = useRef(0);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const navigateForRole = useCallback((role) => {
    navigate(role === "admin" ? "/dashboard" : "/inventory", { replace: true });
  }, [navigate]);

  const restore = useCallback(async (user) => {
    const id = ++attempt.current;
    setCheckingSession(true);
    setError("");
    try {
      const role = await getUserRole(user);
      if (mounted.current && id === attempt.current && auth.currentUser?.uid === user.uid) navigateForRole(role);
    } catch (err) {
      if (mounted.current && id === attempt.current) setError(err.message || "Unable to restore saved login.");
    } finally {
      if (mounted.current && id === attempt.current) setCheckingSession(false);
    }
  }, [navigateForRole]);

  useEffect(() => {
    mounted.current = true;
    const timer = setTimeout(() => {
      if (!mounted.current) return;
      setCheckingSession(false);
      setError("Session initialization is taking longer than expected. You can retry when it is ready, or reload the app.");
    }, 5000);
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      clearTimeout(timer);
      if (!mounted.current) return;
      setReady(true);
      if (busy.current) return;
      if (user) void restore(user);
      else {
        ++attempt.current;
        setCheckingSession(false);
        setError("");
      }
    }, (err) => {
      clearTimeout(timer);
      if (mounted.current) {
        setCheckingSession(false);
        setError(err.message || "Unable to initialize login. Reload the app.");
      }
    });
    const updateNetwork = () => setOnline(navigator.onLine);
    window.addEventListener("online", updateNetwork);
    window.addEventListener("offline", updateNetwork);
    return () => {
      mounted.current = false;
      ++attempt.current;
      clearTimeout(timer);
      unsubscribe();
      window.removeEventListener("online", updateNetwork);
      window.removeEventListener("offline", updateNetwork);
    };
  }, [restore]);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (busy.current || !ready || checkingSession) return;
    if (!navigator.onLine) {
      setError("Connect to the internet to sign in. A saved session can be restored offline.");
      return;
    }
    busy.current = true;
    ++attempt.current;
    setError("");
    setLoading(true);
    let signedIn = false;
    try {
      const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
      signedIn = true;
      const role = await getUserRole(credential.user, { fresh: true });
      if (mounted.current) navigateForRole(role);
    } catch (err) {
      if (signedIn) await signOut(auth).catch(console.error);
      if (mounted.current) {
        const messages = {
          "auth/network-request-failed": "Network connection failed. Please reconnect and try again.",
          "auth/invalid-credential": "Invalid email or password.",
          "auth/wrong-password": "Invalid email or password.",
          "auth/user-not-found": "Invalid email or password.",
          "auth/too-many-requests": "Too many attempts. Please try again later.",
          "auth/user-disabled": "This account has been disabled.",
          "permission-denied": "You do not have permission to access this account profile.",
        };
        setError(messages[err.code] || err.message || "Unable to sign in.");
      }
    } finally {
      busy.current = false;
      if (mounted.current) setLoading(false);
    }
  };

  const changeAccount = async () => {
    if (busy.current) return;
    ++attempt.current;
    setLoading(true);
    try { await signOut(auth); }
    catch (err) { setError(err.message || "Unable to sign out."); }
    finally { if (mounted.current) setLoading(false); }
  };

  return (
    <div className="login-container">
      <div className="login-box" aria-busy={checkingSession || loading}>
        <img className="login-logo" src={logo} alt="CHILL logo" />
        <h1>Login</h1>
        {!online && <p className="login-network">Offline mode</p>}
        {error && <p className="error-message" role="alert">{error}</p>}
        {checkingSession ? (
          <div className="login-status" role="status"><span className="login-spinner" />Checking saved login...</div>
        ) : !ready ? (
          <button type="button" onClick={() => window.location.reload()}>Reload app</button>
        ) : auth.currentUser && !loading ? (
          <div className="login-actions">
            <button type="button" onClick={() => restore(auth.currentUser)}>Retry saved login</button>
            <button type="button" className="login-secondary" onClick={changeAccount}>Use another account</button>
          </div>
        ) : (
          <form onSubmit={handleLogin}>
            <div className="input-group">
              <label htmlFor="login-email">Email</label>
              <input id="login-email" type="email" autoComplete="username" placeholder="Enter your email" value={email} onChange={(e) => setEmail(e.target.value)} required disabled={loading} />
            </div>
            <div className="input-group">
              <label htmlFor="login-password">Password</label>
              <input id="login-password" type="password" autoComplete="current-password" placeholder="Enter your password" value={password} onChange={(e) => setPassword(e.target.value)} required disabled={loading} />
            </div>
            <button type="submit" disabled={loading || !online}>{loading ? "Logging in..." : "Login"}</button>
          </form>
        )}
      </div>
    </div>
  );
}
export default Login;
