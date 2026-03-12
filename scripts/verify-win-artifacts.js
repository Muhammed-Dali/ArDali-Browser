const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');

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

function resolveWindowsNativeDistDir(root) {
  const preferred = path.join(root, 'native-dist', 'windows');
  if (exists(preferred)) return preferred;
  return path.join(root, 'native-dist');
}

function assertFileLooksLikeWindowsBinary(p, label) {
  if (!exists(p)) {
    const extra = [];
    try {
      const root = path.resolve(__dirname, '..');
      const wantsAddon = /aurivo_audio\.node/i.test(p);
      const wantsVisualizer = /aurivo-projectm-visualizer(\.exe)?/i.test(p);

      if (wantsAddon) {
        const nativeBuildDir = path.join(root, 'native', 'build');
        if (exists(nativeBuildDir)) {
          const hits = findFiles(nativeBuildDir, (name) => /aurivo_audio\.node$/i.test(name), 40);
          if (hits.length) extra.push(`Bulunan adaylar:\n- ${hits.join('\n- ')}`);
        }
      }

      if (wantsVisualizer) {
        const nativeDistDir = resolveWindowsNativeDistDir(root);
        if (exists(nativeDistDir)) {
          const hits = findFiles(nativeDistDir, (name) => /aurivo-projectm-visualizer/i.test(name), 40);
          if (hits.length) extra.push(`Bulunan adaylar:\n- ${hits.join('\n- ')}`);
        }
      }
    } catch {
      // ignore
    }

    const extraMsg = extra.length ? `\n\n${extra.join('\n\n')}` : '';
    throw new Error(`${label} bulunamadı: ${p}${extraMsg}`);
  }

  const m = readMagic(p, 4);
  const isMZ = m.length >= 2 && m[0] === 0x4d && m[1] === 0x5a; // 'MZ'
  if (!isMZ) {
    throw new Error(
      `${label} Windows binary gibi görünmüyor (MZ yok). ` +
        `Muhtemelen Linux (ELF) dosyası paketleniyor. path=${p} magic=${hex(m)}`
    );
  }
}

function toLower(s) {
  return String(s || '').toLowerCase();
}

function isDll(name) {
  return toLower(name).endsWith('.dll');
}

function isLikelySystemDll(name) {
  const n = toLower(name);
  const system = new Set([
    'advapi32.dll',
    'bcrypt.dll',
    'comctl32.dll',
    'comdlg32.dll',
    'crypt32.dll',
    'dwmapi.dll',
    'gdi32.dll',
    'gdi32full.dll',
    'imm32.dll',
    'kernel32.dll',
    'opengl32.dll',
    'msvcrt.dll',
    'ntdll.dll',
    'ole32.dll',
    'oleaut32.dll',
    'psapi.dll',
    'rpcrt4.dll',
    'secur32.dll',
    'setupapi.dll',
    'shell32.dll',
    'shlwapi.dll',
    'ucrtbase.dll',
    'user32.dll',
    'version.dll',
    'winmm.dll',
    'ws2_32.dll'
  ]);
  if (n.startsWith('api-ms-win-') || n.startsWith('ext-ms-')) return true;
  return system.has(n);
}

