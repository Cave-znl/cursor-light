const fs = require("node:fs");
const path = require("node:path");

const outDir = path.join(__dirname, "..", "build");
const svgPath = path.join(outDir, "icon.svg");
const icoPath = path.join(outDir, "icon.ico");
const sizes = [16, 24, 32, 48, 64, 128, 256];

fs.mkdirSync(outDir, { recursive: true });

fs.writeFileSync(
  svgPath,
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="case" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#24282c"/>
      <stop offset="1" stop-color="#101214"/>
    </linearGradient>
    <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
      <feDropShadow dx="0" dy="0" stdDeviation="12" flood-color="#35dc74" flood-opacity=".9"/>
    </filter>
  </defs>
  <rect x="26" y="18" width="204" height="220" rx="42" fill="url(#case)" stroke="#ffffff" stroke-opacity=".16" stroke-width="8"/>
  <circle cx="128" cy="70" r="35" fill="#070809"/>
  <circle cx="128" cy="70" r="24" fill="#ff4037" opacity=".45"/>
  <circle cx="128" cy="128" r="35" fill="#070809"/>
  <circle cx="128" cy="128" r="24" fill="#ffd449" opacity=".5"/>
  <circle cx="128" cy="186" r="35" fill="#070809"/>
  <circle cx="128" cy="186" r="25" fill="#35dc74" filter="url(#glow)"/>
</svg>
`,
  "utf8"
);

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function mix(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function roundedRectAlpha(x, y, width, height, radius) {
  const dx = Math.max(Math.abs(x - width / 2) - width / 2 + radius, 0);
  const dy = Math.max(Math.abs(y - height / 2) - height / 2 + radius, 0);
  const dist = Math.sqrt(dx * dx + dy * dy);
  return clamp(radius - dist, 0, 1);
}

function circleAlpha(x, y, cx, cy, r) {
  const distance = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
  return clamp(r - distance, 0, 1);
}

function drawIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const scale = size / 256;
  const body = {
    x: 26 * scale,
    y: 18 * scale,
    w: 204 * scale,
    h: 220 * scale,
    r: 42 * scale
  };
  const lamps = [
    { cx: 128 * scale, cy: 70 * scale, color: [255, 64, 55], lit: 0.45 },
    { cx: 128 * scale, cy: 128 * scale, color: [255, 212, 73], lit: 0.5 },
    { cx: 128 * scale, cy: 186 * scale, color: [53, 220, 116], lit: 1 }
  ];

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const idx = (y * size + x) * 4;
      const cx = x + 0.5;
      const cy = y + 0.5;
      const bodyAlpha = roundedRectAlpha(cx - body.x, cy - body.y, body.w, body.h, body.r);

      if (bodyAlpha > 0) {
        const t = clamp((cy - body.y) / body.h, 0, 1);
        pixels[idx] = mix(36, 16, t);
        pixels[idx + 1] = mix(40, 18, t);
        pixels[idx + 2] = mix(44, 20, t);
        pixels[idx + 3] = Math.round(255 * bodyAlpha);
      }

      for (const lamp of lamps) {
        const shadow = circleAlpha(cx, cy, lamp.cx, lamp.cy, 36 * scale);
        if (shadow > 0) {
          pixels[idx] = Math.round(pixels[idx] * (1 - shadow * 0.7));
          pixels[idx + 1] = Math.round(pixels[idx + 1] * (1 - shadow * 0.7));
          pixels[idx + 2] = Math.round(pixels[idx + 2] * (1 - shadow * 0.7));
          pixels[idx + 3] = Math.max(pixels[idx + 3], Math.round(255 * shadow));
        }

        const light = circleAlpha(cx, cy, lamp.cx, lamp.cy, 24 * scale);
        if (light > 0) {
          const alpha = light * lamp.lit;
          pixels[idx] = mix(pixels[idx], lamp.color[0], alpha);
          pixels[idx + 1] = mix(pixels[idx + 1], lamp.color[1], alpha);
          pixels[idx + 2] = mix(pixels[idx + 2], lamp.color[2], alpha);
          pixels[idx + 3] = Math.max(pixels[idx + 3], Math.round(255 * light));
        }
      }
    }
  }

  return pixels;
}

function createDib(size) {
  const pixels = drawIcon(size);
  const xor = Buffer.alloc(size * size * 4);
  const maskStride = Math.ceil(size / 32) * 4;
  const mask = Buffer.alloc(maskStride * size);
  const header = Buffer.alloc(40);

  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(0, 16);
  header.writeUInt32LE(xor.length + mask.length, 20);

  for (let y = 0; y < size; y += 1) {
    const srcY = size - 1 - y;
    for (let x = 0; x < size; x += 1) {
      const src = (srcY * size + x) * 4;
      const dest = (y * size + x) * 4;
      xor[dest] = pixels[src + 2];
      xor[dest + 1] = pixels[src + 1];
      xor[dest + 2] = pixels[src];
      xor[dest + 3] = pixels[src + 3];
    }
  }

  return Buffer.concat([header, xor, mask]);
}

function createIco() {
  const images = sizes.map((size) => ({ size, data: createDib(size) }));
  const header = Buffer.alloc(6);
  const entries = Buffer.alloc(images.length * 16);
  let offset = header.length + entries.length;

  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  for (let i = 0; i < images.length; i += 1) {
    const image = images[i];
    const entry = i * 16;
    entries[entry] = image.size === 256 ? 0 : image.size;
    entries[entry + 1] = image.size === 256 ? 0 : image.size;
    entries[entry + 2] = 0;
    entries[entry + 3] = 0;
    entries.writeUInt16LE(1, entry + 4);
    entries.writeUInt16LE(32, entry + 6);
    entries.writeUInt32LE(image.data.length, entry + 8);
    entries.writeUInt32LE(offset, entry + 12);
    offset += image.data.length;
  }

  return Buffer.concat([header, entries, ...images.map((image) => image.data)]);
}

fs.writeFileSync(icoPath, createIco());
console.log(`Generated ${path.relative(process.cwd(), svgPath)} and ${path.relative(process.cwd(), icoPath)}`);
