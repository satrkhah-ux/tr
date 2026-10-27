/** Remove the generic click-to-chat wrapper, keeping the advertised request. */
export function requestText(text: string): string {
  return text.split(/\r?\n/).filter(line => {
    const value = line.replace(/[أإآ]/g, "ا").replace(/[ـ\u064b-\u065f]/g, "").trim();
    return !/^(?:مرحبا بكم في ترافليون|احجز بكجات سفر مع ترافليون)/.test(value)
      && !/^انا مهتم ب\s*[:：]?\s*$/.test(value);
  }).join("\n");
}
