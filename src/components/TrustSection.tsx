"use client";

import Image from "next/image";
import { useLanguage } from "@/components/LanguageProvider";

export function TrustSection() {
  const { t, isRTL } = useLanguage();

  const features = [
    {
      icon: "https://www.okx.com/cdn/assets/imgs/489/EE84C8746B854DA899E03E4EB331A103.png",
      title: t.trustFeature1Title,
      description: t.trustFeature1Desc,
    },
    {
      icon: "https://www.okx.com/cdn/assets/imgs/2511/73E5BDA6221080E9.png",
      title: t.trustFeature2Title,
      description: t.trustFeature2Desc,
    },
    {
      icon: "https://www.okx.com/cdn/assets/imgs/2511/86DA2A807AFC9E14.png",
      title: t.trustFeature3Title,
      description: t.trustFeature3Desc,
    },
    {
      icon: "https://www.okx.com/cdn/assets/imgs/2511/531D7466DA1C4669.png",
      title: t.trustFeature4Title,
      description: t.trustFeature4Desc,
    },
  ];

  return (
    <section className="py-24 bg-black" dir={isRTL ? "rtl" : "ltr"}>
      <div className="max-w-[1440px] mx-auto px-6 lg:px-12">
        <div className="text-center mb-16">
          <h2
            className="text-3xl md:text-4xl lg:text-[2.75rem] font-bold text-white leading-tight"
            style={isRTL ? { fontFamily: "Arial, Tahoma, sans-serif" } : {}}
          >
            {t.trustHeading}
          </h2>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((f) => (
            <div
              key={f.title}
              className="bg-[#141414] border border-white/8 rounded-2xl p-6 hover:border-white/15 hover:bg-[#181818] transition-all"
            >
              <div className="w-14 h-14 mb-5 rounded-xl bg-white/5 flex items-center justify-center overflow-hidden">
                <Image
                  src={f.icon}
                  alt={f.title}
                  width={48}
                  height={48}
                  className="w-10 h-10 object-contain"
                  unoptimized
                />
              </div>
              <h3
                className="text-base font-semibold text-white mb-2"
                style={isRTL ? { fontFamily: "Arial, Tahoma, sans-serif" } : {}}
              >
                {f.title}
              </h3>
              <p
                className="text-sm text-white/50 leading-relaxed"
                style={isRTL ? { fontFamily: "Arial, Tahoma, sans-serif" } : {}}
              >
                {f.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

