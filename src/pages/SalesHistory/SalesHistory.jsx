import { useEffect, useState, useMemo, useSyncExternalStore } from "react";
import {
  collection,
  onSnapshot,
  getDocsFromCache,
  where,
  query,
  orderBy,
  doc,
  deleteDoc,
} from "firebase/firestore";

import { createPortal } from "react-dom";
import { jsPDF } from "jspdf";
import { auth, db } from "../../firebase/config";
import "./salesHistory.css";


// Calendar dates in Philippine time, independent of the device timezone.
const manilaDate = (date) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
};

const getCurrentMonth = () => {
  const today = manilaDate(new Date());
  return { from: `${today.slice(0, 7)}-01`, to: today };
};

// Memory cache survives route changes, but is isolated by authenticated user.
const historyCache = new Map();
const deleteJobs = new Map();
const deleteSubscribers = new Set();
let deleteVersion = 0;
const notifyDeletes = () => { deleteVersion++; deleteSubscribers.forEach(fn => fn()); };
const subscribeDeletes = (fn) => { deleteSubscribers.add(fn); return () => deleteSubscribers.delete(fn); };
const getDeleteVersion = () => deleteVersion;
const emptyHistory = { sales: [], hasSnapshot: false };
// Clear sensitive cached records when the authenticated account changes.
import { onAuthStateChanged } from "firebase/auth";
let cacheOwner = auth.currentUser?.uid || null;
onAuthStateChanged(auth, user => {
  const uid = user?.uid || null;
  if (uid !== cacheOwner) { historyCache.clear(); cacheOwner = uid; }
});
const subscribeAuth = (fn) => onAuthStateChanged(auth, fn);
const getUid = () => auth.currentUser?.uid || null;

