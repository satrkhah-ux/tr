"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Lock, ShieldCheck } from "lucide-react";

export default function AdminLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw,   setShowPw]   = useState(false);
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    await new Promise((r) => setTimeout(r, 700));
    if (username === "admin" && password === "palmx2026") {
      localStorage.setItem("palmx-admin-auth", "true");
      router.replace("/admin/dashboard");
    } else {
      setError("Invalid credentials. Hint: admin / palmx2026");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-black flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-[#e2b700]/10 rounded-2xl mb-4">
            <ShieldCheck className="w-7 h-7 text-[#e2b700]" />
          </div>
          <h1 className="text-2xl font-bold text-white">
            Palm<span className="text-[#e2b700]">X</span>
          </h1>
          <p className="text-sm text-white/40 mt-1">Secure Administrator Access</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-[#0a0a0a] border border-white/8 rounded-2xl p-6 space-y-4"
        >
          <div>
            <label className="text-xs font-semibold text-white/50 block mb-1.5 uppercase tracking-wide">
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-[#e2b700]/50 transition-colors"
              placeholder="admin"
              autoComplete="username"
              required
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-white/50 block mb-1.5 uppercase tracking-wide">
              Password
            </label>
            <div className="relative">
              <input
                type={showPw ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 pr-11 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-[#e2b700]/50 transition-colors"
                placeholder="••••••••"
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                onClick={() => setShowPw(!showPw)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
                tabIndex={-1}
              >
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {error && (
            <p className="text-sm text-[#f6465d] bg-[#f6465d]/8 border border-[#f6465d]/20 px-3 py-2.5 rounded-xl">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-[#e2b700] hover:bg-[#f5ca00] disabled:opacity-50 disabled:cursor-not-allowed text-black font-semibold rounded-xl text-sm transition-colors flex items-center justify-center gap-2 mt-2"
          >
            <Lock className="w-4 h-4" />
            {loading ? "Verifying…" : "Sign In to Admin Panel"}
          </button>
        </form>

        <p className="text-center text-xs text-white/20 mt-5">
          PalmX Admin Panel v3.0 · All access attempts are logged
        </p>
      </div>
    </div>
  );
}
