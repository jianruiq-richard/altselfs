import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

// Export browser/search assets only. The app icon and wordmarks are separate masters.
const source = await readFile(new URL('../public/brand/minaco/minaco-search-favicon.svg', import.meta.url));
const png = size => sharp(source, { density: 384 }).resize(size, size).png().toBuffer();
for (const size of [32, 48, 64, 96, 144, 192]) {
  await writeFile(new URL(`../public/brand/minaco/png/minaco-favicon-${size}.png`, import.meta.url), await png(size));
}
await writeFile(new URL('../src/app/icon.png', import.meta.url), await png(512));
const touch = await png(180);
await writeFile(new URL('../src/app/apple-icon.png', import.meta.url), touch);
await writeFile(new URL('../public/brand/minaco/png/minaco-apple-touch-icon-180.png', import.meta.url), touch);

// Standard ICO directory with PNG payloads; no additional conversion dependency.
const sizes = [16, 32, 48, 64, 96];
const images = await Promise.all(sizes.map(png));
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
images.forEach((image, index) => {
  const entry = 6 + index * 16;
  header[entry] = sizes[index];
  header[entry + 1] = sizes[index];
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(image.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += image.length;
});
await writeFile(new URL('../public/favicon.ico', import.meta.url), Buffer.concat([header, ...images]));
console.log('Exported search/browser PNGs, Next.js web icons and favicon.ico from the same SVG.');
