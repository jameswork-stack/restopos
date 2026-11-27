import { useEffect, useState, useMemo, useRef, useSyncExternalStore } from "react";
import {
  collection,
  onSnapshot,
  getDocsFromCache,
  doc,
  writeBatch,
} from "firebase/firestore";

import { auth, db } from "../../firebase/config";
import { onAuthStateChanged } from "firebase/auth";
import { getCurrentUserInfo } from "../../services/authService";
import "./expenses.css";

const toDate = (timestamp) => {
  if (typeof timestamp?.toDate === "function") {
    return timestamp.toDate();
  }
  if (timestamp == null) return null;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date;
};

// Shared, account-scoped memory cache survives React route unmounts.
// Firestore remains the persistent offline storage and source of truth.
const stores = new Map();
const sortExpenses = (rows) => [...rows].sort((a, b) =>
  (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0));
function getStore(uid) {
  if (!stores.has(uid)) {
    const listeners = new Set();
    const store = {
      rows: [], pending: new Map(),
      state: { expenses: [], ready: false, fromCache: true, error: "", feedback: null, pendingCount: 0 },
      subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
      getSnapshot: () => store.state,
      publish: (patch = {}) => {
        const rows = new Map(store.rows.map((row) => [row.id, row]));
        for (const [id, operation] of store.pending) {
          if (operation.type === "delete") rows.delete(id);
          else rows.set(id, { ...operation.row, pendingSync: true });
        }
        store.state = { ...store.state, ...patch, expenses: sortExpenses([...rows.values()]), pendingCount: store.pending.size };
        listeners.forEach((fn) => fn());
      },
    };
    stores.set(uid, store);
  }
  return stores.get(uid);
}
const snapshotRows = (snapshot) => snapshot.docs.map((entry) => ({
  ...entry.data({ serverTimestamps: "estimate" }), id: entry.id,
  pendingSync: entry.metadata.hasPendingWrites,
}));

// A write promise resolves only after the server acknowledges it. Never await
// it in the UI. Preserve pending operations and feedback across navigation.
function queueExpenseWrite(store, id, operation, batch) {
  const promise = batch.commit();
  store.pending.set(id, operation);
  store.publish({ ready: true, feedback: { type: "pending", text: "Change queued locally. Awaiting Firebase confirmation." } });
  void promise.then(() => {
    store.rows = store.rows.filter((row) => row.id !== id);
    if (operation.type === "add") store.rows.push({ ...operation.row, pendingSync: false });
    store.pending.delete(id);
    store.publish({ feedback: { type: "success", text: "Expense change confirmed by Firebase." } });
  }).catch((error) => {
    console.error("Expense write rejected:", error);
    store.pending.delete(id);
    store.rows = store.rows.filter((row) => row.id !== id);
    if (operation.type === "delete") store.rows.push(operation.row);
    store.publish({ feedback: { type: "error", text: `Expense ${operation.type} failed (${error.code || "unknown error"}). Verify the record and permissions before retrying.` } });
  });
}

function Expenses() {
  // =========================
  // EXPENSE DATA
  // =========================
  const [uid, setUid] = useState(() => auth.currentUser?.uid || "");
  useEffect(() => onAuthStateChanged(auth, (user) => setUid(user?.uid || "")), []);
  const store = getStore(uid);
  const { expenses, ready, fromCache, error: syncError, feedback: saveFeedback, pendingCount } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [retry, setRetry] = useState(0);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [initialWait, setInitialWait] = useState(true);
  const loadingExpenses = !ready && initialWait;
  const writeLock = useRef(false);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);

  // =========================
  // FORM
  // =========================
  const [showExpenseForm, setShowExpenseForm] = useState(false);

  const [expenseName, setExpenseName] = useState("");
  const [expenseDescription, setExpenseDescription] =
    useState("");
  const [expenseAmount, setExpenseAmount] = useState("");

  // =========================
  // LOADING STATES
  // =========================


  const [savingExpense, setSavingExpense] =
    useState(false);


    const [dateFrom, setDateFrom] = useState("");
const [dateTo, setDateTo] = useState("");

