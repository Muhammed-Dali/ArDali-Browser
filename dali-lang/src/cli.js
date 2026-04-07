#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { parseDali } = require('./parser');
const { compileToWebAudioModule } = require('./compiler-web-audio');
const { compileToWasmModuleSkeleton } = require('./compiler-wasm');
const { validateSourceLimits, validateProgramSecurity } = require('./security-validator');
const { runProgramTasks } = require('./task-runtime');
const { createProgramIR, hashIR } = require('./ir');
const { loadOrCreateCachedIR } = require('./ir-cache');
const {
  verifySourceTextSignature,
  defaultSignaturePathForSource,
  readPemFile
} = require('./signature');
const { formatDiagnosticWithSource, createDiagnostic, classifyDiagnostic } = require('./diagnostics');

function printUsage() {
  console.log('Usage:');
  console.log('  node dali-lang/src/cli.js <input.dali|input.dl> [output.js] [--target js|wasm] [--backend webaudio|audioworklet] [--strict|--hardened] [--verify-signature --public-key <pub.pem> [--signature <file.sig.json>]]');
  console.log('  node dali-lang/src/cli.js run <input.dali|input.dl> [--dry-run|--no-dry-run --execute-stub] [--json]');
  console.log('  node dali-lang/src/cli.js ir <input.dali|input.dl> [output.ir.json] [--json] [--no-cache]');
  console.log('  node dali-lang/src/cli.js setup [--editor vscode] [--skip-editor-install]');
}

function parseArgs(argv) {
  const args = Array.isArray(argv) ? argv.slice() : [];
  const options = {
    mode: 'compile',
    inputPathArg: '',
    outputPathArg: '',
    verifySignature: false,
    publicKeyPath: '',
    signaturePath: '',
    json: false,
    backend: '',
    securityMode: 'strict',
    target: 'js',
    setupEditor: 'vscode',
    skipEditorInstall: false,
    useCache: true,
    dryRun: true,
    executeStub: false
  };
  if (args.length === 0) return options;
  let startIndex = 0;
  const first = String(args[0] || '').trim().toLowerCase();
  if (first === 'run') {
    options.mode = 'run';
    startIndex = 1;
  } else if (first === 'ir') {
    options.mode = 'ir';
    startIndex = 1;
  } else if (first === 'setup') {
    options.mode = 'setup';
    startIndex = 1;
  }
  if (options.mode !== 'setup') {
    options.inputPathArg = String(args[startIndex] || '').trim();
  }

  let posOutSet = false;
  const optionScanStart = options.mode === 'setup' ? startIndex : startIndex + 1;
  for (let i = optionScanStart; i < args.length; i += 1) {
    const arg = String(args[i] || '').trim();
    if (!arg) continue;
    if (!arg.startsWith('--') && !posOutSet) {
      options.outputPathArg = arg;
      posOutSet = true;
      continue;
    }
    if (arg === '--verify-signature') {
      options.verifySignature = true;
      continue;
    }
    if (arg === '--public-key') {
      options.publicKeyPath = String(args[i + 1] || '').trim();
      i += 1;
      continue;
    }
    if (arg === '--signature') {
      options.signaturePath = String(args[i + 1] || '').trim();
      i += 1;
      continue;
    }
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--backend') {
      options.backend = String(args[i + 1] || '').trim().toLowerCase();
      i += 1;
      continue;
    }
    if (arg === '--target') {
      options.target = String(args[i + 1] || '').trim().toLowerCase();
      i += 1;
      continue;
    }
    if (arg === '--strict') {
      options.securityMode = 'strict';
      continue;
    }
    if (arg === '--hardened') {
      options.securityMode = 'hardened';
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--no-dry-run') {
      options.dryRun = false;
      continue;
    }
    if (arg === '--execute-stub') {
      options.executeStub = true;
      continue;
    }
    if (arg === '--no-cache') {
      options.useCache = false;
      continue;
    }
    if (arg === '--editor') {
      options.setupEditor = String(args[i + 1] || '').trim().toLowerCase();
      i += 1;
      continue;
    }
    if (arg === '--skip-editor-install') {
      options.skipEditorInstall = true;
    }
  }
  return options;
}

