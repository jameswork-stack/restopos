import { useEffect, useRef, useState } from "react";
import {
  collection,
  getDocs,
  getDocsFromCache,
  writeBatch,
  doc,
  serverTimestamp,
} from "firebase/firestore";

import { db } from "../../firebase/config";
import "./inventory.css";
import { getCurrentUserInfo } from "../../services/authService";

const isDineIn = (product) => product?.trackStock === false;

const normalizeId = (value) => String(value ?? "").trim().toLowerCase();
const normalizeName = (value) => normalizeId(value).replace(/\s+/g, " ");
const isNetworkError = (error) =>
  error?.code === "unavailable" ||
  error?.code === "deadline-exceeded" ||
  (typeof navigator !== "undefined" && !navigator.onLine);

function Inventory() {
  const productSaveLock = useRef(false);

  const checkDuplicateProduct = async (productId, productName, excludeId = null) => {
    let snapshot;
    try {
      snapshot = await getDocsFromCache(collection(db, "products"));
    } catch (cacheError) {
      console.warn("Could not check the Firestore product cache:", cacheError);
    }
    const otherProducts = snapshot
      ? snapshot.docs.filter((entry) => entry.id !== excludeId)
      : products
        .filter((entry) => entry.id !== excludeId)
        .map((entry) => ({ id: entry.id, data: () => entry }));
    if (otherProducts.some((entry) => normalizeId(entry.data().productId) === normalizeId(productId))) {
      return "A product with this Product ID / Barcode already exists.";
    }
    if (otherProducts.some((entry) => normalizeName(entry.data().productName) === normalizeName(productName))) {
      return "A product with this name already exists. Edit the existing product or use Add Stock instead.";
    }
    return null;
  };

  const [showStockForm, setShowStockForm] = useState(false);
  const [stockAction, setStockAction] = useState(null);
  const [selectedProduct, setSelectedProduct] = useState(null);

  const [stockForm, setStockForm] = useState({
  quantity: "",
  reason: "",
  costAmount: "",
});

const [openMenuId, setOpenMenuId] = useState(null);

const [showEditForm, setShowEditForm] = useState(false);
const [editingProduct, setEditingProduct] = useState(null);

const [showDeleteForm, setShowDeleteForm] = useState(false);
const [deletingProduct, setDeletingProduct] = useState(null);

const [editReason, setEditReason] = useState("");
const [deleteReason, setDeleteReason] = useState("");

const [updatingProduct, setUpdatingProduct] = useState(false);
const [deleting, setDeleting] = useState(false);

  const [updatingStock, setUpdatingStock] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState(null);

  // Search and filter
  const [searchTerm, setSearchTerm] = useState("");
  const [stockFilter, setStockFilter] = useState("all");

  const [formData, setFormData] = useState({
      trackStock: true,
    productId: "",
    productName: "",
    description: "",
    productCost: "",
    sellingPrice: "",
    initialStock: "",
    minimumStock: "",
    maximumStock: "",
  });

  // Load products
  const loadProducts = async () => {
    try {
      const querySnapshot =
        typeof navigator !== "undefined" && !navigator.onLine
          ? await getDocsFromCache(collection(db, "products"))
          : await getDocs(collection(db, "products"));

      const productList = querySnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      setProducts(productList);
    } catch (error) {
      if (!isNetworkError(error)) {
        console.error("Error loading products:", error);
      }
      try {
        const cachedSnapshot = await getDocsFromCache(collection(db, "products"));
        setProducts(cachedSnapshot.docs.map((productDoc) => ({
          id: productDoc.id,
          ...productDoc.data(),
        })));
      } catch (cacheError) {
        console.error("Error loading cached products:", cacheError);
      }
    } finally {
      setLoading(false);
    }
  };

  // Open stock form
const openStockForm = (product, action) => {
  if (isDineIn(product)) return;
  setSelectedProduct(product);
  setStockAction(action);

  setStockForm({
    quantity: "",
    reason: "",
    costAmount: "",
  });

  setShowStockForm(true);
};

// Close stock form
const closeStockForm = () => {
  setShowStockForm(false);
  setSelectedProduct(null);
  setStockAction(null);

  setStockForm({
    quantity: "",
    reason: "",
    costAmount: "",
  });
};

// Handle stock form input
const handleStockFormChange = (e) => {
  const { name, value } = e.target;

  setStockForm((prev) => ({
    ...prev,
    [name]: value,
  }));
};

// Open edit product form
const openEditForm = (product) => {
  setEditingProduct(product);

  setFormData({
    trackStock: !isDineIn(product),
    productId: product.productId || "",
    productName: product.productName || "",
    description: product.description || "",
    productCost: product.productCost ?? "",
    sellingPrice: product.sellingPrice ?? "",
    initialStock: product.stock ?? "",
    minimumStock: product.minimumStock ?? "",
    maximumStock: product.maximumStock ?? "",
  });

  setEditReason("");

  setShowEditForm(true);
  setOpenMenuId(null);
};

const handleEditProduct = async (e) => {
  e.preventDefault();

  if (!editingProduct || productSaveLock.current) {
    return;
  }

  if (!editReason.trim()) {
    alert("Please enter a reason for editing this product.");
    return;
  }

  if (
    !formData.productId.trim() ||
    !formData.productName.trim() ||
    formData.productCost === "" ||
    formData.sellingPrice === "" ||
    (formData.trackStock && (formData.minimumStock === "" ||
    formData.maximumStock === ""))
  ) {
    alert("Please fill in all required fields.");
    return;
  }

  const productCost = Number(formData.productCost);
  const sellingPrice = Number(formData.sellingPrice);
  const minimumStock = formData.trackStock ? Number(formData.minimumStock) : 0;
  const maximumStock = formData.trackStock ? Number(formData.maximumStock) : 0;

  if (
    productCost < 0 ||
    sellingPrice < 0 ||
    minimumStock < 0 ||
    maximumStock < 0
  ) {
    alert("Values cannot be negative.");
    return;
  }

  if (maximumStock < minimumStock) {
    alert(
      "Maximum stock must be greater than minimum stock."
    );
    return;
  }

  productSaveLock.current = true;
  try {
    setUpdatingProduct(true);
    setSaveFeedback(null);

    // Get currently logged-in user's information
    const userInfo = await getCurrentUserInfo();

    const duplicate = await checkDuplicateProduct(formData.productId, formData.productName, editingProduct.id);
    if (duplicate) { alert(duplicate); return; }
    const batch = writeBatch(db);
    // Update product
    batch.update(
      doc(db, "products", editingProduct.id),
      {
        productId: formData.productId.trim(),
        productName: formData.productName.trim(),
        description: formData.description.trim(),
        productCost,
        trackStock: formData.trackStock,
        costPerItem: formData.trackStock ? (Number(editingProduct.stock) > 0 ? Number((productCost / Number(editingProduct.stock)).toFixed(2)) : 0) : productCost,
        profitPerItem: Number((sellingPrice - (formData.trackStock ? (Number(editingProduct.stock) > 0 ? productCost / Number(editingProduct.stock) : 0) : productCost)).toFixed(2)),
        sellingPrice,
        minimumStock,
        maximumStock,
        updatedAt: serverTimestamp(),
    });

    // Record edit activity
    batch.set(
      doc(collection(db, "productActivity")),
      {
        action: "edit",

        productId: formData.productId.trim(),
        productName: formData.productName.trim(),

        reason: editReason.trim(),

        userId: userInfo.userId,
        email: userInfo.email,
        role: userInfo.role,

        createdAt: serverTimestamp(),
    });
    const syncPromise = batch.commit();
    setProducts((current) => current.map((product) =>
      product.id === editingProduct.id
        ? {
            ...product,
            productId: formData.productId.trim(),
            productName: formData.productName.trim(),
            description: formData.description.trim(),
            productCost,
            trackStock: formData.trackStock,
            sellingPrice,
            minimumStock,
            maximumStock,
          }
        : product
    ));
    setSaveFeedback({
      type: "success",
      text: "Product update saved on this device. It will sync to Firestore when online.",
    });
    void syncPromise.catch((error) => {
      console.error("Could not sync product update:", error);
      setProducts((current) => current.map((product) =>
        product.id === editingProduct.id ? editingProduct : product
      ));
      setSaveFeedback({
        type: "error",
        text: "The product update could not sync to Firestore. Check your connection and permissions.",
      });
    });

    setShowEditForm(false);
    setEditingProduct(null);
    setEditReason("");

    setFormData({
      trackStock: true,
      productId: "",
      productName: "",
      description: "",
      productCost: "",
      sellingPrice: "",
      initialStock: "",
      minimumStock: "",
      maximumStock: "",
    });

  } catch (error) {
    console.error("Error updating product:", error);
    alert("Failed to update product.");
  } finally {
    productSaveLock.current = false;
    setUpdatingProduct(false);
  }
};

const openDeleteForm = (product) => {
  setDeletingProduct(product);
  setDeleteReason("");
  setShowDeleteForm(true);
  setOpenMenuId(null);
};
const handleDeleteProduct = async (e) => {
  e.preventDefault();

  if (!deletingProduct) {
    return;
  }

  if (!deleteReason.trim()) {
    alert("Please enter a reason for deleting this product.");
    return;
  }

  try {
    setDeleting(true);
    setSaveFeedback(null);
    const userInfo = await getCurrentUserInfo();
    const deleteBatch = writeBatch(db);

    // Record deletion before deleting the product
    deleteBatch.set(doc(collection(db, "productActivity")), {
      action: "delete",
      productId: deletingProduct.productId,
      productName: deletingProduct.productName,
      reason: deleteReason.trim(),

      userId: userInfo.userId,
      email: userInfo.email,
      role: userInfo.role,

      createdAt: serverTimestamp(),
    });

    // Delete product
    deleteBatch.delete(doc(db, "products", deletingProduct.id));
    const syncPromise = deleteBatch.commit();
    setProducts((current) =>
      current.filter((product) => product.id !== deletingProduct.id)
    );

    setSaveFeedback({
      type: "success",
      text: "Product deletion saved on this device. It will sync to Firestore when online.",
    });
    void syncPromise.catch((error) => {
      console.error("Could not sync product deletion:", error);
      setProducts((current) => [deletingProduct, ...current]);
      setSaveFeedback({
        type: "error",
        text: "The product deletion could not sync to Firestore. Check your connection and permissions.",
      });
    });

    setShowDeleteForm(false);
    setDeletingProduct(null);
    setDeleteReason("");

  } catch (error) {
    console.error("Error deleting product:", error);
    alert("Failed to delete product.");
  } finally {
    setDeleting(false);
  }
};

// Add or remove stock
// Add or remove stock
const handleStockUpdate = async (e) => {
  e.preventDefault();

  const quantity = Number(stockForm.quantity);

  if (!quantity || quantity <= 0) {
    alert("Please enter a valid quantity.");
    return;
  }

  if (!stockForm.reason.trim()) {
    alert("Please enter a reason.");
    return;
  }

  if (!selectedProduct || isDineIn(selectedProduct)) {
    return;
  }

  try {
    setUpdatingStock(true);
    setSaveFeedback(null);

    // Get current user information
    const userInfo = await getCurrentUserInfo();

    // Current product values
    const currentStock = Number(selectedProduct.stock) || 0;
    const currentCost = Number(selectedProduct.productCost) || 0;
    const sellingPrice = Number(selectedProduct.sellingPrice) || 0;

    let newStock;
    let newCost;
    let newCostPerItem;
    let newProfitPerItem;
    let addedCost = 0;
    let removedCost = 0;

    if (stockAction === "add") {
      // ==========================================
      // ADD STOCK
      // ==========================================

      const costAmount = Number(stockForm.costAmount);

      if (costAmount <= 0) {
        alert("Please enter the cost of the new stock.");
        return;
      }

      // New stock quantity
      newStock = currentStock + quantity;

      // Add the cost of the new stock
      newCost = currentCost + costAmount;

      // Weighted average cost per item
      newCostPerItem =
        newStock > 0
          ? newCost / newStock
          : 0;

      // Profit per item
      newProfitPerItem =
        sellingPrice - newCostPerItem;

      // Store for activity log
      addedCost = costAmount;

    } else {
      // ==========================================
      // REMOVE STOCK
      // ==========================================

      if (quantity > currentStock) {
        alert(
          `Cannot remove ${quantity} items. Current stock is only ${currentStock}.`
        );
        return;
      }

      // Current average cost per item
      const currentCostPerItem =
        currentStock > 0
          ? currentCost / currentStock
          : 0;

      // Automatically calculate the cost
      // of the stock being removed
      removedCost =
        currentCostPerItem * quantity;

      // New stock quantity
      newStock = currentStock - quantity;

      // Remove the cost of the stock
      newCost = currentCost - removedCost;

      // Prevent negative values caused by rounding
      if (newCost < 0) {
        newCost = 0;
      }

      // Calculate new cost per item
      newCostPerItem =
        newStock > 0
          ? newCost / newStock
          : 0;

      // Calculate new profit per item
      newProfitPerItem =
        sellingPrice - newCostPerItem;
    }

    // Round financial values
    newCost = Number(newCost.toFixed(2));
    newCostPerItem = Number(
      newCostPerItem.toFixed(2)
    );
    newProfitPerItem = Number(
      newProfitPerItem.toFixed(2)
    );

    // ==========================================
    // UPDATE PRODUCT
    // ==========================================

    const stockBatch = writeBatch(db);
    stockBatch.update(doc(db, "products", selectedProduct.id), {
        stock: newStock,

        // Total cost of current inventory
        productCost: newCost,

        // Average cost per item
        costPerItem: newCostPerItem,

        // Selling price - average cost
        profitPerItem: newProfitPerItem,

        updatedAt: serverTimestamp(),
      }
    );

    // ==========================================
    // SAVE STOCK MOVEMENT
    // ==========================================

    const previousCostPerItem =
      currentStock > 0
        ? currentCost / currentStock
        : 0;

    const previousProfitPerItem =
      sellingPrice - previousCostPerItem;

    stockBatch.set(doc(collection(db, "stockMovements")), {
        productId: selectedProduct.productId,

        productName: selectedProduct.productName,

        action: stockAction,

        quantity: quantity,

        previousStock: currentStock,

        newStock: newStock,

        previousCost: currentCost,

        // Cost added when adding stock
        addedCost: addedCost,

        // Cost automatically removed when
        // removing stock
        removedCost: Number(
          removedCost.toFixed(2)
        ),

        newCost: newCost,

        previousCostPerItem: Number(
          previousCostPerItem.toFixed(2)
        ),

        newCostPerItem: newCostPerItem,

        previousProfitPerItem: Number(
          previousProfitPerItem.toFixed(2)
        ),

        newProfitPerItem: newProfitPerItem,

        reason: stockForm.reason.trim(),

        // User information
        userId: userInfo.userId,

        email: userInfo.email,

        role: userInfo.role,

        createdAt: serverTimestamp(),
      }
    );
    const syncPromise = stockBatch.commit();
    setProducts((current) => current.map((product) =>
      product.id === selectedProduct.id
        ? {
            ...product,
            stock: newStock,
            productCost: newCost,
            costPerItem: newCostPerItem,
            profitPerItem: newProfitPerItem,
          }
        : product
    ));

    // ==========================================
    // SUCCESS
    // ==========================================

    setSaveFeedback({
      type: "success",
      text: stockAction === "add"
        ? "Stock saved on this device. It will sync to Firestore when online."
        : "Stock removal saved on this device. It will sync to Firestore when online.",
    });
    void syncPromise.catch((error) => {
      console.error("Could not sync stock update:", error);
      setProducts((current) => current.map((product) =>
        product.id === selectedProduct.id ? selectedProduct : product
      ));
      setSaveFeedback({
        type: "error",
        text: "The stock update could not sync to Firestore. Check your connection and permissions.",
      });
    });

    closeStockForm();

  } catch (error) {
    console.error(
      "Error updating stock:",
      error
    );

    alert("Failed to update stock.");
  } finally {
    setUpdatingStock(false);
  }
};


  useEffect(() => {
    loadProducts();
  }, []);

  // Handle form input
  const handleChange = (e) => {
    const { name, value } = e.target;

    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  
// Save product
const handleSubmit = async (e) => {
  e.preventDefault();

  if (saving || productSaveLock.current) {
    return;
  }

  if (
    !formData.productId.trim() ||
    !formData.productName.trim() ||
    formData.productCost === "" ||
    formData.sellingPrice === "" ||
    (formData.trackStock && formData.initialStock === "") ||
    (formData.trackStock && (formData.minimumStock === "" ||
    formData.maximumStock === ""))
  ) {
    alert("Please fill in all required fields.");
    return;
  }

  // Convert values to numbers
  const productCost = Number(formData.productCost);
  const sellingPrice = Number(formData.sellingPrice);
  const initialStock = formData.trackStock ? Number(formData.initialStock) : 0;
  const minimumStock = formData.trackStock ? Number(formData.minimumStock) : 0;
  const maximumStock = formData.trackStock ? Number(formData.maximumStock) : 0;

  // Validate values
  if (
    productCost < 0 ||
    sellingPrice < 0 ||
    (formData.trackStock && initialStock <= 0) ||
    minimumStock < 0 ||
    maximumStock < 0
  ) {
    alert(
      "Product cost, selling price, and stock must be valid positive values."
    );
    return;
  }

  if (maximumStock < minimumStock) {
    alert("Maximum stock must be greater than minimum stock.");
    return;
  }

  // Calculate cost per item
  const costPerItem = formData.trackStock ? productCost / initialStock : productCost;

  // Calculate profit per item
  const profitPerItem = sellingPrice - costPerItem;

  productSaveLock.current = true;
  try {
    setSaving(true);
    setSaveFeedback(null);
    const userInfo = await getCurrentUserInfo();

    const productId = formData.productId.trim();

    const duplicate = await checkDuplicateProduct(productId, formData.productName);
    if (duplicate) { alert(duplicate); return; }
    const batch = writeBatch(db);
    const productRef = doc(collection(db, "products"));
    const newProductData = {
      productId,
      productName: formData.productName.trim(),
      description: formData.description.trim(),
      productCost,
      costPerItem: Number(costPerItem.toFixed(2)),
      sellingPrice,
      profitPerItem: Number(profitPerItem.toFixed(2)),
      trackStock: formData.trackStock,
      stock: initialStock,
      minimumStock,
      maximumStock,
    };
    const newProduct = {
      ...newProductData,
      id: productRef.id,
      createdAt: new Date(),
    };

    // Add product
    batch.set(productRef, {
      ...newProductData,
      createdAt: serverTimestamp(),
    });

    // Record product activity
    batch.set(doc(collection(db, "productActivity")), {
      action: "add",

      productId,

      productName: formData.productName.trim(),

      reason: "New product added",

      userId: userInfo.userId,

      email: userInfo.email,

      role: userInfo.role,

      createdAt: serverTimestamp(),
    });

    const syncPromise = batch.commit();
    setProducts((current) => [newProduct, ...current]);
    setSaveFeedback({
      type: "success",
      text: "Product added successfully on this device. It will sync to Firestore when online.",
    });
    void syncPromise.catch((error) => {
      console.error("Could not sync new product:", error);
      setProducts((current) => current.filter((product) => product.id !== productRef.id));
      setSaveFeedback({
        type: "error",
        text: "The product could not sync to Firestore. Check your connection and permissions.",
      });
    });

    // Reset form
    setFormData({
      trackStock: true,
      productId: "",
      productName: "",
      description: "",
      productCost: "",
      sellingPrice: "",
      initialStock: "",
      minimumStock: "",
      maximumStock: "",
    });

    setShowForm(false);
  } catch (error) {
    console.error("Error adding product:", error);
    alert("Failed to add product.");
  } finally {
    productSaveLock.current = false;
    setSaving(false);
  }
};


  // Get stock status
  const getStockStatus = (product) => {
    if (isDineIn(product)) return { text: "Dine-in Food", className: "dine-in-stock" };
    if (Number(product.stock) === 0) {
      return {
        text: "Out of Stock",
        className: "out-stock",
      };
    }

    if (
      Number(product.stock) <=
      Number(product.minimumStock)
    ) {
      return {
        text: "Low Stock",
        className: "low-stock",
      };
    }

    if (
      Number(product.stock) >=
      Number(product.maximumStock)
    ) {
      return {
        text: "Over Stock",
        className: "over-stock",
      };
    }

    return {
      text: "In Stock",
      className: "in-stock",
    };
  };

  // Search + filter products
  const filteredProducts = products.filter((product) => {
  const search = searchTerm.toLowerCase().trim();

  const matchesSearch =
    product.productName
      ?.toLowerCase()
      .includes(search) ||
    product.productId
      ?.toLowerCase()
      .includes(search);

  const stock = Number(product.stock);
  const minimumStock = Number(product.minimumStock);
  const maximumStock = Number(product.maximumStock);

  let matchesFilter = true;
  if (stockFilter === "dine-in") matchesFilter = isDineIn(product);
  else if (stockFilter === "tracked") matchesFilter = !isDineIn(product);
  else if (stockFilter !== "all") {
    const status = getStockStatus(product).className;
    matchesFilter = !isDineIn(product) && status === `${stockFilter}-stock`;
  }

  return matchesSearch && matchesFilter;
});

  return (
    <div className="inventory-page">

      {/* HEADER */}
      <div className="inventory-header">
        <div>
          <h1>Inventory</h1>
          <p>Manage your products and stock levels.</p>
        </div>
        {saveFeedback && (
          <div
            className={`inventory-save-feedback ${saveFeedback.type}`}
            role={saveFeedback.type === "error" ? "alert" : "status"}
          >
            {saveFeedback.text}
          </div>
        )}

        <button
          className="add-product-button"
          onClick={() => { setFormData({ trackStock: true, productId: "", productName: "", description: "", productCost: "", sellingPrice: "", initialStock: "", minimumStock: "", maximumStock: "" }); setShowForm(true); }}
        >
          + Add Product
        </button>
      </div>

      {/* SEARCH AND FILTER */}
      <div className="inventory-tools">

        <div className="search-box">
          <span className="search-icon">🔎</span>

          <input
            type="text"
            placeholder="Search product name, ID or barcode..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />

          {searchTerm && (
            <button
              className="clear-search"
              onClick={() => setSearchTerm("")}
            >
              ×
            </button>
          )}
        </div>

       <div className="stock-filter">
  <button type="button" className={`filter-button ${stockFilter === "dine-in" ? "active" : ""}`} onClick={() => setStockFilter("dine-in")}>Dine-in Food</button>
  <button type="button" className={`filter-button ${stockFilter === "tracked" ? "active" : ""}`} onClick={() => setStockFilter("tracked")}>Stocked Products</button>
  <button
    className={
      stockFilter === "all"
        ? "filter-button active"
        : "filter-button"
    }
    onClick={() => setStockFilter("all")}
  >
    All Products
  </button>

  <button
    className={
      stockFilter === "low"
        ? "filter-button active"
        : "filter-button"
    }
    onClick={() => setStockFilter("low")}
  >
    Low Stock
  </button>

  <button
    className={
      stockFilter === "out"
        ? "filter-button active"
        : "filter-button"
    }
    onClick={() => setStockFilter("out")}
  >
    Out of Stock
  </button>

  <button
    className={
      stockFilter === "over"
        ? "filter-button active"
        : "filter-button"
    }
    onClick={() => setStockFilter("over")}
  >
    Over Stock
  </button>
</div>
      </div>

      {/* ADD PRODUCT FORM */}
      {showForm && (
        <div className="product-form-overlay">
          <div className="product-form-card">

            <div className="form-header">
              <div>
                <h2>Add Product</h2>
                <p>
                  Enter the product information below.
                </p>
              </div>

              <button
                className="close-form-button"
                disabled={saving}
                  onClick={() => setShowForm(false)}
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSubmit}>

              <div className="form-grid">
<div className="form-group full-width inventory-type-field">
                  <label htmlFor="inventory-product-type">Product Type</label>
                  <select id="inventory-product-type" value={formData.trackStock ? "stocked" : "dine-in"} onChange={(e) => setFormData(prev => ({ ...prev, trackStock: e.target.value === "stocked" }))}>
                    <option value="stocked">Stocked Product</option>
                    <option value="dine-in">Dine-in Food (No Stock Tracking)</option>
                  </select>
                  {!formData.trackStock && <small className="form-help">Enter the cost of one serving. Stock quantities are not tracked.</small>}
                </div>

                <div className="form-group">
                  <label>
                    Product ID / Barcode
                  </label>

                  <input
                    type="text"
                    name="productId"
                    placeholder="Scan or enter barcode"
                    value={formData.productId}
                    onChange={handleChange}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Product Name</label>

                  <input
                    type="text"
                    name="productName"
                    placeholder="Enter product name"
                    value={formData.productName}
                    onChange={handleChange}
                    required
                  />
                </div>

                <div className="form-group full-width">
                  <label>Description</label>

                  <textarea
                    name="description"
                    placeholder="Enter product description"
                    value={formData.description}
                    onChange={handleChange}
                    rows="3"
                  />
                </div>

                <div className="form-group">
                  <label>{formData.trackStock ? "Product Cost (Total)" : "Cost per Serving"}</label>

                  <input
                    type="number"
                    name="productCost"
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                    value={formData.productCost}
                    onChange={handleChange}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Selling Price</label>

                  <input
                    type="number"
                    name="sellingPrice"
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                    value={formData.sellingPrice}
                    onChange={handleChange}
                    required
                  />
                </div>

                {formData.trackStock && (<div className="form-group">
                  <label>Initial Stock</label>

                  <input
                    type="number"
                    name="initialStock"
                    placeholder="0"
                    min="0"
                    value={formData.initialStock}
                    onChange={handleChange}
                    required
                  />
                </div>)}

                {formData.trackStock && (<div className="form-group">
                  <label>Minimum Stock</label>

                  <input
                    type="number"
                    name="minimumStock"
                    placeholder="0"
                    min="0"
                    value={formData.minimumStock}
                    onChange={handleChange}
                    required
                  />
                </div>)}

                {formData.trackStock && (<div className="form-group">
                  <label>Maximum / Over Stock</label>

                  <input
                    type="number"
                    name="maximumStock"
                    placeholder="0"
                    min="0"
                    value={formData.maximumStock}
                    onChange={handleChange}
                    required
                  />
                </div>)}

              </div>

              <div className="form-actions">

                <button
                  type="button"
                  className="cancel-button"
                  disabled={saving}
                  onClick={() => setShowForm(false)}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="save-product-button"
                  disabled={saving}
                >
                  {saving
                    ? "Saving..."
                    : "Save Product"}
                </button>

              </div>

            </form>
          </div>
        </div>

        
      )}

{/* EDIT FORM */}
  {showEditForm && editingProduct && (
  <div className="product-form-overlay">

    <div className="product-form-card">

      <div className="form-header">

        <div>
          <h2>Edit Product</h2>

          <p>
            Update the information for{" "}
            <strong>
              {editingProduct.productName}
            </strong>
          </p>
        </div>

        <button
          className="close-form-button"
          onClick={() => {
            setShowEditForm(false);
            setEditingProduct(null);
          }}
        >
          
        </button>

      </div>

      <form onSubmit={handleEditProduct}>

        <div className="form-grid">
<div className="form-group full-width inventory-type-field"><label>Product Type</label><div className="inventory-type-readonly">{formData.trackStock ? "Stocked Product" : "Dine-in Food"}</div></div>

          <div className="form-group">
            <label>
              Product ID / Barcode
            </label>

            <input
              type="text"
              name="productId"
              value={formData.productId}
              onChange={handleChange}
              required
            />
          </div>

          <div className="form-group">
            <label>Product Name</label>

            <input
              type="text"
              name="productName"
              value={formData.productName}
              onChange={handleChange}
              required
            />
          </div>

          <div className="form-group full-width">
            <label>Description</label>

            <textarea
              name="description"
              value={formData.description}
              onChange={handleChange}
              rows="3"
            />
          </div>

          <div className="form-group">
            <label>{formData.trackStock ? "Product Cost (Total)" : "Cost per Serving"}</label>

            <input
              type="number"
              name="productCost"
              min="0"
              step="0.01"
              value={formData.productCost}
              onChange={handleChange}
              required
            />
          </div>

          <div className="form-group">
            <label>Selling Price</label>

            <input
              type="number"
              name="sellingPrice"
              min="0"
              step="0.01"
              value={formData.sellingPrice}
              onChange={handleChange}
              required
            />
          </div>

          {formData.trackStock && (<div className="form-group">
            <label>Minimum Stock</label>

            <input
              type="number"
              name="minimumStock"
              min="0"
              value={formData.minimumStock}
              onChange={handleChange}
              required
            />
          </div>)}

          {formData.trackStock && (<div className="form-group">
            <label>Maximum / Over Stock</label>

            <input
              type="number"
              name="maximumStock"
              min="0"
              value={formData.maximumStock}
              onChange={handleChange}
              required
            />
          </div>)}

          {/* EDIT REASON */}
          <div className="form-group full-width">
            <label>
              Reason for Editing
            </label>

            <textarea
              value={editReason}
              onChange={(e) =>
                setEditReason(e.target.value)
              }
              placeholder="Why are you editing this product?"
              rows="3"
              required
            />
          </div>

        </div>

        <div className="form-actions">

          <button
            type="button"
            className="cancel-button"
            onClick={() => {
              setShowEditForm(false);
              setEditingProduct(null);
            }}
          >
            Cancel
          </button>

          <button
            type="submit"
            className="save-product-button"
            disabled={updatingProduct}
          >
            {updatingProduct
              ? "Saving..."
              : "Save Changes"}
          </button>

        </div>

      </form>

    </div>

  </div>
)}
{/* DELETE FORM */}
{showDeleteForm && deletingProduct && (
  <div className="product-form-overlay">

    <div className="delete-form-card">

      <div className="delete-header">

        <div>
          <h2>Delete Product</h2>

          <p>
            You are about to delete:
          </p>

          <strong>
            {deletingProduct.productName}
          </strong>
        </div>

        <button
          className="close-form-button"
          onClick={() => {
            setShowDeleteForm(false);
            setDeletingProduct(null);
          }}
        >
          ×
        </button>

      </div>

      <div className="delete-warning">
        <strong>Warning</strong>

        <p>
          This action will permanently remove this
          product from the inventory.
        </p>
      </div>

      <form onSubmit={handleDeleteProduct}>

        <div className="form-group">

          <label>
            Reason for Deleting
          </label>

          <textarea
            value={deleteReason}
            onChange={(e) =>
              setDeleteReason(e.target.value)
            }
            placeholder="Why do you want to delete this product?"
            rows="4"
            required
          />

        </div>

        <div className="form-actions">

          <button
            type="button"
            className="cancel-button"
            onClick={() => {
              setShowDeleteForm(false);
              setDeletingProduct(null);
            }}
          >
            Cancel
          </button>

          <button
            type="submit"
            className="confirm-delete-button"
            disabled={deleting}
          >
            {deleting
              ? "Deleting..."
              : "Delete Product"}
          </button>

        </div>

      </form>

    </div>

  </div>
)}

      {/* PRODUCTS */}
      <div className="products-section">

        <div className="products-section-header">
          <div>
            <h2>Products</h2>

            <p className="results-count">
              Showing {filteredProducts.length} of{" "}
              {products.length} products
            </p>
          </div>

          <span>
            {products.length} product
            {products.length !== 1 ? "s" : ""}
          </span>
        </div>

        {loading ? (
          <div className="empty-products">
            Loading products...
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="empty-products">
            <h3>No products found</h3>

            <p>
              {searchTerm
                ? "Try a different product name, ID, or barcode."
                : stockFilter === "low"
                ? "There are no low-stock products."
                : stockFilter === "out"
                ? "There are no out-of-stock products."
                : "Click Add Product to add your first product."}
            </p>
          </div>
        ) : (
          <div className="product-grid">

            {filteredProducts.map((product) => {
              const stockStatus =
                getStockStatus(product);

              return (
                <div
                  className="product-card"
                  key={product.id}
                >

                  <div className="product-card-top">

  <span
    className={`stock-status ${stockStatus.className}`}
  >
    {stockStatus.text}
  </span>

  <div className="product-card-menu">

    <button
      className="menu-button"
      onClick={() =>
        setOpenMenuId(
          openMenuId === product.id
            ? null
            : product.id
        )
      }
      title="Product options"
    >
      ⋮
    </button>

    {openMenuId === product.id && (
      <div className="product-menu">

        <button
          onClick={() => openEditForm(product)}
        >
          <span>✏️</span>
          Edit Product
        </button>

        <button
          className="delete-menu-item"
          onClick={() => openDeleteForm(product)}
        >
          <span>🗑️</span>
          Delete Product
        </button>

      </div>
    )}

  </div>

</div>

<div className="product-id-display">
  {product.productId}
</div>

                  <h3>{product.productName}</h3>

                  {product.description && (
                    <p className="product-description">
                      {product.description}
                    </p>
                  )}

                  <div className="price-section">

                    <div>
                      <span>{isDineIn(product) ? "Cost per Serving" : "Cost"}</span>

                      <strong>
                        ₱
                        {Number(
                          product.productCost
                        ).toFixed(2)}
                      </strong>
                    </div>

                    <div>
                      <span>Selling Price</span>

                      <strong>
                        ₱
                        {Number(
                          product.sellingPrice
                        ).toFixed(2)}
                      </strong>
                    </div>

                  </div>

                  {isDineIn(product) ? (
  <div className="inventory-dine-in-info"><span>Stock tracking disabled</span><strong>Profit per serving: ₱{(Number(product.sellingPrice) - Number(product.productCost)).toFixed(2)}</strong></div>
) : (<>
<div className="stock-section">

                    <div>
                      <span>Current Stock</span>
                      <strong>
                        {product.stock}
                      </strong>
                    </div>

                    <div>
                      <span>Minimum</span>
                      <strong>
                        {product.minimumStock}
                      </strong>
                    </div>

                    <div>
                      <span>Maximum</span>
                      <strong>
                        {product.maximumStock}
                      </strong>
                    </div>

                  </div>

                  <div className="stock-actions">

  <button
    className="add-stock-button"
    onClick={() => openStockForm(product, "add")}
  >
    + Add Stock
  </button>

  <button
    className="remove-stock-button"
    onClick={() => openStockForm(product, "remove")}
  >
    − Remove Stock
  </button>

</div>
</>)}

                </div>
              );
            })}

          </div>
        )}

      </div>

      {/* STOCK UPDATE FORM */}
{showStockForm && selectedProduct && (
  <div className="product-form-overlay">

    <div className="stock-form-card">

      <div className="form-header">

        <div>
          <h2>
            {stockAction === "add"
              ? "Add Stock"
              : "Remove Stock"}
          </h2>

          <p>
            {selectedProduct.productName}
          </p>
        </div>

        <button
          className="close-form-button"
          onClick={closeStockForm}
        >
          ×
        </button>

      </div>

      <div className="stock-info-grid">

  <div className="current-stock-info">
    <span>Current Stock</span>

    <strong>
      {selectedProduct.stock}
    </strong>
  </div>

  <div className="current-stock-info">
    <span>Current Cost</span>

    <strong>
      ₱
      {Number(
        selectedProduct.productCost || 0
      ).toFixed(2)}
    </strong>
  </div>

</div>

<form onSubmit={handleStockUpdate}>

  {/* QUANTITY */}
  <div className="form-group">
    <label>Quantity</label>

    <input
      type="number"
      name="quantity"
      placeholder="Enter quantity"
      min="1"
      value={stockForm.quantity}
      onChange={handleStockFormChange}
      required
    />
  </div>

  {/* ADD STOCK COST */}
  {stockAction === "add" && (
    <div className="form-group">

      <label>
        Add Stock Cost Amount
      </label>

      <input
        type="number"
        name="costAmount"
        placeholder="0.00"
        min="0"
        step="0.01"
        value={stockForm.costAmount}
        onChange={handleStockFormChange}
        required
      />

      <small className="form-help">
        Enter the total cost you paid for
        this new stock.
      </small>

    </div>
  )}

  {/* REMOVE STOCK INFORMATION */}
  {stockAction === "remove" && (
    <div className="form-help-box">

      <strong>
        Inventory cost will be calculated automatically.
      </strong>

      <p>
        Cost per item: ₱
        {(
          Number(selectedProduct?.costPerItem) ||
          (
            Number(selectedProduct?.stock) > 0
              ? Number(selectedProduct?.productCost || 0) /
                Number(selectedProduct?.stock)
              : 0
          )
        ).toFixed(2)}
      </p>

      <p>
        Removed inventory cost: ₱
        {(
          (
            Number(selectedProduct?.costPerItem) ||
            (
              Number(selectedProduct?.stock) > 0
                ? Number(selectedProduct?.productCost || 0) /
                  Number(selectedProduct?.stock)
                : 0
            )
          ) *
          Number(stockForm.quantity || 0)
        ).toFixed(2)}
      </p>

    </div>
  )}

  {/* REASON */}
  <div className="form-group">

    <label>Reason</label>

    <textarea
      name="reason"
      placeholder={
        stockAction === "add"
          ? "Example: New delivery received"
          : "Example: Damaged products"
      }
      rows="4"
      value={stockForm.reason}
      onChange={handleStockFormChange}
      required
    />

  </div>

  {/* ACTION BUTTONS */}
  <div className="form-actions">

    <button
      type="button"
      className="cancel-button"
      onClick={closeStockForm}
    >
      Cancel
    </button>

    <button
      type="submit"
      className={
        stockAction === "add"
          ? "save-stock-button"
          : "confirm-remove-button"
      }
      disabled={updatingStock}
    >
      {updatingStock
        ? "Updating..."
        : stockAction === "add"
        ? "Add Stock"
        : "Remove Stock"}
    </button>

  </div>

</form>

    </div>

  </div>
)}

    </div>
  );
}

export default Inventory;