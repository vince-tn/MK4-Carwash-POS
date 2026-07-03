import { useMemo, useState } from "react";

const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
});

function csvSafe(value) {
  const stringValue = String(value ?? "");
  return `"${stringValue.replaceAll('"', '""')}"`;
}

function getPaymentMethods(order) {
  const methods = [];

  if (order.paymentEnabled?.cash) methods.push("cash");
  if (order.paymentEnabled?.gcash) methods.push("gcash");
  if (order.paymentEnabled?.credit) methods.push("credit");
  if (order.paymentEnabled?.discount) methods.push("discount");

  return methods;
}

function sortOrders(orders, sortBy) {
  const sorted = [...orders];

  if (sortBy === "newest") {
    return sorted.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  if (sortBy === "oldest") {
    return sorted.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  }

  if (sortBy === "highest_total") {
    return sorted.sort((a, b) => Number(b.total || 0) - Number(a.total || 0));
  }

  if (sortBy === "lowest_total") {
    return sorted.sort((a, b) => Number(a.total || 0) - Number(b.total || 0));
  }

  if (sortBy === "plate_az") {
    return sorted.sort((a, b) =>
      String(a.plateNumber).localeCompare(String(b.plateNumber))
    );
  }

  if (sortBy === "worker_az") {
    return sorted.sort((a, b) =>
      String(a.washerName).localeCompare(String(b.washerName))
    );
  }

  return sorted;
}

function PaymentEditModal({ order, onClose, onSave }) {
  const [paymentForm, setPaymentForm] = useState({
    paymentEnabled: {
      cash: Boolean(order.paymentEnabled?.cash),
      gcash: Boolean(order.paymentEnabled?.gcash),
      credit: Boolean(order.paymentEnabled?.credit),
      discount: Boolean(order.paymentEnabled?.discount),
    },
    cash: order.cash || "",
    gcash: order.gcash || "",
    credit: order.credit || "",
    discount: order.discount || "",
    referenceNo: order.referenceNo || "",
    paymentNotes: order.paymentNotes || "",
  });

  const discount = paymentForm.paymentEnabled.discount
    ? Number(paymentForm.discount) || 0
    : 0;

  const updatedTotal = Math.max(
    Number(order.serviceTotal || 0) + Number(order.addOnTotal || 0) - discount,
    0
  );

  const updatedPaid =
    (paymentForm.paymentEnabled.cash ? Number(paymentForm.cash) || 0 : 0) +
    (paymentForm.paymentEnabled.gcash ? Number(paymentForm.gcash) || 0 : 0) +
    (paymentForm.paymentEnabled.credit ? Number(paymentForm.credit) || 0 : 0);

  const updatedBalance = updatedTotal - updatedPaid;

  function updateField(field, value) {
    setPaymentForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  }

  function togglePayment(method) {
    setPaymentForm((prev) => ({
      ...prev,
      paymentEnabled: {
        ...prev.paymentEnabled,
        [method]: !prev.paymentEnabled[method],
      },
      [method]: prev.paymentEnabled[method] ? "" : prev[method],
    }));
  }

  function handleSubmit(e) {
    e.preventDefault();

    onSave(order.id, paymentForm);
    onClose();
  }

  return (
    <div className="modal-backdrop">
      <form className="payment-modal" onSubmit={handleSubmit}>
        <div className="modal-header">
          <div>
            <span className="eyebrow">Update Payment</span>
            <h2>{order.id}</h2>
            <p>
              Plate: <strong>{order.plateNumber}</strong>
            </p>
          </div>

          <button type="button" className="ghost-btn" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="payment-summary-grid">
          <div>
            <span>Original Service/Add-on Total</span>
            <strong>
              {peso.format(
                Number(order.serviceTotal || 0) + Number(order.addOnTotal || 0)
              )}
            </strong>
          </div>

          <div>
            <span>Updated Total</span>
            <strong>{peso.format(updatedTotal)}</strong>
          </div>

          <div>
            <span>Updated Paid</span>
            <strong>{peso.format(updatedPaid)}</strong>
          </div>

          <div>
            <span>Updated Balance</span>
            <strong
              className={updatedBalance > 0 ? "danger-text" : "success-text"}
            >
              {peso.format(updatedBalance)}
            </strong>
          </div>
        </div>

        <div className="payment-grid modal-payment-grid">
          <label className="check-label">
            <input
              type="checkbox"
              checked={paymentForm.paymentEnabled.cash}
              onChange={() => togglePayment("cash")}
            />
            Cash
          </label>

          <label className="check-label">
            <input
              type="checkbox"
              checked={paymentForm.paymentEnabled.gcash}
              onChange={() => togglePayment("gcash")}
            />
            GCash
          </label>

          <label className="check-label">
            <input
              type="checkbox"
              checked={paymentForm.paymentEnabled.credit}
              onChange={() => togglePayment("credit")}
            />
            Credit
          </label>

          <label className="check-label">
            <input
              type="checkbox"
              checked={paymentForm.paymentEnabled.discount}
              onChange={() => togglePayment("discount")}
            />
            Discount
          </label>
        </div>

        <div className="form-grid">
          <label>
            Cash Amount
            <input
              type="number"
              disabled={!paymentForm.paymentEnabled.cash}
              value={paymentForm.cash}
              onChange={(e) => updateField("cash", e.target.value)}
            />
          </label>

          <label>
            GCash Amount
            <input
              type="number"
              disabled={!paymentForm.paymentEnabled.gcash}
              value={paymentForm.gcash}
              onChange={(e) => updateField("gcash", e.target.value)}
            />
          </label>

          <label>
            Credit Amount
            <input
              type="number"
              disabled={!paymentForm.paymentEnabled.credit}
              value={paymentForm.credit}
              onChange={(e) => updateField("credit", e.target.value)}
            />
          </label>

          <label>
            Discount Amount
            <input
              type="number"
              disabled={!paymentForm.paymentEnabled.discount}
              value={paymentForm.discount}
              onChange={(e) => updateField("discount", e.target.value)}
            />
          </label>

          <label>
            Reference Number
            <input
              type="text"
              value={paymentForm.referenceNo}
              onChange={(e) => updateField("referenceNo", e.target.value)}
              placeholder="GCash / receipt / bank reference"
            />
          </label>

          <label className="wide-field">
            Payment Notes
            <input
              type="text"
              value={paymentForm.paymentNotes}
              onChange={(e) => updateField("paymentNotes", e.target.value)}
              placeholder="Example: Customer paid remaining balance today"
            />
          </label>
        </div>

        <button className="submit-btn" type="submit">
          Save Payment Update
        </button>
      </form>
    </div>
  );
}

export default function SalesRecords({
  orders,
  workers,
  onClearOrders,
  onUpdateOrderPayment,
}) {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("newest");
  const [editingPaymentOrder, setEditingPaymentOrder] = useState(null);

  const [filters, setFilters] = useState({
    dateFrom: "",
    dateTo: "",
    workerIds: [],
    paymentMethods: [],
    balanceStatus: "all",
  });

  function toggleWorker(workerId) {
    setFilters((prev) => {
      const exists = prev.workerIds.includes(workerId);

      return {
        ...prev,
        workerIds: exists
          ? prev.workerIds.filter((id) => id !== workerId)
          : [...prev.workerIds, workerId],
      };
    });
  }

  function togglePaymentMethod(method) {
    setFilters((prev) => {
      const exists = prev.paymentMethods.includes(method);

      return {
        ...prev,
        paymentMethods: exists
          ? prev.paymentMethods.filter((item) => item !== method)
          : [...prev.paymentMethods, method],
      };
    });
  }

  function updateFilter(field, value) {
    setFilters((prev) => ({
      ...prev,
      [field]: value,
    }));
  }

  function clearFilters() {
    setSearch("");
    setSortBy("newest");
    setFilters({
      dateFrom: "",
      dateTo: "",
      workerIds: [],
      paymentMethods: [],
      balanceStatus: "all",
    });
  }

  const filteredAndSortedOrders = useMemo(() => {
    const query = search.toLowerCase();

    const filtered = orders.filter((order) => {
      const servicesText =
        order.services
          ?.map((service) => `${service.category} ${service.size}`)
          .join(" ")
          .toLowerCase() || "";

      const matchesSearch =
        order.id?.toLowerCase().includes(query) ||
        order.plateNumber?.toLowerCase().includes(query) ||
        order.washerName?.toLowerCase().includes(query) ||
        order.date?.toLowerCase().includes(query) ||
        order.referenceNo?.toLowerCase().includes(query) ||
        servicesText.includes(query);

      const matchesDateFrom =
        !filters.dateFrom || order.date >= filters.dateFrom;

      const matchesDateTo = !filters.dateTo || order.date <= filters.dateTo;

      const matchesWorker =
        filters.workerIds.length === 0 ||
        filters.workerIds.includes(order.workerId);

      const orderPaymentMethods = getPaymentMethods(order);

      const matchesPayment =
        filters.paymentMethods.length === 0 ||
        filters.paymentMethods.some((method) =>
          orderPaymentMethods.includes(method)
        );

      const matchesBalance =
        filters.balanceStatus === "all" ||
        (filters.balanceStatus === "paid" && Number(order.balance || 0) <= 0) ||
        (filters.balanceStatus === "unpaid" && Number(order.balance || 0) > 0);

      return (
        matchesSearch &&
        matchesDateFrom &&
        matchesDateTo &&
        matchesWorker &&
        matchesPayment &&
        matchesBalance
      );
    });

    return sortOrders(filtered, sortBy);
  }, [orders, search, filters, sortBy]);

  function exportCSV() {
    if (filteredAndSortedOrders.length === 0) {
      alert("No filtered data to export.");
      return;
    }

    const headers = [
      "Sales Order ID",
      "Date",
      "Plate Number",
      "Customer Name",
      "Contact Number",
      "Car Type",
      "Worker",
      "Manager",
      "Services",
      "Add-ons",
      "Service Total",
      "Add-on Total",
      "Cash",
      "GCash",
      "Credit",
      "Discount",
      "Total",
      "Paid",
      "Balance",
      "Commission",
      "Commission Rule",
      "Reference Number",
      "Payment Notes",
      "Payment Updated At",
      "Photo Proof",
      "Notes",
      "Created At",
    ];

    const rows = filteredAndSortedOrders.map((order) => {
      const services = order.services
        ?.map(
          (service) =>
            `${service.category} - ${service.size} - ${service.price}`
        )
        .join(" | ");

      return [
        order.id,
        order.date,
        order.plateNumber,
        order.customerName,
        order.contactNumber,
        order.carType,
        order.washerName,
        order.manager,
        services,
        order.selectedAddOns?.join(" | "),
        order.serviceTotal,
        order.addOnTotal,
        order.paymentEnabled?.cash ? order.cash : "",
        order.paymentEnabled?.gcash ? order.gcash : "",
        order.paymentEnabled?.credit ? order.credit : "",
        order.paymentEnabled?.discount ? order.discount : "",
        order.total,
        order.totalPaid,
        order.balance,
        order.commission,
        order.commissionLabel,
        order.referenceNo,
        order.paymentNotes,
        order.paymentUpdatedAt,
        order.photoName,
        order.notes,
        order.createdAt,
      ];
    });

    const csvContent = [
      headers.map(csvSafe).join(","),
      ...rows.map((row) => row.map(csvSafe).join(",")),
    ].join("\n");

    const blob = new Blob([csvContent], {
      type: "text/csv;charset=utf-8;",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const date = new Date().toISOString().split("T")[0];

    link.href = url;
    link.download = `mk4-auto-care-filtered-sales-${date}.csv`;
    link.click();

    URL.revokeObjectURL(url);
  }

  return (
    <section className="records-page">
      <div className="dashboard-header">
        <div>
          <span className="eyebrow">Sales Records</span>
          <h2>Searchable Order History</h2>
        </div>

        <div className="action-row">
          <button className="secondary-btn no-margin" onClick={exportCSV}>
            Export Filtered CSV
          </button>

          <button className="danger-btn" onClick={onClearOrders}>
            Clear Demo Data
          </button>
        </div>
      </div>

      <div className="filter-card">
        <div className="filter-top">
          <label>
            Search
            <input
              type="search"
              placeholder="Search order ID, plate, worker, service, ref no..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>

          <label>
            Sort By
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="highest_total">Highest total</option>
              <option value="lowest_total">Lowest total</option>
              <option value="plate_az">Plate A-Z</option>
              <option value="worker_az">Worker A-Z</option>
            </select>
          </label>

          <label>
            Date From
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(e) => updateFilter("dateFrom", e.target.value)}
            />
          </label>

          <label>
            Date To
            <input
              type="date"
              value={filters.dateTo}
              onChange={(e) => updateFilter("dateTo", e.target.value)}
            />
          </label>

          <label>
            Balance
            <select
              value={filters.balanceStatus}
              onChange={(e) => updateFilter("balanceStatus", e.target.value)}
            >
              <option value="all">All</option>
              <option value="paid">Paid / No Balance</option>
              <option value="unpaid">With Balance</option>
            </select>
          </label>
        </div>

        <div className="filter-groups">
          <div>
            <strong>Worker Filter</strong>
            <div className="filter-checks">
              {workers.map((worker) => (
                <label className="check-label compact-check" key={worker.id}>
                  <input
                    type="checkbox"
                    checked={filters.workerIds.includes(worker.id)}
                    onChange={() => toggleWorker(worker.id)}
                  />
                  {worker.name}
                </label>
              ))}
            </div>
          </div>

          <div>
            <strong>Payment Filter</strong>
            <div className="filter-checks">
              {["cash", "gcash", "credit", "discount"].map((method) => (
                <label className="check-label compact-check" key={method}>
                  <input
                    type="checkbox"
                    checked={filters.paymentMethods.includes(method)}
                    onChange={() => togglePaymentMethod(method)}
                  />
                  {method.toUpperCase()}
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="filter-footer">
          <span>
            Showing <strong>{filteredAndSortedOrders.length}</strong> of{" "}
            <strong>{orders.length}</strong> records
          </span>

          <button className="ghost-btn" onClick={clearFilters}>
            Clear Filters
          </button>
        </div>
      </div>

      <div className="table-wrap records-table">
        <table>
          <thead>
            <tr>
              <th>Order ID</th>
              <th>Date</th>
              <th>Plate</th>
              <th>Worker</th>
              <th>Services</th>
              <th>Payment</th>
              <th>Ref No.</th>
              <th>Total</th>
              <th>Paid</th>
              <th>Balance</th>
              <th>Actions</th>
            </tr>
          </thead>

          <tbody>
            {filteredAndSortedOrders.length === 0 ? (
              <tr>
                <td colSpan="11" className="empty">
                  No records found.
                </td>
              </tr>
            ) : (
              filteredAndSortedOrders.map((order) => (
                <tr key={order.id}>
                  <td>
                    <strong>{order.id}</strong>
                  </td>

                  <td>{order.date}</td>

                  <td>
                    <strong>{order.plateNumber}</strong>
                  </td>

                  <td>{order.washerName}</td>

                  <td>
                    {order.services?.map((service) => (
                      <div key={service.id} className="mini-service">
                        {service.category} - {service.size}
                        <br />
                        <strong>{peso.format(service.price)}</strong>
                      </div>
                    ))}
                  </td>

                  <td>
                    {order.paymentEnabled?.cash && (
                      <>
                        Cash: {peso.format(Number(order.cash) || 0)}
                        <br />
                      </>
                    )}
                    {order.paymentEnabled?.gcash && (
                      <>
                        GCash: {peso.format(Number(order.gcash) || 0)}
                        <br />
                      </>
                    )}
                    {order.paymentEnabled?.credit && (
                      <>
                        Credit: {peso.format(Number(order.credit) || 0)}
                        <br />
                      </>
                    )}
                    {order.paymentEnabled?.discount && (
                      <>
                        Discount: {peso.format(Number(order.discount) || 0)}
                        <br />
                      </>
                    )}
                    {order.paymentUpdatedAt && (
                      <small>
                        Updated:{" "}
                        {new Date(order.paymentUpdatedAt).toLocaleString()}
                      </small>
                    )}
                  </td>

                  <td>{order.referenceNo || "—"}</td>

                  <td>{peso.format(order.total)}</td>

                  <td>{peso.format(order.totalPaid)}</td>

                  <td
                    className={
                      Number(order.balance || 0) > 0
                        ? "danger-text"
                        : "success-text"
                    }
                  >
                    {peso.format(order.balance)}
                  </td>

                  <td>
                    <button
                      className="table-action-btn"
                      onClick={() => setEditingPaymentOrder(order)}
                    >
                      🖍
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {editingPaymentOrder && (
        <PaymentEditModal
          order={editingPaymentOrder}
          onClose={() => setEditingPaymentOrder(null)}
          onSave={onUpdateOrderPayment}
        />
      )}
    </section>
  );
}