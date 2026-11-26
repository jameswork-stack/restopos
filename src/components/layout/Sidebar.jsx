import { useEffect, useState } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "../../firebase/config";
import { Store, LayoutDashboard, Activity, Package, ScanBarcode, ReceiptText, Wallet, UserRound, LogOut, Menu, X } from "lucide-react";

const overview = [
  { to: "/dashboard", label: "Dashboard", Icon: LayoutDashboard },
  { to: "/activity-log", label: "Activity Log", Icon: Activity },
];
const management = [
  { to: "/inventory", label: "Inventory", Icon: Package },
  { to: "/barcode-scanner", label: "Barcode Scanner", Icon: ScanBarcode },
  { to: "/sales-history", label: "Sales History", Icon: ReceiptText },
  { to: "/expenses", label: "Expenses", Icon: Wallet },
];

function Sidebar({ role }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { setIsOpen(false); }, [location.pathname]);
  useEffect(() => {
    const onKey = (event) => { if (event.key === "Escape") setIsOpen(false); };
    const media = window.matchMedia("(max-width: 768px)");
    const onResize = (event) => { if (!event.matches) setIsOpen(false); };
    window.addEventListener("keydown", onKey);
    media.addEventListener("change", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      media.removeEventListener("change", onResize);
    };
  }, []);

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    setError("");
    try {
      await signOut(auth);
      navigate("/", { replace: true });
    } catch (error) {
      console.error("Logout error:", error);
      setError("Unable to sign out. Please try again.");
    } finally { setLoggingOut(false); }
  };

  const renderLink = ({ to, label, Icon }) => (
    <NavLink key={to} to={to} onClick={() => setIsOpen(false)}
      className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>
      <Icon size={19} aria-hidden="true" />
      <span>{label}</span>
    </NavLink>
  );

  return (
    <>
      <header className="restopos-mobile-header">
        <div className="restopos-mobile-brand"><Store size={22} aria-hidden="true" /> RestoPos</div>
        <button type="button" className="restopos-menu-toggle" aria-label={isOpen ? "Close navigation" : "Open navigation"} aria-expanded={isOpen} aria-controls="restopos-sidebar" onClick={() => setIsOpen(!isOpen)}>
          {isOpen ? <X size={23} /> : <Menu size={23} />}
        </button>
      </header>
      {isOpen && <div className="restopos-sidebar-backdrop" onClick={() => setIsOpen(false)} aria-hidden="true" />}
      <aside id="restopos-sidebar" className={`sidebar${isOpen ? " sidebar-open" : ""}`}>
        <div className="sidebar-header">
          <div className="restopos-brand-icon"><Store size={24} aria-hidden="true" /></div>
          <div className="restopos-brand-text"><h2>RestoPos</h2><p>Management System</p></div>
          <button type="button" className="restopos-drawer-close" aria-label="Close navigation" onClick={() => setIsOpen(false)}><X size={20} /></button>
        </div>
        <nav className="sidebar-nav" aria-label="Main navigation">
          {role === "admin" && <div className="restopos-nav-group"><span className="restopos-nav-label">Overview</span>{overview.map(renderLink)}</div>}
          <div className="restopos-nav-group"><span className="restopos-nav-label">Management</span>{management.map(renderLink)}</div>
        </nav>
        <div className="sidebar-bottom">
          <div className="user-role">
            <div className="restopos-user-icon"><UserRound size={20} aria-hidden="true" /></div>
            <div className="restopos-user-text"><strong>{role === "admin" ? "Administrator" : role || "User"}</strong><span>{role === "admin" ? "Admin account" : role === "staff" ? "Staff account" : "User account"}</span></div>
          </div>
          <button type="button" className="logout-button" onClick={handleLogout} disabled={loggingOut}><LogOut size={18} aria-hidden="true" />{loggingOut ? "Signing out…" : "Sign out"}</button>
          {error && <p className="restopos-logout-error" role="alert">{error}</p>}
          <div className="software-info"><p>RJ SYSTEM SOLUTIONS</p></div>
        </div>
      </aside>
    </>
  );
}
export default Sidebar;