function SalesHistory() {
  const uid = useSyncExternalStore(subscribeAuth, getUid);
  const deletionVersion = useSyncExternalStore(subscribeDeletes, getDeleteVersion);
  const [dateFrom, setDateFrom] = useState(() => getCurrentMonth().from);
  const [dateTo, setDateTo] = useState(() => getCurrentMonth().to);
  const cacheKey = JSON.stringify([uid, dateFrom, dateTo]);
  const [history, setHistory] = useState(() => ({ key: cacheKey, ...(historyCache.get(cacheKey) || emptyHistory) }));
  const currentHistory = history.key === cacheKey ? history : historyCache.get(cacheKey) || emptyHistory;
  const sales = currentHistory.sales;
  const hasSnapshot = currentHistory.hasSnapshot;
  const loading = false; // Never block the page on network access.

  // Selected sale for View modal
  const [selectedSale, setSelectedSale] = useState(null);

  const [menu, setMenu] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [fromCache, setFromCache] = useState(true);
  const [syncError, setSyncError] = useState(false);
  const [retry, setRetry] = useState(0);
  const jobs = useMemo(() => [...deleteJobs.values()].filter(job => job.uid === uid), [uid, deletionVersion]);
  const pendingDeletes = jobs.filter(job => job.status === "pending");
  const failedDeletes = jobs.filter(job => job.status === "failed");
  const [visibleCount, setVisibleCount] = useState(50);
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    const close = () => setMenu(null);
    const key = (event) => { if (event.key === "Escape") close(); };
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", key);
    };
  }, []);

  const invalidRange = Boolean(dateFrom && dateTo && dateFrom > dateTo);
  useEffect(() => {
    setVisibleCount(50);
    setFromCache(true);
    setSyncError(false);
    if (invalidRange || !uid) return;
    const constraints = [];
    if (dateFrom) constraints.push(where("createdAt", ">=", new Date(`${dateFrom}T00:00:00+08:00`)));
    if (dateTo) constraints.push(where("createdAt", "<", new Date(new Date(`${dateTo}T00:00:00+08:00`).getTime() + 86400000)));
    const salesQuery = query(collection(db, "saleActivity"), ...constraints, orderBy("createdAt", "desc"));
    let active = true;
    let listenerReceived = false;
    const apply = snapshot => {
      if (!active || auth.currentUser?.uid !== uid) return;
      const value = { sales: snapshot.docs.map(entry => ({ ...entry.data({ serverTimestamps: "estimate" }), id: entry.id, pendingSync: entry.metadata.hasPendingWrites })), hasSnapshot: true };
      historyCache.set(cacheKey, value);
      if (historyCache.size > 12) historyCache.delete(historyCache.keys().next().value);
      setHistory({ key: cacheKey, ...value });
      setFromCache(snapshot.metadata.fromCache);
    };
    // Read IndexedDB directly on a cold visit, without waiting for the listener.
    getDocsFromCache(salesQuery).then(snapshot => {
      if (!listenerReceived && !historyCache.has(cacheKey)) apply(snapshot);
    }).catch(() => {});
    const unsubscribe = onSnapshot(salesQuery, { includeMetadataChanges: true }, snapshot => {
      listenerReceived = true;
      apply(snapshot);
    }, error => {
      if (!active) return;
      listenerReceived = true;
      console.error("Sales history listener failed:", error);
      setSyncError(true);
      if (error.code === "permission-denied" || error.code === "unauthenticated") {
        historyCache.delete(cacheKey);
        setHistory({ key: cacheKey, ...emptyHistory });
      }
      setErrorMessage("Unable to synchronize sales history. Check access and retry.");
    });
    return () => { active = false; unsubscribe(); };
  }, [uid, cacheKey, dateFrom, dateTo, invalidRange, retry]);

  const filteredSales = useMemo(() => {
    if (invalidRange || !uid) return [];
    const hidden = new Set(jobs.filter(job => job.status !== "failed").map(job => job.id));
    return sales.filter(sale => !hidden.has(sale.id));
  }, [sales, jobs, invalidRange, uid]);

  const totalTransactions = filteredSales.length;

  // ---------------------------------------
  // FORMAT DATE
  // ---------------------------------------
  const formatDate = (timestamp) => {
    if (!timestamp) {
      return "Date unavailable";
    }

    const date =
      typeof timestamp.toDate === "function"
        ? timestamp.toDate()
        : new Date(timestamp);

    return date.toLocaleString("en-PH", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };



  // ---------------------------------------
  // GET ITEM COUNT
  // ---------------------------------------
  const getItemCount = (items) => {
    if (!Array.isArray(items)) {
      return 0;
    }

    return items.reduce(
      (total, item) => total + (Number(item.quantity) || 0),
      0
    );
  };

  // ---------------------------------------
  // FORMAT CURRENCY
  // ---------------------------------------
  const formatCurrency = (amount) => {
    return `₱${(Number(amount) || 0).toLocaleString("en-PH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  };

  // ---------------------------------------
  // VIEW SALE
  // ---------------------------------------
  const handleViewSale = (sale) => {
    setSelectedSale(sale);
  };

  // ---------------------------------------
  // CLOSE MODAL
  // ---------------------------------------
  const handleCloseSaleModal = () => {
    setSelectedSale(null);
  };

  const openMenu = (event, sale) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu((previous) => previous?.sale.id === sale.id ? null : {
      sale,
      left: Math.max(8, Math.min(rect.right - 180, window.innerWidth - 188)),
      top: Math.max(8, rect.bottom + 6 + 180 <= window.innerHeight
        ? rect.bottom + 6 : rect.top - 186),
    });
  };

  // 58 mm receipt. Change to 80 for an 80 mm thermal printer.
  const RECEIPT_WIDTH = 58;
  const receiptLines = (sale) => {
    const money = (value) => formatCurrency(value).replace("₱", "PHP ");
    const lines = [
      { text: "SALES RECEIPT", center: true, bold: true },
      { text: "Sale #" + (sale.saleId || sale.id) },
      { text: formatDate(sale.createdAt) },
      { text: "--------------------------------" },
    ];
    for (const item of Array.isArray(sale.items) ? sale.items : []) {
      lines.push({ text: item.productName || "Unknown product", bold: true });
      lines.push({ text: `${Number(item.quantity) || 0} x ${money(item.sellingPrice)}` });
      lines.push({ text: money(item.subtotal), right: true });
    }
    lines.push(
      { text: "--------------------------------" },
      { text: "TOTAL: " + money(sale.total), bold: true },
      { text: "Payment: " + (sale.paymentMethod || "Cash Only") },
      { text: "GCash: " + money(sale.gcashAmount) },
      { text: "Cash: " + money((Number(sale.total) || 0) - (Number(sale.gcashAmount) || 0)) },
      { text: "Items: " + getItemCount(sale.items) },
      { text: "Thank you!", center: true }
    );
    return lines;
  };

  const makeReceipt = (sale) => {
    const width = RECEIPT_WIDTH;
    const margin = 4;
    const lineHeight = 4;
    const measure = new jsPDF({ unit: "mm", format: [width, 100] });
    measure.setFontSize(9);
    const rows = receiptLines(sale).flatMap((line) => {
      measure.setFont("helvetica", line.bold ? "bold" : "normal");
      return measure.splitTextToSize(String(line.text), width - margin * 2)
        .map((text) => ({ ...line, text }));
    });
    const height = Math.max(width, 12 + rows.length * lineHeight);
    const pdf = new jsPDF({ unit: "mm", orientation: "portrait", format: [width, height] });
    pdf.setFontSize(9);
    rows.forEach((row, index) => {
      pdf.setFont("helvetica", row.bold ? "bold" : "normal");
      pdf.text(row.text, row.center ? width / 2 : row.right ? width - margin : margin,
        6 + index * lineHeight, { align: row.center ? "center" : row.right ? "right" : "left" });
    });
    return pdf;
  };

  const handleSaveReceipt = (sale) => {
    setMenu(null);
    try {
      makeReceipt(sale).save(`Receipt-${String(sale.saleId || sale.id).replace(/[^a-zA-Z0-9_-]/g, "_")}.pdf`);
    } catch (error) {
      console.error(error);
      setErrorMessage("Unable to save receipt.");
    }
  };

  const handlePrintReceipt = (sale) => {
    setMenu(null);
    const printWindow = window.open("", "_blank", "width=420,height=650");
    if (!printWindow) { setErrorMessage("Allow pop-ups to print receipts."); return; }
    const document = printWindow.document;
    document.title = "Sales Receipt";
    const style = document.createElement("style");
    style.textContent = `@page { margin: 0; } * { box-sizing: border-box; } body { margin: 0; width: ${RECEIPT_WIDTH}mm; padding: 4mm; font: 12px Arial, sans-serif; color: black; } .line { white-space: pre-wrap; overflow-wrap: anywhere; margin-bottom: 2mm; } @media print { button { display: none; } }`;
    document.head.appendChild(style);
    receiptLines(sale).forEach((line) => {
      const element = document.createElement("div");
      element.className = "line";
      element.textContent = line.text;
      element.style.textAlign = line.center ? "center" : line.right ? "right" : "left";
      element.style.fontWeight = line.bold ? "bold" : "normal";
      document.body.appendChild(element);
    });
    const button = document.createElement("button");
    button.textContent = "Print receipt";
    button.onclick = () => printWindow.print();
    document.body.appendChild(button);
    printWindow.focus();
    printWindow.print();
  };

  const handleDeleteSale = () => {
    if (!deleteTarget || !uid || auth.currentUser?.uid !== uid) return;
    const target = deleteTarget;
    const key = JSON.stringify([uid, target.id]);
    if (deleteJobs.get(key)?.status === "pending") return;
    deleteJobs.set(key, { uid, id: target.id, label: target.saleId || target.id, status: "pending" });
    notifyDeletes();
    setErrorMessage("");
    setDeleteTarget(null);
    if (selectedSale?.id === target.id) setSelectedSale(null);
    // Submit once. The promise can remain pending offline; do not await it in UI.
    Promise.resolve().then(() => deleteDoc(doc(db, "saleActivity", target.id))).then(() => {
      // Remove confirmed records from every retained date-range snapshot.
      for (const [range, value] of historyCache) {
        if (JSON.parse(range)[0] === uid) historyCache.set(range, { ...value, sales: value.sales.filter(sale => sale.id !== target.id) });
      }
      deleteJobs.set(key, { uid, id: target.id, status: "confirmed" });
      notifyDeletes();
    }).catch(error => {
      console.error("Deletion rejected:", error);
      deleteJobs.set(key, { uid, id: target.id, label: target.saleId || target.id, status: "failed" });
      notifyDeletes();
    });
  };

  return (
    <div className="sales-history-page">

      {/* =====================================
          HEADER
      ====================================== */}
      <div className="sales-history-header">
        <div>
          <h1>Sales History</h1>

          <p>
            View completed sales and transaction records.
          </p>
        </div>
      </div>

      {/* =====================================
          SUMMARY
      ====================================== */}
      <div className="sales-date-filter">
        <div className="sales-date-heading">
          <h2>Filter Transactions</h2>
          <p>Select a date range (Philippine time).</p>
        </div>
        <div className="sales-date-controls">
          <label>Date From
            <input type="date" value={dateFrom} max={dateTo || undefined}
              onChange={(event) => { setDateFrom(event.target.value); setMenu(null); }} />
          </label>
          <label>Date To
            <input type="date" value={dateTo} min={dateFrom || undefined}
              onChange={(event) => { setDateTo(event.target.value); setMenu(null); }} />
          </label>
          <button type="button" onClick={() => {
            const { from, to } = getCurrentMonth();
            setDateFrom(from); setDateTo(to); setMenu(null);
          }}>Reset Filter</button>
          <button type="button" onClick={() => {
            setDateFrom(""); setDateTo(""); setMenu(null);
          }}>All Dates</button>
        </div>
        {invalidRange && <p className="sales-date-error" role="alert">Date From must not be after Date To.</p>}
      </div>

      <div className={`sales-sync-status ${syncError ? "sync-error" : (!online || fromCache || pendingDeletes.length) ? "sync-pending" : "sync-ready"}`} role="status">
        <div><strong>{syncError ? "Sync unavailable" : !online ? "Offline mode" : (fromCache || !hasSnapshot) ? "Cached records · awaiting server" : "Server connected"}</strong>
          <span>{pendingDeletes.length ? `${pendingDeletes.length} deletion(s) awaiting confirmation. ` : ""}{fromCache ? "Cached totals may be incomplete." : ""}</span></div>
        {syncError && <button type="button" onClick={() => setRetry((value) => value + 1)}>Retry</button>}
      </div>
      {failedDeletes.length > 0 && <div className="sales-sync-status sync-error" role="alert"><div><strong>Deletion rejected</strong><span>{failedDeletes.map(job => `Sale #${job.label}`).join(", ")} could not be deleted. Check permissions before retrying.</span></div><button type="button" onClick={() => { for (const [key, job] of deleteJobs) if (job.uid === uid && job.status === "failed") deleteJobs.delete(key); notifyDeletes(); setRetry(value => value + 1); }}>Dismiss / refresh</button></div>}
      <div className="sales-summary">

        {/* TOTAL TRANSACTIONS */}
        <div className="sales-summary-card">
          <div className="sales-summary-icon">#</div>

          <div className="sales-summary-content">
            <span>Total Transactions</span>

            <strong>
              {loading
                ? "Loading..."
                : !hasSnapshot || (fromCache && !totalTransactions) ? "—" : totalTransactions.toLocaleString("en-PH")}
            </strong>
          </div>
        </div>

      </div>

      {/* =====================================
          SALES HISTORY
      ====================================== */}
      <div className="sales-history-card">

        <div className="sales-history-card-header">
          <div>
            <h2>Sales History</h2>

            <p>
              Completed transactions recorded in the
              system.
            </p>
          </div>

          <span className="transaction-count">
            {totalTransactions} transaction
            {totalTransactions !== 1 ? "s" : ""}
          </span>
        </div>

        {/* LOADING */}
        {loading ? (
          <div className="sales-history-empty">
            <div className="loading-spinner"></div>

            <p>Loading sales history...</p>
          </div>

        ) : filteredSales.length === 0 ? (

          /* EMPTY */
          <div className="sales-history-empty">
            <div className="empty-sales-icon">₱</div>

            <h3>{invalidRange ? "Invalid date range" : !hasSnapshot || fromCache ? "No cached records for this range" : "No matching transactions"}</h3>

            <p>
              {!hasSnapshot || fromCache ? "Checking available records in the background. Connect to verify sales history." : "Try a different date range."}
            </p>
          </div>

        ) : (

          /* SALES LIST */
          <div className="sales-history-list">

            {filteredSales.slice(0, visibleCount).map((sale) => (
              <div
                className="sale-history-item"
                key={sale.id}
              >

                {/* SALE BASIC INFO */}
                <div className="sale-history-main">

                  <div className="sale-history-icon">
                    ₱
                  </div>

                  <div className="sale-history-info">

                    <strong>
                      Sale #{sale.saleId || sale.id}
                    </strong>

                    <p>
                      {formatDate(sale.createdAt)} {sale.pendingSync && <span className="sale-pending-tag">Pending sync</span>}
                    </p>

                  </div>
                </div>

                {/* SALE DETAILS */}
                <div className="sale-history-details">

                  {/* TOTAL */}
                  <div className="sale-history-detail sale-history-total">
                    <span>Total</span>

                    <strong>
                      {formatCurrency(sale.total)}
                    </strong>
                  </div>

                  {/* ACTION MENU */}
                  <button type="button" className="sale-action-trigger"
                    aria-label="Sale actions" aria-haspopup="menu"
                    aria-expanded={menu?.sale.id === sale.id}
                    onClick={(event) => openMenu(event, sale)}>⋮</button>

                </div>
              </div>
            ))}
            {visibleCount < filteredSales.length && <button className="sales-load-more" type="button" onClick={() => setVisibleCount((count) => count + 50)}>Show more ({filteredSales.length - visibleCount} remaining)</button>}
          </div>
        )}
      </div>

      {errorMessage && <div className="sale-action-error" role="alert">{errorMessage} <button type="button" onClick={() => setErrorMessage("")}>×</button></div>}
      {menu && createPortal(
        <>
          <div className="sale-action-backdrop" onClick={() => setMenu(null)} />
          <div className="sale-action-menu" role="menu" style={{ left: menu.left, top: menu.top }}>
            <button role="menuitem" onClick={() => { handleViewSale(menu.sale); setMenu(null); }}>View</button>
            <button role="menuitem" onClick={() => handlePrintReceipt(menu.sale)}>Print receipt</button>
            <button role="menuitem" onClick={() => handleSaveReceipt(menu.sale)}>Save receipt (PDF)</button>
            <button role="menuitem" className="sale-action-danger" onClick={() => { setDeleteTarget(menu.sale); setMenu(null); }}>Delete</button>
          </div>
        </>, document.body)}
      {deleteTarget && createPortal(
        <div className="sale-delete-overlay">
          <div className="sale-delete-dialog" role="dialog" aria-modal="true" aria-label="Delete sale">
            <h3>Delete sale?</h3>
            <p>Sale #{deleteTarget.saleId || deleteTarget.id} will be removed from sales history only. The sales collection and inventory stock will not be changed. Offline deletion will synchronize when connected.</p>
            <div className="sale-delete-buttons">
              <button onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button className="sale-delete-confirm" onClick={handleDeleteSale}>Delete</button>
            </div>
          </div>
        </div>, document.body)}

      {/* =====================================
          SALE DETAILS MODAL
      ====================================== */}
      {selectedSale && (
        <div
          className="sale-modal-overlay"
          onClick={handleCloseSaleModal}
        >

          <div
            className="sale-modal"
            onClick={(event) =>
              event.stopPropagation()
            }
          >

            {/* MODAL HEADER */}
            <div className="sale-modal-header">

              <div>
                <h2>
                  Sale #
                  {selectedSale.saleId ||
                    selectedSale.id}
                </h2>

                <p>
                  Complete transaction information
                </p>
              </div>

              <button
                type="button"
                className="sale-modal-close"
                onClick={handleCloseSaleModal}
                aria-label="Close"
              >
                ×
              </button>

            </div>

            {/* =================================
                SALE INFORMATION
            ================================== */}
            <div className="sale-modal-info">

              <div className="sale-info-box">
                <span>Sale ID</span>

                <strong>
                  {selectedSale.saleId ||
                    selectedSale.id}
                </strong>
              </div>

              <div className="sale-info-box">
                <span>Date & Time</span>

                <strong>
                  {formatDate(
                    selectedSale.createdAt
                  )}
                </strong>
              </div>

              <div className="sale-info-box">
                <span>Completed By</span>

                <strong>
                  {selectedSale.email ||
                    "Unknown user"}
                </strong>
              </div>

              <div className="sale-info-box">
                <span>Role</span>

                <strong>
                  {selectedSale.role ||
                    "Unknown"}
                </strong>
              </div>

              <div className="sale-info-box">
                <span>Payment Method</span>

                <strong>
                  {selectedSale.paymentMethod ||
                    "Cash Only"}
                </strong>
              </div>

              <div className="sale-info-box">
                <span>GCash Amount</span>

                <strong>
                  {formatCurrency(
                    selectedSale.gcashAmount
                  )}
                </strong>
              </div>

            </div>

            {/* =================================
                PRODUCTS
            ================================== */}
            <div className="sale-products-section">

              <div className="sale-products-header">

                <div>
                  <h3>Products</h3>

                  <p>
                    Products included in this sale
                  </p>
                </div>

                <span>
                  {getItemCount(
                    selectedSale.items
                  )}{" "}
                  item
                  {getItemCount(
                    selectedSale.items
                  ) !== 1
                    ? "s"
                    : ""}
                </span>

              </div>

              {!Array.isArray(
                selectedSale.items
              ) ||
              selectedSale.items.length === 0 ? (

                <div className="no-sale-products">
                  No product information available.
                </div>

              ) : (

                <div className="sale-products-table-wrapper">

                  <table className="sale-products-table">

                    <thead>
                      <tr>
  <th>Product ID</th>
  <th>Product Name</th>
  <th>Price</th>
  <th>Quantity</th>
  <th>Subtotal</th>
  <th>Profit</th>
</tr>
                    </thead>

                    <tbody>

                      {selectedSale.items.map(
                        (item, index) => (
                          <tr key={index}>

                            <td>
                              {item.productId || "-"}
                            </td>

                            <td>
                              <strong>
                                {item.productName ||
                                  "Unknown product"}
                              </strong>
                            </td>

                            <td>
                              {formatCurrency(
                                item.sellingPrice
                              )}
                            </td>

                            <td>
                              {Number(
                                item.quantity
                              ) || 0}
                            </td>

                            <td className="product-subtotal">
                              {formatCurrency(
                                item.subtotal
                              )}
                            </td>

                            <td className="product-profit">
  {formatCurrency(item.profit)}
</td>

                          </tr>
                        )
                      )}

                    </tbody>

                  </table>

                </div>
              )}

            </div>

            {/* =================================
                PAYMENT INFORMATION
            ================================== */}
            <div className="sale-payment-summary">

              <div className="sale-payment-row">
                <span>Payment Method</span>

                <strong>
                  {selectedSale.paymentMethod ||
                    "Cash Only"}
                </strong>
              </div>

              <div className="sale-payment-row">
                <span>GCash Amount</span>

                <strong>
                  {formatCurrency(
                    selectedSale.gcashAmount
                  )}
                </strong>
              </div>

              {/* ONLY SHOW CASH FOR GCASH + CASH */}
              {selectedSale.paymentMethod ===
                "GCash + Cash" && (
                <div className="sale-payment-row">

                  <span>Cash Amount</span>

                  <strong>
                    {formatCurrency(
                      Number(
                        selectedSale.total || 0
                      ) -
                        Number(
                          selectedSale.gcashAmount || 0
                        )
                    )}
                  </strong>

                </div>
              )}

            </div>

            {/* =================================
                TOTAL
            ================================== */}
            {/* =================================
    SALE FINANCIAL SUMMARY
================================== */}

<div className="sale-modal-financial-summary">

  <div className="sale-modal-total">
    <span>Total Sale</span>

    <strong>
      {formatCurrency(selectedSale.total)}
    </strong>
  </div>

  <div className="sale-modal-cost">
    <span>Cost of Goods Sold</span>

    <strong>
      {formatCurrency(
        selectedSale.costOfGoodsSold
      )}
    </strong>
  </div>

  <div className="sale-modal-profit">
    <span>Total Profit</span>

    <strong>
      {formatCurrency(
        selectedSale.profit
      )}
    </strong>
  </div>

</div>

            {/* FOOTER */}
            <div className="sale-modal-footer">

              <button
                type="button"
                className="close-sale-button"
                onClick={handleCloseSaleModal}
              >
                Close
              </button>

            </div>

          </div>
        </div>
      )}

    </div>
  );
}

export default SalesHistory;