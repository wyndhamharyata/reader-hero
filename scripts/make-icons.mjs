import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const outDir = new URL("../public/icons/", import.meta.url);
await mkdir(outDir, { recursive: true });

const book = (scale) => {
  const offset = (512 - 512 * scale) / 2;
  return `<g transform="translate(${offset} ${offset}) scale(${scale})">
    <path d="M112 152c48-20 96-20 144 0v208c-48-20-96-20-144 0z" fill="#ffffff"/>
    <path d="M400 152c-48-20-96-20-144 0v208c48-20 96-20 144 0z" fill="#e0e7ff"/>
    <path d="M256 152v208" stroke="#c7d2fe" stroke-width="8"/>
  </g>`;
};

const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#4f46e5"/>
  ${book(0.82)}
</svg>`;

const maskableSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#4f46e5"/>
  ${book(0.6)}
</svg>`;

const targets = [
  { name: "icon-192.png", size: 192, svg: iconSvg },
  { name: "icon-512.png", size: 512, svg: iconSvg },
  { name: "maskable-512.png", size: 512, svg: maskableSvg },
  { name: "apple-touch-icon.png", size: 180, svg: iconSvg },
];

for (const target of targets) {
  const buffer = Buffer.from(target.svg);
  await sharp(buffer, { density: 384 })
    .resize(target.size, target.size)
    .png()
    .toFile(fileURLToPath(new URL(target.name, outDir)));
}

await writeFile(fileURLToPath(new URL("icon.svg", outDir)), iconSvg);

console.log(`wrote ${targets.length} icons to public/icons`);
