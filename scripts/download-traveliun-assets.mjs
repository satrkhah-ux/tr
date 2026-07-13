import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const assetDir = path.join(root, "public", "traveliun");

const assets = [
  ["https://app.traveliun.com/media/logos/logo_en.svg", "logo-en.svg"],
  ["https://app.traveliun.com/media/auth/background.webp", "auth-background.webp"],
  ["https://app.traveliun.com/favicon.ico", "favicon.ico"],
];

await mkdir(assetDir, { recursive: true });

let downloaded = 0;
for (const [url, filename] of assets) {
  const response = await fetch(url);
  if (!response.ok) {
    console.warn(`Skipped ${url}: ${response.status}`);
    continue;
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  await writeFile(path.join(assetDir, filename), bytes);
  downloaded += 1;
}

console.log(JSON.stringify({ downloaded, assetDir }, null, 2));
