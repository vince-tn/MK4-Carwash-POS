import { useMemo, useState } from "react";
import { addOnLineFor, assignmentsFor, creditSale, partsWithNobody } from "../lib/commission";
import { DoneBy, QtyStepper, WorkerPick } from "./WhoDidIt";

/*
 * Services and add-ons, inside a sale's Edit window in Sales Records.
 *
 * Lists what the sale has, and lets an admin or secretary add more after the
 * sale was recorded (client request, 2026-10-27): the same choices as the
 * Worker Form, priced from the price list, with Labor's amount and
 * description. Each addition is saved straight away and in one step
 * (supabase/24): the sale's totals and commission go up by exactly what was
 * added, and Paid and Balance follow. Nothing is removed from a sale here.
 *
 * Each added line says who did it, the sale's own worker unless another is
 * chosen (supabase/25), and earns them commission under their rule as it is
 * now (lib/commission creditSale). A flat per-order amount is paid once per
 * worker per sale: never again to the sale's own worker, and to a helper
 * only if they had not earned it on this sale already.
 */

const peso = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });

const when = (value) => (value ? new Date(value).toLocaleString() : "");

// A new service row, starting on the first price-list entry, as on the
// Worker Form.
function blankService(pricingData) {
  const firstCategory = pricingData[0];
  const firstItem = firstCategory?.items?.[0];

  return {
    id: crypto.randomUUID(),
    category: firstCategory?.category || "",
    size: firstItem?.size || "",
    price: firstItem?.price || 0,
    commissionType: firstCategory?.commissionType || "",
    commissionRate: firstCategory?.commissionRate || 0,
    doneBy: [""],
    steps: {},
  };
}

function addedNote(line) {
  return line.addedBy ? `Added ${when(line.addedAt)} by ${line.addedBy}` : "";
}

