// Generates the PWA icon set into public/icons/ from the Traveliun logo:
//   icon-192.png / icon-512.png      — standard launcher icons (green tile + white mark)
//   icon-maskable-512.png            — extra safe-zone padding for Android maskable
//   apple-touch-icon.png (180)       — iOS home-screen icon (opaque)
// Usage: node scripts/make-pwa-icons.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const GREEN = "#185045";
const OUT = "public/icons";
mkdirSync(OUT, { recursive: true });

const logoSvg = readFileSync("public/traveliun/logo-en.svg");

/** White version of the logo at `size`: rasterize → take alpha → join onto white. */
async function whiteLogo(size) {
  const raster = await sharp(logoSvg, { density: 300 })
    .resize(size, size, { fit: "inside" })
    .ensureAlpha()
    .png()
    .toBuffer();
  const { width, height } = await sharp(raster).metadata();
  const alpha = await sharp(raster).extractChannel("alpha").raw().toBuffer();
  const white = await sharp({
    create: { width: width ?? size, height: height ?? size, channels: 3, background: "#ffffff" },
  })
    .joinChannel(alpha, { raw: { width: width ?? size, height: height ?? size, channels: 1 } })
    .png()
    .toBuffer();
  return white;
}

/** Green rounded tile with the white mark centered; `logoRatio` = mark share of tile. */
async function tile(size, logoRatio, radiusRatio) {
  const radius = Math.round(size * radiusRatio);
  const bg = Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><rect width="${size}" height="${size}" rx="${radius}" fill="${GREEN}"/></svg>`,
  );
  const mark = await whiteLogo(Math.round(size * logoRatio));
  return sharp(bg).composite([{ input: mark, gravity: "centre" }]).png().toBuffer();
}

writeFileSync(`${OUT}/icon-192.png`, await tile(192, 0.62, 0.18));
writeFileSync(`${OUT}/icon-512.png`, await tile(512, 0.62, 0.18));
// maskable: full-bleed square (the platform applies its own mask), mark inside the 80% safe zone
writeFileSync(`${OUT}/icon-maskable-512.png`, await tile(512, 0.5, 0));
// iOS ignores transparency and rounds corners itself → opaque, no radius
writeFileSync(`${OUT}/apple-touch-icon.png`, await tile(180, 0.62, 0));
console.log("wrote 4 icons into", OUT);
