"use client";

import { useState } from "react";
import { Search, ChevronDown, Shield, Ban, Snowflake, UserCheck, AlertTriangle } from "lucide-react";
import { usePalmXStore, type UserRecord, type AccountStatus, type KycStatus } from "@/lib/store";

const KYC_LABELS: Record<KycStatus, { label: string; color: string }> = {
  verified:   { label: "Verified",   color: "#0ecb81" },
  pending:    { label: "Pending",    color: "#e2b700" },
  rejected:   { label: "Rejected",  color: "#f6465d" },
  resubmit:   { label: "Resubmit",  color: "#ff8c00" },
  unverified: { label: "Unverified",color: "#666" },
};

const ACCT_LABELS: Record<AccountStatus, { label: string; color: string }> = {
  active:    { label: "Active",    color: "#0ecb81" },
  suspended: { label: "Suspended", color: "#e2b700" },
  frozen:    { label: "Frozen",    color: "#375bd2" },
  banned:    { label: "Banned",    color: "#f6465d" },
};

export default function AdminUsersPage() {
  const { users, updateUser } = usePalmXStore();
  const [search, setSearch]   = useState("");
  const [kycFilter, setKycFilter]   = useState<KycStatus | "all">("all");
  const [acctFilter, setAcctFilter] = useState<AccountStatus | "all">("all");
  const [confirmAction, setConfirmAction] = useState<{
    userId: string;
    action: AccountStatus;
    label: string;
  } | null>(null);
  const [toast, setToast] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  }

  function executeAction(userId: string, action: AccountStatus) {
    updateUser(userId, { accountStatus: action });
    const user = users.find((u) => u.id === userId);
    showToast(`${user?.name ?? "User"} status updated to ${action}.`);
    setConfirmAction(null);
  }

  const filtered = users.filter((u) => {
    const matchSearch =
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      u.phone.includes(search);
    const matchKyc  = kycFilter  === "all" || u.kycStatus      === kycFilter;
    const matchAcct = acctFilter === "all" || u.accountStatus  === acctFilter;
    return matchSearch && matchKyc && matchAcct;
  });

  return (
    <div className="p-6 lg:p-8 max-w-[1280px]">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">User Management</h1>
        <p className="text-sm text-white/40 mt-1">
          {users.length} total users · {users.filter((u) => u.accountStatus === "active").length} active
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email, phone…"
            className="w-full bg-black border border-white/10 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#e2b700]/40"
          />
        </div>

        <div className="relative">
          <select
            value={kycFilter}
            onChange={(e) => setKycFilter(e.target.value as KycStatus | "all")}
            className="appearance-none bg-black border border-white/10 rounded-xl px-4 pr-8 py-2.5 text-sm text-white focus:outline-none cursor-pointer"
          >
            <option value="all">All KYC</option>
            {(Object.keys(KYC_LABELS) as KycStatus[]).map((k) => (
              <option key={k} value={k}>{KYC_LABELS[k].label}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/40 pointer-events-none" />
        </div>

        <div className="relative">
          <select
            value={acctFilter}
            onChange={(e) => setAcctFilter(e.target.value as AccountStatus | "all")}
            className="appearance-none bg-black border border-white/10 rounded-xl px-4 pr-8 py-2.5 text-sm text-white focus:outline-none cursor-pointer"
          >
            <option value="all">All Status</option>
            {(Object.keys(ACCT_LABELS) as AccountStatus[]).map((k) => (
              <option key={k} value={k}>{ACCT_LABELS[k].label}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/40 pointer-events-none" />
        </div>
      </div>

      {/* Table */}
      <div className="bg-black border border-white/8 rounded-2xl overflow-hidden">
        {/* Column headers */}
        <div className="grid grid-cols-[1fr_1fr_auto_auto_auto_auto] gap-3 px-5 py-3 border-b border-white/8 text-xs font-semibold text-white/30 uppercase tracking-wider">
          <span>User</span>
          <span>Email / Phone</span>
          <span>KYC</span>
          <span>Account</span>
          <span>Balance</span>
          <span>Actions</span>
        </div>

        {filtered.length === 0 ? (
          <div className="py-14 text-center text-white/30 text-sm">No users found</div>
        ) : (
          <div>
            {filtered.map((user) => {
              const kyc  = KYC_LABELS[user.kycStatus];
              const acct = ACCT_LABELS[user.accountStatus];
              const isExpanded = expandedId === user.id;

              return (
                <div key={user.id} className="border-b border-white/5 last:border-0">
                  {/* Row */}
                  <div
                    className="grid grid-cols-[1fr_1fr_auto_auto_auto_auto] gap-3 items-center px-5 py-4 hover:bg-white/2 transition-colors cursor-pointer"
                    onClick={() => setExpandedId(isExpanded ? null : user.id)}
                  >
                    {/* Name */}
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                        style={{ background: `${kyc.color}18`, color: kyc.color }}
                      >
                        {user.name.charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-white truncate">{user.name}</p>
                        <p className="text-xs text-white/35">{user.country} · {user.joinedAt}</p>
                      </div>
                    </div>

                    {/* Contact */}
                    <div className="min-w-0">
                      <p className="text-sm text-white/70 truncate">{user.email}</p>
                      <p className="text-xs text-white/35">{user.phone}</p>
                    </div>

                    {/* KYC badge */}
                    <span
                      className="text-xs font-semibold px-2.5 py-1 rounded-lg whitespace-nowrap"
                      style={{ background: `${kyc.color}18`, color: kyc.color }}
                    >
                      {kyc.label}
                    </span>

                    {/* Account badge */}
                    <span
                      className="text-xs font-semibold px-2.5 py-1 rounded-lg whitespace-nowrap"
                      style={{ background: `${acct.color}18`, color: acct.color }}
                    >
                      {acct.label}
                    </span>

                    {/* Balance */}
                    <span className="text-sm text-white/60 font-mono whitespace-nowrap">
                      {user.spotBalance}
                    </span>

                    {/* Action buttons */}
                    <div
                      className="flex items-center gap-1.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {user.accountStatus !== "active" ? (
                        <button
                          onClick={() =>
                            setConfirmAction({ userId: user.id, action: "active", label: "Reactivate" })
                          }
                          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[#0ecb81] bg-[#0ecb81]/8 hover:bg-[#0ecb81]/15 rounded-lg transition-colors"
                          title="Reactivate"
                        >
                          <UserCheck className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <>
                          <button
                            onClick={() =>
                              setConfirmAction({ userId: user.id, action: "suspended", label: "Suspend" })
                            }
                            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[#e2b700] bg-[#e2b700]/8 hover:bg-[#e2b700]/15 rounded-lg transition-colors"
                            title="Suspend"
                          >
                            <AlertTriangle className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() =>
                              setConfirmAction({ userId: user.id, action: "frozen", label: "Freeze" })
                            }
                            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[#375bd2] bg-[#375bd2]/8 hover:bg-[#375bd2]/15 rounded-lg transition-colors"
                            title="Freeze"
                          >
                            <Snowflake className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() =>
                              setConfirmAction({ userId: user.id, action: "banned", label: "Ban" })
                            }
                            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[#f6465d] bg-[#f6465d]/8 hover:bg-[#f6465d]/15 rounded-lg transition-colors"
                            title="Ban"
                          >
                            <Ban className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="px-5 pb-4 bg-white/1 border-t border-white/5 grid grid-cols-2 md:grid-cols-4 gap-4">
                      {[
                        { label: "KYC Tier",       value: `Tier ${user.kycTier}` },
                        { label: "Document Type",  value: user.kycDocType ?? "—" },
                        { label: "Doc Number",     value: user.kycDocNumber ?? "—" },
                        { label: "KYC Submitted",  value: user.kycSubmittedAt ?? "—" },
                      ].map(({ label, value }) => (
                        <div key={label} className="pt-3">
                          <p className="text-xs text-white/35 mb-0.5">{label}</p>
                          <p className="text-sm text-white font-medium">{value}</p>
                        </div>
                      ))}
                      {user.adminNotes && (
                        <div className="pt-3 col-span-2 md:col-span-4">
                          <p className="text-xs text-white/35 mb-0.5">Admin Notes</p>
                          <p className="text-sm text-[#e2b700]">{user.adminNotes}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Confirm Modal */}
      {confirmAction && (() => {
        const user = users.find((u) => u.id === confirmAction.userId);
        const actionColors: Record<string, string> = {
          Suspend: "#e2b700", Freeze: "#375bd2", Ban: "#f6465d", Reactivate: "#0ecb81",
        };
        const color = actionColors[confirmAction.label] ?? "#e2b700";
        return (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-[#0a0a0a] border border-white/12 rounded-2xl p-6 w-full max-w-sm">
              <div className="flex items-center gap-3 mb-4">
                <Shield className="w-5 h-5" style={{ color }} />
                <h3 className="text-base font-semibold text-white">
                  {confirmAction.label} Account
                </h3>
              </div>
              <p className="text-sm text-white/60 mb-5">
                Are you sure you want to <strong style={{ color }}>{confirmAction.label.toLowerCase()}</strong>{" "}
                <strong className="text-white">{user?.name}</strong>? This action is reversible by an administrator.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => executeAction(confirmAction.userId, confirmAction.action)}
                  className="flex-1 py-2.5 text-sm font-semibold rounded-xl transition-colors"
                  style={{ background: `${color}18`, color, border: `1px solid ${color}30` }}
                >
                  Confirm {confirmAction.label}
                </button>
                <button
                  onClick={() => setConfirmAction(null)}
                  className="flex-1 py-2.5 text-sm font-medium text-white/60 bg-white/5 hover:bg-white/10 rounded-xl transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 bg-[#0ecb81] text-black text-sm font-semibold px-4 py-3 rounded-xl shadow-xl z-50 animate-pulse">
          ✓ {toast}
        </div>
      )}
    </div>
  );
}
