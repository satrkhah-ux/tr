"use client";

import { useState } from "react";
import { Plus, Edit2, Trash2, Power, X, Check } from "lucide-react";
import { usePalmXStore, type PalmXAsset, type AssetStatus } from "@/lib/store";

const EMPTY_FORM = {
  symbol: "", name: "", color: "#ffffff", price: "", priceNum: 0,
  change: "0.00%", positive: true, volume: "$0", cap: "$0",
  status: "active" as AssetStatus,
  networks: "", depositMin: "", networkFee: "",
};

export default function AdminAssetsPage() {
  const { assets, addAsset, updateAsset, removeAsset } = usePalmXStore();

  const [modal, setModal] = useState<{ open: boolean; editId: string | null }>({ open: false, editId: null });
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [search, setSearch] = useState("");

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(""), 3500); }

  function openAdd() {
    setForm({ ...EMPTY_FORM });
    setModal({ open: true, editId: null });
  }

  function openEdit(asset: PalmXAsset) {
    setForm({
      symbol: asset.symbol, name: asset.name, color: asset.color,
      price: asset.price, priceNum: asset.priceNum,
      change: asset.change, positive: asset.positive,
      volume: asset.volume, cap: asset.cap, status: asset.status,
      networks: asset.networks.join(", "),
      depositMin: asset.depositMin, networkFee: asset.networkFee,
    });
    setModal({ open: true, editId: asset.id });
  }

  function handleSave() {
    if (!form.symbol.trim() || !form.name.trim()) return;
    const networksArr = form.networks
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean);

    if (modal.editId) {
      updateAsset(modal.editId, {
        ...form,
        symbol: form.symbol.toUpperCase(),
        networks: networksArr,
        priceNum: parseFloat(form.price.replace(/[^0-9.]/g, "")) || 0,
      });
      showToast(`${form.name} updated successfully.`);
    } else {
      addAsset({
        ...form,
        symbol: form.symbol.toUpperCase(),
        networks: networksArr,
        priceNum: parseFloat(form.price.replace(/[^0-9.]/g, "")) || 0,
      });
      showToast(`${form.name} (${form.symbol.toUpperCase()}) added to the platform.`);
    }
    setModal({ open: false, editId: null });
  }

  function toggleStatus(asset: PalmXAsset) {
    const newStatus: AssetStatus = asset.status === "active" ? "suspended" : "active";
    updateAsset(asset.id, { status: newStatus });
    showToast(`${asset.name} ${newStatus === "active" ? "activated" : "suspended"}.`);
  }

  const filtered = assets.filter(
    (a) =>
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.symbol.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 lg:p-8 max-w-[1280px]">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Asset Management</h1>
          <p className="text-sm text-white/40 mt-1">
            {assets.filter((a) => a.status === "active").length} active · {assets.length} total
          </p>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 px-4 py-2.5 bg-[#e2b700] hover:bg-[#f5ca00] text-black text-sm font-semibold rounded-xl transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Asset
        </button>
      </div>

      {/* Search */}
      <div className="mb-5">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search assets…"
          className="bg-black border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#e2b700]/40 w-64"
        />
      </div>

      {/* Table */}
      <div className="bg-black border border-white/8 rounded-2xl overflow-hidden">
        <div className="grid grid-cols-[auto_1fr_auto_auto_auto_auto_auto] gap-3 px-5 py-3 border-b border-white/8 text-xs font-semibold text-white/30 uppercase tracking-wider">
          <span>#</span>
          <span>Asset</span>
          <span>Price</span>
          <span>Deposit Min</span>
          <span>Network Fee</span>
          <span>Status</span>
          <span>Actions</span>
        </div>

        {filtered.map((asset) => (
          <div
            key={asset.id}
            className={`grid grid-cols-[auto_1fr_auto_auto_auto_auto_auto] gap-3 items-center px-5 py-3.5 border-b border-white/5 last:border-0 hover:bg-white/2 transition-colors ${
              asset.status === "suspended" ? "opacity-50" : ""
            }`}
          >
            <span className="text-xs text-white/30 font-mono w-5">{asset.rank}</span>

            {/* Asset name */}
            <div className="flex items-center gap-3 min-w-0">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                style={{ background: asset.color }}
              >
                {asset.symbol.slice(0, 2)}
              </div>
              <div>
                <p className="text-sm font-semibold text-white">{asset.name}</p>
                <p className="text-xs text-white/40">{asset.symbol}</p>
              </div>
            </div>

            <span className="text-sm font-mono text-white/80 whitespace-nowrap">{asset.price}</span>
            <span className="text-xs text-white/50 whitespace-nowrap">{asset.depositMin}</span>
            <span className="text-xs text-white/50 whitespace-nowrap">{asset.networkFee}</span>

            {/* Status badge */}
            <span
              className={`text-xs font-semibold px-2.5 py-1 rounded-lg whitespace-nowrap ${
                asset.status === "active"
                  ? "bg-[#0ecb81]/10 text-[#0ecb81]"
                  : "bg-[#e2b700]/10 text-[#e2b700]"
              }`}
            >
              {asset.status === "active" ? "Active" : "Suspended"}
            </span>

            {/* Actions */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => openEdit(asset)}
                className="p-1.5 text-white/40 hover:text-white hover:bg-white/8 rounded-lg transition-colors"
                title="Edit"
              >
                <Edit2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => toggleStatus(asset)}
                className={`p-1.5 rounded-lg transition-colors ${
                  asset.status === "active"
                    ? "text-[#e2b700]/60 hover:text-[#e2b700] hover:bg-[#e2b700]/8"
                    : "text-[#0ecb81]/60 hover:text-[#0ecb81] hover:bg-[#0ecb81]/8"
                }`}
                title={asset.status === "active" ? "Suspend" : "Activate"}
              >
                <Power className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setConfirmRemove(asset.id)}
                className="p-1.5 text-[#f6465d]/40 hover:text-[#f6465d] hover:bg-[#f6465d]/8 rounded-lg transition-colors"
                title="Remove"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="py-14 text-center text-white/30 text-sm">No assets found</div>
        )}
      </div>

      {/* Add / Edit Modal */}
      {modal.open && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#0a0a0a] border border-white/12 rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-semibold text-white">
                {modal.editId ? "Edit Asset" : "Add New Asset"}
              </h3>
              <button
                onClick={() => setModal({ open: false, editId: null })}
                className="text-white/40 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {[
                { label: "Symbol", key: "symbol", placeholder: "BTC", upper: true },
                { label: "Name",   key: "name",   placeholder: "Bitcoin" },
                { label: "Current Price", key: "price", placeholder: "$96,420.50", full: false },
                { label: "24h Change",    key: "change", placeholder: "+2.14%" },
                { label: "Min Deposit",   key: "depositMin", placeholder: "0.001 BTC" },
                { label: "Network Fee",   key: "networkFee", placeholder: "0.0002 BTC" },
                { label: "24h Volume",    key: "volume",     placeholder: "$38.2B" },
                { label: "Market Cap",    key: "cap",        placeholder: "$1.89T" },
              ].map(({ label, key, placeholder, upper }) => (
                <div key={key}>
                  <label className="text-xs font-semibold text-white/40 uppercase tracking-wide block mb-1.5">
                    {label}
                  </label>
                  <input
                    type="text"
                    value={(form as unknown as Record<string, string>)[key]}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        [key]: upper ? e.target.value.toUpperCase() : e.target.value,
                        ...(key === "change"
                          ? { positive: !e.target.value.startsWith("-") }
                          : {}),
                      }))
                    }
                    placeholder={placeholder}
                    className="w-full bg-black border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-[#e2b700]/40"
                  />
                </div>
              ))}

              <div className="col-span-2">
                <label className="text-xs font-semibold text-white/40 uppercase tracking-wide block mb-1.5">
                  Networks (comma-separated)
                </label>
                <input
                  type="text"
                  value={form.networks}
                  onChange={(e) => setForm((f) => ({ ...f, networks: e.target.value }))}
                  placeholder="Bitcoin (BTC), Lightning Network"
                  className="w-full bg-black border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-[#e2b700]/40"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-white/40 uppercase tracking-wide block mb-1.5">
                  Color (hex)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={form.color}
                    onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                    className="w-10 h-10 bg-transparent border border-white/10 rounded-lg cursor-pointer"
                  />
                  <input
                    type="text"
                    value={form.color}
                    onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                    className="flex-1 bg-black border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-[#e2b700]/40"
                    placeholder="#f7931a"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-white/40 uppercase tracking-wide block mb-1.5">
                  Status
                </label>
                <select
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as AssetStatus }))}
                  className="w-full bg-black border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none cursor-pointer"
                >
                  <option value="active">Active</option>
                  <option value="suspended">Suspended</option>
                </select>
              </div>
            </div>

            <div className="flex gap-3 mt-5">
              <button
                onClick={handleSave}
                disabled={!form.symbol.trim() || !form.name.trim()}
                className="flex-1 py-2.5 bg-[#e2b700] hover:bg-[#f5ca00] disabled:opacity-40 text-black font-semibold rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
              >
                <Check className="w-4 h-4" />
                {modal.editId ? "Save Changes" : "Add Asset"}
              </button>
              <button
                onClick={() => setModal({ open: false, editId: null })}
                className="flex-1 py-2.5 bg-white/5 hover:bg-white/10 text-white/70 font-medium rounded-xl text-sm transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Remove */}
      {confirmRemove && (() => {
        const asset = assets.find((a) => a.id === confirmRemove);
        return (
          <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-[#0a0a0a] border border-white/12 rounded-2xl p-6 w-full max-w-sm">
              <h3 className="text-base font-semibold text-white mb-2">Remove Asset</h3>
              <p className="text-sm text-white/60 mb-5">
                Remove <strong className="text-white">{asset?.name} ({asset?.symbol})</strong> from
                the platform? This also removes it from Markets and Wallet pages.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    removeAsset(confirmRemove);
                    showToast(`${asset?.name} removed from platform.`);
                    setConfirmRemove(null);
                  }}
                  className="flex-1 py-2.5 bg-[#f6465d]/15 hover:bg-[#f6465d]/25 text-[#f6465d] font-semibold rounded-xl text-sm transition-colors"
                >
                  Remove
                </button>
                <button
                  onClick={() => setConfirmRemove(null)}
                  className="flex-1 py-2.5 bg-white/5 hover:bg-white/10 text-white/60 rounded-xl text-sm transition-colors"
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
        <div className="fixed bottom-6 right-6 bg-[#0ecb81] text-black text-sm font-semibold px-5 py-3 rounded-xl shadow-2xl z-50">
          ✓ {toast}
        </div>
      )}
    </div>
  );
}
