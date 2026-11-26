import { useEffect, useState } from "react";
import {
  collection,
  getDocs,
  query,
  orderBy,
  doc,
  deleteDoc,
} from "firebase/firestore";

import { createPortal } from "react-dom";
import { jsPDF } from "jspdf";
import { db } from "../../firebase/config";
import "./salesHistory.css";


function SalesHistory() {
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);

  // Selected sale for View modal
  const [selectedSale, setSelectedSale] = useState(null);

  const [menu, setMenu] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");

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

  const loadSalesHistory = async () => {
    try {
      setLoading(true);

      const salesQuery = query(
        collection(db, "saleActivity"),
        orderBy("createdAt", "desc")
      );

      const snapshot = await getDocs(salesQuery);

      const salesList = snapshot.docs.map((saleDoc) => ({
        ...saleDoc.data(),
        id: saleDoc.id,
      }));

      setSales(salesList);
    } catch (error) {
      console.error("Error loading sales history:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSalesHistory();
  }, []);

  // ---------------------------------------
  // TOTAL TRANSACTIONS
  // ---------------------------------------
  const totalTransactions = sales.length;

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

  const handleDeleteSale = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setErrorMessage("");
    try {
      await deleteDoc(doc(db, "saleActivity", deleteTarget.id));
      setSales((previous) => previous.filter((sale) => sale.id !== deleteTarget.id));
      if (selectedSale?.id === deleteTarget.id) setSelectedSale(null);
      setDeleteTarget(null);
    } catch (error) {
      console.error("Error deleting sale:", error);
      setErrorMessage("Unable to delete sale. Check your permissions and connection.");
    } finally { setDeleting(false); }
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
      <div className="sales-summary">

        {/* TOTAL TRANSACTIONS */}
        <div className="sales-summary-card">
          <div className="sales-summary-icon">#</div>

          <div className="sales-summary-content">
            <span>Total Transactions</span>

            <strong>
              {loading
                ? "Loading..."
                : totalTransactions.toLocaleString("en-PH")}
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

        ) : sales.length === 0 ? (

          /* EMPTY */
          <div className="sales-history-empty">
            <div className="empty-sales-icon">₱</div>

            <h3>No sales yet</h3>

            <p>
              Completed sales will appear here.
            </p>
          </div>

        ) : (

          /* SALES LIST */
          <div className="sales-history-list">

            {sales.map((sale) => (
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
                      {formatDate(sale.createdAt)}
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
            <p>Sale #{deleteTarget.saleId || deleteTarget.id} will be permanently removed. Inventory stock will not be restored.</p>
            <div className="sale-delete-buttons">
              <button disabled={deleting} onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button className="sale-delete-confirm" disabled={deleting} onClick={handleDeleteSale}>{deleting ? "Deleting..." : "Delete"}</button>
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