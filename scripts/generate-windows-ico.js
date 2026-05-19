const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { default: pngToIco } = require('png-to-ico');

function findImageMagickBinary() {
  const candidates = process.platform === 'win32'
    ? ['magick.exe', 'convert.exe', 'magick', 'convert']
    : ['magick', 'convert'];

  for (const bin of candidates) {
    const res = spawnSync(bin, ['-version'], { stdio: 'ignore' });
    if (res.status === 0) return bin;
  }
  return null;
}

function resizePng(bin, src, size, dest) {
  const args = [src, '-resize', `${size}x${size}`, dest];
  const res = spawnSync(bin, args, { stdio: 'inherit' });
  if (res.status !== 0) {
    throw new Error(`ImageMagick resize failed for ${size}x${size}`);
  }
}

async function main() {
  const rootDir = path.join(__dirname, '..');
  const src = path.join(rootDir, 'icons', 'ardali_512.png');
  const dest = path.join(rootDir, 'icons', 'ardali.ico');

  const bin = findImageMagickBinary();
  if (bin) {
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ardali-ico-'));
    try {
      const sizes = [256, 128, 64, 48, 32, 24, 16];
      const images = [];
      for (const size of sizes) {
        const out = path.join(tmpDir, `icon_${size}.png`);
        resizePng(bin, src, size, out);
        images.push(out);
      }

      const icoBuffer = await pngToIco(images);
      await fs.promises.writeFile(dest, icoBuffer);
      console.log(`Generated: ${dest}`);
      return;
    } finally {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    }
  }

  const icoBuffer = await pngToIco(src);
  await fs.promises.writeFile(dest, icoBuffer);
  console.log(`Generated (fallback): ${dest}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
