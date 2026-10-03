import { useMemo, useState } from "react";
import imageCompression from "browser-image-compression";
import { supabase } from "../lib/supabaseClient";
import { localDateString } from "../lib/reportUtils";

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

// Each line is rounded to the centavo, so the breakdown in Sales Records adds
// up exactly to the total.
function centavos(amount) {
  return Math.round(amount * 100) / 100;
}

/*
 * The worker's rule (their own, or the global one) decides the commission on
 * services. Add-ons are separate: each earns its own percentage of its price,
 * on top of the service commission, whatever the worker's rule.
 *
 * serviceCommissions lines up with services. Under "flat per order" every
 * service line is 0 and the flat amount belongs to the order as a whole.
 */
function calculateCommission({ services, addOnLines, worker, commissionSettings }) {
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

  let perService;
  let perOrder = 0;
  let label;

  if (mode === "flat_per_order") {
    perService = () => 0;
    perOrder = value;
    label = `Flat per order: ${peso.format(value)}`;
  } else if (mode === "flat_per_service") {
    perService = () => value;
    label = `Flat per service: ${peso.format(value)}`;
  } else if (mode === "custom_percent") {
    perService = (service) => Number(service.price || 0) * (value / 100);
    label = `Custom percentage: ${value}%`;
  } else {
    perService = (service) =>
      Number(service.price || 0) * (Number(service.commissionRate || 0) / 100);
    label = "Service percentage";
  }

  const serviceCommissions = services.map((service) =>
    centavos(perService(service))
  );

  const addOnCommission = addOnLines.reduce(
    (sum, line) => sum + line.commission,
    0
  );

  const commission = centavos(
    serviceCommissions.reduce((sum, amount) => sum + amount, 0) +
      perOrder +
      addOnCommission
  );

  return {
    commission,
    label: addOnCommission > 0 ? `${label} + add-ons` : label,
    serviceCommissions,
  };
}