const [deletingExpenseLoading, setDeletingExpenseLoading] =
  useState(false);

  // =========================
  // LOAD EXPENSES
  // =========================
  useEffect(() => {
    if (!uid) { setInitialWait(false); return; }
    let active = true;
    let receivedSnapshot = false;
    setInitialWait(!store.state.ready);
    store.publish({ fromCache: true, error: "" });
    const timer = setTimeout(() => { if (active) setInitialWait(false); }, 1200);
    const ref = collection(db, "expenses");
    // Read persistent cache immediately, without depending on network status.
    void getDocsFromCache(ref).then((snapshot) => {
      if (!active || receivedSnapshot) return;
      if (snapshot.size || !store.state.ready) {
        store.rows = snapshotRows(snapshot);
        store.publish({ ready: true, fromCache: true });
      }
    }).catch(() => {});
    const unsubscribe = onSnapshot(ref, { includeMetadataChanges: true }, (snapshot) => {
      if (!active) return;
      receivedSnapshot = true;
      clearTimeout(timer);
      store.rows = snapshotRows(snapshot);
      store.publish({ ready: true, fromCache: snapshot.metadata.fromCache, error: "" });
      setInitialWait(false);
    }, (error) => {
      if (!active) return;
      clearTimeout(timer);
      if (["permission-denied", "unauthenticated"].includes(error.code)) store.rows = [];
      store.publish({ error: "Unable to refresh expenses. Check access and connection.", fromCache: true });
      setInitialWait(false);
    });
    return () => { active = false; clearTimeout(timer); unsubscribe(); };
  }, [uid, store, retry]);

  const filteredExpenses = useMemo(() => expenses.filter((expense) => {
    const expenseDate = toDate(expense.createdAt);
    if (!expenseDate) return false;

  // Date From
  if (dateFrom) {
    const fromDate = new Date(`${dateFrom}T00:00:00`);

    if (expenseDate < fromDate) {
      return false;
    }
  }

  // Date To
  if (dateTo) {
    const toDate = new Date(`${dateTo}T23:59:59.999`);

    if (expenseDate > toDate) {
      return false;
    }
  }

  return true;
}), [expenses, dateFrom, dateTo]);

