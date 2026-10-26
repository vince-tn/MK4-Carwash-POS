// A tab at the top of every screen of a build that is not connected to the
// live shop's database (the staging site, or a local copy pointed at
// staging), so test sales are never mistaken for real ones, nor the other way
// round. The live site never shows it.
const LIVE_PROJECT = "vsxwwgglvckbjxvifxuw";

export const IS_STAGING = !String(import.meta.env.VITE_SUPABASE_URL || "").includes(LIVE_PROJECT);

export default function StagingBadge() {
  if (!IS_STAGING) return null;

  return (
    <div className="staging-badge" role="note">
      Staging: test data, not the live shop
    </div>
  );
}
