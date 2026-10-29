"use client";

import type { RepackageCustomer } from "@/lib/repackage/repackage-types";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { BasicPhoneLookup } from "../basic/BasicPhoneLookup";
import { basicField, basicLabel } from "../basic/styles";

/**
 * Who the repackage is FOR — Basic's own customer fields (the phone first: a few
 * digits find the customer in Teletel and one tap fills the phone and the name;
 * typed by hand, the number is simply the number). Used where a repackage is
 * started (the list) and where it can be linked later (the review's client
 * card), so both ask the same way and fill the same `RepackageData.customer`.
 */
export function RepackageClientFields({
  customer,
  onChange,
  ring = false,
}: {
  customer: RepackageCustomer;
  onChange: (customer: RepackageCustomer) => void;
  /** mark an empty field red — the issue needs both. */
  ring?: boolean;
}) {
  const { t } = useTraveliunUI();
  const red = (filled: string) => (ring && !filled.trim() ? " border-[#e0879b] focus:border-[#c22850]" : "");
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <BasicPhoneLookup
        label={t("pg.customerPhone")}
        phone={customer.customer_phone}
        onPhone={(customer_phone) => onChange({ ...customer, customer_phone })}
        onPick={(hit) => onChange({ customer_name: hit.name, customer_phone: hit.phone })}
        invalid={ring && !customer.customer_phone.trim()}
      />
      <label className={basicLabel}>
        {t("pg.customerName")}
        <input
          value={customer.customer_name}
          onChange={(e) => onChange({ ...customer, customer_name: e.target.value })}
          className={`${basicField}${red(customer.customer_name)}`}
        />
      </label>
    </div>
  );
}
