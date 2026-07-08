const { JSDOM } = require('jsdom');
const dom = new JSDOM(`
<!DOCTYPE html>
<html><body>
<div class="custom-dropdown" id="behaviorWebSearchEngine">
    <div class="custom-dropdown-trigger" onclick="this.parentElement.classList.toggle('open'); event.stopPropagation();">
        <img src="https://duckduckgo.com/favicon.ico" class="custom-dropdown-icon" alt="">
        <span class="custom-dropdown-text">DuckDuckGo</span>
        <span class="material-symbols-rounded">expand_more</span>
    </div>
    <div class="custom-dropdown-menu">
        <div class="custom-dropdown-option" data-value="google" onclick="if(window.handleCustomDropdownOptionClick) window.handleCustomDropdownOptionClick(this); event.stopPropagation();">
            <img src="https://www.google.com/favicon.ico" alt=""> <span>Google</span>
        </div>
    </div>
</div>
</body></html>
`);
const window = dom.window;
const document = window.document;

const state = { settings: {} };
function markSettingsDirty() { console.log("markSettingsDirty called"); }

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
            
            window.dispatchEvent(new window.CustomEvent('ardali:settings-changed', {
                detail: { webSearchEngine: val }
            }));
            document.dispatchEvent(new window.CustomEvent('ardali:settings-changed', {
                detail: { webSearchEngine: val }
            }));
        }
    }
};

const dd = document.getElementById('behaviorWebSearchEngine');
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

const googleOpt = document.querySelector('.custom-dropdown-option[data-value="google"]');
window.handleCustomDropdownOptionClick(googleOpt);

console.log("New value:", dd.value);
console.log("New text:", dd.querySelector('.custom-dropdown-text').textContent);
console.log("State:", state.settings.web.searchEngine);
