"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { getSecretaryBoard, type SecretaryBoard } from "@/lib/data/my-followups";
import { SecretaryDayBoard } from "./SecretaryDayBoard";

/** The day board with the administration's picker («مشاهدة الإدارة»: anyone's real day, read-only). */
export function SecretaryBoardSection({ initial }: { initial: SecretaryBoard }) {
  const [board, setBoard] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function open(id: string) {
    setBusy(true);
    try { const b = await getSecretaryBoard(id || undefined); if (b) setBoard(b); }
    catch { /* keep the current board */ } finally { setBusy(false); }
  }

  return <section className="space-y-3">
    <div className="flex flex-wrap items-center gap-3">
      <h2 className="text-lg font-extrabold">خطة اليوم{board.view.readOnly ? ` — ${board.view.name}` : ""}</h2>
      {board.view.readOnly && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">مشاهدة فقط</span>}
      {busy && <Loader2 className="size-4 animate-spin text-[#557d78]" />}
      <span className="flex-1" />
      {board.view.team && board.view.people.length > 0 && <select value={board.view.employeeId} onChange={(e) => void open(e.target.value)} disabled={busy}
        aria-label="سكرتير موظف" className="tv-field rounded-lg border p-2 text-sm">
        {board.view.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>}
    </div>
    <SecretaryDayBoard board={board} />
  </section>;
}
