/** Local destination scenery; never depend on an advert or an external image host. */
const IDS: Record<string, string> = {
  "جورجيا": "georgia", "مصر": "egypt", "تركيا": "turkey", "اندونيسيا": "indonesia",
  "فيتنام": "vietnam", "اذربيجان": "azerbaijan", "البحرين": "bahrain", "المملكه المتحده": "uk",
  "بريطانيا": "uk", "التشيك": "czechia", "البوسنه والهرسك": "bosnia", "تايلاند": "thailand",
  "ماليزيا": "malaysia", "المالديف": "maldives", "ارمينيا": "armenia", "استراليا": "australia",
  "البانيا": "albania", "المانيا": "germany", "اوزبكستان": "uzbekistan", "اسبانيا": "spain",
  "ايطاليا": "italy", "الاردن": "jordan", "الامارات العربيه المتحده": "uae", "البرتغال": "portugal",
  "الصين": "china", "الفلبين": "philippines", "الكويت": "kuwait",
  "المجر": "hungary", "المغرب": "morocco", "النمسا": "austria", "الهند": "india",
  "الولايات المتحده": "usa", "اليابان": "japan", "اليونان": "greece", "بولندا": "poland",
  "تنزانيا": "tanzania", "تونس": "tunisia", "جنوب افريقيا": "south-africa", "روسيا": "russia",
  "سريلانكا": "sri-lanka", "سنغافوره": "singapore", "سويسرا": "switzerland", "سيشل": "seychelles",
  "صربيا": "serbia", "عمان": "oman", "فرنسا": "france", "قبرص": "cyprus", "قطر": "qatar",
  "كازاخستان": "kazakhstan", "كندا": "canada", "كوريا الجنوبيه": "south-korea", "كينيا": "kenya",
  "لبنان": "lebanon", "موريشيوس": "mauritius", "نيبال": "nepal", "هولندا": "netherlands",
  "هونغ كونغ": "hong-kong", "السودان": "sudan", "شنغن (اوروبا)": "france",
};

export function landmarkFor(country: string): string {
  const key = country.normalize("NFKC").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/[ً-ْ]/g, "").trim();
  const id = IDS[key];
  return id ? `/screen-landmarks/${id}.webp` : "/screen-landmarks/journey.svg";
}
