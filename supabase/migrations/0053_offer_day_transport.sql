-- The transport line of each programme day, frozen with the offer.
--
-- It is derived from the draft's transport plan (transportNoteForDay), and the
-- client reads a programme day by day — so the PDF prints «استقبال من المطار
-- إلى الفندق — فان» on day one instead of a loose table of vehicles at the end.
-- Text only: no supplier, no price. Null on days with nothing to say.

alter table public.offer_days add column if not exists transport_note text;
