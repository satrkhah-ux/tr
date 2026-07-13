/**
 * PalmX Fiat On-Ramp — Bank & Country Relational Database
 * Covers: 22 Arab League nations + 8 high-crypto-volume global markets
 * Total: 300 banks across 30 countries
 */

// ─── Types ─────────────────────────────────────────────────────────────────────
export type CardType       = "visa" | "mastercard" | "local";
export type BankStatus     = "active" | "suspended";
export type CountryStatus  = "active" | "suspended";
export type CountryRegion  = "arab" | "global";
export type GatewayType    = "stripe" | "checkout" | "adyen" | "tap" | "fawry" | "paystack" | "local";

export interface Bank {
  id:        string;
  name:      string;
  swift:     string;
  cardTypes: CardType[];
  gateway:   GatewayType;
  status:    BankStatus;
}

export interface SupportedCountry {
  code:         string;        // ISO 3166-1 alpha-2
  name:         string;
  nameAr:       string;
  region:       CountryRegion;
  currency:     string;
  currencyCode: string;
  flagEmoji:    string;
  gateway:      GatewayType;   // default processor for this country
  status:       CountryStatus;
  banks:        Bank[];
}

// ─── Factory helper ────────────────────────────────────────────────────────────
function mkBanks(
  cc: string,
  list: Array<[string, string, CardType[], GatewayType]>,
): Bank[] {
  return list.map(([name, swift, cardTypes, gateway], i) => ({
    id:        `${cc.toLowerCase()}-bank-${i + 1}`,
    name,
    swift,
    cardTypes,
    gateway,
    status: "active" as BankStatus,
  }));
}