function installVsCodeExtension() {
  const extId = 'aurivo.dali-language';
  const cmd = spawnSync('code', ['--install-extension', extId, '--force'], {
    encoding: 'utf8'
  });
  if (cmd.error) {
    throw new Error(`[DALI SETUP] failed to run 'code': ${cmd.error.message}`);
  }
  if (cmd.status !== 0) {
    const stderr = String(cmd.stderr || '').trim();
    const stdout = String(cmd.stdout || '').trim();
    const details = stderr || stdout || 'unknown error';
    throw new Error(`[DALI SETUP] VS Code extension install failed (${extId}): ${details}`);
  }
  console.log(`[dali-setup] VS Code extension installed: ${extId}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.mode === 'setup') {
    const editor = String(options.setupEditor || 'vscode').trim().toLowerCase();
    if (editor !== 'vscode') {
      throw new Error(`[DALI SETUP] unsupported editor '${editor}'. Allowed: vscode`);
    }
    console.log('[dali-setup] starting setup for editor=vscode');
    if (options.skipEditorInstall) {
      console.log('[dali-setup] editor install skipped (--skip-editor-install)');
      process.exit(0);
    }
    installVsCodeExtension();
    process.exit(0);
  }

  const inputPathArg = options.inputPathArg;
  const outputPathArg = options.outputPathArg;
  if (!inputPathArg) {
    printUsage();
    process.exit(1);
  }

  const inputPath = path.resolve(process.cwd(), inputPathArg);
  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  const source = fs.readFileSync(inputPath, 'utf8');
  validateSourceLimits(source, path.basename(inputPath));
  if (options.verifySignature) {
    if (!options.publicKeyPath) {
      throw new Error('Missing --public-key for --verify-signature');
    }
    const sigPath = options.signaturePath
      ? path.resolve(process.cwd(), options.signaturePath)
      : defaultSignaturePathForSource(inputPath);
    if (!fs.existsSync(sigPath)) {
      throw new Error(`Signature file not found: ${sigPath}`);
    }
    const signatureData = JSON.parse(fs.readFileSync(sigPath, 'utf8'));
    const publicKeyPem = readPemFile(options.publicKeyPath);
    verifySourceTextSignature(source, signatureData, {
      publicKeyPem,
      fileLabel: path.relative(process.cwd(), inputPath)
    });
  }
  const ast = parseDali(source);

  if (options.mode === 'ir') {
    validateProgramSecurity(ast, { mode: options.securityMode });
    const cached = loadOrCreateCachedIR({
      sourceText: source,
      sourceLabel: path.relative(process.cwd(), inputPath),
      rootDir: process.cwd(),
      useCache: options.useCache !== false,
      buildIR: () => createProgramIR(ast, { sourceLabel: path.relative(process.cwd(), inputPath) })
    });
    const irOut = {
      ok: true,
      mode: 'ir',
      source: path.relative(process.cwd(), inputPath),
      sourceHash: cached.sourceHash,
      cacheHit: cached.cacheHit,
      cachePath: path.relative(process.cwd(), cached.cachePath),
      irHash: hashIR(cached.ir),
      ir: cached.ir,
      timestamp: new Date().toISOString()
    };
    const outputPath = outputPathArg
      ? path.resolve(process.cwd(), outputPathArg)
      : inputPath.replace(/\.(dali|dl)$/i, '.ir.json');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(irOut, null, 2), 'utf8');
    if (options.json) {
      console.log(JSON.stringify({
        ok: true,
        mode: 'ir',
        source: irOut.source,
        output: path.relative(process.cwd(), outputPath),
        sourceHash: irOut.sourceHash,
        irHash: irOut.irHash,
        cacheHit: irOut.cacheHit
      }));
    } else {
      console.log(`[dali-ir] source=${irOut.source} output=${path.relative(process.cwd(), outputPath)} cacheHit=${irOut.cacheHit} irHash=${irOut.irHash.slice(0, 12)}`);
    }
    process.exit(0);
  }

  if (options.mode === 'run') {
    validateProgramSecurity(ast, { mode: options.securityMode });
    const result = await runProgramTasks(ast, {
      dryRun: options.dryRun !== false,
      executeStub: options.executeStub === true
    });
    if (options.json) {
      console.log(JSON.stringify(result));
    } else {
      console.log(`[dali-run] preset=${result.presetName} tasks=${result.taskCount} blocked=${result.blocked} dryRun=${result.dryRun}`);
      for (const item of result.plan) {
        const status = item.permitted ? 'OK' : 'BLOCKED';
        console.log(`[dali-run][${status}] task="${item.name}" provider=${item.provider} mode=${item.mode} requires=${item.requires.join(',') || '-'} denied=${item.denied.join(',') || '-'}`);
      }
    }
    process.exit(result.ok ? 0 : 1);
  }

  let compiled = '';
  const target = String(options.target || 'js').trim().toLowerCase();
  if (target === 'wasm') {
    compiled = compileToWasmModuleSkeleton(ast, {
      sourceLabel: path.relative(process.cwd(), inputPath),
      securityMode: options.securityMode
    });
  } else {
    compiled = compileToWebAudioModule(ast, {
      backend: options.backend,
      securityMode: options.securityMode
    });
  }

  const outputPath = outputPathArg
    ? path.resolve(process.cwd(), outputPathArg)
    : inputPath.replace(/\.(dali|dl)$/i, '.compiled.js');

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, compiled, 'utf8');
  if (options.json) {
    console.log(JSON.stringify({
      ok: true,
      file: path.relative(process.cwd(), inputPath),
      output: path.relative(process.cwd(), outputPath),
      presetCount: Array.isArray(ast?.presets) ? ast.presets.length : 0,
      timestamp: new Date().toISOString()
    }));
  } else {
    console.log(`Compiled ${path.basename(inputPath)} -> ${outputPath}`);
  }
}

let lastInputLabel = '';
let lastSourceText = '';
let lastJsonMode = false;

async function bootstrap() {
  try {
    const rawArgs = parseArgs(process.argv.slice(2));
    lastJsonMode = rawArgs.json === true;
    if (rawArgs.inputPathArg) {
      const abs = path.resolve(process.cwd(), rawArgs.inputPathArg);
      lastInputLabel = rawArgs.inputPathArg;
      if (fs.existsSync(abs)) {
        lastSourceText = fs.readFileSync(abs, 'utf8');
      }
    }
    await main();
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    const diagnostic = createDiagnostic({
      message,
      fileLabel: lastInputLabel,
      sourceText: lastSourceText,
      context: { tool: 'dali-cli' }
    });
    if (lastJsonMode) {
      console.error(JSON.stringify(diagnostic));
    } else {
      const textDiag = lastSourceText
        ? formatDiagnosticWithSource(lastSourceText, message, lastInputLabel)
        : message;
      console.error(`[dali-cli][${classifyDiagnostic(message)}][${diagnostic.timestamp}] ${textDiag}`);
    }
    process.exit(1);
  }
}

bootstrap();
