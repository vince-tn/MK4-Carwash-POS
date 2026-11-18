import { supabase } from "./supabaseClient";
import { localDateString } from "./reportUtils";

/*
 * Signatures on Vale and Cash Advance forms (supabase/27): a PNG drawn on the screen,
 * stored in the private signatures bucket as <yyyy-mm-dd>/<uuid>.png, the
 * only shape the storage rules accept. Only admins and secretaries can open
 * one, through a short-lived signed link.
 */

// Returns the stored path.
export async function uploadSignature(blob) {
  const path = `${localDateString()}/${crypto.randomUUID()}.png`;

  const { error } = await supabase.storage
    .from("signatures")
    .upload(path, blob, { contentType: "image/png", upsert: false });

  if (error) throw error;
  return path;
}

// A short-lived link to a stored signature, or null if it cannot be opened.
export async function signatureUrl(path) {
  const { data, error } = await supabase.storage.from("signatures").createSignedUrl(path, 300);

  if (error) {
    console.error("Could not sign the signature URL", error);
    return null;
  }

  return data.signedUrl;
}
