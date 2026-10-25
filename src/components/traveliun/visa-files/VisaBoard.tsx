"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getVisaBoard } from "@/lib/data/visa-files";
import { useRole } from "@/lib/roles/RoleContext";
import type { VisaActionResult, VisaBoard as Board } from "@/lib/visa-files/types";
import { defaultBoardFilter, friendlyError, isVisaManager, settle, toVisaFilter, type BoardFilterState } from "@/lib/visa-files/ui";
import { VisaBoardView, type BoardPhase } from "./VisaBoardView";

const countriesOf = (board: Board) => board.rows.map((r) => r.country).filter(Boolean);
const merge = (seen: string[], more: string[]) => [...new Set([...seen, ...more])].sort((a, b) => a.localeCompare(b, "ar"));

/**
 * /visa-files: holds the filter, asks the server for the board when it changes (the search after a short pause) and
 * every minute, and keeps the last good board on screen when a refresh fails. Nothing is filtered here — the
 * server answers for this employee (a visas.work holder gets his own files and the unassigned; the management, all).
 */
export function VisaBoard({ initial }: { initial: VisaActionResult<{ board: Board }> }) {
  const { can } = useRole();
  const manager = isVisaManager(can);
  const [filter, setFilter] = useState<BoardFilterState>(defaultBoardFilter);
  const [phase, setPhase] = useState<BoardPhase>(() => (initial.ok ? { kind: "ready", board: initial.board } : { kind: "error", message: friendlyError(initial.error) }));
  const [countries, setCountries] = useState(() => (initial.ok ? merge([], countriesOf(initial.board)) : []));
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // only the newest answer counts: a slow one for an older filter must not overwrite it
  const ticket = useRef(0);
  const filterRef = useRef(filter);
  const searched = useRef(filter.search);
  const first = useRef(true);

  const load = useCallback(async (f: BoardFilterState) => {
    const mine = ++ticket.current;
    setRefreshing(true);
    const r = await settle(() => getVisaBoard(toVisaFilter(f)));
    if (mine !== ticket.current) return;
    setRefreshing(false);
    setNow(Date.now());
    if (r.ok) {
      setPhase({ kind: "ready", board: r.board });
      setCountries((seen) => merge(seen, countriesOf(r.board)));
    } else {
      setPhase((p) => (p.kind === "ready" ? { ...p, error: r.error } : { kind: "error", message: r.error }));
    }
  }, []);

  useEffect(() => {
    filterRef.current = filter;
    // the server already rendered the first board for this very filter
    if (first.current) {
      first.current = false;
      return;
    }
    const typing = filter.search !== searched.current;
    searched.current = filter.search;
    const timer = setTimeout(() => void load(filter), typing ? 350 : 0);
    return () => clearTimeout(timer);
  }, [filter, load]);

  useEffect(() => {
    const every = setInterval(() => void load(filterRef.current), 60_000);
    return () => clearInterval(every);
  }, [load]);

  return (
    <VisaBoardView
      phase={phase}
      filter={filter}
      countries={countries}
      manager={manager}
      now={now}
      refreshing={refreshing}
      onFilter={setFilter}
      onRefresh={() => void load(filter)}
    />
  );
}
