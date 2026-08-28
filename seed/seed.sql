-- Dev seed: one agency account, two client shelves, six tools across
-- sections, covering every state the UI has to render.
--
-- Safe to re-run: deletes seeded rows first. Cascades handle the children.

DELETE FROM users WHERE id = 'usr_seed_agency';

INSERT INTO users (id, handle, name, email, plan, created_at) VALUES
  ('usr_seed_agency', 'studio', 'Studio Owner', 'you@studio.co', 'studio', 1756339200000);

INSERT INTO shelves (id, user_id, slug, title, blurb, client_name, accent, visibility, sort_order, created_at, updated_at) VALUES
  ('shl_seed_bakery', 'usr_seed_agency', 'maria-bakery',
   'Maria''s Bakery',
   'Every tool we built for the Elm Street shop. Bookmark this page. It stays current.',
   'Maria''s Bakery', '#9b3d1f', 'unlisted', 0, 1756339200000, 1756339200000),
  ('shl_seed_landscape', 'usr_seed_agency', 'dan-landscaping',
   'Dan''s Landscaping',
   'Crew tools and the back office, in one place.',
   'Dan''s Landscaping', '#3d5a3a', 'private', 1, 1756339200000, 1756339200000);

-- Maria: two sections, plus one private tool that must never appear on the
-- client shelf. That last row is the visibility clamp's test fixture.
INSERT INTO tools (id, shelf_id, title, blurb, live_url, section, tag, visibility, sort_order, version, status, checked_at, confirmed_at, prompt, builder, created_at, updated_at) VALUES
  ('tol_seed_orders', 'shl_seed_bakery', 'Standing order sheet',
   'Cafes text their Friday bread list. We stop guessing.',
   'https://orders.maria.example.com', 'Front of house', 'booking', 'unlisted', 0, 3, 'live',
   1756339200000, 1756339200000,
   'Build a page where wholesale cafes submit their standing bread order for the week. Name, item, quantity, day. One row per cafe, editable until Thursday.',
   'claude', 1756339200000, 1756339200000),

  ('tol_seed_cakes', 'shl_seed_bakery', 'Cake calendar',
   'Custom cakes by date so the fridge is not a surprise.',
   'https://cakes.maria.example.com', 'Front of house', 'booking', 'unlisted', 1, 1, 'live',
   1756339200000, 1756339200000,
   'A month calendar of custom cake orders. Click a day to see what is due, who ordered it and whether the deposit cleared.',
   'claude', 1756339200000, 1756339200000),

  -- confirmed_at is deliberately ~100 days old: renders "Needs confirming".
  ('tol_seed_counter', 'shl_seed_bakery', 'Counter display board',
   'What is in the case today, on the screen behind the till.',
   'https://counter.maria.example.com', 'Front of house', 'internal', 'unlisted', 2, 1, 'live',
   1756339200000, 1747699200000,
   'Full screen board for a TV behind the counter. Todays items and prices, big type, auto refresh every five minutes.',
   'pages', 1756339200000, 1756339200000),

  ('tol_seed_invoices', 'shl_seed_bakery', 'Wholesale invoices',
   'One page for cafe invoices. No QuickBooks tab.',
   'https://invoices.maria.example.com', 'Back office', 'invoicing', 'unlisted', 3, 2, 'live',
   1756339200000, 1756339200000,
   'Generate a monthly invoice per wholesale cafe from the standing order sheet. Printable, one page each.',
   'claude', 1756339200000, 1756339200000),

  -- status down: the live check found it unreachable.
  ('tol_seed_flour', 'shl_seed_bakery', 'Flour run log',
   'Tracks vendor drops so we stop double-ordering rye.',
   'https://flour.maria.example.com', 'Back office', 'inventory', 'unlisted', 4, 3, 'down',
   1756339200000, 1756339200000,
   'Build a single page log of flour deliveries. Vendor, date, bag count, rye or white. One row per drop, newest first. Flag a vendor if two drops land in the same week.',
   'claude', 1756339200000, 1756339200000),

  -- PRIVATE under an unlisted shelf. Must be absent from /s/maria-bakery.
  ('tol_seed_rota', 'shl_seed_bakery', 'Staff rota',
   'Who opens, who closes, printed Sunday night.',
   'https://rota.maria.example.com', 'Back office', 'internal', 'private', 5, 1, 'live',
   1756339200000, 1756339200000,
   'Weekly staff rota. Columns are days, rows are people, printable on one sheet.',
   'pages', 1756339200000, 1756339200000);

-- A tool with no section, to prove the unnamed first group renders.
INSERT INTO tools (id, shelf_id, title, blurb, live_url, section, tag, visibility, sort_order, version, status, created_at, updated_at) VALUES
  ('tol_seed_quotes', 'shl_seed_landscape', 'Quote builder',
   'Square footage in, printable quote out.',
   'https://quotes.dan.example.com', NULL, 'other', 'private', 0, 1, 'live',
   1756339200000, 1756339200000);

-- Version history for the flour log, so the version list has something real.
INSERT INTO snapshots (id, tool_id, version, live_url, prompt, note, created_at) VALUES
  ('snp_seed_flour_1', 'tol_seed_flour', 1, 'https://flour-v1.maria.example.com',
   'Log of flour deliveries. Vendor, date, bag count.', 'Updated link', 1749081600000),
  ('snp_seed_flour_2', 'tol_seed_flour', 2, 'https://flour-v2.maria.example.com',
   'Log of flour deliveries. Vendor, date, bag count, rye or white.', 'Added tax line', 1753488000000);
