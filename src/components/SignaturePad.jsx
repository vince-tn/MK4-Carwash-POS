import { useEffect, useRef } from "react";

/*
 * A box to sign in with a finger, a stylus or the mouse, for Vale and Cash Advance
 * forms (supabase/27). Each finished stroke hands the signature to onChange
 * as a PNG; clearing hands it null. The parent remounts it (a new key) to
 * start a fresh one.
 */
export default function SignaturePad({ onChange, disabled }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const inked = useRef(false);

  // Sized to the box on screen at the device's pixel density, so the line is
  // sharp, on a white background, so it prints as it looks.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(canvas.clientWidth * ratio);
    canvas.height = Math.round(canvas.clientHeight * ratio);

    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.lineWidth = 2.5 * ratio;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#111111";
  }, []);

  function point(event) {
    const canvas = canvasRef.current;
    const box = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - box.left) / box.width) * canvas.width,
      y: ((event.clientY - box.top) / box.height) * canvas.height,
    };
  }

  function start(event) {
    if (disabled) return;
    event.preventDefault();
    canvasRef.current.setPointerCapture(event.pointerId);
    const context = canvasRef.current.getContext("2d");
    const { x, y } = point(event);
    context.beginPath();
    context.moveTo(x, y);
    // A dot for a tap.
    context.lineTo(x + 0.1, y + 0.1);
    context.stroke();
    drawing.current = true;
    inked.current = true;
  }

  function move(event) {
    if (!drawing.current) return;
    event.preventDefault();
    const context = canvasRef.current.getContext("2d");
    const { x, y } = point(event);
    context.lineTo(x, y);
    context.stroke();
  }

  function end() {
    if (!drawing.current) return;
    drawing.current = false;
    canvasRef.current.toBlob((blob) => onChange(inked.current ? blob : null), "image/png");
  }

  function clear() {
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    inked.current = false;
    onChange(null);
  }

  return (
    <div className="signature-pad">
      <canvas
        ref={canvasRef}
        aria-label="Sign here"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onPointerLeave={end}
      />
      <div className="signature-pad-foot">
        <span className="field-hint">Sign inside the box</span>
        <button type="button" className="link-btn" onClick={clear} disabled={disabled}>
          Clear
        </button>
      </div>
    </div>
  );
}
