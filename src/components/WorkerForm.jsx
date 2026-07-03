import { useMemo, useState } from "react";

const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
});

function createBlankService(pricingData) {
  const firstCategory = pricingData[0];
  const firstItem = firstCategory?.items?.[0];

  return {
    id: crypto.randomUUID(),
    category: firstCategory?.category || "",
    size: firstItem?.size || "",
    price: firstItem?.price || 0,
    commissionType: firstCategory?.commissionType || "",
    commissionRate: firstCategory?.commissionRate || 0,
  };
}

function generateSalesOrderId(orders) {
  const today = new Date();
  const datePart = today.toISOString().slice(0, 10).replaceAll("-", "");
  const todayCount =
    orders.filter((order) => order.id?.includes(`SO-${datePart}`)).length + 1;

  return `SO-${datePart}-${String(todayCount).padStart(3, "0")}`;
}

function calculateCommission({ services, worker, commissionSettings }) {
  const workerMode = worker?.commissionMode || "inherit";
  const mode =
    workerMode === "inherit"
      ? commissionSettings.globalMode
      : worker.commissionMode;

  const rawValue =
    workerMode === "inherit"
      ? commissionSettings.globalValue
      : worker.commissionValue;

  const value = Number(rawValue) || 0;

  if (mode === "flat_per_order") {
    return {
      commission: value,
      label: `Flat per order: ${peso.format(value)}`,
    };
  }

  if (mode === "flat_per_service") {
    return {
      commission: services.length * value,
      label: `Flat per service: ${peso.format(value)}`,
    };
  }

  if (mode === "custom_percent") {
    const serviceTotal = services.reduce(
      (sum, service) => sum + Number(service.price || 0),
      0
    );

    return {
      commission: serviceTotal * (value / 100),
      label: `Custom percentage: ${value}%`,
    };
  }

  const servicePercentageCommission = services.reduce((sum, service) => {
    return (
      sum + Number(service.price || 0) * (Number(service.commissionRate || 0) / 100)
    );
  }, 0);

  return {
    commission: servicePercentageCommission,
    label: "Service percentage",
  };
}

