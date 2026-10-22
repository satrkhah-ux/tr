/**
 * A traveller's nationality as people read it (the owner, 2026-10-22): the
 * passport gives ICAO alpha-3 («SAU»), staff type «سعودي» or «SA» — every
 * screen and voucher shows the country's name instead («السعودية»), and the
 * visa rule (travelers.ts visaFor) reads them all as the same code. What is
 * STORED stays as it was read or typed.
 *
 * The countries table holds only the 57 destinations, by ISO alpha-2 — not
 * the travellers' nationalities (Syria, Yemen, Pakistan…) — so the names come
 * from Intl (CLDR) through this alpha-3 → alpha-2 table.
 *
 * Pure: no I/O.
 */

// ISO 3166-1 alpha-3 + alpha-2, five letters per country
const ISO =
  "AFGAF ALAAX ALBAL DZADZ ASMAS ANDAD AGOAO AIAAI ATAAQ ATGAG ARGAR ARMAM ABWAW AUSAU AUTAT AZEAZ BHSBS BHRBH BGDBD BRBBB " +
  "BLRBY BELBE BLZBZ BENBJ BMUBM BTNBT BOLBO BESBQ BIHBA BWABW BVTBV BRABR IOTIO BRNBN BGRBG BFABF BDIBI CPVCV KHMKH CMRCM " +
  "CANCA CYMKY CAFCF TCDTD CHLCL CHNCN CXRCX CCKCC COLCO COMKM COGCG CODCD COKCK CRICR CIVCI HRVHR CUBCU CUWCW CYPCY CZECZ " +
  "DNKDK DJIDJ DMADM DOMDO ECUEC EGYEG SLVSV GNQGQ ERIER ESTEE SWZSZ ETHET FLKFK FROFO FJIFJ FINFI FRAFR GUFGF PYFPF ATFTF " +
  "GABGA GMBGM GEOGE DEUDE GHAGH GIBGI GRCGR GRLGL GRDGD GLPGP GUMGU GTMGT GGYGG GINGN GNBGW GUYGY HTIHT HMDHM VATVA HNDHN " +
  "HKGHK HUNHU ISLIS INDIN IDNID IRNIR IRQIQ IRLIE IMNIM ISRIL ITAIT JAMJM JPNJP JEYJE JORJO KAZKZ KENKE KIRKI PRKKP KORKR " +
  "KWTKW KGZKG LAOLA LVALV LBNLB LSOLS LBRLR LBYLY LIELI LTULT LUXLU MACMO MDGMG MWIMW MYSMY MDVMV MLIML MLTMT MHLMH MTQMQ " +
  "MRTMR MUSMU MYTYT MEXMX FSMFM MDAMD MCOMC MNGMN MNEME MSRMS MARMA MOZMZ MMRMM NAMNA NRUNR NPLNP NLDNL NCLNC NZLNZ NICNI " +
  "NERNE NGANG NIUNU NFKNF MKDMK MNPMP NORNO OMNOM PAKPK PLWPW PSEPS PANPA PNGPG PRYPY PERPE PHLPH PCNPN POLPL PRTPT PRIPR " +
  "QATQA REURE ROURO RUSRU RWARW BLMBL SHNSH KNAKN LCALC MAFMF SPMPM VCTVC WSMWS SMRSM STPST SAUSA SENSN SRBRS SYCSC SLESL " +
  "SGPSG SXMSX SVKSK SVNSI SLBSB SOMSO ZAFZA SGSGS SSDSS ESPES LKALK SDNSD SURSR SJMSJ SWESE CHECH SYRSY TWNTW TJKTJ TZATZ " +
  "THATH TLSTL TGOTG TKLTK TONTO TTOTT TUNTN TURTR TKMTM TCATC TUVTV UGAUG UKRUA AREAE GBRGB USAUS UMIUM URYUY UZBUZ VUTVU " +
  "VENVE VNMVN VGBVG VIRVI WLFWF ESHEH YEMYE ZMBZM ZWEZW";

const ALPHA2: Record<string, string> = Object.fromEntries(ISO.split(" ").map((e) => [e.slice(0, 3), e.slice(3)]));
const ALPHA3: Record<string, string> = Object.fromEntries(Object.entries(ALPHA2).map(([a3, a2]) => [a2, a3]));
// ICAO 9303's own codes: Germany is «D»; the British passport classes; Kosovo
Object.assign(ALPHA2, { D: "DE", GBD: "GB", GBN: "GB", GBO: "GB", GBP: "GB", GBS: "GB", RKS: "XK" });

/** How staff write a Saudi passport (the owner, 2026-10-22) — all of it is SAU. */
const SAUDI = new Set(["سعودي", "سعودية", "سعوديه", "السعودية", "السعوديه", "المملكة العربية السعودية", "SAUDI", "SAUDI ARABIA", "KSA"]);

/** The ICAO code for what was read or typed: «سعودي»/«Saudi»/«SA» → SAU, «KW» → KWT; anything else upper-cased as it is. */
export function nationalityCode(value: string | null | undefined): string {
  const v = (value ?? "").trim().replace(/\s+/g, " ").toUpperCase();
  if (SAUDI.has(v)) return "SAU";
  return (v.length === 2 && ALPHA3[v]) || v;
}

const display: Partial<Record<"ar" | "en", Intl.DisplayNames>> = {};
// the system's own spelling where CLDR's differs (countries.arabic_name «السعودية»)
const AR_NAME: Record<string, string> = { SA: "السعودية", PS: "فلسطين" };

/** The country's name for a nationality code («SAU» → «السعودية», «SYR» → «سوريا»); what is not a code is shown as written. */
export function nationalityName(value: string | null | undefined, lang: "ar" | "en" = "ar"): string {
  const iso2 = ALPHA2[nationalityCode(value)];
  if (!iso2) return (value ?? "").trim();
  if (lang === "ar" && AR_NAME[iso2]) return AR_NAME[iso2];
  display[lang] ??= new Intl.DisplayNames([lang], { type: "region", fallback: "code" });
  return display[lang].of(iso2) ?? (value ?? "").trim();
}
