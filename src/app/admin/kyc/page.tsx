"use client";

import { useState } from "react";
import { Search, CheckCircle, XCircle, RefreshCw, FileText, ChevronDown } from "lucide-react";
import { usePalmXStore, type KycStatus, type UserRecord } from "@/lib/store";

const STATUS_CONFIG: Record<KycStatus, { label: string; color: string }> = {
  pending:    { label: "Pending",    color: "#e2b700" },
  verified:   { label: "Verified",   color: "#0ecb81" },
  rejected:   { label: "Rejected",   color: "#f6465d" },
  resubmit:   { label: "Resubmit",   color: "#ff8c00" },
  unverified: { label: "Unverified", color: "#666" },
};

type ActionType = "approve" | "reject" | "resubmit" | null;

export default function AdminKycPage() {
  const { users, approveKyc, rejectKyc, requestResubmission } = usePalmXStore();

  const [tab, setTab]       = useState<"pending" | "all">("pending");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<KycStatus | "all">("all");

  const [activeAction, setActiveAction] = useState<{
    user: UserRecord;
    type: ActionType;
    notes: string;
  } | null>(null);

  const [toast, setToast] = useState<{ msg: string; color: string } | null>(null);

  function showToast(msg: string, color = "#0ecb81") {
    setToast({ msg, color });
    setTimeout(() => setToast(null), 4000);
  }

  function submitAction() {
    if (!activeAction) return;
    const { user, type, notes } = activeAction;
    if (type === "approve")   { approveKyc(user.id); showToast(`✓ KYC approved for ${user.name}. Status → Verified.`); }
    if (type === "reject")    { rejectKyc(user.id, notes); showToast(`KYC rejected for ${user.name}.`, "#f6465d"); }
    if (type === "resubmit")  { requestResubmission(user.id, notes); showToast(`Resubmission requested from ${user.name}.`, "#ff8c00"); }
    setActiveAction(null);
  }

  const filtered = users.filter((u) => {
    // KYC-relevant users only (tier 1 or 2 attempt)
    if (tab === "pending" && u.kycStatus !== "pending") return false;
    if (filter !== "all" && u.kycStatus !== filter) return false;
    const matchSearch =
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase());
    return matchSearch && u.kycTier > 0;
  });

  return (
    <div className="p-6 lg:p-8 max-w-[1280px]">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">KYC Review</h1>
        <p className="text-sm text-white/40 mt-1">
          Review identity verification submissions and manage approval status
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 bg-white/5 p-1 rounded-xl w-fit">
        {(["pending", "all"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors capitalize ${
              tab === t ? "bg-[#e2b700] text-black" : "text-white/50 hover:text-white"
            }`}
          >
            {t === "pending" ? `Pending (${users.filter((u) => u.kycStatus === "pending" && u.kycTier > 0).length})` : "All Applications"}
          </button>
        ))}
      </div>

      {/* Search + Filter */}
      <div className="flex flex-wrap gap-3 mb-5">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search user…"
            className="w-full bg-black border border-white/10 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#e2b700]/40"
          />
        </div>
        {tab === "all" && (
          <div className="relative">
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as KycStatus | "all")}
              className="appearance-none bg-black border border-white/10 rounded-xl px-4 pr-8 py-2.5 text-sm text-white focus:outline-none cursor-pointer"
            >
              <option value="all">All Status</option>
              {(Object.keys(STATUS_CONFIG) as KycStatus[]).map((k) => (
                <option key={k} value={k}>{STATUS_CONFIG[k].label}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/40 pointer-events-none" />
          </div>
        )}
      </div>

      {/* Table */}
      <div className="bg-black border border-white/8 rounded-2xl overflow-hidden">
        <div className="grid grid-cols-[1fr_1fr_auto_auto_auto_auto] gap-3 px-5 py-3 border-b border-white/8 text-xs font-semibold text-white/30 uppercase tracking-wider">
          <span>User</span>
          <span>Document</span>
          <span>Tier</span>
          <span>Submitted</span>
          <span>Status</span>
          <span>Actions</span>
        </div>

        {filtered.length === 0 ? (
          <div className="py-14 text-center text-white/30 text-sm">
            {tab === "pending" ? "✓ No pending KYC submissions" : "No applications found"}
          </div>
        ) : (
          filtered.map((user) => {
            const cfg = STATUS_CONFIG[user.kycStatus];
            return (
              <div
                key={user.id}
                className="grid grid-cols-[1fr_1fr_auto_auto_auto_auto] gap-3 items-center px-5 py-4 border-b border-white/5 last:border-0 hover:bg-white/2 transition-colors"
              >
                {/* User */}
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                    style={{ background: `${cfg.color}18`, color: cfg.color }}
                  >
                    {user.name.charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white truncate">{user.name}</p>
                    <p className="text-xs text-white/40">{user.email}</p>
                  </div>
                </div>

                {/* Document */}
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className="w-3.5 h-3.5 text-white/30 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm text-white truncate">{user.kycDocType ?? "—"}</p>
                    <p className="text-xs text-white/40 font-mono">{user.kycDocNumber ?? "—"}</p>
                  </div>
                </div>

                {/* Tier */}
                <span className="text-sm font-semibold text-white/70 text-center">
                  Tier {user.kycTier}
                </span>

                {/* Submitted */}
                <span className="text-xs text-white/35 whitespace-nowrap">
                  {user.kycSubmittedAt ?? "—"}
                </span>

                {/* Status */}
                <span
                  className="text-xs font-semibold px-2.5 py-1 rounded-lg whitespace-nowrap"
                  style={{ background: `${cfg.color}18`, color: cfg.color }}
                >
                  {cfg.label}
                </span>

                {/* Actions */}
                <div className="flex items-center gap-1.5">
                  {user.kycStatus === "pending" ? (
                    <>
                      <button
                        onClick={() => setActiveAction({ user, type: "approve", notes: "" })}
                        className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-[#0ecb81] bg-[#0ecb81]/8 hover:bg-[#0ecb81]/15 rounded-lg transition-colors"
                        title="Approve"
                      >
                        <CheckCircle className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Approve</span>
                      </button>
                      <button
                        onClick={() => setActiveAction({ user, type: "resubmit", notes: "" })}
                        className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-[#ff8c00] bg-[#ff8c00]/8 hover:bg-[#ff8c00]/15 rounded-lg transition-colors"
                        title="Request Resubmission"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setActiveAction({ user, type: "reject", notes: "" })}
                        className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-[#f6465d] bg-[#f6465d]/8 hover:bg-[#f6465d]/15 rounded-lg transition-colors"
                        title="Reject"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                      </button>
                    </>
                  ) : (
                    <span className="text-xs text-white/25 italic">
                      {user.kycStatus === "verified" ? "Approved" : "Actioned"}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Action Modal */}
      {activeAction && (() => {
        const isApprove   = activeAction.type === "approve";
        const isReject    = activeAction.type === "reject";
        const isResubmit  = activeAction.type === "resubmit";
        const color       = isApprove ? "#0ecb81" : isReject ? "#f6465d" : "#ff8c00";
        const label       = isApprove ? "Approve KYC" : isReject ? "Reject KYC" : "Request Resubmission";
        const icon        = isApprove ? CheckCircle : isReject ? XCircle : RefreshCw;
        const Icon        = icon;

        return (
          <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-[#0a0a0a] border border-white/12 rounded-2xl p-6 w-full max-w-md">
              <div className="flex items-center gap-3 mb-1">
                <Icon className="w-5 h-5" style={{ color }} />
                <h3 className="text-base font-semibold text-white">{label}</h3>
              </div>
              <p className="text-sm text-white/50 mb-4 ml-8">
                User: <strong className="text-white">{activeAction.user.name}</strong>
                {" · "}{activeAction.user.kycDocType} #{activeAction.user.kycDocNumber}
              </p>

              {!isApprove && (
                <div className="mb-4">
                  <label className="text-xs font-semibold text-white/40 uppercase tracking-wide block mb-1.5">
                    {isReject ? "Reason for rejection" : "Instructions for resubmission"}
                    <span className="text-[#f6465d] ml-1">*</span>
                  </label>
                  <textarea
                    rows={3}
                    value={activeAction.notes}
                    onChange={(e) =>
                      setActiveAction({ ...activeAction, notes: e.target.value })
                    }
                    placeholder={
                      isReject
                        ? "e.g. Document image is blurry or expired"
                        : "e.g. Please provide a clearer selfie with document visible"
                    }
                    className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-[#e2b700]/40 resize-none"
                  />
                </div>
              )}

              {isApprove && (
                <div className="bg-[#0ecb81]/8 border border-[#0ecb81]/20 rounded-xl px-4 py-3 mb-4">
                  <p className="text-sm text-[#0ecb81]">
                    This will mark the user as <strong>Verified</strong> and grant full
                    platform access. An automated notification will be sent to the user.
                  </p>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={submitAction}
                  disabled={!isApprove && !activeAction.notes.trim()}
                  className="flex-1 py-2.5 text-sm font-semibold rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ background: `${color}18`, color, border: `1px solid ${color}30` }}
                >
                  Confirm {isApprove ? "Approval" : isReject ? "Rejection" : "Request"}
                </button>
                <button
                  onClick={() => setActiveAction(null)}
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
        <div
          className="fixed bottom-6 right-6 text-sm font-semibold px-5 py-3 rounded-xl shadow-2xl z-50 max-w-xs"
          style={{ background: toast.color, color: toast.color === "#f6465d" ? "#fff" : "#000" }}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}