const handleDeleteExpense = async (expense) => {
  if (!expense || writeLock.current || store.pending.has(expense.id)) {
    return;
  }

  const confirmed = window.confirm(
    `Are you sure you want to delete "${expense.expenseName}"?`
  );

  if (!confirmed) {
    return;
  }

  try {
    writeLock.current = true;
    setDeletingExpenseLoading(true);

    // Get the user who is deleting the expense
    const userInfo = await getCurrentUserInfo();
    if (!uid || auth.currentUser?.uid !== uid || userInfo.userId !== uid) throw new Error("Your session changed. Please try again.");
    const deleteBatch = writeBatch(db);

    // Record the deletion activity
    deleteBatch.set(doc(collection(db, "expenseActivity")), {
      action: "delete",

      expenseId: expense.id,
      expenseName: expense.expenseName,
      description: expense.description || "",
      amount: Number(expense.amount) || 0,

      userId: userInfo.userId,
      email: userInfo.email,
      role: userInfo.role,

      createdAt: new Date(),
    });

    // Delete the expense record
    deleteBatch.delete(doc(db, "expenses", expense.id));
    queueExpenseWrite(store, expense.id, { type: "delete", row: expense }, deleteBatch);

  } catch (error) {
    console.error(
      "Error deleting expense:",
      error
    );

    alert("Failed to delete expense.");
  } finally {
    writeLock.current = false;
    setDeletingExpenseLoading(false);
  }
};

  // =========================
  // LOAD ON PAGE OPEN
  // =========================


  // =========================
  // ADD EXPENSE
  // =========================
  const handleAddExpense = async (e) => {
    e.preventDefault();
    if (writeLock.current) return;

    if (!expenseName.trim()) {
      alert("Please enter an expense name.");
      return;
    }

    if (!expenseDescription.trim()) {
      alert("Please enter an expense description.");
      return;
    }

    if (expenseAmount === "") {
      alert("Please enter the expense amount.");
      return;
    }

    const amount = Number(expenseAmount);

    if (!Number.isFinite(amount) || amount <= 0) {
      alert(
        "Expense amount must be greater than 0."
      );
      return;
    }

    try {
      writeLock.current = true;
      setSavingExpense(true);

      // Get logged-in user's information
      const userInfo = await getCurrentUserInfo();
    if (!uid || auth.currentUser?.uid !== uid || userInfo.userId !== uid) throw new Error("Your session changed. Please try again.");

      const expenseRef = doc(collection(db, "expenses"));
      const expenseData = {
        expenseName: expenseName.trim(),
        description: expenseDescription.trim(),
        amount: amount,

        // User information
        userId: userInfo.userId,
        email: userInfo.email,
        role: userInfo.role,

        // Date and time
        createdAt: new Date(),
      };
      const savedExpense = { id: expenseRef.id, ...expenseData };
      const expenseBatch = writeBatch(db);
      expenseBatch.set(expenseRef, expenseData);
      queueExpenseWrite(store, expenseRef.id, { type: "add", row: savedExpense }, expenseBatch);

      // Clear form
      setExpenseName("");
      setExpenseDescription("");
      setExpenseAmount("");

      // Close form
      setShowExpenseForm(false);

    } catch (error) {
      console.error(
        "Error adding expense:",
        error
      );

      alert(
        error.message ||
          "Failed to add expense."
      );
    } finally {
      writeLock.current = false;
      setSavingExpense(false);
    }
  };

  // =========================
  // FORMAT DATE
  // =========================
  const formatDate = (timestamp) => {
    const date = toDate(timestamp);
    if (!date) {
      return "Date unavailable";
    }

    return date.toLocaleString("en-PH", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  // =========================
  // TOTAL EXPENSES
  // =========================
  const [visibleCount, setVisibleCount] = useState(50);
  useEffect(() => setVisibleCount(50), [dateFrom, dateTo]);
  const totalExpenses = expenses.reduce(
    (total, expense) => {
      return total + (Number(expense.amount) || 0);
    },
    0
  );

  return (
    <div className="expenses-page">

      {/* =========================
          HEADER
      ========================= */}
      <div className="expenses-header">
        <div>
          <h1>Expenses</h1>

          <p>
            Record and manage expenses made by
            authorized users.
          </p>
        </div>
        <button
          type="button"
          className="add-expense-button"
          onClick={() =>
            setShowExpenseForm(true)
          }
        >
          <span>＋</span>
          Add Expense
        </button>
      </div>

      <div className={`expense-sync-status ${syncError ? "error" : !online || fromCache || pendingCount ? "pending" : "ready"}`} role="status">
        <div><strong>{syncError ? "Sync unavailable" : !online ? "Offline mode" : fromCache ? "Cached records · refreshing" : "Server synchronized"}</strong>
          <span>{pendingCount ? `${pendingCount} change(s) awaiting confirmation. ` : ""}{fromCache ? "Cached totals may be incomplete." : ""}</span></div>
        {syncError && <button type="button" onClick={() => setRetry((value) => value + 1)}>Retry</button>}
      </div>
        {saveFeedback && (
          <div
            className={`expenses-save-feedback ${saveFeedback.type}`}
            role={saveFeedback.type === "error" ? "alert" : "status"}
          >
            {saveFeedback.text}
          </div>
        )}

      {/* =========================
          SUMMARY
      ========================= */}
      <div className="expense-summary">

        <div className="expense-summary-card">
          <div className="expense-summary-icon">
            ₱
          </div>

          <div>
            <span>Total Expenses</span>

            <strong>
              {!ready || (fromCache && !expenses.length) ? "—" : `₱${totalExpenses.toLocaleString(
                "en-PH",
                {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                }
              )}`} 
            </strong>
          </div>
        </div>

        <div className="expense-summary-card">
          <div className="expense-summary-icon">
            #
          </div>

          <div>
            <span>Expense Records</span>

            <strong>
              {!ready || (fromCache && !expenses.length) ? "—" : expenses.length}
            </strong>
          </div>
        </div>

      </div>

      {/* =========================
          ADD EXPENSE FORM
      ========================= */}
      {showExpenseForm && (
        <div className="expense-form-card">

          <div className="expense-form-header">
            <div>
              <h2>Add Expense</h2>

              <p>
                Enter the details of the new
                expense.
              </p>
            </div>

            <button
              type="button"
              className="close-expense-button"
              onClick={() =>
                setShowExpenseForm(false)
              }
            >
              ×
            </button>
          </div>

          <form onSubmit={handleAddExpense}>

            {/* Expense Name */}
            <div className="expense-form-group">
              <label>
                Expense Name
                <span>*</span>
              </label>

              <input
                type="text"
                value={expenseName}
                onChange={(e) =>
                  setExpenseName(e.target.value)
                }
                placeholder="e.g. Electricity Bill"
              />
            </div>

            {/* Description */}
            <div className="expense-form-group">
              <label>
                Description
                <span>*</span>
              </label>

              <textarea
                value={expenseDescription}
                onChange={(e) =>
                  setExpenseDescription(
                    e.target.value
                  )
                }
                placeholder="Enter a description of the expense"
                rows="4"
              />
            </div>

            {/* Amount */}
            <div className="expense-form-group">
              <label>
                Amount
                <span>*</span>
              </label>

              <div className="amount-input-wrapper">
                <span>₱</span>

                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={expenseAmount}
                  onChange={(e) =>
                    setExpenseAmount(
                      e.target.value
                    )
                  }
                  placeholder="0.00"
                />
              </div>
            </div>

            {/* Buttons */}
            <div className="expense-form-actions">

              <button
                type="button"
                className="cancel-expense-button"
                onClick={() =>
                  setShowExpenseForm(false)
                }
                disabled={savingExpense || deletingExpenseLoading}
              >
                Cancel
              </button>

              <button
                type="submit"
                className="save-expense-button"
                disabled={savingExpense || deletingExpenseLoading}
              >
                {savingExpense
                  ? "Saving..."
                  : "Save Expense"}
              </button>

            </div>

          </form>
        </div>
      )}

{/* date filter */}

<div className="expense-filters">

  <div className="expense-filter-group">
    <label>Date From</label>

    <input
      type="date"
      value={dateFrom}
      onChange={(e) =>
        setDateFrom(e.target.value)
      }
    />
  </div>

  <div className="expense-filter-group">
    <label>Date To</label>

    <input
      type="date"
      value={dateTo}
      onChange={(e) =>
        setDateTo(e.target.value)
      }
    />
  </div>

  <button
    type="button"
    className="clear-expense-filter"
    onClick={() => {
      setDateFrom("");
      setDateTo("");
    }}
  >
    Clear Filter
  </button>

</div>

      {/* =========================
          EXPENSE LIST HEADER
      ========================= */}
      <div className="expense-list-header">
        <div>
          <h2>Expense Records</h2>

          <p>
            History of recorded expenses.
          </p>
        </div>
      </div>

      {/* =========================
          LOADING
      ========================= */}
      {loadingExpenses ? (
        <div className="expense-empty">
          <div className="expense-loading-spinner"></div>

          <p>Loading expenses...</p>
        </div>
      ) : filteredExpenses.length === 0 ? (

        /* =========================
           EMPTY
        ========================= */
        <div className="expense-empty">

          <div className="expense-empty-icon">
            ₱
          </div>

          <h3>{expenses.length === 0 ? (fromCache || !ready ? "No cached expenses" : "No expenses yet") : "No matching expenses"}</h3>

          <p>
            {expenses.length === 0
              ? (fromCache || !ready ? 'Connect to the internet to verify expense records.' : 'Click "Add Expense" to record your first expense.')
              : "Try a different date range or clear the filter."}
          </p>

        </div>

      ) : (

        /* =========================
           EXPENSE LIST
        ========================= */
        <div className="expense-list">

          {filteredExpenses.slice(0, visibleCount).map((expense) => (
            <div
              className="expense-item"
              key={expense.id}
            >

              {/* Top */}
              <div className="expense-item-top">

                <div className="expense-item-title">
                  <div className="expense-item-icon">
                    ₱
                  </div>

                  <div>
                    <h3>
                      {expense.expenseName} {expense.pendingSync && <span className="expense-pending-tag">Pending sync</span>}
                    </h3>

                    <p>
                      {expense.description}
                    </p>
                  </div>
                </div>

                <div className="expense-amount">
                  ₱
                  {Number(
                    expense.amount
                  ).toLocaleString(
                    "en-PH",
                    {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    }
                  )}
                </div>

              </div>

              {/* Bottom */}
              <div className="expense-item-footer">

                <div className="expense-user">

                  <span>
                    Added by
                  </span>

                  <strong>
                    {expense.email ||
                      "Unknown user"}
                  </strong>

                </div>

                <div className="expense-role">

                  <span
                    className={`expense-role-badge ${
                      expense.role === "admin"
                        ? "expense-role-admin"
                        : "expense-role-staff"
                    }`}
                  >
                    {expense.role ||
                      "Unknown"}
                  </span>

                </div>

                <div className="expense-date">

                  <span>
                    Date
                  </span>

                  <strong>
                    {formatDate(
                      expense.createdAt
                    )}
                  </strong>

                </div>

                <button
  type="button"
  className="delete-expense-button"
  disabled={deletingExpenseLoading || savingExpense || expense.pendingSync}
  onClick={() => handleDeleteExpense(expense)}
>
  Delete
</button>

              </div>

            </div>
          ))}
          {visibleCount < filteredExpenses.length && <button type="button" className="expense-load-more" onClick={() => setVisibleCount((count) => count + 50)}>Show more ({filteredExpenses.length - visibleCount} remaining)</button>}

        </div>
      )}
    </div>
  );
}

export default Expenses;