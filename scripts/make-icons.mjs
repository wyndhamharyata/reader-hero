import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const outDir = new URL("../public/icons/", import.meta.url);
const source = (path) => readFile(new URL(path, import.meta.url));

// Full-bleed sources stay out of public/ because iOS and Android round or crop them themselves.
const rounded = await source("../public/icons/icon.svg");
const square = await source("./icons/square.svg");
const maskable = await source("./icons/maskable.svg");

const targets = [
  { name: "icon-192.png", size: 192, svg: rounded },
  { name: "icon-512.png", size: 512, svg: rounded },
  { name: "maskable-512.png", size: 512, svg: maskable },
  { name: "apple-touch-icon.png", size: 180, svg: square },
];

for (const target of targets) {
  await sharp(target.svg, { density: 384 })
    .resize(target.size, target.size)
    .png()
    .toFile(fileURLToPath(new URL(target.name, outDir)));
}

console.log(`wrote ${targets.length} icons to public/icons`);
