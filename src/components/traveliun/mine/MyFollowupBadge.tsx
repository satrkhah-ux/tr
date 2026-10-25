"use client";

import { useEffect, useState } from "react";
import { getMyFollowupCount } from "@/lib/data/my-followups";

/** beside «متابعتي»: how many clients and reminders are on me now (a minute's refresh, like «المتابعة»'s) */
export function MyFollowupBadge() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let active = true;
    const load = () =>
      getMyFollowupCount()
        .then((value) => {
          if (active) setCount(value);
        })
        .catch(() => undefined);
    void load();
    const timer = setInterval(() => void load(), 60000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  return count ? (
    <span title="ما عليك في «متابعتي» الآن" className="rounded-full bg-[#E7EEFB] px-2 py-0.5 text-xs font-bold text-[#1D4ED8]">
      {count}
    </span>
  ) : null;
}
