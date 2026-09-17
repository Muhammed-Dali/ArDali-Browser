"use strict";

const vscode = require("vscode");

const KNOWN_BLOCKS = new Set([
  "engine",
  "chain",
  "quality",
  "module",
  "preamp",
  "eq32",
  "peaking",
  "low_shelf",
  "high_shelf",
  "compressor",
  "limiter",
  "reverb",
  "bassboost",
  "deesser",
  "exciter",
  "stereowidener",
  "echo",
  "noisegate",
  "autogain",
  "truepeak",
  "dynamiceq",
  "crossfeed",
  "surround",
  "bassmono",
  "tapesat",
  "bitdither"
]);

const KNOWN_EFFECT_STATEMENTS = new Set([
  "preamp",
  "peaking",
  "low_shelf",
  "high_shelf",
  "compressor",
  "limiter",
  "reverb",
  "bassboost",
  "deesser",
  "exciter",
  "stereowidener",
  "echo",
  "noisegate",
  "autogain",
  "truepeak",
  "dynamiceq",
  "crossfeed",
  "surround",
  "bassmono",
  "tapesat",
  "bitdither"
]);

const BLOCK_KEYWORDS = [
  "preset",
  "engine",
  "chain",
  "quality",
  "module",
  "preamp",
  "eq32",
  "compressor",
  "limiter",
  "reverb",
  "bassboost",
  "deesser",
  "exciter",
  "stereowidener",
  "echo",
  "noisegate",
  "autogain",
  "truepeak",
  "dynamiceq",
  "crossfeed",
  "surround",
  "bassmono",
  "tapesat",
  "bitdither"
];

const PARAM_KEYS = [
  "gain",
  "freq",
  "frequency",
  "q",
  "threshold",
  "ratio",
  "attack",
  "release",
  "ceiling",
  "enabled",
  "sample_rate",
  "max_latency_ms",
  "true_peak_protection",
  "mix",
  "width",
  "delay",
  "feedback",
  "high_cut",
  "target_level",
  "max_gain",
  "room_size",
  "damping",
  "wet_dry",
  "hf_ratio",
  "input_gain",
  "makeup_gain",
  "knee",
  "amount",
  "cutoff",
  "stereo_width",
  "drive",
  "bit_depth",
  "side",
  "level"
];

const VALUES = ["on", "off", "strict", "realtime", "web", "music", "speakers"];
const ALLOWED_INPUTS = new Set(["web", "music"]);
const ALLOWED_OUTPUTS = new Set(["speakers"]);
const ALLOWED_SAFETY = new Set(["strict"]);
const ALLOWED_PROFILE = new Set(["realtime"]);
const ALLOWED_TOGGLE = new Set(["on", "off"]);

