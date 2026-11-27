import { Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";

import { auth } from "../firebase/config";
import { getUserRole } from "../services/authService";

function ProtectedRoute({
  children,
  allowedRoles
}) {
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const unsubscribe = onAuthStateChanged(
      auth,
      async (user) => {
        if (!active) return;
        setLoading(true);
        setError("");
        if (!user) {
          setRole(null);
          setLoading(false);
          return;
        }

        try {
          const userRole = await getUserRole(user);
          if (active) setRole(userRole);
        } catch (roleError) {
          console.error("Could not verify the signed-in user:", roleError);
          if (active) {
            setRole(null);
            setError(roleError.message || "Unable to verify your account.");
          }
        } finally {
          if (active) setLoading(false);
        }
      }
    );

    return () => {
      active = false;
      unsubscribe();
    };

  }, []);

  if (loading) {
    return <div>Loading...</div>;
  }

  if (error) {
    return (
      <div role="alert" style={{ padding: 24 }}>
        <p>{error}</p>
        <button type="button" onClick={() => window.location.reload()}>
          Retry
        </button>
      </div>
    );
  }

  if (!role) {
    return <Navigate to="/" replace />;
  }

  // Check page permission
  if (!allowedRoles.includes(role)) {
    return <Navigate to="/inventory" replace />;
  }

  return children(role);
}

export default ProtectedRoute;