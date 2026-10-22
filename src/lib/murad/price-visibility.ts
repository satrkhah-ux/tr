/** Remove monetary lines and links to priced documents in price-free answers. */
export function withoutPrices(text: string): string {
  return text.split("\n").filter((line) => !/💰|[$€£]|(?:\d|[٠-٩]).*(?:ريال|دولار|درهم|يورو|SAR|USD|AED|EUR)|(?:السعر|سعره|الإجمالي|التكلفة|رسوم|price|total|cost)\s*[:：]?\s*(?:\d|[٠-٩])|https?:\/\/\S+/i.test(line)).join("\n").trim();
}
