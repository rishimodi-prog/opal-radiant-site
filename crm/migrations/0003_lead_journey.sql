-- Lead intent capture: what the visitor was actually looking at before they
-- filled the form. source_page only ever recorded the page the form sat on
-- (almost always /book-appointment), which told the team nothing about intent.
--
-- previous_page    the last non-form page visited, e.g. /services/laser-hair-removal-thane
-- previous_title   that page's <title>, for readability in the dashboard
-- page_journey     up to 8 recent paths, " > " joined, for the fuller story
-- referrer         external referrer for the session (Google, Instagram, etc.)
-- intent_treatment treatment derived from the browsing path, e.g. "Laser Hair Removal"
-- intent_branch    branch derived from the browsing path, e.g. "Thane"

ALTER TABLE leads ADD COLUMN previous_page TEXT;
ALTER TABLE leads ADD COLUMN previous_title TEXT;
ALTER TABLE leads ADD COLUMN page_journey TEXT;
ALTER TABLE leads ADD COLUMN referrer TEXT;
ALTER TABLE leads ADD COLUMN intent_treatment TEXT;
ALTER TABLE leads ADD COLUMN intent_branch TEXT;
