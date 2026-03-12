const I18n = require("../translations/i18n");
const i18n = new I18n();
window.__translationsLoaded = false;

(async () => {
	await i18n.init();
	window.__translationsLoaded = true;
	document.dispatchEvent(new Event("translations-loaded"));
})();

window.i18n = i18n;
