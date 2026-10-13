-- «لوحة الاستقبال» issued from the operations case failed with err.createFailed:
-- operation_documents.kind was checked to the four voucher kinds (0025) while the
-- app (VoucherKind, the /voucher/[token]/pdf route) already issues a fifth.
alter table public.operation_documents drop constraint if exists operation_documents_kind_check;
alter table public.operation_documents
  add constraint operation_documents_kind_check
  check (kind = any (array['hotel_voucher', 'flight_ticket', 'itinerary', 'booking_summary', 'welcome_board']));
