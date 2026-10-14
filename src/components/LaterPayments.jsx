import { useState } from "react";
import { compressProof, openProofPath, uploadProof } from "../lib/proofs";

/*
 * Payments made after the sale, inside the Update Payment window.
 *
 * A customer may pay a sale off in several parts on different days. Each part
 * is recorded here with its method, amount, reference number, an optional
 * proof image and an optional note; the database stamps when it was recorded
 * and by whom (supabase/23). Parts can be added until nothing is owed, and a
 * part entered by mistake can be removed. A removed part stays in the list,
 * struck through with who removed it and when, and stops counting.
 *
 * Each add or remove is saved straight away. It is separate from the "Save
 * Payment Update" button below, which only saves changes to the payment taken
 * at the sale.
 */

const METHODS = [
  { value: "cash", label: "Cash" },
  { value: "gcash", label: "GCash" },
  { value: "bank", label: "Bank" },
  { value: "credit", label: "Credit" },
];

const METHOD_LABEL = Object.fromEntries(METHODS.map((m) => [m.value, m.label]));

const peso = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });

const when = (value) => (value ? new Date(value).toLocaleString() : "");

function blankPayment(owed) {
  return {
    method: "cash",
    amount: owed > 0 ? String(Math.round(owed * 100) / 100) : "",
    reference: "",
    note: "",
  };
}

export default function LaterPayments({ order, onAdd, onRemove }) {
  // What the database holds as still owed: the check it applies to a new
  // payment, whatever is being edited further down in the window.
  const owed = Math.max(Number(order.balance) || 0, 0);
  const payments = order.payments || [];

  const [form, setForm] = useState(() => blankPayment(owed));
  const [proofFile, setProofFile] = useState(null);
  const [proofName, setProofName] = useState("");
  const [proofStatus, setProofStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [fileKey, setFileKey] = useState(0);

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleProof(e) {
    const file = e.target.files?.[0];

    if (!file) {
      setProofFile(null);
      setProofName("");
      setProofStatus("");
      return;
    }

    setProofStatus("Compressing...");

    try {
      const compressed = await compressProof(file);
      setProofFile(compressed);
      setProofName(file.name);
      setProofStatus(`Ready: ${Math.round(compressed.size / 1024)} KB`);
    } catch (error) {
      console.error("Image compression failed", error);
      setProofFile(null);
      setProofName("");
      setProofStatus("Could not process that image. Please try another file.");
    }
  }

  async function handleAdd() {
    const amount = Number(form.amount);

    if (!(amount > 0)) {
      alert("Enter the amount paid.");
      return;
    }

    if (amount > owed + 0.005) {
      alert(`That is more than the ${peso.format(owed)} still owed on this sale.`);
      return;
    }

    setBusy(true);

    try {
      let proofPath = "";

      if (proofFile) {
        setProofStatus("Uploading proof...");

        try {
          proofPath = await uploadProof(proofFile);
        } catch (error) {
          console.error("Proof upload failed", error);

          // As on the Worker Form: a failed image must not stop the payment
          // being recorded. The person entering it decides.
          const saveAnyway = confirm(
            `Could not upload the proof image: ${error.message}\n\nRecord the payment anyway, without the image?`
          );

          if (!saveAnyway) {
            setProofStatus("");
            return;
          }
        }
      }

      await onAdd(order.id, {
        method: form.method,
        amount,
        reference: form.reference,
        note: form.note,
        proofPath,
        proofName: proofPath ? proofName : "",
      });

      setForm(blankPayment(Math.max(owed - amount, 0)));
      setProofFile(null);
      setProofName("");
      setProofStatus("");
      setFileKey((key) => key + 1);
    } catch (error) {
      console.error("Could not add the payment", error);
      alert(`Could not add the payment: ${error.message}`);
      setProofStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(payment) {
    const confirmed = confirm(
      `Remove the ${peso.format(payment.amount)} ${
        METHOD_LABEL[payment.method] || payment.method
      } payment recorded ${when(payment.paidAt)}?\n\nIt stays in the list as removed, and stops counting towards what was paid.`
    );

    if (!confirmed) return;

    setBusy(true);

    try {
      await onRemove(order.id, payment.id);
    } catch (error) {
      console.error("Could not remove the payment", error);
      alert(`Could not remove the payment: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    // Enter in these fields would otherwise submit the window's form below,
    // saving and closing it.
    <section
      className="later-payments"
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target.tagName === "INPUT") e.preventDefault();
      }}
    >
      <div className="later-payments-head">
        <h3>Payments after the sale</h3>
        <span className={owed > 0 ? "danger-text" : "success-text"}>
          {owed > 0 ? `Still owed: ${peso.format(owed)}` : "Fully paid"}
        </span>
      </div>

      {payments.length === 0 ? (
        <p className="field-hint">
          {owed > 0
            ? "None yet. Record each part a customer pays after the sale here."
            : "None."}
        </p>
      ) : (
        <ul className="later-payment-list">
          {payments.map((payment) => (
            <li
              key={payment.id}
              className={payment.removedAt ? "is-removed" : undefined}
            >
              <div className="later-payment-main">
                <strong>{peso.format(payment.amount)}</strong>{" "}
                {METHOD_LABEL[payment.method] || payment.method}
                {payment.reference ? ` · Ref ${payment.reference}` : ""}
              </div>

              <div className="later-payment-meta">
                {when(payment.paidAt)}
                {payment.recordedBy ? ` by ${payment.recordedBy}` : ""}
                {payment.note ? ` · ${payment.note}` : ""}
                {payment.removedAt
                  ? ` · Removed ${when(payment.removedAt)}${
                      payment.removedBy ? ` by ${payment.removedBy}` : ""
                    }`
                  : ""}
              </div>

              <div className="later-payment-actions">
                {payment.proofPath && (
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => openProofPath(payment.proofPath)}
                  >
                    View proof
                  </button>
                )}

                {!payment.removedAt && (
                  <button
                    type="button"
                    className="small-danger-btn"
                    disabled={busy}
                    onClick={() => handleRemove(payment)}
                  >
                    Remove
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {order.archivedAt ? (
        <p className="field-hint">
          This sale is archived. Put it back before adding a payment.
        </p>
      ) : owed > 0 ? (
        <div className="form-grid later-payment-form">
          <label>
            Paid With
            <select
              value={form.method}
              onChange={(e) => update("method", e.target.value)}
            >
              {METHODS.map((method) => (
                <option key={method.value} value={method.value}>
                  {method.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            Amount
            <input
              type="number"
              min="0"
              step="0.01"
              max={owed}
              value={form.amount}
              onChange={(e) => update("amount", e.target.value)}
            />
          </label>

          <label>
            Reference Number
            <input
              type="text"
              placeholder="Optional"
              value={form.reference}
              onChange={(e) => update("reference", e.target.value)}
            />
          </label>

          <label>
            Proof Image
            <input
              key={fileKey}
              type="file"
              accept="image/*"
              onChange={handleProof}
            />
            {proofStatus && <span className="field-hint">{proofStatus}</span>}
          </label>

          <label className="wide-field">
            Note
            <input
              type="text"
              placeholder="Optional"
              value={form.note}
              onChange={(e) => update("note", e.target.value)}
            />
          </label>

          <button
            type="button"
            className="secondary-btn no-margin wide-field"
            disabled={busy}
            onClick={handleAdd}
          >
            {busy ? "Saving..." : "Add Payment"}
          </button>
        </div>
      ) : (
        <p className="field-hint">Nothing more is owed on this sale.</p>
      )}
    </section>
  );
}
