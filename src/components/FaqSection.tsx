"use client";

import { useState } from "react";
import { Plus, Minus } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";

export function FaqSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const { t, isRTL } = useLanguage();

  const faqs = [
    { q: t.faq1Q, a: t.faq1A },
    { q: t.faq2Q, a: t.faq2A },
    { q: t.faq3Q, a: t.faq3A },
    { q: t.faq4Q, a: t.faq4A },
  ];

  return (
    <section className="py-24 bg-black" dir={isRTL ? "rtl" : "ltr"}>
      <div className="max-w-[960px] mx-auto px-6 lg:px-12">
        <div className="text-center mb-12">
          <h2
            className="text-3xl md:text-4xl font-bold text-white"
            style={isRTL ? { fontFamily: "Arial, Tahoma, sans-serif" } : {}}
          >
            {t.faqHeading}
          </h2>
        </div>

        <div className="space-y-3">
          {faqs.map((faq, i) => (
            <div
              key={i}
              className="bg-[#141414] border border-white/8 rounded-2xl overflow-hidden hover:border-white/12 transition-colors"
            >
              <button
                className={`w-full flex items-center justify-between p-6 ${isRTL ? "flex-row-reverse text-right" : "text-left"}`}
                onClick={() => setOpenIndex(openIndex === i ? null : i)}
                aria-expanded={openIndex === i}
              >
                <span
                  className="text-base font-medium text-white pr-4"
                  style={isRTL ? { fontFamily: "Arial, Tahoma, sans-serif" } : {}}
                >
                  {faq.q}
                </span>
                <span className="flex-shrink-0 w-8 h-8 rounded-full bg-white/8 flex items-center justify-center text-white/60">
                  {openIndex === i ? <Minus className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                </span>
              </button>
              {openIndex === i && (
                <div className={`px-6 pb-6 ${isRTL ? "text-right" : ""}`}>
                  <p
                    className="text-sm text-white/55 leading-relaxed"
                    style={isRTL ? { fontFamily: "Arial, Tahoma, sans-serif" } : {}}
                  >
                    {faq.a}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

