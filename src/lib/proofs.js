import { supabase } from "./supabaseClient";
import { localDateString } from "./reportUtils";

/*
 * Proof images for payments made after the sale (Sales Records). The same
 * treatment as the Worker Form's: re-encoded as a JPEG of at most 50 KB,
 * which keeps a reference number and amount legible, stored in the
 * payment-proofs bucket as <yyyy-mm-dd>/<uuid>.jpg, the only shape the
 * storage rules accept.
 */
export async function compressProof(file) {
  // Downloaded only when a proof is attached.
  const { default: imageCompression } = await import("browser-image-compression");

  return imageCompression(file, {
    maxSizeMB: 0.05,
    maxWidthOrHeight: 1280,
    fileType: "image/jpeg",
    initialQuality: 0.75,
    useWebWorker: true,
  });
}

// Returns the stored path.
export async function uploadProof(compressed) {
  const path = `${localDateString()}/${crypto.randomUUID()}.jpg`;

  const { error } = await supabase.storage
    .from("payment-proofs")
    .upload(path, compressed, { contentType: "image/jpeg", upsert: false });

  if (error) throw error;
  return path;
}

// Opens a stored proof in a new tab through a short-lived signed link.
export async function openProofPath(path) {
  const { data, error } = await supabase.storage
    .from("payment-proofs")
    .createSignedUrl(path, 60);

  if (error) {
    console.error("Could not sign proof URL", error);
    alert(`Could not open the proof image: ${error.message}`);
    return;
  }

  window.open(data.signedUrl, "_blank", "noopener");
}
