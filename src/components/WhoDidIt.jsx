/*
 * Who did each part of a car (client revision, 2026-11-13; supabase/25), on
 * the Worker Form and when adding to a recorded sale.
 *
 * "" always stands for the car's own worker, so choosing a different worker
 * at the top moves everything still left on them. The commission maths is in
 * lib/commission (assignmentsFor, creditSale).
 */

function leadLabel(leadName) {
  return leadName ? `${leadName} (the car's worker)` : "The car's worker";
}

// A worker picker whose first choice is the car's own worker.
export function WorkerPick({ value, onChange, helpers, leadId, leadName, disabled, label }) {
  return (
    <select
      value={value || ""}
      onChange={(e) => onChange(e.target.value === leadId ? "" : e.target.value)}
      disabled={disabled}
      aria-label={label}
    >
      <option value="">{leadLabel(leadName)}</option>
      {helpers
        .filter((worker) => worker.id !== leadId)
        .map((worker) => (
          <option key={worker.id} value={worker.id}>
            {worker.name}
          </option>
        ))}
    </select>
  );
}

/*
 * For one service: a picker per step when the service has steps, otherwise
 * the workers who did it (they split it equally) and a way to add one.
 */
export function DoneBy({ service, processes = [], helpers, leadId, leadName, onChange, disabled }) {
  const nameOf = (workerId) =>
    workerId
      ? helpers.find((worker) => worker.id === workerId)?.name || "Former worker"
      : leadName || "The car's worker";

  if (processes.length) {
    const totalShare = processes.reduce((sum, process) => sum + (Number(process.sharePercent) || 0), 0);
    const steps = service.steps || {};

    return (
      <div className="done-by">
        <span className="done-by-title">Done by</span>
        <div className="done-by-steps">
          {processes.map((process) => {
            const share =
              totalShare > 0
                ? Math.round(((Number(process.sharePercent) || 0) / totalShare) * 1000) / 10
                : Math.round((100 / processes.length) * 10) / 10;

            return (
              <label key={process.id}>
                <span>
                  {process.name} <small>{share}%</small>
                </span>
                <WorkerPick
                  value={steps[process.id]}
                  onChange={(workerId) => onChange({ steps: { ...steps, [process.id]: workerId } })}
                  helpers={helpers}
                  leadId={leadId}
                  leadName={leadName}
                  disabled={disabled}
                  label={`${process.name} done by`}
                />
              </label>
            );
          })}
        </div>
      </div>
    );
  }

  const doneBy = service.doneBy?.length ? service.doneBy : [""];
  const resolved = doneBy.map((workerId) => workerId || leadId);
  const others = helpers.filter((worker) => !resolved.includes(worker.id));

  return (
    <div className="done-by">
      <span className="done-by-title">
        Done by{doneBy.length > 1 ? `, split equally ${doneBy.length} ways` : ""}
      </span>
      <div className="done-by-chips">
        {doneBy.map((workerId) => (
          <span className="done-by-chip" key={workerId || "lead"}>
            {nameOf(workerId)}
            <button
              type="button"
              aria-label={`Remove ${nameOf(workerId)}`}
              disabled={disabled || doneBy.length === 1}
              onClick={() => onChange({ doneBy: doneBy.filter((id) => id !== workerId) })}
            >
              ×
            </button>
          </span>
        ))}

        {others.length > 0 && (
          <select
            className="done-by-add"
            value=""
            disabled={disabled}
            aria-label="Add a worker to this service"
            onChange={(e) => {
              if (!e.target.value) return;
              const id = e.target.value === leadId ? "" : e.target.value;
              onChange({ doneBy: [...doneBy, id] });
            }}
          >
            <option value="">+ Add a worker</option>
            {others.map((worker) => (
              <option key={worker.id} value={worker.id}>
                {worker.name}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}

// − 2 + for an add-on had more than once.
export function QtyStepper({ value, onChange, disabled, label }) {
  const qty = Number(value) || 1;

  return (
    <span className="qty-stepper" role="group" aria-label={label}>
      <button type="button" onClick={() => onChange(qty - 1)} disabled={disabled || qty <= 1} aria-label="One fewer">
        −
      </button>
      <strong aria-live="polite">{qty}</strong>
      <button type="button" onClick={() => onChange(qty + 1)} disabled={disabled || qty >= 99} aria-label="One more">
        +
      </button>
    </span>
  );
}