export default function WorkerForm({
  onAddOrder,
  workers,
  commissionSettings,
  pricingData,
  addOns,
}) {
  const today = localDateString();
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
    laborDetails: "",
    laborAmount: "",
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
    gcashRef: "",
    creditRef: "",
    notes: "",
    photoName: "",
    photoPath: "",
  });

  const [proofFile, setProofFile] = useState(null);
  const [proofStatus, setProofStatus] = useState("");

  const selectedWorker = workers.find((worker) => worker.id === form.workerId);

  // Payment proofs are phone photos or screenshots, typically 2-5 MB raw.
  // They are re-encoded as JPEG of at most 50 KB, about six times smaller
  // than the old 300 KB, so the 1 GB storage quota lasts six times longer.
  // Tested on a bank-style screenshot: the reference number, amount, date and
  // even 28 px fine print stay legible. Everything becomes JPEG because a PNG
  // screenshot can only get under a size cap by shrinking until the text
  // blurs.
  async function handleProofSelect(e) {
    const file = e.target.files?.[0];

    if (!file) {
      setProofFile(null);
      setProofStatus("");
      updateField("photoName", "");
      return;
    }

    setProofStatus("Compressing...");

    try {
      const compressed = await imageCompression(file, {
        maxSizeMB: 0.05,
        maxWidthOrHeight: 1280,
        fileType: "image/jpeg",
        initialQuality: 0.75,
        useWebWorker: true,
      });

      setProofFile(compressed);
      updateField("photoName", file.name);
      setProofStatus(
        `Ready: ${Math.round(compressed.size / 1024)} KB (from ${Math.round(
          file.size / 1024
        )} KB)`
      );
    } catch (error) {
      console.error("Image compression failed", error);
      setProofFile(null);
      setProofStatus("Could not process that image. Please try another file.");
    }
  }

  const serviceTotal = useMemo(() => {
    return form.services.reduce(
      (sum, service) => sum + Number(service.price || 0),
      0
    );
  }, [form.services]);

  // The chosen worker-priced add-on (Labor Only), if any. While it is chosen
  // it is the only add-on: the others are cleared and locked.
  const laborAddOn = form.selectedAddOns
    .map((name) => addOns.find((item) => item.name === name))
    .find((addOn) => addOn?.workerSetsPrice);

  // Each chosen add-on as it will be charged: Labor Only at the worker's
  // amount, everything else at the price list's.
  const addOnLines = useMemo(() => {
    return form.selectedAddOns.map((name) => {
      const addOn = addOns.find((item) => item.name === name);
      const isLabor = Boolean(addOn?.workerSetsPrice);
      const price = isLabor
        ? Number(form.laborAmount) || 0
        : Number(addOn?.price) || 0;
      const commissionRate = Number(addOn?.commissionRate) || 0;

      return {
        name,
        price,
        commissionRate,
        commission: centavos(price * (commissionRate / 100)),
        details: isLabor ? form.laborDetails.trim() : "",
      };
    });
  }, [form.selectedAddOns, form.laborAmount, form.laborDetails, addOns]);

  const addOnTotal = addOnLines.reduce((sum, line) => sum + line.price, 0);

  const discount = form.paymentEnabled.discount ? Number(form.discount) || 0 : 0;
  const total = Math.max(serviceTotal + addOnTotal - discount, 0);

  const commissionResult = useMemo(() => {
    return calculateCommission({
      services: form.services,
      addOnLines,
      worker: selectedWorker,
      commissionSettings,
    });
  }, [form.services, addOnLines, selectedWorker, commissionSettings]);

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
    setForm((prev) => {
      const turningOff = prev.paymentEnabled[name];

      const next = {
        ...prev,
        paymentEnabled: {
          ...prev.paymentEnabled,
          [name]: !prev.paymentEnabled[name],
        },
        [name]: turningOff ? "" : prev[name],
      };

      // A reference number is meaningless once its method is unchecked.
      if (turningOff && name === "gcash") next.gcashRef = "";
      if (turningOff && name === "credit") next.creditRef = "";

      return next;
    });
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
    const addOn = addOns.find((item) => item.name === name);

    setForm((prev) => {
      const exists = prev.selectedAddOns.includes(name);

      if (exists) {
        return {
          ...prev,
          selectedAddOns: prev.selectedAddOns.filter((item) => item !== name),
          ...(addOn?.workerSetsPrice ? { laborDetails: "", laborAmount: "" } : {}),
        };
      }

      // Labor Only stands alone: choosing it clears the other add-ons, and
      // its amount starts at the admin's default for the worker to change.
      if (addOn?.workerSetsPrice) {
        return {
          ...prev,
          selectedAddOns: [name],
          laborAmount: String(Number(addOn.price) || 0),
        };
      }

      return { ...prev, selectedAddOns: [...prev.selectedAddOns, name] };
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
      laborDetails: "",
      laborAmount: "",
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
      gcashRef: "",
      creditRef: "",
      notes: "",
      photoName: "",
      photoPath: "",
    });

    setProofFile(null);
    setProofStatus("");
  }

  async function handleSubmit(e) {
    e.preventDefault();

    if (!form.plateNumber.trim()) {
      alert("Please enter the plate number.");
      return;
    }

    if (!form.workerId) {
      alert("Please select a worker. Add workers on the Employees page.");
      return;
    }

    if (laborAddOn && !form.laborDetails.trim()) {
      alert(`Please describe the labor done for ${laborAddOn.name}.`);
      return;
    }

    if (laborAddOn && String(form.laborAmount).trim() === "") {
      alert(`Please enter the amount for ${laborAddOn.name}.`);
      return;
    }

    let photoPath = "";

    if (proofFile) {
      setProofStatus("Uploading proof...");

      const objectPath = `${form.date}/${crypto.randomUUID()}.jpg`;

      const { error: uploadError } = await supabase.storage
        .from("payment-proofs")
        .upload(objectPath, proofFile, {
          contentType: proofFile.type,
          upsert: false,
        });

      if (uploadError) {
        console.error("Proof upload failed", uploadError);
        setProofStatus("");

        // A failed image upload must not stop the till taking money, so the
        // sale can still be recorded without its proof. The cashier decides.
        const saveAnyway = confirm(
          `Could not upload the payment proof: ${uploadError.message}\n\nSave the sales order anyway, without the proof image?`
        );

        if (!saveAnyway) return;
      } else {
        // Only a path that was actually stored; otherwise the record links
        // to an image that does not exist.
        photoPath = objectPath;
      }

      setProofStatus("");
    }

    // No id here: the database assigns the sales order number on save.
    const order = {
      ...form,
      // Each line's commission is stored, for the breakdown in Sales Records.
      services: form.services.map((service, index) => ({
        ...service,
        commission: commissionResult.serviceCommissions[index],
      })),
      addOnLines,
      photoPath,
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

    // The order now goes to the shared database, so it can fail. Only clear
    // the form once it is actually stored.
    let saved;

    try {
      saved = await onAddOrder(order);
    } catch (error) {
      console.error("Could not save the sales order", error);
      alert(`Could not save the sales order: ${error.message}`);
      return;
    }

    resetForm();

    alert(`Sales order ${saved.id} saved.`);
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
            No active workers found. Go to the Employees page and add at least
            one worker.
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
              <input value="Assigned when saved" disabled />
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
              Staff on Duty
              <input
                type="text"
                placeholder="Staff name"
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
              {addOns.map((addOn) => {
                const isSelected = form.selectedAddOns.includes(addOn.name);
                const shownPrice =
                  isSelected && addOn.workerSetsPrice
                    ? Number(form.laborAmount) || 0
                    : Number(addOn.price) || 0;

                return (
                  <button
                    type="button"
                    key={addOn.name}
                    className={isSelected ? "addon active" : "addon"}
                    onClick={() => toggleAddOn(addOn.name)}
                    disabled={Boolean(laborAddOn) && !isSelected}
                    title={
                      laborAddOn && !isSelected
                        ? `Unavailable while ${laborAddOn.name} is selected`
                        : undefined
                    }
                  >
                    {addOn.name}
                    <span>{peso.format(shownPrice)}</span>
                  </button>
                );
              })}
            </div>

            {laborAddOn && (
              <div className="form-grid labor-fields">
                <label className="wide-field">
                  Labor Done
                  <input
                    type="text"
                    placeholder="Describe the labor done"
                    value={form.laborDetails}
                    onChange={(e) => updateField("laborDetails", e.target.value)}
                  />
                </label>

                <label>
                  Labor Amount
                  <input
                    type="number"
                    min="0"
                    value={form.laborAmount}
                    onChange={(e) => updateField("laborAmount", e.target.value)}
                  />
                  <small className="field-hint">
                    Default {peso.format(Number(laborAddOn.price) || 0)}.
                    Commission {Number(laborAddOn.commissionRate) || 0}%:{" "}
                    {peso.format(
                      addOnLines.find((line) => line.name === laborAddOn.name)
                        ?.commission || 0
                    )}
                  </small>
                </label>
              </div>
            )}
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

            {form.paymentEnabled.gcash && (
              <label>
                GCash Reference Number
                <input
                  type="text"
                  placeholder="GCash reference"
                  value={form.gcashRef}
                  onChange={(e) => updateField("gcashRef", e.target.value)}
                />
              </label>
            )}

            {form.paymentEnabled.credit && (
              <label>
                Credit Reference Number
                <input
                  type="text"
                  placeholder="Bank / credit reference"
                  value={form.creditRef}
                  onChange={(e) => updateField("creditRef", e.target.value)}
                />
              </label>
            )}

            <label>
              Photo Proof
              <input type="file" accept="image/*" onChange={handleProofSelect} />
              {proofStatus && (
                <small className="field-hint">{proofStatus}</small>
              )}
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
          <strong>Assigned when saved</strong>
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
          <strong>
              {[form.gcashRef, form.creditRef].filter(Boolean).join(" / ") ||
                "—"}
            </strong>
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