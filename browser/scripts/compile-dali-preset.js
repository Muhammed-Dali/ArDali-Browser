'use strict';

const fs = require('fs');
const path = require('path');
const { parseDali, compileToWebAudioModule } = require('../../dali-lang/src');

const [sourcePath, outputPath] = process.argv.slice(2);
if (!sourcePath || !outputPath) {
  throw new Error('Usage: compile-dali-preset.js <source.dl> <output.generated.js>');
}

const source = fs.readFileSync(sourcePath, 'utf8');
const ast = parseDali(source);
const output = compileToWebAudioModule(ast, {
  sourceLabel: path.basename(sourcePath),
  securityMode: 'strict'
});
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, output, 'utf8');
