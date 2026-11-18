import { useCallback, useEffect, useMemo, useState } from "react";
import * as db from "../lib/db";
import { localDateString, peso } from "../lib/reportUtils";
import { signatureUrl, uploadSignature } from "../lib/signatures";
import SignaturePad from "./SignaturePad";

/*
 * The Vale form and the Cash Advance form (client revision, 2026-11-13;
 * kept apart at the client's request, 2026-11-18; supabase/27, 29).
 *
 * Two forms laid out the same: the date, whose it is, the amount, a reason
 * and a signature, as on paper. Each has its own tab, and each tab lists only
 * its own forms. A worker files for themself (on the shared worker login,
 * choosing their name), dated today or up to 7 days back. Admins and
 * secretaries file for any active worker, and approve or reject; approved
 * ones come off that week's payslip (Payslips). A worker on a login of their
 * own sees their own forms; the shared worker login sees none, as everyone
 * uses it.
 */

const FORMS = [
  { kind: "vale", label: "Vale" },
  { kind: "cash_advance", label: "Cash Advance" },
];

const KIND_LABEL = Object.fromEntries(FORMS.map((form) => [form.kind, form.label]));
const STATUS_LABEL = { pending: "Pending", approved: "Approved", rejected: "Rejected" };
const FILTERS = ["pending", "approved", "rejected", "all"];

const when = (value) => (value ? new Date(value).toLocaleString() : "");

function blankForm(workers) {
  return {
    workerId: workers.length === 1 ? workers[0].id : "",
    requestDate: localDateString(),
    amount: "",
    reason: "",
  };
}

function Signature({ path }) {
  const [url, setUrl] = useState(null);
  const [state, setState] = useState("idle");

  async function show() {
    setState("loading");
    const signed = await signatureUrl(path);
    setUrl(signed);
    setState(signed ? "shown" : "failed");
  }

  if (state === "shown") return <img className="signature-image" src={url} alt="Signature" />;

  return (
    <button type="button" className="link-btn" onClick={show} disabled={state === "loading"}>
      {state === "failed" ? "Could not open. Try again" : state === "loading" ? "Opening..." : "View signature"}
    </button>
  );
}

function ReviewActions({ request, onReview, busy }) {
  const [note, setNote] = useState(request.reviewNote);

  return (
    <div className="request-review">
      <input
        type="text"
        placeholder="Note (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        aria-label={`Note on ${request.workerName}'s ${KIND_LABEL[request.kind]}`}
        disabled={busy}
      />
      {request.status !== "approved" && (
        <button type="button" className="secondary-btn no-margin" onClick={() => onReview(request, "approved", note)} disabled={busy}>
          Approve
        </button>
      )}
      {request.status !== "rejected" && (
        <button type="button" className="small-danger-btn" onClick={() => onReview(request, "rejected", note)} disabled={busy}>
          Reject
        </button>
      )}
      {request.status !== "pending" && (
        <button type="button" className="ghost-btn" onClick={() => onReview(request, "pending", "")} disabled={busy}>
          Back to pending
        </button>
      )}
    </div>
  );
}

