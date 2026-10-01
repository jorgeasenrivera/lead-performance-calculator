-- Applied 2026-09-12. Row security governs select, insert, update and delete;
-- it does not govern truncate, references or trigger. The default grants hand
-- all three to the API roles on every table, so the anon key in every copy of
-- the app could empty a table it cannot read a row of. Nothing in the app
-- uses them.
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke truncate, references, trigger on tables from anon, authenticated;
