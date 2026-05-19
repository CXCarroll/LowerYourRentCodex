// Rasterize static/favicon.svg into PNG fallbacks. Run: bun run scripts/build-favicons.ts
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';

const root = resolve(import.meta.dir, '..');
const svgPath = resolve(root, 'static/favicon.svg');
const targets = [
	{ out: 'static/favicon.png', size: 32 },
	{ out: 'static/apple-touch-icon.png', size: 180 }
];

const svg = await readFile(svgPath);
for (const { out, size } of targets) {
	const png = await sharp(svg, { density: 384 }).resize(size, size).png().toBuffer();
	await writeFile(resolve(root, out), png);
	console.log(`wrote ${out} (${size}x${size}, ${png.byteLength} bytes)`);
}
