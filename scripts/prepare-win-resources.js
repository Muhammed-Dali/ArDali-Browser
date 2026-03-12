const fs = require('fs');
const path = require('path');
const cp = require('child_process');

function safeExists(p) {
  try {
    return !!p && fs.existsSync(p);
  } catch {
    return false;
  }
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function normalizeMsysRootFromDllDir(dllDir) {
  const d = String(dllDir || '').trim();
  if (!d) return '';
  try {
    const norm = d.replace(/\//g, '\\');
    const parts = norm.split('\\').filter(Boolean);
    // ...\msys64\mingw64\bin -> ...\msys64
    if (parts.length >= 3) {
      const last = parts[parts.length - 1].toLowerCase();
      const parent = parts[parts.length - 2].toLowerCase();
      if (last === 'bin' && ['mingw64', 'ucrt64', 'clang64', 'usr'].includes(parent)) {
        return parts.slice(0, -2).join('\\');
      }
    }
  } catch {
    // ignore
  }
  return '';
}

function pickBestDllDir(dllDir) {
  const original = String(dllDir || '').trim();
  if (!original) return '';

  const extraRoots = [];
  try {
    const a = String(process.env.MSYS2_LOCATION || '').trim();
    const b = String(process.env.MSYS2_ROOT || '').trim();
    const c = String(process.env.MSYS2_DIR || '').trim();
    if (a) extraRoots.push(a);
    if (b) extraRoots.push(b);
    if (c) extraRoots.push(c);
  } catch {
    // ignore
  }

  const msysRoot = normalizeMsysRootFromDllDir(original);
  const candidates = [];
  candidates.push(original);
  if (msysRoot) {
    candidates.push(path.join(msysRoot, 'mingw64', 'bin'));
    candidates.push(path.join(msysRoot, 'ucrt64', 'bin'));
    candidates.push(path.join(msysRoot, 'clang64', 'bin'));
    candidates.push(path.join(msysRoot, 'usr', 'bin'));
  }
  for (const r of extraRoots) {
    candidates.push(path.join(r, 'mingw64', 'bin'));
    candidates.push(path.join(r, 'ucrt64', 'bin'));
    candidates.push(path.join(r, 'clang64', 'bin'));
    candidates.push(path.join(r, 'usr', 'bin'));
  }

  const uniq = [];
  const seen = new Set();
  for (const c of candidates) {
    const key = String(c || '').toLowerCase();
    if (!c || seen.has(key)) continue;
    seen.add(key);
    uniq.push(c);
  }

  const probes = [
    'SDL2.dll',
    'SDL2_image.dll',
    'glew32.dll',
    'libstdc++-6.dll',
    'libgcc_s_seh-1.dll',
    'libwinpthread-1.dll',
    'libprojectM-4-4.dll'
  ];

  let best = original;
  let bestScore = -1;

  for (const c of uniq) {
    try {
      if (!fs.existsSync(c)) continue;
    } catch {
      continue;
    }
    let score = 0;
    for (const f of probes) {
      try {
        if (fs.existsSync(path.join(c, f))) score++;
      } catch {
        // ignore
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }

  return best;
}

function copyIfExists(from, to) {
  if (!fs.existsSync(from)) return false;
  ensureDir(path.dirname(to));
  fs.copyFileSync(from, to);
  return true;
}

function resolveVisualizerDllDir() {
  const fromEnv = String(process.env.AURIVO_VISUALIZER_DLL_DIR || '').trim();
  if (fromEnv && safeExists(fromEnv)) return fromEnv;

  const roots = [];
  try {
    const a = String(process.env.MSYS2_LOCATION || '').trim();
    const b = String(process.env.MSYS2_ROOT || '').trim();
    const c = String(process.env.MSYS2_DIR || '').trim();
    if (a) roots.push(a);
    if (b) roots.push(b);
    if (c) roots.push(c);
  } catch {
    // ignore
  }

  // GitHub Actions/Windows common paths + local dev.
  if (process.platform === 'win32') {
    roots.push('C:\\\\msys64');
    roots.push('C:\\\\msys2');
    roots.push('D:\\\\msys64');
    roots.push('D:\\\\msys2');
    // Some runners install MSYS2 under the workspace/temp drive.
    roots.push('D:\\\\a\\\\_temp\\\\msys64');
    roots.push('D:\\\\a\\\\msys64');
  }

  const probeBins = [];
  for (const r of roots) {
    const base = String(r || '').trim();
    if (!base) continue;
    probeBins.push(path.join(base, 'mingw64', 'bin'));
    probeBins.push(path.join(base, 'ucrt64', 'bin'));
    probeBins.push(path.join(base, 'clang64', 'bin'));
    probeBins.push(path.join(base, 'usr', 'bin'));
  }

  // Deduplicate and score candidates by presence of expected runtime DLLs.
  const probes = [
    'SDL2.dll',
    'SDL2_image.dll',
    'glew32.dll',
    'libstdc++-6.dll',
    'libgcc_s_seh-1.dll',
    'libwinpthread-1.dll',
    'libprojectM-4-4.dll'
  ];

  let best = '';
  let bestScore = -1;
  const seen = new Set();
  for (const c of probeBins) {
    const key = String(c || '').toLowerCase();
    if (!c || seen.has(key)) continue;
    seen.add(key);
    try {
      if (!fs.existsSync(c)) continue;
    } catch {
      continue;
    }

    let score = 0;
    for (const f of probes) {
      try {
        if (fs.existsSync(path.join(c, f))) score++;
      } catch {
        // ignore
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }

  if (best) return best;

  // If env is set but the dir doesn't exist, return it as a last resort (to keep error messages aligned).
  return fromEnv || '';
}

function copyVisualizerDllsFromDir(dllDir, nativeDistDir) {
  if (!dllDir) return { copied: 0, skipped: 0 };
  const pickedDllDir = pickBestDllDir(dllDir);

  const msysRoot = normalizeMsysRootFromDllDir(pickedDllDir || dllDir);
  const searchDirs = [];
  for (const p of [
    pickedDllDir,
    dllDir,
    msysRoot ? path.join(msysRoot, 'mingw64', 'bin') : '',
    msysRoot ? path.join(msysRoot, 'ucrt64', 'bin') : '',
    msysRoot ? path.join(msysRoot, 'clang64', 'bin') : '',
    msysRoot ? path.join(msysRoot, 'usr', 'bin') : ''
  ]) {
    const s = String(p || '').trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (searchDirs.find((d) => d.toLowerCase() === key)) continue;
    searchDirs.push(s);
  }

  const anyDirExists = searchDirs.some((d) => {
    try {
      return fs.existsSync(d);
    } catch {
      return false;
    }
  });

  if (!pickedDllDir || !anyDirExists) {
    console.warn('[prepare-win-resources] AURIVO_VISUALIZER_DLL_DIR bulunamadı:', dllDir);
    return { copied: 0, skipped: 0 };
  }

  ensureDir(nativeDistDir);

  const findObjdump = () => {
    const candidates = [];

    // Prefer MinGW objdump (doesn't depend on MSYS2 runtime).
    for (const d of searchDirs) {
      candidates.push(path.join(d, 'x86_64-w64-mingw32-objdump.exe'));
      candidates.push(path.join(d, 'x86_64-w64-mingw32-objdump'));
      candidates.push(path.join(d, 'objdump.exe'));
      candidates.push(path.join(d, 'objdump'));
    }

    // Fallback: resolve from PATH (useful on Linux cross-compile setups).
    candidates.push('x86_64-w64-mingw32-objdump');
    candidates.push('objdump');

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
      try {
        if (!p) continue;
        if ((p.includes('\\') || p.includes('/')) && !fs.existsSync(p)) continue;
      } catch {
        continue;
      }
      if (canRun(p)) return p;
    }

    return '';
  };

  const objdumpPath = findObjdump();

  const listDllDeps = (filePath) => {
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
      console.warn('[prepare-win-resources] objdump failed:', e?.message || e);
      return [];
    }
  };

  const toLower = (s) => String(s || '').toLowerCase();
  const isDll = (name) => toLower(name).endsWith('.dll');

  const findInSearchDirs = (name) => {
    for (const d of searchDirs) {
      const p = path.join(d, name);
      try {
        if (fs.existsSync(p)) return p;
      } catch {
        // ignore
      }
    }
    return '';
  };

  let copied = 0;
  let skipped = 0;
  let removed = 0;

  const isLikelySystemDll = (name) => {
    const n = toLower(name);
    if (n.startsWith('api-ms-win-') || n.startsWith('ext-ms-')) return true;
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
    return system.has(n);
  };

  const resolveDllPath = (name) => {
    const fromSearch = findInSearchDirs(name);
    if (fromSearch) return fromSearch;
    const existing = path.join(nativeDistDir, name);
    if (safeExists(existing)) return existing;
    return '';
  };

  const rootNames = [
    'SDL2.dll',
    'SDL2_image.dll',
    'glew32.dll',
    'libstdc++-6.dll',
    'libgcc_s_seh-1.dll',
    'libwinpthread-1.dll',
    'libprojectM-4-4.dll',
    'libprojectM-4-playlist-4.dll'
  ];

  const roots = [];
  const visualizerExe = path.join(nativeDistDir, 'aurivo-projectm-visualizer.exe');
  if (safeExists(visualizerExe)) roots.push(visualizerExe);
  for (const n of rootNames) {
    const p = resolveDllPath(n);
    if (p) roots.push(p);
  }

  const requiredDlls = new Set();
  const visitedFiles = new Set();
  const queue = [...roots];

  let steps = 0;
  while (queue.length && steps < 500) {
    steps++;
    const cur = String(queue.shift() || '');
    if (!cur) continue;
    const curKey = toLower(cur);
    if (visitedFiles.has(curKey)) continue;
    visitedFiles.add(curKey);

    const curBase = path.basename(cur);
    if (isDll(curBase)) requiredDlls.add(curBase);

    const deps = listDllDeps(cur);
    for (const dep of deps) {
      const name = path.basename(dep);
      if (!isDll(name)) continue;
      if (isLikelySystemDll(name)) continue;
      requiredDlls.add(name);

      const depPath = resolveDllPath(name);
      if (depPath) {
        queue.push(depPath);
      } else {
        skipped++;
      }
    }
  }

  for (const name of requiredDlls) {
    const from = findInSearchDirs(name);
    if (!from) continue;
    const to = path.join(nativeDistDir, name);
    try {
      fs.copyFileSync(from, to);
      copied++;
    } catch (e) {
      console.warn('[prepare-win-resources] DLL kopyalanamadı:', name, e?.message || e);
      skipped++;
    }
  }

  const keepExtras = String(process.env.AURIVO_KEEP_EXTRA_VISUALIZER_DLLS || '').trim() === '1';
  if (!keepExtras) {
    try {
      for (const entry of fs.readdirSync(nativeDistDir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        if (!isDll(entry.name)) continue;
        if (requiredDlls.has(entry.name)) continue;
        try {
          fs.unlinkSync(path.join(nativeDistDir, entry.name));
          removed++;
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
  }

  console.log('[prepare-win-resources] Visualizer DLL dependency bundle:', {
    from: dllDir,
    using: pickedDllDir,
    searched: searchDirs,
    to: nativeDistDir,
    objdump: objdumpPath || '(none)',
    copied,
    skipped,
    required: requiredDlls.size,
    removed
  });

  return { copied, skipped };
}

function main() {
  const root = path.resolve(__dirname, '..');
  const requireDlls = String(process.env.AURIVO_REQUIRE_VISUALIZER_DLLS || '').trim() === '1';
  const nativeDistLegacyDir = path.join(root, 'native-dist');
  const nativeDistDir = path.join(root, 'native-dist', 'windows');
  ensureDir(nativeDistDir);

  const binDir = path.join(root, 'bin');
  ensureDir(binDir);

  const ffmpegSrc = path.join(root, 'third_party', 'ffmpeg', 'ffmpeg.exe');
  const ffmpegDst = path.join(binDir, 'ffmpeg.exe');
  const copiedFfmpeg = copyIfExists(ffmpegSrc, ffmpegDst);

  if (!copiedFfmpeg) {
    console.warn('[prepare-win-resources] ffmpeg.exe bulunamadı:', ffmpegSrc);
  } else {
    const size = fs.statSync(ffmpegDst).size;
    if (size === 0) {
      console.warn('[prepare-win-resources] ffmpeg.exe 0 bayt (placeholder). Gerçek ffmpeg.exe ile değiştirin:', ffmpegDst);
    } else {
      console.log('[prepare-win-resources] ffmpeg.exe kopyalandı:', ffmpegDst);
    }
  }

  const visualizerExe = path.join(nativeDistDir, 'aurivo-projectm-visualizer.exe');
  const legacyVisualizerExe = path.join(nativeDistLegacyDir, 'aurivo-projectm-visualizer.exe');
  if (!safeExists(visualizerExe) && safeExists(legacyVisualizerExe)) {
    copyIfExists(legacyVisualizerExe, visualizerExe);
  }

  if (!safeExists(visualizerExe)) {
    console.warn('[prepare-win-resources] Visualizer exe yok (Windows build için gerekli):', visualizerExe);
  }

  // Optional: copy visualizer runtime DLLs (MSYS2/MinGW etc.)
  // Example: set AURIVO_VISUALIZER_DLL_DIR="C:\\msys64\\mingw64\\bin"
  try {
    const dllDir = resolveVisualizerDllDir();

    // If the visualizer exists but we can't find MSYS2's DLL dir, this almost always means
    // the packaged app will fail to start the visualizer on a clean Windows machine.
    const hasVisualizerExe = safeExists(visualizerExe);

    if (dllDir) {
      copyVisualizerDllsFromDir(dllDir, nativeDistDir);

      // In CI/release builds: fail fast if core DLLs still aren't present after bundling.
      if (requireDlls && hasVisualizerExe) {
        const mustExist = [
          'SDL2.dll',
          'SDL2_image.dll',
          'glew32.dll',
          'libgcc_s_seh-1.dll',
          'libstdc++-6.dll',
          'libwinpthread-1.dll',
          'libprojectM-4-4.dll'
        ];
        const missing = mustExist.filter((n) => !safeExists(path.join(nativeDistDir, n)));
        if (missing.length) {
          throw new Error(
            'Visualizer runtime DLL bundle eksik (native-dist içinde olmalı):\n- ' + missing.join('\n- ') +
              `\n\nDLL source dir: ${dllDir}\n` +
              'İpucu: MSYS2 MinGW64 paketleri yüklü olmalı (SDL2/glew/projectM/toolchain).'
          );
        }
      }
    } else if (hasVisualizerExe) {
      const msg =
        '[prepare-win-resources] ⚠ Visualizer exe var ama AURIVO_VISUALIZER_DLL_DIR bulunamadı; DLL paketleme atlandı. ' +
        'Windows üzerinde MSYS2 kuruluysa env ayarlayın (ör: C:\\msys64\\mingw64\\bin).';
      if (requireDlls) throw new Error(msg);
      console.warn(msg);
    }
  } catch (e) {
    const msg = e?.message || e;
    if (requireDlls) {
      throw new Error(`[prepare-win-resources] Visualizer DLL kopyalama hatası: ${msg}`);
    }
    console.warn('[prepare-win-resources] Visualizer DLL kopyalama hatası:', msg);
  }
}

main();
