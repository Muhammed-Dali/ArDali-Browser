const fs = require('fs');

function fixFile(file) {
    let content = fs.readFileSync(file, 'utf8');
    
    // Add onclick to trigger
    content = content.replace(
        /<div class="custom-dropdown-trigger">/g,
        `<div class="custom-dropdown-trigger" onclick="this.parentElement.classList.toggle('open'); event.stopPropagation();">`
    );
    
    // Add onclick to options
    content = content.replace(
        /<div class="custom-dropdown-option" data-value="([^"]+)">/g,
        '<div class="custom-dropdown-option" data-value="$1" onclick="if(window.selectCustomSearchEngine) window.selectCustomSearchEngine(this); event.stopPropagation();">'
    );
    
    fs.writeFileSync(file, content);
}

fixFile('index.html');
fixFile('settings.html');
console.log('Fixed HTML files');
