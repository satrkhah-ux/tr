import type { LucideIcon } from "lucide-react";
import {
  Badge,
  BarChart3,
  BookOpen,
  Building2,
  Car,
  Columns3,
  Contact,
  FileText,
  Globe2,
  Handshake,
  Headphones,
  Hotel,
  Package,
  Plane,
  Settings,
  Ship,
  Users,
} from "lucide-react";
import generatedPages from "./traveliun-pages.generated.json";

export type TraveliunColumn = {
  key: string;
  label: string;
  minWidth?: string;
};

export type TraveliunRow = Record<string, string>;

export type TraveliunFilter = {
  label: string;
  value?: string;
};

export type TraveliunLegend = {
  label: string;
  tone: "mint" | "cream";
};

export type TraveliunTablePage = {
  title: string;
  route: string;
  addLabel?: string;
  searchPlaceholder?: string;
  filters?: TraveliunFilter[];
  legends?: TraveliunLegend[];
  columns: TraveliunColumn[];
  rows: TraveliunRow[];
  emptyText?: string;
  extractedText?: string;
};

export type TraveliunNavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  status?: "ready" | "coming-soon";
};

export const traveliunNotice =
  "هذا النظام ما زال تحت التجربة الرجاء تدقيق العروض يدوياً في البداية";

export const traveliunNavItems: TraveliunNavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: BarChart3, status: "ready" },
  { label: "Kanban Board", href: "/kanban-board", icon: Columns3, status: "ready" },
  { label: "Customers", href: "/customers", icon: Contact, status: "ready" },
  { label: "Companies", href: "/companies", icon: Building2, status: "ready" },
  { label: "Companies Visits", href: "/companies-visits", icon: Contact, status: "ready" },
  { label: "Employees", href: "/employees", icon: Users, status: "ready" },
  { label: "Roles", href: "/employees/roles", icon: Users, status: "ready" },
  { label: "Ready Offers", href: "/ready-offers", icon: Package, status: "ready" },
  { label: "Packages", href: "/offers", icon: Package, status: "ready" },
  { label: "Countries", href: "/countries", icon: Globe2, status: "ready" },
  { label: "Cities", href: "/cities", icon: Building2, status: "ready" },
  { label: "Hotels", href: "/hotels", icon: Hotel, status: "ready" },
  { label: "Rooms Types", href: "/rooms-types", icon: Hotel, status: "ready" },
  { label: "Airlines", href: "/airlines", icon: Plane, status: "ready" },
  { label: "Airports Names", href: "/airports", icon: Plane, status: "ready" },
  { label: "Ports Names", href: "/ports", icon: Ship, status: "ready" },
  { label: "Cars Types", href: "/cars-types", icon: Car, status: "ready" },
  { label: "Cars", href: "/cars", icon: Car, status: "ready" },
  { label: "Transfers", href: "/cars/transfers", icon: Car, status: "ready" },
  { label: "Tours", href: "/cars/tours", icon: Globe2, status: "ready" },
  { label: "Drivers", href: "/drivers", icon: Users, status: "ready" },
  { label: "Services", href: "/services", icon: Handshake, status: "ready" },
  { label: "Services Types", href: "/services-types", icon: Handshake, status: "ready" },
  { label: "VISAs", href: "/visas", icon: Badge, status: "ready" },
  { label: "VISAs Types", href: "/visas-types", icon: Badge, status: "ready" },
  { label: "Currencies", href: "/setting/currencies", icon: Settings, status: "ready" },
  { label: "Profits", href: "/setting/profits", icon: Settings, status: "ready" },
  { label: "Statuses Groups", href: "/setting/statuses-groups", icon: Settings, status: "ready" },
  { label: "Statuses", href: "/setting/statuses", icon: Settings, status: "ready" },
  { label: "Suppliers", href: "/setting/suppliers", icon: Users, status: "ready" },
  { label: "Suppliers Preferences", href: "/setting/suppliers-preferences", icon: Settings, status: "ready" },
  { label: "Supervisors", href: "/setting/supervisors", icon: Users, status: "ready" },
  { label: "Terms & Conditions", href: "/offers/terms-and-conditions", icon: FileText, status: "ready" },
  { label: "Offer Includes", href: "/offers/offer-includes", icon: FileText, status: "ready" },
  { label: "Offer Not Includes", href: "/offers/offer-not-includes", icon: FileText, status: "ready" },
  { label: "Customers Care", href: "/customers_care", icon: Headphones, status: "ready" },
  { label: "Customers Care Dashboard", href: "/customers_care/dashboard", icon: BarChart3, status: "ready" },
  { label: "Care Service Type", href: "/customers_care/services", icon: Headphones, status: "ready" },
  { label: "Guide Categories", href: "/guide/categories", icon: BookOpen, status: "ready" },
  { label: "Guide Informations", href: "/guide/informations", icon: BookOpen, status: "ready" },
  { label: "Traveliun Guide", href: "/web-guide", icon: BookOpen, status: "ready" },
];