function pushIssue(issues, line, lineIndex, token, message, severity) {
  const start = Math.max(line.indexOf(token), 0);
  issues.push(
    new vscode.Diagnostic(
      new vscode.Range(lineIndex, start, lineIndex, start + token.length),
      message,
      severity
    )
  );
}

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  const diagnostics = vscode.languages.createDiagnosticCollection("dali");
  context.subscriptions.push(diagnostics);

  const refreshDiagnostics = (document) => {
    if (document.languageId !== "dali") {
      return;
    }

    const issues = [];
    for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex += 1) {
      const line = document.lineAt(lineIndex).text;
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("//")) {
        continue;
      }

      const blockMatch = trimmed.match(/^([a-z_][a-z0-9_]*)\s*\{/i);
      if (blockMatch) {
        const token = blockMatch[1];
        if (!KNOWN_BLOCKS.has(token)) {
          pushIssue(
            issues,
            line,
            lineIndex,
            token,
            `Unknown DALI block/effect: '${token}'.`,
            vscode.DiagnosticSeverity.Error
          );
        }
        continue;
      }

      const legacyEffectMatch = trimmed.match(/^([a-z_][a-z0-9_]*)\s+[^;]*=.*;/i);
      if (legacyEffectMatch) {
        const token = legacyEffectMatch[1];
        if (!KNOWN_EFFECT_STATEMENTS.has(token)) {
          pushIssue(
            issues,
            line,
            lineIndex,
            token,
            `Unknown DALI effect statement: '${token}'.`,
            vscode.DiagnosticSeverity.Error
          );
        }
      }

      // Security-critical target validation.
      const inputMatch = trimmed.match(/^input\s*[:\s]\s*([a-z_][a-z0-9_]*)\s*;?$/i);
      if (inputMatch && !ALLOWED_INPUTS.has(inputMatch[1])) {
        pushIssue(
          issues,
          line,
          lineIndex,
          inputMatch[1],
          `Invalid input target '${inputMatch[1]}'. Allowed: web, music.`,
          vscode.DiagnosticSeverity.Error
        );
      }

      const outputMatch = trimmed.match(/^output\s*[:\s]\s*([a-z_][a-z0-9_]*)\s*;?$/i);
      if (outputMatch && !ALLOWED_OUTPUTS.has(outputMatch[1])) {
        pushIssue(
          issues,
          line,
          lineIndex,
          outputMatch[1],
          `Invalid output target '${outputMatch[1]}'. Allowed: speakers.`,
          vscode.DiagnosticSeverity.Error
        );
      }

      const safetyMatch = trimmed.match(/^safety\s*[:\s]\s*([a-z_][a-z0-9_]*)\s*;?$/i);
      if (safetyMatch && !ALLOWED_SAFETY.has(safetyMatch[1])) {
        pushIssue(
          issues,
          line,
          lineIndex,
          safetyMatch[1],
          `Invalid safety mode '${safetyMatch[1]}'. Allowed: strict.`,
          vscode.DiagnosticSeverity.Error
        );
      }

      const profileMatch = trimmed.match(/^profile\s*[:\s]\s*([a-z_][a-z0-9_]*)\s*;?$/i);
      if (profileMatch && !ALLOWED_PROFILE.has(profileMatch[1])) {
        pushIssue(
          issues,
          line,
          lineIndex,
          profileMatch[1],
          `Invalid profile '${profileMatch[1]}'. Allowed: realtime.`,
          vscode.DiagnosticSeverity.Error
        );
      }

      const enabledMatch = trimmed.match(/^enabled\s*[:=]\s*([a-z_][a-z0-9_]*)\s*;?$/i);
      if (enabledMatch && !ALLOWED_TOGGLE.has(enabledMatch[1])) {
        pushIssue(
          issues,
          line,
          lineIndex,
          enabledMatch[1],
          `Invalid toggle '${enabledMatch[1]}'. Use on/off.`,
          vscode.DiagnosticSeverity.Error
        );
      }

      // Basic syntax safety net: statement-like lines should end with ';'
      const statementLike =
        /[:=]/.test(trimmed) &&
        !trimmed.endsWith(";") &&
        !trimmed.endsWith("{") &&
        !trimmed.endsWith("}");
      if (statementLike) {
        pushIssue(
          issues,
          line,
          lineIndex,
          trimmed,
          "Missing ';' at end of statement.",
          vscode.DiagnosticSeverity.Error
        );
      }

      // Unit sanity check: rejects unknown unit suffixes.
      const unknownUnitMatch = trimmed.match(/-?(?:\d+\.\d+|\d+)([a-z%]+)/i);
      if (
        unknownUnitMatch &&
        !["hz", "ms", "db", "x", "%"].includes(unknownUnitMatch[1].toLowerCase())
      ) {
        pushIssue(
          issues,
          line,
          lineIndex,
          unknownUnitMatch[1],
          `Unknown unit '${unknownUnitMatch[1]}'. Allowed: hz, ms, db, x, %.`,
          vscode.DiagnosticSeverity.Error
        );
      }
    }

    diagnostics.set(document.uri, issues);
  };

  if (vscode.window.activeTextEditor) {
    refreshDiagnostics(vscode.window.activeTextEditor.document);
  }

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(refreshDiagnostics),
    vscode.workspace.onDidChangeTextDocument((e) => refreshDiagnostics(e.document)),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        refreshDiagnostics(editor.document);
      }
    })
  );

  const completionProvider = vscode.languages.registerCompletionItemProvider(
    { language: "dali", scheme: "file" },
    {
      provideCompletionItems() {
        const items = [];

        for (const keyword of BLOCK_KEYWORDS) {
          const item = new vscode.CompletionItem(keyword, vscode.CompletionItemKind.Keyword);
          items.push(item);
        }

        for (const key of PARAM_KEYS) {
          const item = new vscode.CompletionItem(key, vscode.CompletionItemKind.Property);
          item.insertText = new vscode.SnippetString(`${key}: $1;`);
          items.push(item);
        }

        for (const value of VALUES) {
          const item = new vscode.CompletionItem(value, vscode.CompletionItemKind.Value);
          items.push(item);
        }

        const bandItem = new vscode.CompletionItem("band", vscode.CompletionItemKind.Function);
        bandItem.insertText = new vscode.SnippetString("band(${1:1000hz}) = ${2:0.0db};");
        bandItem.detail = "eq32 band assignment";
        items.push(bandItem);

        return items;
      }
    },
    ":",
    " ",
    "="
  );
  context.subscriptions.push(completionProvider);
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
