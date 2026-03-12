const fs = require('fs');
const path = require('path');
const os = require('os');

function exists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function readMagic(p, n = 4) {
  try {
    const fd = fs.openSync(p, 'r');
    try {
      const buf = Buffer.alloc(n);
      const bytes = fs.readSync(fd, buf, 0, n, 0);
      return buf.subarray(0, bytes);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return Buffer.alloc(0);
  }
}

function hex(buf) {
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join(' ');
}

function assertFileLooksLikeElf(p, label) {
  if (!exists(p)) {
    throw new Error(`${label} bulunamadı: ${p}`);
  }

  const m = readMagic(p, 4);
  const isElf = m.length >= 4 && m[0] === 0x7f && m[1] === 0x45 && m[2] === 0x4c && m[3] === 0x46; // 0x7F 'E' 'L' 'F'
  if (!isElf) {
    throw new Error(
      `${label} ELF binary gibi görünmüyor. ` +
        `Muhtemelen farklı OS için üretilmiş (MZ/Mach-O) ya da eksik dosya. path=${p} magic=${hex(m)}`
    );
  }
}

function main() {
  const root = path.resolve(__dirname, '..');
  const nativeDistDir = path.join(root, 'native-dist', 'linux');

  console.log('\n[verify-linux-artifacts] Linux build artifact kontrolü...');
  console.log('[verify-linux-artifacts] host platform:', os.platform());

  // Native audio addon (must be built for Electron/Linux before packaging)
  const nativeAddon = path.join(root, 'native', 'build', 'Release', 'aurivo_audio.node');
  assertFileLooksLikeElf(nativeAddon, 'Native audio addon (aurivo_audio.node)');

  // Visualizer executable (must exist for Linux packaged builds)
  const visualizerExe = path.join(nativeDistDir, 'aurivo-projectm-visualizer');
  assertFileLooksLikeElf(visualizerExe, 'Visualizer exe (aurivo-projectm-visualizer)');

  // libprojectM v4 runtime (bundle next to visualizer for distro compatibility)
  const projectmCore = path.join(nativeDistDir, 'libprojectM-4.so.4');
  const projectmPlaylist = path.join(nativeDistDir, 'libprojectM-4-playlist.so.4');
  assertFileLooksLikeElf(projectmCore, 'projectM runtime (libprojectM-4.so.4)');
  assertFileLooksLikeElf(projectmPlaylist, 'projectM runtime (libprojectM-4-playlist.so.4)');

  // BASS runtime shared objects copied into native build dir
  const bassSoDir = path.join(root, 'native', 'build', 'Release');
  const requiredBassSos = [
    'libbass.so',
    'libbass_fx.so',
    'libbass_aac.so',
    'libbassape.so',
    'libbassflac.so',
    'libbasswv.so'
  ];

  for (const so of requiredBassSos) {
    const p = path.join(bassSoDir, so);
    assertFileLooksLikeElf(p, `BASS SO (${so})`);
  }

  // ffmpeg binary (electron-builder extraResources reads /usr/bin/ffmpeg on Linux)
  const ffmpeg = '/usr/bin/ffmpeg';
  if (!exists(ffmpeg)) {
    console.warn('[verify-linux-artifacts] ⚠ /usr/bin/ffmpeg yok: Linux paketinde ffmpeg gömülemeyebilir.');
  }

  console.log('[verify-linux-artifacts] ✓ OK');
}

try {
  main();
} catch (e) {
  const msg = e && e.message ? e.message : String(e);
  console.error('\n[verify-linux-artifacts] ❌', msg);
  console.error('\nİpucu: Linux paketlemek için önce native bileşenleri üretin:');
  console.error('- `npm run rebuild-native` (aurivo_audio.node)');
  console.error('- Visualizer: `cmake -S visualizer -B build-visualizer && cmake --build build-visualizer`');
  console.error('- Sonra `cp build-visualizer/aurivo-projectm-visualizer native-dist/linux/`');
  console.error('- libprojectM v4 runtime (sisteme göre /usr/local/lib veya /usr/lib):');
  console.error('  - `cp -L /usr/local/lib/libprojectM-4.so.4 native-dist/linux/ || cp -L /usr/lib/libprojectM-4.so.4 native-dist/linux/`');
  console.error('  - `cp -L /usr/local/lib/libprojectM-4-playlist.so.4 native-dist/linux/ || cp -L /usr/lib/libprojectM-4-playlist.so.4 native-dist/linux/`');
  console.error('- Sonra `npm run build:linux`');
  process.exit(1);
}