export const arabicLabels: Record<string, string> = {
  Dashboard: "لوحة التحكم",
  "Kanban Board": "لوحة العروض",
  Customers: "العملاء",
  Companies: "الشركات",
  "Companies Visits": "زيارات الشركات",
  Employees: "الموظفون",
  Roles: "الأدوار",
  "Ready Offers": "العروض الجاهزة",
  Packages: "البكجات",
  Countries: "الدول",
  Cities: "المدن",
  Hotels: "الفنادق",
  "Rooms Types": "أنواع الغرف",
  Airlines: "شركات الطيران",
  "Airports Names": "المطارات",
  "Ports Names": "الموانئ",
  "Cars Types": "أنواع السيارات",
  Cars: "السيارات",
  Transfers: "التوصيلات",
  Tours: "الجولات",
  Drivers: "السائقون",
  Services: "الخدمات",
  "Services Types": "أنواع الخدمات",
  VISAs: "التأشيرات",
  "VISAs Types": "أنواع التأشيرات",
  Currencies: "العملات",
  Profits: "الأرباح",
  "Statuses Groups": "مجموعات الحالات",
  Statuses: "الحالات",
  Suppliers: "الموردون",
  "Suppliers Preferences": "تفضيلات الموردين",
  Supervisors: "المشرفون",
  "Terms & Conditions": "الشروط والأحكام",
  "Offer Includes": "يشمل العرض",
  "Offer Not Includes": "لا يشمل العرض",
  "Customers Care": "رعاية العملاء",
  "Customers Care Dashboard": "لوحة رعاية العملاء",
  "Care Service Type": "نوع خدمة الرعاية",
  "Guide Categories": "تصنيفات الدليل",
  "Guide Informations": "معلومات الدليل",
  "Traveliun Guide": "دليل ترافليون",
  Search: "بحث",
  Add: "إضافة",
  Select: "اختر",
  Apply: "تطبيق",
  "No Data Found": "لا توجد بيانات",
};

export function labelForLanguage(label: string, language: "en" | "ar") {
  return language === "ar" ? arabicLabels[label] ?? label : label;
}

export const fullTraveliunPages = Object.fromEntries(
  (generatedPages as TraveliunTablePage[]).map((page) => [page.route, page]),
) as Record<string, TraveliunTablePage>;

export function getTraveliunPage(route: string) {
  return fullTraveliunPages[route] ?? fullTraveliunPages[`/${route.replace(/^\/+/, "")}`];
}

export const dashboardFilters: TraveliunFilter[] = [
  { label: "Date", value: "2026-07-02 to 2026-07-02" },
  { label: "Employee" },
  { label: "Country" },
];

export const kanbanColumns = [
  {
    title: "Active Not Confirmed",
    cards: [
      { code: "AD-2-1057-20260626", date: "2026-06-26", phone: "0594135050", country: "MALASYIA" },
      { code: "AD-3-7734-20260707", date: "2026-07-07", phone: "0101", country: "Thailand" },
      { code: "AD-1-6746-20251106", date: "2025-11-06", phone: "0594135050", country: "Indonesia" },
      { code: "AD-3-6056-20250912", date: "2025-09-12", phone: "011111101111", country: "Azerbaijan" },
    ],
  },
  {
    title: "Followed up with the client 1",
    cards: [
      { code: "AD-7-0939-20250113", date: "2025-01-13", phone: "0563080050", country: "Thailand" },
      { code: "AD-1-0819-20250101", date: "2025-01-01", phone: "0594135050", country: "MALASYIA" },
    ],
  },
  {
    title: "Confirmed Hotels",
    cards: [
      { code: "AD-2-0533-20250101", date: "2025-01-01", phone: "0594135050", country: "MALASYIA" },
      { code: "AD-1-0315-20241124", date: "2024-11-24", phone: "05013196750", country: "MALASYIA" },
    ],
  },
  {
    title: "Flights",
    cards: [
      { code: "AD-1-0011-20241006", date: "2024-10-06", phone: "535345345345", country: "Indonesia" },
    ],
  },
  {
    title: "Transportation",
    cards: [
      { code: "AD-2-5628-20250820", date: "2025-08-20", phone: "0594135050", country: "MALASYIA" },
    ],
  },
  {
    title: "Completed",
    cards: [
      { code: "AD-3-0006-20241001", date: "2024-10-01", phone: "535345345345", country: "MALASYIA" },
    ],
  },
];

export const guideCategories = [
  {
    title: "الدليل",
    icon: FileText,
    files: ["الدليل السياحي_20240913_66e4b051c4f9a.pdf"],
  },
  {
    title: "فن البيع",
    icon: BookOpen,
    files: [
      "كل ما يخص تركيا الاسئلة الشائعة_20240918_66eb682b60dd7.pdf",
      "الية عمل المبيعات مع الحسابات_20241002_66fcd157e62dd.pdf",
    ],
  },
  {
    title: "تركيا",
    icon: Globe2,
    files: [
      "اهم الاماكن السياحية في اسطنبول_20240918_66ea90583ebba.pdf",
      "جولات في اسطنبول_20240918_66ea90e6a35bb.pdf",
      "اهم العالم السياحية في الشمال التركي_20240918_66ea914a0b0e0.pdf",
    ],
  },
  {
    title: "الإدارة المالية",
    icon: Building2,
    files: ["قواعد متابعة الحسابات والموردين.pdf"],
  },
];
