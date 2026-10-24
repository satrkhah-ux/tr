/** «ذاكرة مُراد»'s subjects and shape — no server code, so the settings page can show them (knowledge.ts folds them). */
export const TOPICS = { visa: "التأشيرات", package: "البكجات والوجهات", flight: "الطيران", hotel: "الفنادق", transport: "المواصلات", general: "عام وسياسات" } as const;
export type Topic = keyof typeof TOPICS;
export type Knowledge = { at: string | null; topics: Partial<Record<Topic, { at: string; lessons: number; items: { q: string; a: string }[] }>> };