export default function Requests({ workers = [], canReview = false, ownLogin = false }) {
  const [kind, setKind] = useState("vale");
  const [form, setForm] = useState(() => blankForm(workers));
  const [signature, setSignature] = useState(null);
  const [padKey, setPadKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [requests, setRequests] = useState([]);
  const [listState, setListState] = useState(canReview || ownLogin ? "loading" : "none");
  const [filter, setFilter] = useState("pending");
  const [reviewing, setReviewing] = useState(null);

  const label = KIND_LABEL[kind];
  const today = localDateString();
  const earliest = useMemo(() => {
    const date = new Date(`${today}T00:00:00`);
    date.setDate(date.getDate() - 7);
    return localDateString(date);
  }, [today]);

  const load = useCallback(async () => {
    if (!canReview && !ownLogin) return;

    try {
      setRequests(canReview ? await db.fetchRequests() : await db.fetchMyRequests());
      setListState("ready");
    } catch (error) {
      console.error("Could not load the forms", error);
      setListState("error");
    }
  }, [canReview, ownLogin]);

  useEffect(() => {
    // Loads once on opening; the list then changes only through this page.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // Another form starts clean: nothing typed or signed for one is filed as
  // the other.
  function chooseForm(next) {
    if (next === kind) return;
    setKind(next);
    setForm(blankForm(workers));
    setSignature(null);
    setPadKey((key) => key + 1);
    setMessage(null);
  }

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setMessage(null);

    if (!form.workerId) return setMessage({ error: true, text: "Choose whose form this is." });
    if (!(Number(form.amount) > 0)) return setMessage({ error: true, text: "Enter an amount above zero." });
    if (!form.requestDate) return setMessage({ error: true, text: "Choose the date." });
    if (!signature) return setMessage({ error: true, text: "Sign inside the box." });

    setBusy(true);

    try {
      const signaturePath = await uploadSignature(signature);
      const saved = await db.fileRequest({ ...form, kind, signaturePath });

      setForm(blankForm(workers));
      setSignature(null);
      setPadKey((key) => key + 1);
      setMessage({
        error: false,
        text: `${label} of ${peso.format(Number(form.amount))} for ${saved.worker_name} filed. ${
          canReview ? "Approve it below." : "The office will approve or reject it."
        }`,
      });
      await load();
    } catch (error) {
      console.error("Could not file the form", error);
      setMessage({ error: true, text: `Could not file the form: ${error.message}` });
    } finally {
      setBusy(false);
    }
  }

  async function review(request, status, note) {
    setReviewing(request.id);

    try {
      await db.reviewRequest(request.id, status, note);
      await load();
    } catch (error) {
      console.error("Could not update the form", error);
      alert(`Could not update the form: ${error.message}`);
    } finally {
      setReviewing(null);
    }
  }

  const ofThisKind = requests.filter((request) => request.kind === kind);
  const shown = ofThisKind.filter((request) => filter === "all" || request.status === filter);
  const pendingOf = (k) => requests.filter((request) => request.kind === k && request.status === "pending");
  const pending = pendingOf(kind);
  const pendingTotal = pending.reduce((sum, request) => sum + request.amount, 0);

  return (
    <section className="dashboard requests-page">
      <div className="toggle-group form-tabs" role="tablist" aria-label="Forms">
        {FORMS.map((option) => (
          <button
            key={option.kind}
            type="button"
            role="tab"
            aria-selected={kind === option.kind}
            className={kind === option.kind ? "active" : ""}
            onClick={() => chooseForm(option.kind)}
          >
            {option.label} Form
            {canReview && pendingOf(option.kind).length ? ` (${pendingOf(option.kind).length})` : ""}
          </button>
        ))}
      </div>

      <form className="form-card" onSubmit={submit} aria-label={`${label} form`}>
        <div className="section-heading">
          <div>
            <span className="eyebrow">{label} Form</span>
            <h2>File a {label}</h2>
          </div>
        </div>

        <div className="form-grid">
          <label>
            Date
            <input
              type="date"
              value={form.requestDate}
              max={today}
              min={canReview ? undefined : earliest}
              onChange={(e) => update("requestDate", e.target.value)}
              disabled={busy}
            />
          </label>

          <label>
            Name
            <select value={form.workerId} onChange={(e) => update("workerId", e.target.value)} disabled={busy}>
              {workers.length !== 1 && (
                <option value="" disabled>
                  {canReview ? "Select the worker" : "Select your name"}
                </option>
              )}
              {workers.map((worker) => (
                <option key={worker.id} value={worker.id}>
                  {worker.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Amount (₱)
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={form.amount}
              onChange={(e) => update("amount", e.target.value)}
              disabled={busy}
            />
          </label>

          <label>
            Reason (optional)
            <input type="text" value={form.reason} onChange={(e) => update("reason", e.target.value)} disabled={busy} />
          </label>

          <div className="wide-field">
            <span className="field-label">Signature</span>
            <SignaturePad key={padKey} onChange={setSignature} disabled={busy} />
          </div>
        </div>

        {message && (
          <p className={message.error ? "form-message danger-text" : "form-message success-text"} role="status">
            {message.text}
          </p>
        )}

        <button type="submit" className="submit-btn" disabled={busy}>
          {busy ? "Filing..." : `File ${label}`}
        </button>
      </form>

      {listState !== "none" && (
        <div className="chart-card">
          <div className="report-controls">
            <h3>{canReview ? `${label} forms` : `My ${label} forms`}</h3>
            {canReview && (
              <div className="toggle-group">
                {FILTERS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={filter === value ? "active" : ""}
                    onClick={() => setFilter(value)}
                  >
                    {value === "all" ? "All" : STATUS_LABEL[value]}
                    {value === "pending" && pending.length ? ` (${pending.length})` : ""}
                  </button>
                ))}
              </div>
            )}
          </div>

          {canReview && pending.length > 0 && (
            <p className="report-hint">
              {pending.length} waiting for approval, {peso.format(pendingTotal)} in all.
            </p>
          )}

          {listState === "loading" && <p className="empty">Loading forms...</p>}
          {listState === "error" && <p className="empty danger-text">Could not load the forms. Reload to try again.</p>}
          {listState === "ready" && shown.length === 0 && <p className="empty">No {label} forms here.</p>}

          {listState === "ready" && shown.length > 0 && (
            <ul className="request-list">
              {shown.map((request) => (
                <li key={request.id} className={`request-item is-${request.status}`}>
                  <div className="request-main">
                    <strong>
                      {KIND_LABEL[request.kind]} • {peso.format(request.amount)}
                    </strong>
                    <span className={`request-status is-${request.status}`}>{STATUS_LABEL[request.status]}</span>
                  </div>

                  <div className="request-meta">
                    {request.requestDate}
                    {canReview && ` • ${request.workerName}`}
                    {request.reason && ` • ${request.reason}`}
                  </div>

                  <div className="request-meta">
                    {canReview && request.filedBy && `Filed by ${request.filedBy}, ${when(request.filedAt)}`}
                    {request.reviewedBy &&
                      ` • ${STATUS_LABEL[request.status]} by ${request.reviewedBy}, ${when(request.reviewedAt)}`}
                    {request.reviewNote && ` • "${request.reviewNote}"`}
                  </div>

                  {canReview && (
                    <>
                      <Signature path={request.signaturePath} />
                      <ReviewActions request={request} onReview={review} busy={reviewing === request.id} />
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
