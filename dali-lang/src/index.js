'use strict';

const { parseDali } = require('./parser');
const { compileToWebAudioModule } = require('./compiler-web-audio');
const { compileToWasmModuleSkeleton } = require('./compiler-wasm');
const { validateProgramSecurity, validateSourceLimits, CAPABILITY_POLICY, ALLOWED_UNITS } = require('./security-validator');
const {
  signSourceText,
  verifySourceTextSignature,
  defaultSignaturePathForSource
} = require('./signature');
const {
  formatDiagnosticWithSource,
  createDiagnostic,
  classifyDiagnostic,
  inferDiagnosticCode
} = require('./diagnostics');
const { runProgramTasks } = require('./task-runtime');
const { createProgramIR, hashIR } = require('./ir');
const { loadOrCreateCachedIR, defaultCacheDir } = require('./ir-cache');

module.exports = {
  parseDali,
  compileToWebAudioModule,
  compileToWasmModuleSkeleton,
  validateProgramSecurity,
  validateSourceLimits,
  CAPABILITY_POLICY,
  ALLOWED_UNITS,
  signSourceText,
  verifySourceTextSignature,
  defaultSignaturePathForSource,
  formatDiagnosticWithSource,
  createDiagnostic,
  classifyDiagnostic,
  inferDiagnosticCode,
  runProgramTasks,
  createProgramIR,
  hashIR,
  loadOrCreateCachedIR,
  defaultCacheDir
};