function findObjdump(dllDir) {
  const candidates = [];
  if (dllDir) {
    candidates.push(path.join(dllDir, 'objdump.exe'));
    candidates.push(path.join(dllDir, 'x86_64-w64-mingw32-objdump.exe'));
    candidates.push(path.join(path.dirname(dllDir), 'usr', 'bin', 'objdump.exe'));
  }
  candidates.push('objdump.exe');
  candidates.push('objdump');
  candidates.push('x86_64-w64-mingw32-objdump.exe');
  candidates.push('x86_64-w64-mingw32-objdump');

  const canRun = (exe) => {
    try {
      if (!exe) return false;
      cp.execFileSync(exe, ['--version'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  };

  for (const p of candidates) {
    if (!p) continue;
    try {
      if ((p.includes('\\') || p.includes('/')) && !fs.existsSync(p)) continue;
    } catch {
      continue;
    }
    if (canRun(p)) return p;
  }
  return '';
}

function listDllDeps(objdumpPath, filePath) {
  if (!objdumpPath || !filePath || !fs.existsSync(filePath)) return [];
  try {
    const out = cp.execFileSync(objdumpPath, ['-p', filePath], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true
    });
    const deps = [];
    for (const line of String(out || '').split(/\r?\n/)) {
      const m = line.match(/DLL Name:\s*(.+)$/i);
      if (m) {
        const name = String(m[1] || '').trim();
        if (name) deps.push(name);
      }
    }
    return deps;
  } catch (e) {
    console.warn('[verify-win-artifacts] ⚠ objdump failed:', e?.message || e);
    return [];
  }
}

function resolveVisualizerDllDirGuess() {
  const fromEnv = String(process.env.AURIVO_VISUALIZER_DLL_DIR || '').trim();
  if (fromEnv) return fromEnv;

  if (process.platform === 'win32') {
    const candidates = ['C:\\\\msys64\\\\mingw64\\\\bin', 'C:\\\\msys2\\\\mingw64\\\\bin'];
    for (const c of candidates) {
      try {
        if (fs.existsSync(c)) return c;
      } catch {
        // ignore
      }
    }
  }
  return '';
}

function assertBundledDllClosure(nativeDistDir, objdumpPath, entryFile, label) {
  if (!objdumpPath) {
    const skip = String(process.env.AURIVO_SKIP_VISUALIZER_DLL_CHECK || '').trim() === '1';
    const msg = `${label} DLL kontrolü için objdump bulunamadı. (AURIVO_SKIP_VISUALIZER_DLL_CHECK=1 ile atlanabilir)`;
    if (skip) {
      console.warn('[verify-win-artifacts] ⚠', msg);
      return;
    }
    throw new Error(msg);
  }

  const missing = new Set();
  const visited = new Set();
  const queue = [entryFile];

  while (queue.length) {
    const cur = queue.shift();
    if (!cur) continue;
    const key = toLower(cur);
    if (visited.has(key)) continue;
    visited.add(key);

    const deps = listDllDeps(objdumpPath, cur)
      .map((d) => path.basename(d))
      .filter((n) => isDll(n));

    for (const dep of deps) {
      if (isLikelySystemDll(dep)) continue;

      const depPath = path.join(nativeDistDir, dep);
      if (!exists(depPath)) {
        missing.add(dep);
        continue;
      }

      queue.push(depPath);
    }
  }

  if (missing.size) {
    throw new Error(
      `${label} için eksik runtime DLL'leri (native-dist içinde olmalı):\n- ${[...missing].sort().join('\n- ')}\n\n` +
        `İpucu: Windows ortamında \`npm run prepare:win:resources\` ve MSYS2 MinGW64 DLL dizini (` +
        `AURIVO_VISUALIZER_DLL_DIR="C:\\\\msys64\\\\mingw64\\\\bin") ayarlı olmalı.`
    );
  }
}

function assertVisualizerRuntimeDlls(nativeDistDir, visualizerExe) {
  const strict = String(process.env.AURIVO_REQUIRE_VISUALIZER_DLLS || '').trim() === '1';
  if (strict) {
    const mustExist = [
      'SDL2.dll',
      'SDL2_image.dll',
      'glew32.dll',
      'libgcc_s_seh-1.dll',
      'libstdc++-6.dll',
      'libwinpthread-1.dll',
      'libprojectM-4-4.dll'
    ];
    const missing = mustExist.filter((n) => !exists(path.join(nativeDistDir, n)));
    if (missing.length) {
      throw new Error(
        `Visualizer için eksik runtime DLL'leri (native-dist içinde olmalı):\n- ${missing.join('\n- ')}\n\n` +
          `İpucu: Windows ortamında \`npm run prepare:win:resources\` ve MSYS2 MinGW64 DLL dizini (` +
          `AURIVO_VISUALIZER_DLL_DIR="C:\\\\msys64\\\\mingw64\\\\bin") ayarlı olmalı.`
      );
    }
  }
  const dllDir = resolveVisualizerDllDirGuess();
  const objdumpPath = findObjdump(dllDir) || findObjdump('');
  assertBundledDllClosure(nativeDistDir, objdumpPath, visualizerExe, 'Visualizer');
}

function assertVisualizerLaunchable(visualizerExe, nativeDistDir) {
  if (!visualizerExe || !exists(visualizerExe)) return;

  // Smoke-test only: we just want to catch loader errors like missing DLL (0xC0000135).
  // No GPU/display assumptions here; non-zero app-level exits are tolerated.
  const env = { ...process.env };
  env.PATH = `${nativeDistDir};${env.PATH || ''}`;

  let res;
  try {
    res = cp.spawnSync(visualizerExe, ['--help'], {
      cwd: nativeDistDir,
      env,
      windowsHide: true,
      encoding: 'utf8',
      timeout: 10000
    });
  } catch (e) {
    throw new Error(`Visualizer smoke-test başlatılamadı: ${e?.message || e}`);
  }

  const status = Number(res?.status);
  const missingDllCodes = new Set([3221225781, -1073741515]); // 0xC0000135

  if (missingDllCodes.has(status)) {
    const out = String(res?.stdout || '').trim();
    const err = String(res?.stderr || '').trim();
    throw new Error(
      'Visualizer smoke-test eksik DLL ile çöktü (0xC0000135).\n' +
        `exe=${visualizerExe}\n` +
        `cwd=${nativeDistDir}\n` +
        (out ? `stdout:\n${out}\n` : '') +
        (err ? `stderr:\n${err}\n` : '')
    );
  }

  if (res?.error && !missingDllCodes.has(Number(res?.error?.errno))) {
    const code = res.error.code || res.error.errno || '';
    throw new Error(`Visualizer smoke-test process error: ${code} ${res.error.message || ''}`.trim());
  }
}

function findFiles(rootDir, predicate, limit = 50) {
  const results = [];
  const queue = [rootDir];

  while (queue.length && results.length < limit) {
    const dir = queue.shift();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (results.length >= limit) break;
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Avoid deep recursion into node_modules-like trees (shouldn't exist here, but safe).
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        queue.push(p);
        continue;
      }
      if (entry.isFile() && predicate(entry.name)) {
        results.push(p);
      }
    }
  }

  return results;
}

function main() {
  const root = path.resolve(__dirname, '..');

  console.log('\n[verify-win-artifacts] Windows build artifact kontrolü...');
  console.log('[verify-win-artifacts] host platform:', os.platform());
  const skipVisualizer = String(process.env.AURIVO_SKIP_VISUALIZER || '').trim() === '1';
  const visualizerOnly = String(process.env.AURIVO_VERIFY_VISUALIZER_ONLY || '').trim() === '1';

  // Native audio addon (must be built for Electron/Windows before packaging)
  if (!visualizerOnly) {
    const nativeAddon = path.join(root, 'native', 'build', 'Release', 'aurivo_audio.node');
    assertFileLooksLikeWindowsBinary(nativeAddon, 'Native audio addon (aurivo_audio.node)');
  }

  // Visualizer executable (must exist for Windows packaged builds)
  if (skipVisualizer) {
    console.warn('[verify-win-artifacts] ⚠ Visualizer kontrolü atlandı (AURIVO_SKIP_VISUALIZER=1).');
  } else {
    const nativeDistDir = resolveWindowsNativeDistDir(root);
    const visualizerExe = path.join(nativeDistDir, 'aurivo-projectm-visualizer.exe');
    if (!exists(visualizerExe)) {
      if (visualizerOnly) {
        throw new Error(`Visualizer exe yok: ${visualizerExe}`);
      }
      console.warn('[verify-win-artifacts] ⚠ Visualizer exe yok (opsiyonel - çalışmaya devam edilecek):', visualizerExe);
    } else {
      assertFileLooksLikeWindowsBinary(visualizerExe, 'Visualizer exe (aurivo-projectm-visualizer.exe)');
      assertVisualizerRuntimeDlls(nativeDistDir, visualizerExe);
      assertVisualizerLaunchable(visualizerExe, nativeDistDir);
    }
  }

  // BASS runtime DLLs copied into native build dir (DLL loader searches here)
  if (!visualizerOnly) {
    const bassDllDir = path.join(root, 'native', 'build', 'Release');
    const requiredBassDlls = [
      'bass.dll',
      'bass_fx.dll',
      'bass_aac.dll',
      'bassape.dll',
      'bassflac.dll',
      'basswv.dll'
    ];

    for (const dll of requiredBassDlls) {
      const p = path.join(bassDllDir, dll);
      assertFileLooksLikeWindowsBinary(p, `BASS DLL (${dll})`);
    }
  }

  // ffmpeg.exe (optional, but recommended for album art extraction / download tools)
  if (!visualizerOnly) {
    const ffmpegExe = path.join(root, 'bin', 'ffmpeg.exe');
    if (!exists(ffmpegExe)) {
      console.warn('[verify-win-artifacts] ⚠ ffmpeg.exe yok (opsiyonel):', ffmpegExe);
    } else {
      const m = readMagic(ffmpegExe, 2);
      const isMZ = m.length >= 2 && m[0] === 0x4d && m[1] === 0x5a;
      if (!isMZ) {
        console.warn('[verify-win-artifacts] ⚠ ffmpeg.exe MZ değil (placeholder olabilir):', ffmpegExe);
      }
    }
  }

  console.log('[verify-win-artifacts] ✓ OK');
}

try {
  main();
} catch (e) {
  const msg = e && e.message ? e.message : String(e);
  console.error('\n[verify-win-artifacts] ❌', msg);
  console.error('\nİpucu: Windows installer üretmek için Windows ortamında derleyin:');
  console.error('- `native/build/Release/aurivo_audio.node` Windows için derlenmeli (MZ)');
  console.error('- `native-dist/windows/aurivo-projectm-visualizer.exe` Windows için derlenmeli (MZ)');
  console.error('- Sonra `npm run build:win`');
  process.exit(1);
}
