-- Repair: clear the half-written price list
--
-- The first seed ran twice at once (React Strict Mode invokes effects twice in
-- development, and each run generated its own ids), and the old save routine
-- deleted any row that was not in its own list. The two runs deleted each
-- other's rows, leaving 16 service categories with no sizes or prices under
-- them -- which is why "Package / Size" was empty.
--
-- savePricing no longer deletes rows it has not previously seen, and the load
-- now runs once per session, so this cannot recur. This file just clears the
-- wreckage; the app re-seeds the full price list from src/data/pricing.js the
-- next time it loads.
--
-- Run once, then reload the app.

delete from public.service_items;
delete from public.service_categories;
delete from public.add_ons;
