import { listTripReceipts } from "@/lib/data/payment-receipt";

/**
 * The client's receipts on their /trip link — one «سند قبض» per payment, each
 * behind its own token. Client-facing, so Arabic literals like the rest of the
 * page; it shows only what the client paid, never a cost or a note.
 */
export async function TripReceipts({ token }: { token: string }) {
  const receipts = await listTripReceipts(token);
  if (receipts.length === 0) return null;

  return (
    <section className="tv-card mt-4 rounded-2xl border p-6 shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
      <h2 className="text-[15px] font-extrabold">سندات القبض</h2>
      <ul className="mt-3 space-y-2">
        {receipts.map((r) => (
          <li key={r.token}>
            <a
              href={`/trip/receipt/${r.token}/pdf`}
              target="_blank"
              rel="noopener"
              className="flex items-center justify-between gap-3 rounded-[12px] border border-[#e2ebe7] px-4 py-3.5 transition-colors hover:bg-[#f4f8f6]"
            >
              <span className="min-w-0">
                <span className="block text-[14px] font-extrabold">
                  <bdi dir="ltr">{`${r.amount.toLocaleString("en-US")} ${r.currency}`}</bdi>
                </span>
                <span className="mt-0.5 block text-[11.5px] font-semibold text-tv-text-faint">
                  <bdi dir="ltr">{`${r.receipt_no} · ${r.paid_at}`}</bdi>
                </span>
              </span>
              <span className="shrink-0 rounded-[9px] bg-[#185045] px-3.5 py-2 text-[12.5px] font-bold text-white">فتح السند</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
