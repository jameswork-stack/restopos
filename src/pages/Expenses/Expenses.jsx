import { useEffect, useState } from "react";
import {
  collection,
  getDocs,
  getDocsFromCache,
  doc,
  writeBatch,
} from "firebase/firestore";

import { db } from "../../firebase/config";
import { getCurrentUserInfo } from "../../services/authService";
import "./expenses.css";

const toDate = (timestamp) => {
  if (typeof timestamp?.toDate === "function") {
    return timestamp.toDate();
  }
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date;
};

function Expenses() {
  // =========================
  // EXPENSE DATA
  // =========================
  const [expenses, setExpenses] = useState([]);

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
  const [loadingExpenses, setLoadingExpenses] =
    useState(true);

  const [savingExpense, setSavingExpense] =
    useState(false);

    const [dateFrom, setDateFrom] = useState("");
const [dateTo, setDateTo] = useState("");
const [deletingExpense, setDeletingExpense] = useState(null);
const [deletingExpenseLoading, setDeletingExpenseLoading] =
  useState(false);

  // =========================
  // LOAD EXPENSES
  // =========================
  const loadExpenses = async () => {
    try {
      setLoadingExpenses(true);

      let querySnapshot;
      try {
        querySnapshot = typeof navigator !== "undefined" && !navigator.onLine
          ? await getDocsFromCache(collection(db, "expenses"))
          : await getDocs(collection(db, "expenses"));
      } catch (error) {
        console.error("Error loading expenses from Firestore:", error);
        querySnapshot = await getDocsFromCache(collection(db, "expenses"));
      }

      const expenseList = [];

      querySnapshot.forEach((expenseDoc) => {
        expenseList.push({
          id: expenseDoc.id,
          ...expenseDoc.data(),
        });
      });

      // Newest expense first
      expenseList.sort((a, b) => {
        const dateA = toDate(a.createdAt) || new Date(0);
        const dateB = toDate(b.createdAt) || new Date(0);

        return dateB - dateA;
      });

      setExpenses(expenseList);
    } catch (error) {
      console.error(
        "Error loading expenses:",
        error
      );
    } finally {
      setLoadingExpenses(false);
    }
  };

  const filteredExpenses = expenses.filter((expense) => {
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
    const toDate = new Date(`${dateTo}T23:59:59`);

    if (expenseDate > toDate) {
      return false;
    }
  }

  return true;
});

const handleDeleteExpense = async (expense) => {
  if (!expense) {
    return;
  }

  const confirmed = window.confirm(
    `Are you sure you want to delete "${expense.expenseName}"?`
  );

  if (!confirmed) {
    return;
  }

  try {
    setDeletingExpenseLoading(true);

    // Get the user who is deleting the expense
    const userInfo = await getCurrentUserInfo();
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
    await deleteBatch.commit();
    setExpenses((current) =>
      current.filter((entry) => entry.id !== expense.id)
    );

    alert("Expense deletion saved on this device. It will sync to Firestore when online.");

    setDeletingExpense(null);

  } catch (error) {
    console.error(
      "Error deleting expense:",
      error
    );

    alert("Failed to delete expense.");
  } finally {
    setDeletingExpenseLoading(false);
  }
};

  // =========================
  // LOAD ON PAGE OPEN
  // =========================
  useEffect(() => {
    loadExpenses();
  }, []);

  // =========================
  // ADD EXPENSE
  // =========================
  const handleAddExpense = async (e) => {
    e.preventDefault();

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

    if (isNaN(amount) || amount <= 0) {
      alert(
        "Expense amount must be greater than 0."
      );
      return;
    }

    try {
      setSavingExpense(true);

      // Get logged-in user's information
      const userInfo = await getCurrentUserInfo();

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
      await expenseBatch.commit();
      setExpenses((current) => [savedExpense, ...current]);

      alert("Expense saved on this device. It will sync to Firestore when online.");

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
              ₱
              {totalExpenses.toLocaleString(
                "en-PH",
                {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                }
              )}
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
              {expenses.length}
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
                disabled={savingExpense}
              >
                Cancel
              </button>

              <button
                type="submit"
                className="save-expense-button"
                disabled={savingExpense}
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

          <h3>{expenses.length === 0 ? "No expenses yet" : "No matching expenses"}</h3>

          <p>
            {expenses.length === 0
              ? 'Click "Add Expense" to record your first expense.'
              : "Try a different date range or clear the filter."}
          </p>

        </div>

      ) : (

        /* =========================
           EXPENSE LIST
        ========================= */
        <div className="expense-list">

          {filteredExpenses.map((expense) => (
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
                      {expense.expenseName}
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
  disabled={deletingExpenseLoading}
  onClick={() => handleDeleteExpense(expense)}
>
  Delete
</button>

              </div>

            </div>
          ))}

        </div>
      )}
    </div>
  );
}

export default Expenses;