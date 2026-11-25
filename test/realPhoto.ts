import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import type { RGBAImage } from '../src/vision/cv';

/** Decode an image file to RGBA via ImageMagick (dev/test helper). Returns null if unavailable. */
export function loadPhoto(path: string): RGBAImage | null {
  if (!existsSync(path)) return null;
  let ppm: Buffer;
  try {
    ppm = execFileSync('magick', [path, '-auto-orient', 'ppm:-'], { maxBuffer: 200 * 1024 * 1024 });
  } catch {
    return null;
  }
  // Parse "P6\n<w> <h>\n255\n" header.
  let pos = 0;
  const fields: string[] = [];
  while (fields.length < 4) {
    while (/\s/.test(String.fromCharCode(ppm[pos]))) pos++;
    if (ppm[pos] === 0x23) {
      // '#' comment until end of line
      while (ppm[pos] !== 0x0a) pos++;
      continue;
    }
    let tok = '';
    while (!/\s/.test(String.fromCharCode(ppm[pos]))) tok += String.fromCharCode(ppm[pos++]);
    fields.push(tok);
  }
  pos++;
  const [, w, h] = fields.map(Number);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = ppm[pos + i * 3];
    data[i * 4 + 1] = ppm[pos + i * 3 + 1];
    data[i * 4 + 2] = ppm[pos + i * 3 + 2];
    data[i * 4 + 3] = 255;
  }
  return { data, width: w, height: h };
}

/** Save RGBA as PNG via ImageMagick (debugging). */
export function savePng(path: string, img: RGBAImage) {
  const header = Buffer.from(`P6\n${img.width} ${img.height}\n255\n`);
  const rgb = Buffer.alloc(img.width * img.height * 3);
  for (let i = 0; i < img.width * img.height; i++) {
    rgb[i * 3] = img.data[i * 4];
    rgb[i * 3 + 1] = img.data[i * 4 + 1];
    rgb[i * 3 + 2] = img.data[i * 4 + 2];
  }
  const tmp = path.replace(/\.png$/, '.ppm');
  writeFileSync(tmp, Buffer.concat([header, rgb]));
  execFileSync('magick', [tmp, path]);
}
