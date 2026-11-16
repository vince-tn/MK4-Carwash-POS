import { useState } from "react";
import { peso } from "../lib/reportUtils";
import {
  detailCommissions,
  detailsProblem,
  detailsToSave,
  equalShares,
  isCustomSplit,
  totalShare,
} from "../lib/packageDetails";

/*
 * Package details for one service on the Services page (supabase/25): the
 * parts of a service like Full Package, each of which the Worker Form asks
 * who did. The rest of the Services page saves as the admin types; these
 * are edited as a draft and saved with a button, so a half-typed set of
 * shares that does not add up to 100% never reaches the Worker Form.
 *
 * The parent keys this on the saved details, so a save starts a fresh draft
 * from what was stored.
 */

function newName(details) {
  const taken = details.map((detail) => detail.name);
  let n = details.length + 1;
  while (taken.includes(`Detail ${n}`)) n += 1;
  return `Detail ${n}`;
}

export default function PackageDetails({ category, onSave }) {
  const saved = category.processes || [];
  const [draft, setDraft] = useState(() => ({
    mode: isCustomSplit(saved) ? "custom" : "equal",
    details: saved.map((detail) => ({ ...detail })),
  }));

  const problem = detailsProblem(draft);
  const toSave = detailsToSave(draft);
  const changed = JSON.stringify(toSave) !== JSON.stringify(detailsToSave({ mode: "custom", details: saved }));
  const amounts = detailCommissions(category, draft);
  const custom = draft.mode === "custom";

  function setDetails(change) {
    setDraft((prev) => ({ ...prev, details: change(prev.details) }));
  }

  function chooseMode(mode) {
    setDraft((prev) => {
      // Starting a custom split from the equal one it replaces.
      if (mode === "custom" && !isCustomSplit(prev.details)) {
        const shares = equalShares(prev.details.length);
        return {
          mode,
          details: prev.details.map((detail, i) => ({ ...detail, sharePercent: shares[i] })),
        };
      }
      return { ...prev, mode };
    });
  }

  function addDetail() {
    setDetails((details) => [
      ...details,
      { id: crypto.randomUUID(), name: newName(details), sharePercent: 0 },
    ]);
  }

  function updateDetail(id, patch) {
    setDetails((details) => details.map((detail) => (detail.id === id ? { ...detail, ...patch } : detail)));
  }

  function removeDetail(id) {
    setDetails((details) => details.filter((detail) => detail.id !== id));
  }

  return (
    <div className="price-item-list package-details">
      <strong>Package Details</strong>
      <small className="field-hint">
        Optional. List what this package is made of (Interior, Exterior,
        Engine...). The Worker Form then asks who did each detail, and each
        worker earns that detail's part of the commission.
      </small>

      {draft.details.length > 0 && (
        <div className="detail-split" role="radiogroup" aria-label="How the commission is split">
          <label className="check-label">
            <input
              type="radio"
              name={`split-${category.id}`}
              checked={!custom}
              onChange={() => chooseMode("equal")}
            />
            Split equally
          </label>
          <label className="check-label">
            <input
              type="radio"
              name={`split-${category.id}`}
              checked={custom}
              onChange={() => chooseMode("custom")}
            />
            Set % per detail
          </label>
        </div>
      )}

      {draft.details.length > 0 && (
        <div className="price-item-row price-item-head">
          <span>Detail</span>
          <span>{custom ? "Share (%)" : "Share"}</span>
          <span />
        </div>
      )}

      {draft.details.map((detail, index) => (
        <div className="price-item-row" key={detail.id}>
          <input
            value={detail.name}
            onChange={(e) => updateDetail(detail.id, { name: e.target.value })}
            placeholder="Example: Interior"
            aria-label={`Detail ${index + 1} name`}
          />

          {custom ? (
            <input
              type="number"
              min="0"
              max="100"
              value={detail.sharePercent}
              onChange={(e) =>
                updateDetail(detail.id, {
                  sharePercent: e.target.value === "" ? "" : Number(e.target.value),
                })
              }
              aria-label={`${detail.name || `Detail ${index + 1}`} share (%)`}
            />
          ) : (
            <input value={`${Math.round((100 / draft.details.length) * 100) / 100}%`} disabled />
          )}

          <button type="button" className="small-danger-btn" onClick={() => removeDetail(detail.id)}>
            Remove
          </button>
        </div>
      ))}

      {custom && draft.details.length > 0 && (
        <p className={problem ? "detail-total danger-text" : "detail-total success-text"}>
          Total: {totalShare(draft.details)}%{problem ? "" : " ✓"}
        </p>
      )}

      {draft.details.length > 0 && amounts.length > 0 && (
        <div className="detail-amounts">
          <span className="field-hint">
            Commission per detail at {Number(category.commissionRate) || 0}% (the shop's default rule)
          </span>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Size</th>
                  <th>Commission</th>
                  {draft.details.map((detail) => (
                    <th key={detail.id}>{detail.name || "—"}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {amounts.map((row) => (
                  <tr key={row.size}>
                    <td>{row.size}</td>
                    <td>{peso.format(row.commission)}</td>
                    {row.details.map((amount, i) => (
                      <td key={draft.details[i].id}>{peso.format(amount)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="detail-actions">
        <button type="button" className="secondary-btn no-margin" onClick={addDetail}>
          + Add Detail
        </button>

        {changed && (
          <button
            type="button"
            className="submit-btn detail-save"
            disabled={Boolean(problem)}
            onClick={() => onSave(toSave)}
          >
            Save Details
          </button>
        )}
      </div>

      {changed && (
        <small className={problem ? "field-hint danger-text" : "field-hint"}>
          {problem || "Not saved yet. The Worker Form keeps the saved details until you save."}
        </small>
      )}
    </div>
  );
}
