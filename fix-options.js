const fs = require('fs');

function fixFile(file) {
    let content = fs.readFileSync(file, 'utf8');
    
    // Add onclick to options
    content = content.replace(
        /<div class="custom-dropdown-option" data-value="([^"]+)">/g,
        '<div class="custom-dropdown-option" data-value="$1" onclick="if(window.handleCustomDropdownOptionClick) window.handleCustomDropdownOptionClick(this); event.stopPropagation();">'
    );
    
    fs.writeFileSync(file, content);
}

fixFile('index.html');
fixFile('settings.html');

let renderer = fs.readFileSync('renderer.js', 'utf8');
if (!renderer.includes('window.handleCustomDropdownOptionClick')) {
    renderer += `
window.handleCustomDropdownOptionClick = function(option) {
    const dd = option.closest('.custom-dropdown');
    if (dd) {
        const val = option.dataset.value;
        dd.value = val;
        dd.classList.remove('open');
        if (dd.id === 'behaviorWebSearchEngine') {
            if (!state.settings || typeof state.settings !== 'object') state.settings = {};
            if (!state.settings.web || typeof state.settings.web !== 'object') state.settings.web = {};
            state.settings.web.searchEngine = val;
            if (typeof markSettingsDirty === 'function') markSettingsDirty();
            
            window.dispatchEvent(new CustomEvent('ardali:settings-changed', {
                detail: { webSearchEngine: val }
            }));
            document.dispatchEvent(new CustomEvent('ardali:settings-changed', {
                detail: { webSearchEngine: val }
            }));
        }
    }
};
`;
    fs.writeFileSync('renderer.js', renderer);
}

console.log('Fixed HTML files and renderer.js');