export default function WorkerForm({
  onAddOrder,
  orders,
  workers,
  commissionSettings,
  pricingData,
  addOns,
}) {
  const today = new Date().toISOString().split("T")[0];
  const activeWorkers = workers.filter((worker) => worker.status === "Active");

  const [form, setForm] = useState({
    date: today,
    plateNumber: "",
    customerName: "",
    contactNumber: "",
    carType: "Medium",
    workerId: activeWorkers[0]?.id || "",
    manager: "",
    services: [createBlankService(pricingData)],
    selectedAddOns: [],
    paymentEnabled: {
      cash: false,
      gcash: false,
      credit: false,
      discount: false,
    },
    cash: "",
    gcash: "",
    credit: "",
    discount: "",
    referenceNo: "",
    notes: "",
    photoName: "",
  });

  const selectedWorker = workers.find((worker) => worker.id === form.workerId);

  const serviceTotal = useMemo(() => {
    return form.services.reduce(
      (sum, service) => sum + Number(service.price || 0),
      0
    );
  }, [form.services]);

  const addOnTotal = useMemo(() => {
    return form.selectedAddOns.reduce((sum, addOnName) => {
      const addOn = addOns.find((item) => item.name === addOnName);
      return sum + (Number(addOn?.price) || 0);
    }, 0);
  }, [form.selectedAddOns, addOns]);

  const discount = form.paymentEnabled.discount ? Number(form.discount) || 0 : 0;
  const total = Math.max(serviceTotal + addOnTotal - discount, 0);

  const commissionResult = useMemo(() => {
    return calculateCommission({
      services: form.services,
      worker: selectedWorker,
      commissionSettings,
    });
  }, [form.services, selectedWorker, commissionSettings]);

  const commission = commissionResult.commission;

  const totalPaid =
    (form.paymentEnabled.cash ? Number(form.cash) || 0 : 0) +
    (form.paymentEnabled.gcash ? Number(form.gcash) || 0 : 0) +
    (form.paymentEnabled.credit ? Number(form.credit) || 0 : 0);

  const balance = total - totalPaid;

  function updateField(name, value) {
    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  }

  function togglePayment(name) {
    setForm((prev) => ({
      ...prev,
      paymentEnabled: {
        ...prev.paymentEnabled,
        [name]: !prev.paymentEnabled[name],
      },
      [name]: prev.paymentEnabled[name] ? "" : prev[name],
    }));
  }

  function addService() {
    setForm((prev) => ({
      ...prev,
      services: [...prev.services, createBlankService(pricingData)],
    }));
  }

  function removeService(id) {
    setForm((prev) => ({
      ...prev,
      services:
        prev.services.length === 1
          ? prev.services
          : prev.services.filter((service) => service.id !== id),
    }));
  }

  function updateService(id, field, value) {
    setForm((prev) => {
      const updatedServices = prev.services.map((service) => {
        if (service.id !== id) return service;

        if (field === "category") {
          const categoryData = pricingData.find((item) => item.category === value);
          if (!categoryData) return service;

          const firstItem = categoryData.items[0];

          return {
            ...service,
            category: value,
            size: firstItem?.size || "",
            price: firstItem?.price || 0,
            commissionType: categoryData.commissionType,
            commissionRate: categoryData.commissionRate,
          };
        }

        if (field === "size") {
          const categoryData = pricingData.find(
            (item) => item.category === service.category
          );
          const selectedItem = categoryData?.items.find(
            (item) => item.size === value
          );

          return {
            ...service,
            size: value,
            price: selectedItem?.price ?? service.price,
          };
        }

        return {
          ...service,
          [field]: value,
        };
      });

      return {
        ...prev,
        services: updatedServices,
      };
    });
  }

  function toggleAddOn(name) {
    setForm((prev) => {
      const exists = prev.selectedAddOns.includes(name);

      return {
        ...prev,
        selectedAddOns: exists
          ? prev.selectedAddOns.filter((item) => item !== name)
          : [...prev.selectedAddOns, name],
      };
    });
  }

  function resetForm() {
    setForm({
      date: today,
      plateNumber: "",
      customerName: "",
      contactNumber: "",
      carType: "Medium",
      workerId: activeWorkers[0]?.id || "",
      manager: "",
      services: [createBlankService(pricingData)],
      selectedAddOns: [],
      paymentEnabled: {
        cash: false,
        gcash: false,
        credit: false,
        discount: false,
      },
      cash: "",
      gcash: "",
      credit: "",
      discount: "",
      referenceNo: "",
      notes: "",
      photoName: "",
    });
  }

  function handleSubmit(e) {
    e.preventDefault();

    if (!form.plateNumber.trim()) {
      alert("Please enter the plate number.");
      return;
    }

    if (!form.workerId) {
      alert("Please select a worker. Add workers in the Workers admin page.");
      return;
    }

    const order = {
      id: generateSalesOrderId(orders),
      ...form,
      washerName: selectedWorker?.name || "Unknown Worker",
      serviceTotal,
      addOnTotal,
      total,
      totalPaid,
      balance,
      commission,
      commissionLabel: commissionResult.label,
      createdAt: new Date().toISOString(),
    };

    onAddOrder(order);
    resetForm();

    alert("Sales order saved.");
  }

  return (
    <section className="page-grid">
      <form className="form-card mk4-form" onSubmit={handleSubmit}>
        <div className="section-heading">
          <div>
            <span className="eyebrow">Worker POS Form</span>
            <h2>New MK4 Sales Order</h2>
          </div>
          <strong>{peso.format(total)}</strong>
        </div>

        {activeWorkers.length === 0 && (
          <div className="warning-card">
            No active workers found. Go to the Workers page and add at least one
            worker.
          </div>
        )}

        <details open className="form-section">
          <summary>Car and Customer Details</summary>

          <div className="form-grid">
            <label>
              Date
              <input
                type="date"
                value={form.date}
                onChange={(e) => updateField("date", e.target.value)}
              />
            </label>

            <label>
              Sales Order ID
              <input value={generateSalesOrderId(orders)} disabled />
            </label>

            <label>
              Plate Number
              <input
                type="text"
                placeholder="ABC 1234"
                value={form.plateNumber}
                onChange={(e) =>
                  updateField("plateNumber", e.target.value.toUpperCase())
                }
              />
            </label>

            <label>
              Car Type / Size
              <select
                value={form.carType}
                onChange={(e) => updateField("carType", e.target.value)}
              >
                <option>Extra Small</option>
                <option>Small</option>
                <option>Medium</option>
                <option>Large</option>
                <option>XLarge</option>
                <option>XXL</option>
              </select>
            </label>

            <label>
              Customer Name
              <input
                type="text"
                placeholder="Optional"
                value={form.customerName}
                onChange={(e) => updateField("customerName", e.target.value)}
              />
            </label>

            <label>
              Contact Number
              <input
                type="text"
                placeholder="Optional"
                value={form.contactNumber}
                onChange={(e) => updateField("contactNumber", e.target.value)}
              />
            </label>

            <label>
              Worker
              <select
                value={form.workerId}
                onChange={(e) => updateField("workerId", e.target.value)}
              >
                {activeWorkers.map((worker) => (
                  <option key={worker.id} value={worker.id}>
                    {worker.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Manager on Duty
              <input
                type="text"
                placeholder="Manager name"
                value={form.manager}
                onChange={(e) => updateField("manager", e.target.value)}
              />
            </label>
          </div>
        </details>

        <details open className="form-section">
          <summary>Services Availed</summary>

          <div className="service-list">
            {form.services.map((service, index) => {
              const selectedCategory = pricingData.find(
                (item) => item.category === service.category
              );

              return (
                <div className="service-row" key={service.id}>
                  <div className="service-row-header">
                    <strong>Service #{index + 1}</strong>
                    <button
                      type="button"
                      className="small-danger-btn"
                      onClick={() => removeService(service.id)}
                      disabled={form.services.length === 1}
                    >
                      Remove
                    </button>
                  </div>

                  <div className="form-grid">
                    <label>
                      Service Category
                      <select
                        value={service.category}
                        onChange={(e) =>
                          updateService(service.id, "category", e.target.value)
                        }
                      >
                        {!selectedCategory && service.category && (
                          <option>{service.category}</option>
                        )}
                        {pricingData.map((item) => (
                          <option key={item.category}>{item.category}</option>
                        ))}
                      </select>
                    </label>

                    <label>
                      Package / Size
                      <select
                        value={service.size}
                        onChange={(e) =>
                          updateService(service.id, "size", e.target.value)
                        }
                      >
                        {!selectedCategory && service.size && (
                          <option>{service.size}</option>
                        )}
                        {(selectedCategory?.items || []).map((item) => (
                          <option key={item.size}>{item.size}</option>
                        ))}
                      </select>
                    </label>

                    <label>
                      Price
                      <input
                        value={peso.format(Number(service.price) || 0)}
                        disabled
                      />
                    </label>

                    <label>
                      Default Service Commission
                      <input
                        value={`${service.commissionType} - ${service.commissionRate}%`}
                        disabled
                      />
                    </label>
                  </div>
                </div>
              );
            })}
          </div>

          <button type="button" className="secondary-btn" onClick={addService}>
            + Add Another Service
          </button>

          <div className="addon-box">
            <p>Add-ons</p>
            <div className="addon-grid">
              {addOns.map((addOn) => (
                <button
                  type="button"
                  key={addOn.name}
                  className={
                    form.selectedAddOns.includes(addOn.name)
                      ? "addon active"
                      : "addon"
                  }
                  onClick={() => toggleAddOn(addOn.name)}
                >
                  {addOn.name}
                  <span>{peso.format(Number(addOn.price) || 0)}</span>
                </button>
              ))}
            </div>
          </div>
        </details>

        <details open className="form-section">
          <summary>Payment, Reference and Proof</summary>

          <div className="payment-grid">
            <label className="check-label">
              <input
                type="checkbox"
                checked={form.paymentEnabled.cash}
                onChange={() => togglePayment("cash")}
              />
              Cash
            </label>

            <label className="check-label">
              <input
                type="checkbox"
                checked={form.paymentEnabled.gcash}
                onChange={() => togglePayment("gcash")}
              />
              GCash
            </label>

            <label className="check-label">
              <input
                type="checkbox"
                checked={form.paymentEnabled.credit}
                onChange={() => togglePayment("credit")}
              />
              Credit
            </label>

            <label className="check-label">
              <input
                type="checkbox"
                checked={form.paymentEnabled.discount}
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
                disabled={!form.paymentEnabled.cash}
                value={form.cash}
                onChange={(e) => updateField("cash", e.target.value)}
              />
            </label>

            <label>
              GCash Amount
              <input
                type="number"
                disabled={!form.paymentEnabled.gcash}
                value={form.gcash}
                onChange={(e) => updateField("gcash", e.target.value)}
              />
            </label>

            <label>
              Credit Amount
              <input
                type="number"
                disabled={!form.paymentEnabled.credit}
                value={form.credit}
                onChange={(e) => updateField("credit", e.target.value)}
              />
            </label>

            <label>
              Discount Amount
              <input
                type="number"
                disabled={!form.paymentEnabled.discount}
                value={form.discount}
                onChange={(e) => updateField("discount", e.target.value)}
              />
            </label>

            <label>
              Reference Number
              <input
                type="text"
                placeholder="GCash / bank / receipt reference"
                value={form.referenceNo}
                onChange={(e) => updateField("referenceNo", e.target.value)}
              />
            </label>

            <label>
              Photo Proof
              <input
                type="file"
                accept="image/*"
                onChange={(e) =>
                  updateField("photoName", e.target.files?.[0]?.name || "")
                }
              />
            </label>

            <label className="wide-field">
              Notes
              <input
                type="text"
                placeholder="Optional remarks"
                value={form.notes}
                onChange={(e) => updateField("notes", e.target.value)}
              />
            </label>
          </div>
        </details>

        <div className="total-panel">
          <div>
            <span>Services</span>
            <strong>{peso.format(serviceTotal)}</strong>
          </div>
          <div>
            <span>Add-ons</span>
            <strong>{peso.format(addOnTotal)}</strong>
          </div>
          <div>
            <span>Total</span>
            <strong>{peso.format(total)}</strong>
          </div>
          <div>
            <span>Paid</span>
            <strong>{peso.format(totalPaid)}</strong>
          </div>
          <div>
            <span>Balance</span>
            <strong className={balance > 0 ? "danger-text" : "success-text"}>
              {peso.format(balance)}
            </strong>
          </div>
        </div>

        <button className="submit-btn" type="submit">
          Save Sales Order
        </button>
      </form>

      <aside className="receipt-preview">
        <span className="eyebrow">Receipt Preview</span>
        <h3>MK4 Auto Care</h3>

        <div className="receipt-row">
          <span>Sales Order</span>
          <strong>{generateSalesOrderId(orders)}</strong>
        </div>

        <div className="receipt-row">
          <span>Plate</span>
          <strong>{form.plateNumber || "—"}</strong>
        </div>

        <div className="receipt-row">
          <span>Worker</span>
          <strong>{selectedWorker?.name || "—"}</strong>
        </div>

        <div className="receipt-row">
          <span>Services</span>
          <strong>{form.services.length}</strong>
        </div>

        <div className="receipt-service-list">
          {form.services.map((service) => (
            <div key={service.id}>
              <span>
                {service.category} - {service.size}
              </span>
              <strong>{peso.format(Number(service.price) || 0)}</strong>
            </div>
          ))}
        </div>

        <div className="receipt-row">
          <span>Add-ons</span>
          <strong>{peso.format(addOnTotal)}</strong>
        </div>

        <div className="receipt-row">
          <span>Discount</span>
          <strong>{peso.format(discount)}</strong>
        </div>

        <div className="receipt-row">
          <span>Ref No.</span>
          <strong>{form.referenceNo || "—"}</strong>
        </div>

        <div className="receipt-row">
          <span>Commission Rule</span>
          <strong>{commissionResult.label}</strong>
        </div>

        <div className="receipt-total">
          <span>Total</span>
          <strong>{peso.format(total)}</strong>
        </div>

        <p className="small-note">
          The reference number is usually used for payment proof, GCash/bank
          transaction reference, or internal receipt tracking.
        </p>
      </aside>
    </section>
  );
}