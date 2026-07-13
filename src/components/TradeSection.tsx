"use client";

import Link from "next/link";
import { Zap, Shield, Code } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";

const stats = [
  { value: "0.08%", labelKey: "Maker fee" },
  { value: "0.1%",  labelKey: "Taker fee" },
  { value: "300+",  labelKey: "Trading pairs" },
  { value: "24/7",  labelKey: "Support" },
];

export function TradeSection() {
  const { t, isRTL } = useLanguage();

  const advantages = [
    { icon: <Zap className="w-5 h-5" />,    title: t.tradeFeature1Title, desc: t.tradeFeature1Desc },
    { icon: <Shield className="w-5 h-5" />, title: t.tradeFeature2Title, desc: t.tradeFeature2Desc },
    { icon: <Code className="w-5 h-5" />,   title: t.tradeFeature3Title, desc: t.tradeFeature3Desc },
  ];

  return (
    <section className="py-24 bg-[#080808]" dir={isRTL ? "rtl" : "ltr"}>
      <div className="max-w-[1440px] mx-auto px-6 lg:px-12">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          <div className={isRTL ? "text-right" : ""}>
            <h2
              className="text-3xl md:text-4xl lg:text-[2.75rem] font-bold text-white leading-tight mb-4"
              style={isRTL ? { fontFamily: "Arial, Tahoma, sans-serif" } : {}}
            >
              {t.tradeHeading}
            </h2>
            <p
              className="text-white/55 text-lg leading-relaxed mb-10"
              style={isRTL ? { fontFamily: "Arial, Tahoma, sans-serif" } : {}}
            >
              {t.tradeSubtitle}
            </p>

            <div className="space-y-6 mb-10">
              {advantages.map((a) => (
                <div key={a.title} className={`flex gap-4 ${isRTL ? "flex-row-reverse" : ""}`}>
                  <div className="w-10 h-10 rounded-xl bg-[#e2b700]/10 text-[#e2b700] flex items-center justify-center flex-shrink-0">
                    {a.icon}
                  </div>
                  <div className={isRTL ? "text-right" : ""}>
                    <h3
                      className="text-sm font-semibold text-white mb-1"
                      style={isRTL ? { fontFamily: "Arial, Tahoma, sans-serif" } : {}}
                    >
                      {a.title}
                    </h3>
                    <p
                      className="text-sm text-white/50"
                      style={isRTL ? { fontFamily: "Arial, Tahoma, sans-serif" } : {}}
                    >
                      {a.desc}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <Link
              href="/trade"
              className="inline-flex px-6 py-3 bg-[#e2b700] hover:bg-[#f5ca00] text-black text-sm font-semibold rounded-xl transition-colors"
            >
              {t.tradeCta}
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {stats.map((s) => (
              <div
                key={s.labelKey}
                className="bg-[#141414] border border-white/8 rounded-2xl p-8 text-center hover:border-white/15 transition-all"
              >
                <p className="text-4xl font-bold text-white mb-2">{s.value}</p>
                <p className="text-sm text-white/50">{s.labelKey}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

