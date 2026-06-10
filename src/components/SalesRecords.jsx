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

  if (sortBy === "highest_commission") {
    return sorted.sort(
      (a, b) => Number(b.commission || 0) - Number(a.commission || 0)
    );
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

export default function SalesRecords({ orders, workers, onClearOrders }) {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("newest");

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
              <option value="highest_commission">Highest commission</option>
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
              <th>Add-ons</th>
              <th>Payment</th>
              <th>Ref No.</th>
              <th>Total</th>
              <th>Balance</th>
              <th>Commission</th>
              <th>Proof</th>
            </tr>
          </thead>

          <tbody>
            {filteredAndSortedOrders.length === 0 ? (
              <tr>
                <td colSpan="12" className="empty">
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
                    {order.selectedAddOns?.length > 0
                      ? order.selectedAddOns.join(", ")
                      : "—"}
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
                      <>Discount: {peso.format(Number(order.discount) || 0)}</>
                    )}
                  </td>

                  <td>{order.referenceNo || "—"}</td>

                  <td>{peso.format(order.total)}</td>

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
                    {peso.format(order.commission)}
                    <br />
                    <small>{order.commissionLabel}</small>
                  </td>

                  <td>{order.photoName || "No file"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}