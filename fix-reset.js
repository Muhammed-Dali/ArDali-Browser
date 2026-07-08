const fs = require('fs');
let code = fs.readFileSync('renderer.js', 'utf8');

const anchor = 'function resetWebDefaults() {\n';
if (code.includes(anchor)) {
    code = code.replace(anchor, anchor + "    if (elements.behaviorWebSearchEngine) elements.behaviorWebSearchEngine.value = 'duckduckgo';\n");
    fs.writeFileSync('renderer.js', code);
    console.log('Fixed resetWebDefaults');
} else {
    console.error('Anchor not found');
}
