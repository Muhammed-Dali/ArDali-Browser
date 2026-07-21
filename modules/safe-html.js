'use strict';

(() => {
    const purifier = window.DOMPurify;
    const policy = Object.freeze({
        USE_PROFILES: Object.freeze({ html: true, svg: true, svgFilters: true }),
        FORBID_TAGS: Object.freeze(['script', 'iframe', 'object', 'embed', 'meta', 'link']),
        FORBID_ATTR: Object.freeze(['srcdoc'])
    });

    const sanitizeHTML = (value) => {
        if (!purifier || typeof purifier.sanitize !== 'function') return '';
        return purifier.sanitize(String(value ?? ''), policy);
    };

    Object.defineProperties(window, {
        ardaliSanitizeHTML: {
            value: sanitizeHTML,
            configurable: false,
            enumerable: false,
            writable: false
        },
        ardaliSetHTML: {
            value: (element, value) => {
                if (!element) return;
                element.innerHTML = sanitizeHTML(value);
            },
            configurable: false,
            enumerable: false,
            writable: false
        }
    });
})();