// ─── Default Country + Bank Data ───────────────────────────────────────────────
export const DEFAULT_COUNTRIES: SupportedCountry[] = [

  // ══════════════════════════════════════════════════════════════════════════════
  //  ARAB LEAGUE  (22 member states)
  // ══════════════════════════════════════════════════════════════════════════════

  {
    code: "IQ", name: "Iraq", nameAr: "العراق",
    region: "arab", currency: "Iraqi Dinar", currencyCode: "IQD",
    flagEmoji: "🇮🇶", gateway: "local", status: "active",
    banks: mkBanks("IQ", [
      ["Bank of Baghdad",                  "BAGBIQBA", ["visa", "mastercard"],         "local"],
      ["Trade Bank of Iraq (TBI)",         "TBIQIQBA", ["visa", "mastercard", "local"], "local"],
      ["Rafidain Bank",                    "RAFBIQBA", ["local"],                       "local"],
      ["Rasheed Bank",                     "RSHBIQBA", ["local"],                       "local"],
      ["National Bank of Iraq",            "NBIQIQBA", ["visa", "mastercard"],          "local"],
      ["Mesopotamia Bank",                 "MESQIQBA", ["visa", "mastercard"],          "local"],
      ["Investment Bank of Iraq",          "INVBIQBA", ["visa", "local"],               "local"],
      ["Commercial Bank of Iraq",          "CBIQIQBA", ["visa", "mastercard"],          "local"],
      ["Iraqi Islamic Bank",               "IISBIQBA", ["local"],                       "local"],
      ["Babylon Bank",                     "BABLIQBA", ["visa", "mastercard"],          "local"],
    ]),
  },

  {
    code: "SA", name: "Saudi Arabia", nameAr: "المملكة العربية السعودية",
    region: "arab", currency: "Saudi Riyal", currencyCode: "SAR",
    flagEmoji: "🇸🇦", gateway: "tap", status: "active",
    banks: mkBanks("SA", [
      ["Al Rajhi Bank",                    "RJHIBSSA", ["visa", "mastercard", "local"], "tap"],
      ["Saudi National Bank (SNB)",        "NCBKSA33", ["visa", "mastercard", "local"], "tap"],
      ["Riyad Bank",                       "RIBLSA22", ["visa", "mastercard", "local"], "tap"],
      ["Saudi British Bank (SABB)",        "SABBSA22", ["visa", "mastercard"],          "tap"],
      ["Alinma Bank",                      "INMASAJE", ["visa", "mastercard", "local"], "tap"],
      ["Arab National Bank",               "ARNBSA31", ["visa", "mastercard", "local"], "tap"],
      ["Banque Saudi Fransi",              "BSFRSAJE", ["visa", "mastercard"],          "tap"],
      ["Al Bilad Bank",                    "ALBISAJE", ["visa", "mastercard", "local"], "tap"],
      ["Saudi Investment Bank",            "SIBCSAJE", ["visa", "mastercard"],          "tap"],
      ["Gulf International Bank",          "GIBSSAJE", ["visa", "mastercard"],          "tap"],
    ]),
  },

  {
    code: "AE", name: "United Arab Emirates", nameAr: "الإمارات العربية المتحدة",
    region: "arab", currency: "UAE Dirham", currencyCode: "AED",
    flagEmoji: "🇦🇪", gateway: "checkout", status: "active",
    banks: mkBanks("AE", [
      ["Emirates NBD",                     "EBILAEAD", ["visa", "mastercard", "local"], "checkout"],
      ["First Abu Dhabi Bank (FAB)",        "NBADAEAA", ["visa", "mastercard", "local"], "checkout"],
      ["Abu Dhabi Commercial Bank (ADCB)", "ADCBAEAA", ["visa", "mastercard", "local"], "checkout"],
      ["Dubai Islamic Bank (DIB)",         "DUIBAEAD", ["visa", "mastercard", "local"], "checkout"],
      ["Mashreq Bank",                     "BOMLAEAD", ["visa", "mastercard"],          "checkout"],
      ["RAKBANK",                          "NRAKAEAK", ["visa", "mastercard"],          "checkout"],
      ["Commercial Bank of Dubai (CBD)",   "CBDUAEAD", ["visa", "mastercard"],          "checkout"],
      ["Union National Bank (UNB)",        "UNBAAEAA", ["visa", "mastercard"],          "checkout"],
      ["HSBC UAE",                         "BBMEAEAD", ["visa", "mastercard"],          "checkout"],
      ["Standard Chartered UAE",           "SCBLAEADX", ["visa", "mastercard"],         "checkout"],
    ]),
  },

  {
    code: "EG", name: "Egypt", nameAr: "مصر",
    region: "arab", currency: "Egyptian Pound", currencyCode: "EGP",
    flagEmoji: "🇪🇬", gateway: "fawry", status: "active",
    banks: mkBanks("EG", [
      ["National Bank of Egypt (NBE)",     "NBEGEGCX", ["visa", "mastercard", "local"], "fawry"],
      ["Banque Misr",                      "BMISEGCX", ["visa", "mastercard", "local"], "fawry"],
      ["Commercial International Bank",    "CIBEEGCX", ["visa", "mastercard"],          "checkout"],
      ["QNB Alahli",                       "QNBAEGCX", ["visa", "mastercard"],          "checkout"],
      ["HSBC Egypt",                       "BARCEGCX", ["visa", "mastercard"],          "checkout"],
      ["Arab African International Bank",  "AAIBEGCX", ["visa", "mastercard"],          "fawry"],
      ["Banque du Caire",                  "BDCAEGCX", ["visa", "mastercard", "local"], "fawry"],
      ["Export Development Bank (EBank)",  "EDBKEGCX", ["visa", "local"],               "fawry"],
      ["Ahli United Bank Egypt",           "AUBIEGCX", ["visa", "mastercard"],          "checkout"],
      ["Credit Agricole Egypt",            "CRDAEGCX", ["visa", "mastercard"],          "checkout"],
    ]),
  },

  {
    code: "KW", name: "Kuwait", nameAr: "الكويت",
    region: "arab", currency: "Kuwaiti Dinar", currencyCode: "KWD",
    flagEmoji: "🇰🇼", gateway: "tap", status: "active",
    banks: mkBanks("KW", [
      ["National Bank of Kuwait (NBK)",    "NBOKKWKW", ["visa", "mastercard", "local"], "tap"],
      ["Kuwait Finance House (KFH)",       "KFHOKWKW", ["visa", "mastercard", "local"], "tap"],
      ["Gulf Bank",                        "GULFKWKW", ["visa", "mastercard"],          "tap"],
      ["Commercial Bank of Kuwait (CBK)",  "COMBKWKW", ["visa", "mastercard"],          "tap"],
      ["Al Ahli Bank of Kuwait",           "ABLKKWKW", ["visa", "mastercard", "local"], "tap"],
      ["Boubyan Bank",                     "BOUBKWKW", ["visa", "mastercard"],          "tap"],
      ["Warba Bank",                       "WARBKWKW", ["visa", "mastercard"],          "tap"],
      ["Burgan Bank",                      "BURGKWKW", ["visa", "mastercard"],          "tap"],
      ["Kuwait International Bank (KIB)",  "KIBKKWKW", ["visa", "local"],               "tap"],
      ["Ahli United Bank Kuwait",          "AUBKKWKW", ["visa", "mastercard"],          "tap"],
    ]),
  },

  {
    code: "QA", name: "Qatar", nameAr: "قطر",
    region: "arab", currency: "Qatari Riyal", currencyCode: "QAR",
    flagEmoji: "🇶🇦", gateway: "checkout", status: "active",
    banks: mkBanks("QA", [
      ["Qatar National Bank (QNB)",        "QNBAQAQA", ["visa", "mastercard", "local"], "checkout"],
      ["Qatar Islamic Bank (QIB)",         "QISBQAQA", ["visa", "mastercard"],          "checkout"],
      ["Commercial Bank of Qatar (CBQ)",   "CBQQQA22", ["visa", "mastercard"],          "checkout"],
      ["Ahli Bank Qatar",                  "QAAQQA22", ["visa", "mastercard"],          "checkout"],
      ["Masraf Al Rayan",                  "MRAEQAQA", ["visa", "mastercard"],          "checkout"],
      ["Doha Bank",                        "DOHBQAQA", ["visa", "mastercard"],          "checkout"],
      ["Qatar International Islamic Bank", "QIIBQAQA", ["visa", "mastercard"],          "checkout"],
      ["Al Khalij Commercial Bank",        "AKCBQAQA", ["visa", "mastercard"],          "checkout"],
      ["Dukhan Bank",                      "IBDIQAQA", ["visa", "mastercard"],          "checkout"],
      ["Arab Bank Qatar",                  "ARZBQAQA", ["visa", "mastercard"],          "checkout"],
    ]),
  },

  {
    code: "JO", name: "Jordan", nameAr: "الأردن",
    region: "arab", currency: "Jordanian Dinar", currencyCode: "JOD",
    flagEmoji: "🇯🇴", gateway: "checkout", status: "active",
    banks: mkBanks("JO", [
      ["Arab Bank",                        "ARABJOAX", ["visa", "mastercard"],          "checkout"],
      ["Housing Bank for Trade & Finance", "HOBJJO22", ["visa", "mastercard", "local"], "checkout"],
      ["Jordan Kuwait Bank (JKB)",         "JOKBJO22", ["visa", "mastercard"],          "checkout"],
      ["Cairo Amman Bank",                 "CAMBJOA1", ["visa", "mastercard"],          "checkout"],
      ["Bank of Jordan",                   "BOJOJO22", ["visa", "mastercard"],          "checkout"],
      ["Jordan Ahli Bank",                 "AHLJJO22", ["visa", "mastercard"],          "checkout"],
      ["Arab Jordan Investment Bank",      "AJIBJOA1", ["visa", "mastercard"],          "checkout"],
      ["Capital Bank of Jordan",           "CABJJO22", ["visa", "mastercard"],          "checkout"],
      ["Invest Bank Jordan",               "INVBJO22", ["visa", "local"],               "checkout"],
      ["Union Bank Jordan",                "UNBKJO22", ["visa", "mastercard"],          "checkout"],
    ]),
  },

  {
    code: "MA", name: "Morocco", nameAr: "المملكة المغربية",
    region: "arab", currency: "Moroccan Dirham", currencyCode: "MAD",
    flagEmoji: "🇲🇦", gateway: "checkout", status: "active",
    banks: mkBanks("MA", [
      ["Attijariwafa Bank",                "BCMAMAMC", ["visa", "mastercard"],          "checkout"],
      ["Banque Centrale Populaire (BCP)",  "BCPOMAMC", ["visa", "mastercard", "local"], "checkout"],
      ["BMCE Bank (Bank of Africa)",       "BMCEXXXX", ["visa", "mastercard"],          "checkout"],
      ["BMCI",                             "BMCIMAMC", ["visa", "mastercard"],          "checkout"],
      ["CIH Bank",                         "CIHBMAMC", ["visa", "mastercard"],          "checkout"],
      ["Crédit Agricole du Maroc",         "CADUMAMC", ["visa", "mastercard", "local"], "checkout"],
      ["Crédit du Maroc",                  "CDMAMAMC", ["visa", "mastercard"],          "checkout"],
      ["Al Barid Bank",                    "BARIMAMC", ["visa", "mastercard", "local"], "checkout"],
      ["CFG Bank",                         "CFGBMAMC", ["visa", "mastercard"],          "checkout"],
      ["Société Générale Maroc",           "SOGEMAMX", ["visa", "mastercard"],          "checkout"],
    ]),
  },

  {
    code: "DZ", name: "Algeria", nameAr: "الجزائر",
    region: "arab", currency: "Algerian Dinar", currencyCode: "DZD",
    flagEmoji: "🇩🇿", gateway: "local", status: "active",
    banks: mkBanks("DZ", [
      ["Banque Extérieure d'Algérie (BEA)", "BEAAAFBM", ["visa", "mastercard", "local"], "local"],
      ["Banque Nationale d'Algérie (BNA)",  "BNAAAFBM", ["visa", "mastercard", "local"], "local"],
      ["Crédit Populaire d'Algérie (CPA)",  "CPALAFBM", ["visa", "local"],               "local"],
      ["BADR",                              "BADRAFBM", ["visa", "local"],               "local"],
      ["BDL",                               "BDLLAFBM", ["visa", "local"],               "local"],
      ["Société Générale Algérie",          "SOGEAFBM", ["visa", "mastercard"],          "checkout"],
      ["BNP Paribas El Djazaïr",            "BNPEAFBM", ["visa", "mastercard"],          "checkout"],
      ["Al Baraka Bank Algeria",            "ARBKDZBM", ["visa", "local"],               "local"],
      ["Algerian Gulf Bank (AGB)",          "AGBKAFBM", ["visa", "mastercard"],          "local"],
      ["Arab Bank Algeria",                 "ARZBDZBM", ["visa", "mastercard"],          "checkout"],
    ]),
  },

  {
    code: "LB", name: "Lebanon", nameAr: "لبنان",
    region: "arab", currency: "Lebanese Pound", currencyCode: "LBP",
    flagEmoji: "🇱🇧", gateway: "checkout", status: "active",
    banks: mkBanks("LB", [
      ["Byblos Bank",                      "BYBALBBE", ["visa", "mastercard"],          "checkout"],
      ["BLOM Bank",                        "BLOMLBBE", ["visa", "mastercard"],          "checkout"],
      ["Bank Audi",                        "AUDBLBBE", ["visa", "mastercard"],          "checkout"],
      ["Fransabank",                       "FRANLBBE", ["visa", "mastercard"],          "checkout"],
      ["BankMed",                          "MEDALBBE", ["visa", "mastercard"],          "checkout"],
      ["Credit Libanais",                  "CRDLLBBE", ["visa", "mastercard"],          "checkout"],
      ["IBL Bank",                         "IBLELBBE", ["visa", "mastercard"],          "checkout"],
      ["Bank of Beirut",                   "BNLBLBBE", ["visa", "local"],               "checkout"],
      ["First National Bank Lebanon",      "FNBLLBBE", ["visa", "mastercard"],          "checkout"],
      ["SGBL",                             "SGBLLBBE", ["visa", "mastercard"],          "checkout"],
    ]),
  },

  {
    code: "SY", name: "Syria", nameAr: "سوريا",
    region: "arab", currency: "Syrian Pound", currencyCode: "SYP",
    flagEmoji: "🇸🇾", gateway: "local", status: "active",
    banks: mkBanks("SY", [
      ["Commercial Bank of Syria",          "COBKSYDA", ["local"],               "local"],
      ["Bank of Syria and Overseas",        "BSOSSYDA", ["visa", "local"],       "local"],
      ["Al-Baraka Bank Syria",              "ARBKSYDA", ["visa", "local"],       "local"],
      ["Fransabank Syria",                  "FRANSYDA", ["visa", "local"],       "local"],
      ["Byblos Bank Syria",                 "BYBASYDE", ["visa", "local"],       "local"],
      ["International Bank for Commerce",   "IBCSSYDA", ["visa", "mastercard"], "local"],
      ["Cham Bank",                         "CHAMSYDA", ["visa", "local"],       "local"],
      ["Syria Gulf Bank",                   "SGBLSYDA", ["visa", "mastercard"], "local"],
      ["Arab Bank Syria",                   "ARZBSYDA", ["visa", "mastercard"], "local"],
      ["Syria International Islamic Bank",  "SIIBSYDA", ["local"],               "local"],
    ]),
  },

  {
    code: "LY", name: "Libya", nameAr: "ليبيا",
    region: "arab", currency: "Libyan Dinar", currencyCode: "LYD",
    flagEmoji: "🇱🇾", gateway: "local", status: "active",
    banks: mkBanks("LY", [
      ["Wahda Bank",                        "WAHBLYLA", ["visa", "mastercard"], "local"],
      ["Sahara Bank",                       "SAHRLYCA", ["visa", "mastercard"], "local"],
      ["Bank of Commerce & Development",    "BCDLLYCA", ["visa", "mastercard"], "local"],
      ["Al-Ahly Bank Libya",                "AHLYLYLY", ["visa", "local"],       "local"],
      ["Jumhouria Bank",                    "JUMBLYLJ", ["visa", "mastercard"], "local"],
      ["North Africa Bank",                 "NABLLYCA", ["local"],               "local"],
      ["Mediterranean Bank Libya",          "MDBLLYCA", ["visa", "mastercard"], "local"],
      ["National Commercial Bank Libya",    "NCBLLYLA", ["visa", "local"],       "local"],
      ["First Gulf Libyan Bank",            "FGLBLYLA", ["visa", "mastercard"], "local"],
      ["Al Waha Bank",                      "WAHBLYCA", ["visa", "local"],       "local"],
    ]),
  },

  {
    code: "TN", name: "Tunisia", nameAr: "تونس",
    region: "arab", currency: "Tunisian Dinar", currencyCode: "TND",
    flagEmoji: "🇹🇳", gateway: "checkout", status: "active",
    banks: mkBanks("TN", [
      ["BIAT",                              "BIATTNTT", ["visa", "mastercard"],          "checkout"],
      ["Attijari Bank Tunisia",             "BSTUTNTT", ["visa", "mastercard"],          "checkout"],
      ["Amen Bank",                         "AMEBTNTT", ["visa", "mastercard"],          "checkout"],
      ["STB",                               "STBKTNTT", ["visa", "mastercard", "local"], "checkout"],
      ["Banque Nationale Agricole (BNA)",   "BNTUTNTT", ["visa", "mastercard", "local"], "checkout"],
      ["Banque de l'Habitat (BH)",          "BHCOTNTT", ["visa", "mastercard"],          "checkout"],
      ["UIB",                               "UIBKTNTT", ["visa", "mastercard"],          "checkout"],
      ["Arab Tunisian Bank (ATB)",          "ATUBTNTX", ["visa", "mastercard"],          "checkout"],
      ["Banque de Tunisie (BT)",            "BTUNTNTT", ["visa", "mastercard"],          "checkout"],
      ["Banque Zitouna",                    "BZITTNTT", ["visa", "local"],               "checkout"],
    ]),
  },

  {
    code: "SD", name: "Sudan", nameAr: "السودان",
    region: "arab", currency: "Sudanese Pound", currencyCode: "SDG",
    flagEmoji: "🇸🇩", gateway: "local", status: "active",
    banks: mkBanks("SD", [
      ["Bank of Khartoum",                  "BKSUSDXX", ["visa", "mastercard"], "local"],
      ["Omdurman National Bank",            "OMNBSDXX", ["visa", "local"],       "local"],
      ["Al Baraka Bank Sudan",              "ARBKSDKH", ["visa", "local"],       "local"],
      ["Sudanese Egyptian Bank",            "SUEBSDXX", ["visa", "mastercard"], "local"],
      ["National Bank of Sudan",            "NABSSDXX", ["local"],               "local"],
      ["Commercial Bank of Sudan",          "COBSSDKH", ["visa", "local"],       "local"],
      ["Saudi Sudanese Bank",               "SAUSSDKH", ["visa", "mastercard"], "local"],
      ["Agricultural Bank of Sudan",        "AMSASDKH", ["local"],               "local"],
      ["Blue Nile Mashreq Bank",            "BNMBSDXX", ["visa", "local"],       "local"],
      ["Tadamon Islamic Bank",              "TADMSDKH", ["local"],               "local"],
    ]),
  },

  {
    code: "OM", name: "Oman", nameAr: "سلطنة عُمان",
    region: "arab", currency: "Omani Rial", currencyCode: "OMR",
    flagEmoji: "🇴🇲", gateway: "tap", status: "active",
    banks: mkBanks("OM", [
      ["Bank Muscat",                       "BMUSOMRX", ["visa", "mastercard", "local"], "tap"],
      ["National Bank of Oman (NBO)",       "NBOMOM22", ["visa", "mastercard"],          "tap"],
      ["Bank Dhofar",                       "BDOOOMRX", ["visa", "mastercard"],          "tap"],
      ["HSBC Oman",                         "BBMEOMRX", ["visa", "mastercard"],          "checkout"],
      ["Ahli Bank Oman",                    "AHLIOMRX", ["visa", "mastercard"],          "tap"],
      ["Oman Arab Bank (OAB)",              "OABOROMR", ["visa", "local"],               "tap"],
      ["First Abu Dhabi Bank Oman",         "NBADOMAN", ["visa", "mastercard"],          "checkout"],
      ["Sohar International",               "SOHIOMRX", ["visa", "mastercard"],          "tap"],
      ["Al Izz Islamic Bank",               "AIZBOMRX", ["visa", "local"],               "tap"],
      ["Bank Nizwa",                        "BNIZOMRX", ["visa", "mastercard"],          "tap"],
    ]),
  },

  {
    code: "BH", name: "Bahrain", nameAr: "البحرين",
    region: "arab", currency: "Bahraini Dinar", currencyCode: "BHD",
    flagEmoji: "🇧🇭", gateway: "checkout", status: "active",
    banks: mkBanks("BH", [
      ["National Bank of Bahrain (NBB)",    "NBOBBHBM", ["visa", "mastercard", "local"], "checkout"],
      ["Ahli United Bank Bahrain",          "AUBBBHBM", ["visa", "mastercard"],          "checkout"],
      ["BBK",                               "BBKUBHBM", ["visa", "mastercard"],          "checkout"],
      ["Al Salam Bank",                     "ASLMBHBM", ["visa", "local"],               "checkout"],
      ["Khaleeji Commercial Bank",          "KHCBBHBM", ["visa", "mastercard"],          "checkout"],
      ["Ithmaar Bank",                      "ITHMBHBM", ["visa", "local"],               "checkout"],
      ["Gulf International Bank (GIB)",     "GIBBGB22", ["visa", "mastercard"],          "checkout"],
      ["Standard Chartered Bahrain",        "SCBLBHBM", ["visa", "mastercard"],          "checkout"],
      ["HSBC Bahrain",                      "BBMEBHBM", ["visa", "mastercard"],          "checkout"],
      ["Al Baraka Banking Group",           "ARBKBHBM", ["visa", "local"],               "checkout"],
    ]),
  },

  {
    code: "PS", name: "Palestine", nameAr: "فلسطين",
    region: "arab", currency: "Israeli New Shekel", currencyCode: "ILS",
    flagEmoji: "🇵🇸", gateway: "local", status: "active",
    banks: mkBanks("PS", [
      ["Bank of Palestine",                 "PALEPS22", ["visa", "mastercard"], "local"],
      ["Arab Bank Palestine",               "ARZBPS22", ["visa", "mastercard"], "local"],
      ["Cairo Amman Bank Palestine",        "CAMBA2AM", ["visa", "mastercard"], "local"],
      ["Palestine Islamic Bank",            "PIBLPS22", ["visa", "local"],       "local"],
      ["Al Quds Bank",                      "ALQDPS22", ["visa", "local"],       "local"],
      ["Palestine Investment Bank (PIB)",   "PAIBPS22", ["visa", "mastercard"], "local"],
      ["Arab Islamic Bank Palestine",       "AIBLPS22", ["visa", "local"],       "local"],
      ["Jordan Ahli Bank Palestine",        "AHLJPS22", ["visa", "mastercard"], "local"],
      ["Palestine Commercial Bank",         "PCBLPS22", ["visa", "local"],       "local"],
      ["Bank of Jordan Palestine",          "BOJOPS22", ["visa", "mastercard"], "local"],
    ]),
  },

  {
    code: "SO", name: "Somalia", nameAr: "الصومال",
    region: "arab", currency: "Somali Shilling", currencyCode: "SOS",
    flagEmoji: "🇸🇴", gateway: "local", status: "active",
    banks: mkBanks("SO", [
      ["Premier Bank Somalia",              "PRMBSOM1", ["visa", "mastercard"], "local"],
      ["Salaam Somali Bank",                "SALSSOBS", ["visa", "local"],       "local"],
      ["International Bank of Commerce",    "IBCOSOM1", ["visa", "mastercard"], "local"],
      ["Dahabshiil Bank International",     "DHIBSOM1", ["local"],               "local"],
      ["Amal Bank Somalia",                 "AMALSOM1", ["visa", "local"],       "local"],
      ["Hormuud Bank",                      "HORMSOM1", ["local"],               "local"],
      ["East Africa Bank Somalia",          "EABKSOM1", ["visa", "mastercard"], "local"],
      ["Kaah Islamic Microfinance",         "KAAHSOM1", ["local"],               "local"],
      ["Amana Bank Somalia",                "AMANSOM1", ["visa", "local"],       "local"],
      ["Taaj Bank Somalia",                 "TAAJSOM1", ["visa", "local"],       "local"],
    ]),
  },

  {
    code: "YE", name: "Yemen", nameAr: "اليمن",
    region: "arab", currency: "Yemeni Rial", currencyCode: "YER",
    flagEmoji: "🇾🇪", gateway: "local", status: "active",
    banks: mkBanks("YE", [
      ["Yemen Bank for Reconstruction",     "YBRDYEYE", ["visa", "local"],               "local"],
      ["National Bank of Yemen",            "NBYSYEYE", ["visa", "local"],               "local"],
      ["International Bank of Yemen (IBY)", "IBYYYEYE", ["visa", "mastercard"],          "local"],
      ["Commercial Bank of Yemen",          "CBMBYEYE", ["visa", "local"],               "local"],
      ["Al Ahly Bank Yemen",                "AAHLYEYE", ["visa", "local"],               "local"],
      ["Credit Agricole Yemen",             "AGRIYEYE", ["visa", "mastercard"],          "local"],
      ["Saba Islamic Bank",                 "SAIBYYEY", ["local"],                       "local"],
      ["Shamil Bank Yemen",                 "SHAMYEYE", ["visa", "local"],               "local"],
      ["First Microfinance Bank Yemen",     "FMFBYEYE", ["local"],                       "local"],
      ["Yemen Gulf Bank",                   "YGBLYYEY", ["visa", "mastercard"],          "local"],
    ]),
  },

  {
    code: "MR", name: "Mauritania", nameAr: "موريتانيا",
    region: "arab", currency: "Mauritanian Ouguiya", currencyCode: "MRU",
    flagEmoji: "🇲🇷", gateway: "local", status: "active",
    banks: mkBanks("MR", [
      ["BMCI Mauritanie",                   "BMCIMRNO", ["visa", "mastercard"], "local"],
      ["Banque Nationale de Mauritanie",    "BNMMRNO1", ["visa", "local"],       "local"],
      ["Générale de Banque de Mauritanie",  "GBMMRNO1", ["visa", "mastercard"], "local"],
      ["BAMIS",                             "BAMSMRNO", ["visa", "local"],       "local"],
      ["Attijari Bank Mauritanie",          "BCMAMRNO", ["visa", "mastercard"], "local"],
      ["BCI Mauritanie",                    "BCIMMRNO", ["visa", "local"],       "local"],
      ["Chinguitty Bank",                   "CHNGMRNO", ["local"],               "local"],
      ["Orabank Mauritanie",                "ORABMRNO", ["visa", "mastercard"], "local"],
      ["Société Générale Mauritanie",       "SOGEMRNO", ["visa", "mastercard"], "local"],
      ["Al Mourabba Bank",                  "ALMBMRNO", ["visa", "local"],       "local"],
    ]),
  },

  {
    code: "DJ", name: "Djibouti", nameAr: "جيبوتي",
    region: "arab", currency: "Djiboutian Franc", currencyCode: "DJF",
    flagEmoji: "🇩🇯", gateway: "local", status: "active",
    banks: mkBanks("DJ", [
      ["BCIMR",                             "BCIMDJDJ", ["visa", "mastercard"], "local"],
      ["Exim Bank Djibouti",                "EXIMDJDJ", ["visa", "mastercard"], "local"],
      ["CAC International Bank",            "CACIDJDJ", ["visa", "mastercard"], "local"],
      ["East Africa Bank Djibouti",         "EABKDJDJ", ["visa", "mastercard"], "local"],
      ["Saba Islamic Bank Djibouti",        "SAIBDJDJ", ["visa", "local"],       "local"],
      ["International Commercial Bank",     "ICMBDJDJ", ["visa", "mastercard"], "local"],
      ["BDCD",                              "BDCDDJDJ", ["local"],               "local"],
      ["Salama African Bank",               "SAABDJDJ", ["visa", "local"],       "local"],
      ["Unity National Bank Djibouti",      "UNMBDJDJ", ["local"],               "local"],
      ["Tropical Commercial Bank",          "TCBDDJDJ", ["visa", "local"],       "local"],
    ]),
  },

  {
    code: "KM", name: "Comoros", nameAr: "جزر القمر",
    region: "arab", currency: "Comorian Franc", currencyCode: "KMF",
    flagEmoji: "🇰🇲", gateway: "local", status: "active",
    banks: mkBanks("KM", [
      ["Banque pour l'Industrie et le Commerce (BIC)", "BICOKMMO", ["visa", "mastercard"], "local"],
      ["Exim Bank Comoros",                 "EXIMKM01", ["visa", "mastercard"], "local"],
      ["MECK",                              "MECKKM01", ["local"],               "local"],
      ["Banque de Développement des Comores","BDCOKM01", ["local"],               "local"],
      ["Credit Union Comoros",              "CUNIKM01", ["local"],               "local"],
      ["Al Flan Microfinance",              "ALFNKM01", ["local"],               "local"],
      ["SNPSF",                             "SNPSKM01", ["local"],               "local"],
      ["Sanduk Islamic Microfinance",       "SANDKM01", ["local"],               "local"],
      ["Banque Populaire des Comores",      "BPOPKM01", ["visa", "local"],       "local"],
      ["Pacific Bank Comoros",              "PACBKM01", ["visa", "mastercard"], "local"],
    ]),
  },

  // ══════════════════════════════════════════════════════════════════════════════
  //  GLOBAL HIGH-VOLUME CRYPTO MARKETS  (8 countries)
  // ══════════════════════════════════════════════════════════════════════════════

  {
    code: "US", name: "United States", nameAr: "الولايات المتحدة",
    region: "global", currency: "US Dollar", currencyCode: "USD",
    flagEmoji: "🇺🇸", gateway: "stripe", status: "active",
    banks: mkBanks("US", [
      ["Chase (JPMorgan Chase)",            "CHASUS33", ["visa", "mastercard"], "stripe"],
      ["Bank of America",                   "BOFAUS3N", ["visa", "mastercard"], "stripe"],
      ["Wells Fargo",                        "WFBIUS6S", ["visa", "mastercard"], "stripe"],
      ["Citibank",                           "CITIUS33", ["visa", "mastercard"], "stripe"],
      ["US Bank",                            "USBKUS44", ["visa", "mastercard"], "stripe"],
      ["Capital One",                        "CFONUS33", ["visa", "mastercard"], "stripe"],
      ["PNC Bank",                           "PNCCUS33", ["visa", "mastercard"], "stripe"],
      ["Goldman Sachs (Marcus)",             "GSCCUS33", ["visa", "mastercard"], "stripe"],
      ["American Express",                   "AESBUS33", ["visa"],               "stripe"],
      ["TD Bank USA",                        "NRTHUS33", ["visa", "mastercard"], "stripe"],
    ]),
  },

  {
    code: "GB", name: "United Kingdom", nameAr: "المملكة المتحدة",
    region: "global", currency: "British Pound", currencyCode: "GBP",
    flagEmoji: "🇬🇧", gateway: "stripe", status: "active",
    banks: mkBanks("GB", [
      ["Barclays",                           "BARCGB22", ["visa", "mastercard"], "stripe"],
      ["HSBC UK",                            "MIDLGB22", ["visa", "mastercard"], "stripe"],
      ["Lloyds Bank",                        "LOYDGB21", ["visa", "mastercard"], "stripe"],
      ["NatWest",                            "NWBKGB2L", ["visa", "mastercard"], "stripe"],
      ["Santander UK",                       "ABBYGB2L", ["visa", "mastercard"], "stripe"],
      ["Standard Chartered UK",              "SCBLGB2L", ["visa", "mastercard"], "stripe"],
      ["Monzo",                              "MONZGB2L", ["mastercard"],         "stripe"],
      ["Revolut",                            "REVOGB21", ["visa", "mastercard"], "stripe"],
      ["Starling Bank",                      "SRLGGB3L", ["mastercard"],         "stripe"],
      ["Halifax",                            "HLFXGB21", ["visa", "mastercard"], "stripe"],
    ]),
  },

  {
    code: "BR", name: "Brazil", nameAr: "البرازيل",
    region: "global", currency: "Brazilian Real", currencyCode: "BRL",
    flagEmoji: "🇧🇷", gateway: "checkout", status: "active",
    banks: mkBanks("BR", [
      ["Itaú Unibanco",                      "ITAUBRSP", ["visa", "mastercard"],          "checkout"],
      ["Banco do Brasil",                    "BRASBRRJ", ["visa", "mastercard"],          "checkout"],
      ["Bradesco",                           "BBDEBRSP", ["visa", "mastercard"],          "checkout"],
      ["Caixa Econômica Federal",            "CEFXBRSP", ["visa", "mastercard", "local"], "checkout"],
      ["Nubank",                             "NUBKBRSB", ["visa", "mastercard"],          "checkout"],
      ["BTG Pactual",                        "BTGPBRSP", ["visa", "mastercard"],          "checkout"],
      ["Santander Brasil",                   "BSCEBRRJ", ["visa", "mastercard"],          "checkout"],
      ["Banco Inter",                        "ITEBBRSP", ["visa", "mastercard"],          "checkout"],
      ["C6 Bank",                            "C6BNBRSP", ["visa", "mastercard"],          "checkout"],
      ["Sicoob",                             "SICOBRSP", ["visa", "mastercard", "local"], "checkout"],
    ]),
  },

  {
    code: "NG", name: "Nigeria", nameAr: "نيجيريا",
    region: "global", currency: "Nigerian Naira", currencyCode: "NGN",
    flagEmoji: "🇳🇬", gateway: "paystack", status: "active",
    banks: mkBanks("NG", [
      ["Zenith Bank",                        "ZEIBNGLA", ["visa", "mastercard"], "paystack"],
      ["Access Bank",                        "ABNGNGLA", ["visa", "mastercard"], "paystack"],
      ["GTBank (Guaranty Trust)",            "GTBINGLA", ["visa", "mastercard"], "paystack"],
      ["First Bank Nigeria",                 "FBNINGLA", ["visa", "mastercard"], "paystack"],
      ["UBA (United Bank for Africa)",       "UNAFNGLA", ["visa", "mastercard"], "paystack"],
      ["FCMB",                               "FCMBNGLA", ["visa", "mastercard"], "paystack"],
      ["Polaris Bank",                       "SKYWNGLA", ["visa", "mastercard"], "paystack"],
      ["Fidelity Bank Nigeria",              "FIDTNGLA", ["visa", "mastercard"], "paystack"],
      ["EcoBank Nigeria",                    "ECOBNGLE", ["visa", "mastercard"], "paystack"],
      ["Keystone Bank",                      "PLNINGLA", ["visa", "mastercard"], "paystack"],
    ]),
  },

  {
    code: "TR", name: "Turkey", nameAr: "تركيا",
    region: "global", currency: "Turkish Lira", currencyCode: "TRY",
    flagEmoji: "🇹🇷", gateway: "checkout", status: "active",
    banks: mkBanks("TR", [
      ["Ziraat Bank",                        "TCZBTR2A", ["visa", "mastercard"], "checkout"],
      ["İş Bank",                            "ISBKTRIS", ["visa", "mastercard"], "checkout"],
      ["Garanti BBVA",                       "TGBATR2A", ["visa", "mastercard"], "checkout"],
      ["Halkbank",                           "TRHBTR2A", ["visa", "mastercard"], "checkout"],
      ["VakıfBank",                          "TVBATR2A", ["visa", "mastercard"], "checkout"],
      ["Akbank",                             "AKBKTRIS", ["visa", "mastercard"], "checkout"],
      ["Yapı Kredi",                         "YAPITRIS", ["visa", "mastercard"], "checkout"],
      ["DenizBank",                          "DESTTRIS", ["visa", "mastercard"], "checkout"],
      ["QNB Finansbank",                     "FNNBTRIS", ["visa", "mastercard"], "checkout"],
      ["ING Bank Turkey",                    "INGBTRIS", ["visa", "mastercard"], "checkout"],
    ]),
  },

  {
    code: "VN", name: "Vietnam", nameAr: "فيتنام",
    region: "global", currency: "Vietnamese Dong", currencyCode: "VND",
    flagEmoji: "🇻🇳", gateway: "checkout", status: "active",
    banks: mkBanks("VN", [
      ["Vietcombank",                        "BFTVVNVX", ["visa", "mastercard"],          "checkout"],
      ["ACB (Asia Commercial Bank)",         "ASCBVNVX", ["visa", "mastercard"],          "checkout"],
      ["Techcombank",                        "VTCBVNVX", ["visa", "mastercard"],          "checkout"],
      ["BIDV",                               "BIDVVNVX", ["visa", "mastercard", "local"], "checkout"],
      ["VietinBank",                         "ICBVVNVX", ["visa", "mastercard", "local"], "checkout"],
      ["VPBank",                             "VPBKVNVX", ["visa", "mastercard"],          "checkout"],
      ["MB Bank",                            "MSCBVNVX", ["visa", "mastercard"],          "checkout"],
      ["Sacombank",                          "SGTTVNVX", ["visa", "mastercard"],          "checkout"],
      ["HDBank",                             "HDBCVNVX", ["visa", "mastercard"],          "checkout"],
      ["OCB (Orient Commercial Bank)",       "ORCBVNVX", ["visa", "mastercard"],          "checkout"],
    ]),
  },

  {
    code: "ZA", name: "South Africa", nameAr: "جنوب أفريقيا",
    region: "global", currency: "South African Rand", currencyCode: "ZAR",
    flagEmoji: "🇿🇦", gateway: "checkout", status: "active",
    banks: mkBanks("ZA", [
      ["Standard Bank",                      "SBZAZAJJ", ["visa", "mastercard"], "checkout"],
      ["Absa Bank",                          "ABSAZAJJ", ["visa", "mastercard"], "checkout"],
      ["Nedbank",                            "NEDZAZAJJ", ["visa", "mastercard"], "checkout"],
      ["FNB (First National Bank)",          "FIRNZAJJ", ["visa", "mastercard"], "checkout"],
      ["Capitec Bank",                       "CABLZAJJ", ["visa", "mastercard"], "checkout"],
      ["Investec",                           "IVESZAJJ", ["visa", "mastercard"], "checkout"],
      ["African Bank",                       "AFBNZAJJ", ["visa", "mastercard"], "checkout"],
      ["Discovery Bank",                     "DISCZA12", ["visa", "mastercard"], "checkout"],
      ["Bidvest Bank",                       "BVESZAJJ", ["visa", "mastercard"], "checkout"],
      ["TymeBank",                           "TYMEZAXX", ["visa", "mastercard"], "checkout"],
    ]),
  },

  {
    code: "IN", name: "India", nameAr: "الهند",
    region: "global", currency: "Indian Rupee", currencyCode: "INR",
    flagEmoji: "🇮🇳", gateway: "checkout", status: "active",
    banks: mkBanks("IN", [
      ["State Bank of India (SBI)",          "SBININBB", ["visa", "mastercard", "local"], "checkout"],
      ["HDFC Bank",                          "HDFCINBB", ["visa", "mastercard"],          "checkout"],
      ["ICICI Bank",                         "ICICINBB", ["visa", "mastercard"],          "checkout"],
      ["Axis Bank",                          "AXISINBB", ["visa", "mastercard"],          "checkout"],
      ["Kotak Mahindra Bank",                "KKBKINBB", ["visa", "mastercard"],          "checkout"],
      ["IndusInd Bank",                      "INDBINBB", ["visa", "mastercard"],          "checkout"],
      ["Yes Bank",                           "YESBINBB", ["visa", "mastercard"],          "checkout"],
      ["Bank of Baroda",                     "BARBINBB", ["visa", "mastercard", "local"], "checkout"],
      ["Punjab National Bank (PNB)",         "PUNBINBB", ["visa", "mastercard", "local"], "checkout"],
      ["Canara Bank",                        "CNRBIN56", ["visa", "mastercard", "local"], "checkout"],
    ]),
  },
];
