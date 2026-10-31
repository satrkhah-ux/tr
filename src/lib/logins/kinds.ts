/** «حسابات الدخول»: what kind of login a row is — the filter chips and the form's choice */
export const LOGIN_KINDS = [
  ["social", "سوشل ميديا"],
  ["website", "موقع"],
  ["system", "نظام"],
  ["booking", "شركة حجوزات"],
  ["email", "بريد"],
  ["other", "أخرى"],
] as const;
export type LoginKind = (typeof LOGIN_KINDS)[number][0];
