import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const sourcePath = path.join(root, "docs", "research", "traveliun", "full-system-pages.json");
const outputPath = path.join(root, "src", "lib", "traveliun-pages.generated.json");

const pages = JSON.parse(await readFile(sourcePath, "utf8"));

function keyFromHeader(header, index) {
  const slug = header
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || `column_${index + 1}`;
}

function cleanText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

const generated = pages
  .filter((page) => {
    const pathname = new URL(page.url).pathname;
    return pathname !== "/404" && pathname !== "/";
  })
  .map((page) => {
    const pathname = new URL(page.url).pathname;
    const table = page.tables?.find((item) => item.headers?.length) || { headers: [], rows: [] };
    const columns = table.headers.map((header, index) => ({
      key: keyFromHeader(header, index),
      label: cleanText(header),
      minWidth: header.length > 16 ? "180px" : "140px",
    }));
    const rows = (table.rows || []).map((cells) =>
      Object.fromEntries(columns.map((column, index) => [column.key, cleanText(cells[index] || "")])),
    );

    return {
      navText: cleanText(page.navText),
      title: cleanText(page.headings?.[0] || page.title?.replace(" - Traveliun", "")),
      route: pathname,
      searchPlaceholder: "Search",
      addLabel: "Add",
      columns,
      rows,
      emptyText: rows.length ? undefined : "No Data Found",
      extractedText: cleanText(page.text).slice(0, 1200),
    };
  })
  .filter((page, index, all) => all.findIndex((item) => item.route === page.route) === index)
  .sort((a, b) => a.route.localeCompare(b.route));

await writeFile(outputPath, `${JSON.stringify(generated, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ pages: generated.length, outputPath }, null, 2));