export default function AddToSale({
  order,
  workers = [],
  // Every active worker, for choosing who did what (supabase/25).
  helpers = [],
  pricingData = [],
  addOns = [],
  commissionSettings,
  onAdd,
}) {
  const [services, setServices] = useState([]);
  const [selectedAddOns, setSelectedAddOns] = useState([]);
  // Per chosen add-on: how many, and who did it ("" = the sale's worker).
  const [addOnChoices, setAddOnChoices] = useState({});
  const [laborDetails, setLaborDetails] = useState("");
  const [laborAmount, setLaborAmount] = useState("");
  const [busy, setBusy] = useState(false);

  // The sale's worker gets whatever nobody else is chosen for. One who has
  // since been deleted earns nothing on it: choose who did it instead.
  const leadId = order.workerId || "";
  const workersById = useMemo(
    () => new Map([...workers, ...helpers].map((item) => [item.id, item])),
    [workers, helpers]
  );
  const leadName = workersById.get(leadId)?.name || order.washerName || "";

  // Workers who already earned a flat per-order amount on this sale, and
  // the sale's own worker, who earned theirs with it.
  const alreadyFlat = useMemo(
    () => [
      leadId,
      ...(order.credits || [])
        .filter((credit) => credit.kind === "sale" && credit.workerId)
        .map((credit) => credit.workerId),
    ],
    [leadId, order.credits]
  );

  const laborAddOn = selectedAddOns
    .map((name) => addOns.find((item) => item.name === name))
    .find((addOn) => addOn?.workerSetsPrice);

  const addOnLines = useMemo(
    () =>
      selectedAddOns.map((name) =>
        addOnLineFor(
          addOns.find((item) => item.name === name) || { name },
          { ...addOnChoices[name], laborAmount, laborDetails },
          leadId
        )
      ),
    [selectedAddOns, addOnChoices, laborAmount, laborDetails, addOns, leadId]
  );

  const added = useMemo(
    () =>
      creditSale({
        services: services.map((service) => ({
          ...service,
          assignments: assignmentsFor(
            service,
            pricingData.find((item) => item.category === service.category),
            leadId
          ),
        })),
        addOnLines,
        workersById,
        commissionSettings: commissionSettings || {},
        alreadyFlat,
      }),
    [services, addOnLines, workersById, commissionSettings, alreadyFlat, pricingData, leadId]
  );

  const addedAmount =
    services.reduce((sum, service) => sum + (Number(service.price) || 0), 0) +
    addOnLines.reduce((sum, line) => sum + line.price, 0);

  const discount = order.paymentEnabled?.discount ? Number(order.discount) || 0 : 0;
  const totalNow = Number(order.total) || 0;
  const totalAfter = Math.max(
    (Number(order.serviceTotal) || 0) + (Number(order.addOnTotal) || 0) + addedAmount - discount,
    0
  );
  const hasChoices = services.length > 0 || selectedAddOns.length > 0;

  function addServiceRow() {
    setServices((prev) => [...prev, blankService(pricingData)]);
  }

  function removeServiceRow(id) {
    setServices((prev) => prev.filter((service) => service.id !== id));
  }

  // The same choices as the Worker Form: a category starts on its first
  // size, and a size takes its price from the list.
  function updateService(id, field, value) {
    setServices((prev) =>
      prev.map((service) => {
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
            steps: {},
          };
        }

        const categoryData = pricingData.find((item) => item.category === service.category);
        const selectedItem = categoryData?.items.find((item) => item.size === value);

        return { ...service, size: value, price: selectedItem?.price ?? service.price };
      })
    );
  }

  function updateServiceWorkers(id, patch) {
    setServices((prev) =>
      prev.map((service) => (service.id === id ? { ...service, ...patch } : service))
    );
  }

  function updateAddOnChoice(name, patch) {
    setAddOnChoices((prev) => ({ ...prev, [name]: { ...prev[name], ...patch } }));
  }

  function toggleAddOn(name) {
    const addOn = addOns.find((item) => item.name === name);

    if (selectedAddOns.includes(name)) {
      setSelectedAddOns((prev) => prev.filter((item) => item !== name));
      setAddOnChoices((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
      if (addOn?.workerSetsPrice) {
        setLaborDetails("");
        setLaborAmount("");
      }
      return;
    }

    setSelectedAddOns((prev) => [...prev, name]);
    if (addOn?.workerSetsPrice) setLaborAmount(String(Number(addOn.price) || 0));
  }

  function reset() {
    setServices([]);
    setSelectedAddOns([]);
    setAddOnChoices({});
    setLaborDetails("");
    setLaborAmount("");
  }

  async function handleAdd() {
    if (!hasChoices) {
      alert("Choose a service or an add-on to add.");
      return;
    }

    const nobody = partsWithNobody({ services, pricingData, leadId, addOnLines });
    if (nobody.length) {
      alert(`Choose who did ${nobody.join(", ")}.`);
      return;
    }

    if (laborAddOn && !laborDetails.trim()) {
      alert(`Please describe the labor done for ${laborAddOn.name}.`);
      return;
    }

    if (laborAddOn && String(laborAmount).trim() === "") {
      alert(`Please enter the amount for ${laborAddOn.name}.`);
      return;
    }

    const names = [
      ...services.map((service) => `${service.category} - ${service.size} (${peso.format(service.price)})`),
      ...addOnLines.map(
        (line) =>
          `${line.qty > 1 ? `${line.qty} x ` : ""}${line.name}${line.details ? `: ${line.details}` : ""} (${peso.format(line.price)})`
      ),
    ];

    const confirmed = confirm(
      `Add to ${order.id}?\n\n${names.join("\n")}\n\nThe total goes from ${peso.format(totalNow)} to ${peso.format(
        totalAfter
      )}, and the commission goes up by ${peso.format(added.commission)}.`
    );

    if (!confirmed) return;

    setBusy(true);

    try {
      await onAdd(order.id, {
        services: added.services,
        addOnLines: added.addOnLines,
        saleCredits: added.saleCredits,
      });
      reset();
    } catch (error) {
      console.error("Could not add to the sale", error);
      alert(`Could not add to the sale: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  const lines = [
    ...(order.services || []).map((service) => ({
      key: `service-${service.id}`,
      label: `${service.category} - ${service.size}`,
      price: service.price,
      note: addedNote(service),
    })),
    ...(order.addOnLines || []).map((line, index) => ({
      key: `addon-${line.id || index}`,
      label: `${line.qty > 1 ? `${line.qty} x ` : ""}${line.details ? `${line.name}: ${line.details}` : line.name} (add-on)`,
      price: line.price,
      note: addedNote(line),
    })),
  ];

  return (
    // Enter in these fields would otherwise submit the window's form below,
    // saving and closing it.
    <section
      className="later-payments sale-lines"
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target.tagName === "INPUT") e.preventDefault();
      }}
    >
      <div className="later-payments-head">
        <h3>Services and add-ons</h3>
        <span>{peso.format((Number(order.serviceTotal) || 0) + (Number(order.addOnTotal) || 0))}</span>
      </div>

      {lines.length === 0 ? (
        <p className="field-hint">No services recorded on this sale.</p>
      ) : (
        <ul className="later-payment-list">
          {lines.map((line) => (
            <li key={line.key}>
              <div className="later-payment-main">{line.label}</div>
              {line.note && <div className="later-payment-meta">{line.note}</div>}
              <div className="later-payment-actions">
                <strong>{line.price === null ? "—" : peso.format(Number(line.price) || 0)}</strong>
              </div>
            </li>
          ))}
        </ul>
      )}

      {order.archivedAt ? (
        <p className="field-hint">This sale is archived. Put it back before adding to it.</p>
      ) : (
        <>
          {services.length > 0 && (
            <div className="service-list">
              {services.map((service, index) => {
                const selectedCategory = pricingData.find(
                  (item) => item.category === service.category
                );

                return (
                  <div className="service-row" key={service.id}>
                    <div className="service-row-header">
                      <strong>New service #{index + 1}</strong>
                      <button
                        type="button"
                        className="small-danger-btn"
                        onClick={() => removeServiceRow(service.id)}
                      >
                        Remove
                      </button>
                    </div>

                    <div className="form-grid later-payment-form">
                      <label>
                        Service Category
                        <select
                          value={service.category}
                          onChange={(e) => updateService(service.id, "category", e.target.value)}
                        >
                          {pricingData.map((item) => (
                            <option key={item.category}>{item.category}</option>
                          ))}
                        </select>
                      </label>

                      <label>
                        Package / Size
                        <select
                          value={service.size}
                          onChange={(e) => updateService(service.id, "size", e.target.value)}
                        >
                          {(selectedCategory?.items || []).map((item) => (
                            <option key={item.size}>{item.size}</option>
                          ))}
                        </select>
                      </label>

                      <label>
                        Price
                        <input value={peso.format(Number(service.price) || 0)} disabled />
                      </label>

                      <label>
                        Commission
                        <input value={peso.format(added.services[index]?.commission || 0)} disabled />
                      </label>
                    </div>

                    <DoneBy
                      service={service}
                      processes={selectedCategory?.processes || []}
                      helpers={helpers}
                      leadId={leadId}
                      leadName={leadName}
                      onChange={(patch) => updateServiceWorkers(service.id, patch)}
                      disabled={busy}
                    />
                  </div>
                );
              })}
            </div>
          )}

          <button
            type="button"
            className="secondary-btn no-margin"
            onClick={addServiceRow}
            disabled={busy || pricingData.length === 0}
          >
            + Add Service
          </button>

          {addOns.length > 0 && (
            <div className="addon-box">
              <p>Add-ons</p>
              <div className="addon-grid">
                {addOns.map((addOn) => {
                  const isSelected = selectedAddOns.includes(addOn.name);
                  const shownPrice =
                    isSelected && addOn.workerSetsPrice
                      ? Number(laborAmount) || 0
                      : Number(addOn.price) || 0;

                  return (
                    <button
                      type="button"
                      key={addOn.name}
                      className={isSelected ? "addon active" : "addon"}
                      onClick={() => toggleAddOn(addOn.name)}
                      disabled={busy}
                    >
                      {addOn.name}
                      <span>{peso.format(shownPrice)}</span>
                    </button>
                  );
                })}
              </div>

              {addOnLines.length > 0 && (
                <ul className="addon-lines">
                  {addOnLines.map((line) => {
                    const addOn = addOns.find((item) => item.name === line.name);

                    return (
                      <li key={line.name}>
                        <strong>{line.name}</strong>
                        {addOn?.workerSetsPrice ? (
                          <span className="field-hint">Once</span>
                        ) : (
                          <QtyStepper
                            value={line.qty}
                            onChange={(qty) => updateAddOnChoice(line.name, { qty })}
                            disabled={busy}
                            label={`How many ${line.name}`}
                          />
                        )}
                        <WorkerPick
                          value={addOnChoices[line.name]?.workerId}
                          onChange={(workerId) => updateAddOnChoice(line.name, { workerId })}
                          helpers={helpers}
                          leadId={leadId}
                          leadName={leadName}
                          disabled={busy}
                          label={`${line.name} done by`}
                        />
                        <span className="addon-line-amount">{peso.format(line.price)}</span>
                      </li>
                    );
                  })}
                </ul>
              )}

              {laborAddOn && (
                <div className="form-grid labor-fields later-payment-form">
                  <label className="wide-field">
                    Labor Done
                    <input
                      type="text"
                      placeholder="Describe the labor done"
                      value={laborDetails}
                      onChange={(e) => setLaborDetails(e.target.value)}
                    />
                  </label>

                  <label>
                    Labor Amount
                    <input
                      type="number"
                      min="0"
                      value={laborAmount}
                      onChange={(e) => setLaborAmount(e.target.value)}
                    />
                  </label>
                </div>
              )}
            </div>
          )}

          {hasChoices && (
            <div className="sale-lines-preview">
              <span>
                Adding <strong>{peso.format(addedAmount)}</strong>: the total goes from{" "}
                {peso.format(totalNow)} to <strong>{peso.format(totalAfter)}</strong>, commission +
                {peso.format(added.commission)}.
              </span>

              <button
                type="button"
                className="secondary-btn no-margin"
                disabled={busy}
                onClick={handleAdd}
              >
                {busy ? "Saving..." : "Add to This Sale"}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
