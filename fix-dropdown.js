const fs = require('fs');
let code = fs.readFileSync('renderer.js', 'utf8');

const oldBlockStart = code.indexOf('if (elements.behaviorWebSearchEngine) {');
const oldBlockEndStr = `        window.addEventListener('ardali:settings-changed', (e) => {
            if (e.detail && e.detail.webSearchEngine && e.detail.webSearchEngine !== currentValue) {
                updateDropdownUI(e.detail.webSearchEngine);
                if (!state.settings || typeof state.settings !== 'object') state.settings = {};
                if (!state.settings.web || typeof state.settings.web !== 'object') state.settings.web = {};
                state.settings.web.searchEngine = e.detail.webSearchEngine;
                markSettingsDirty();
            }
        });
    }`;
const oldBlockEnd = code.indexOf(oldBlockEndStr, oldBlockStart);

if (oldBlockStart === -1 || oldBlockEnd === -1) {
    console.error('Could not find block');
    process.exit(1);
}

const newBlock = `
    // Custom Dropdown Event Delegation
    document.addEventListener('click', (e) => {
        const trigger = e.target.closest('.custom-dropdown-trigger');
        if (trigger) {
            e.stopPropagation();
            const dd = trigger.closest('.custom-dropdown');
            if (dd) {
                document.querySelectorAll('.custom-dropdown.open').forEach(el => {
                    if (el !== dd) el.classList.remove('open');
                });
                dd.classList.toggle('open');
            }
            return;
        }

        const option = e.target.closest('.custom-dropdown-option');
        if (option) {
            e.stopPropagation();
            const dd = option.closest('.custom-dropdown');
            if (dd) {
                const val = option.dataset.value;
                const currentIcon = dd.querySelector('.custom-dropdown-icon');
                const currentText = dd.querySelector('.custom-dropdown-text');
                
                dd.querySelectorAll('.custom-dropdown-option').forEach(opt => opt.classList.remove('selected'));
                option.classList.add('selected');
                
                if (currentIcon && option.querySelector('img')) currentIcon.src = option.querySelector('img').src;
                if (currentText && option.querySelector('span')) currentText.textContent = option.querySelector('span').textContent;
                
                dd.classList.remove('open');
                
                if (dd.id === 'behaviorWebSearchEngine') {
                    if (!state.settings || typeof state.settings !== 'object') state.settings = {};
                    if (!state.settings.web || typeof state.settings.web !== 'object') state.settings.web = {};
                    state.settings.web.searchEngine = val;
                    if (typeof markSettingsDirty === 'function') markSettingsDirty();
                    
                    // Dispatch both ways
                    window.dispatchEvent(new CustomEvent('ardali:settings-changed', {
                        detail: { webSearchEngine: val }
                    }));
                    document.dispatchEvent(new CustomEvent('ardali:settings-changed', {
                        detail: { webSearchEngine: val }
                    }));
                }
            }
            return;
        }

        document.querySelectorAll('.custom-dropdown.open').forEach(el => el.classList.remove('open'));
    });

    if (elements.behaviorWebSearchEngine) {
        const dd = elements.behaviorWebSearchEngine;
        let currentValue = 'duckduckgo';
        Object.defineProperty(dd, 'value', {
            get: function() { return currentValue; },
            set: function(val) { 
                currentValue = val;
                const opt = dd.querySelector(\`.custom-dropdown-option[data-value="\${val}"]\`);
                if (opt) {
                    const currentIcon = dd.querySelector('.custom-dropdown-icon');
                    const currentText = dd.querySelector('.custom-dropdown-text');
                    dd.querySelectorAll('.custom-dropdown-option').forEach(o => o.classList.remove('selected'));
                    opt.classList.add('selected');
                    if (currentIcon && opt.querySelector('img')) currentIcon.src = opt.querySelector('img').src;
                    if (currentText && opt.querySelector('span')) currentText.textContent = opt.querySelector('span').textContent;
                }
            }
        });
    }

    window.addEventListener('ardali:settings-changed', (e) => {
        if (e.detail && e.detail.webSearchEngine) {
            if (elements.behaviorWebSearchEngine && elements.behaviorWebSearchEngine.value !== e.detail.webSearchEngine) {
                elements.behaviorWebSearchEngine.value = e.detail.webSearchEngine;
            }
            if (!state.settings || typeof state.settings !== 'object') state.settings = {};
            if (!state.settings.web || typeof state.settings.web !== 'object') state.settings.web = {};
            
            if (state.settings.web.searchEngine !== e.detail.webSearchEngine) {
                state.settings.web.searchEngine = e.detail.webSearchEngine;
                markSettingsDirty();
            }
        }
    });
`;

code = code.substring(0, oldBlockStart) + newBlock.trim() + code.substring(oldBlockEnd + oldBlockEndStr.length);

// Also add dispatch inside onSettingsReload
const reloadBlock = `window.ardali?.onSettingsReload?.(async (nextSettings, reloadMeta = {}) => {`;
if (code.includes(reloadBlock)) {
    code = code.replace(reloadBlock, reloadBlock + `
        if (nextSettings?.web?.searchEngine) {
            document.dispatchEvent(new CustomEvent('ardali:settings-changed', {
                detail: { webSearchEngine: nextSettings.web.searchEngine }
            }));
            window.dispatchEvent(new CustomEvent('ardali:settings-changed', {
                detail: { webSearchEngine: nextSettings.web.searchEngine }
            }));
        }
    `);
}

fs.writeFileSync('renderer.js', code);
console.log('Done');
