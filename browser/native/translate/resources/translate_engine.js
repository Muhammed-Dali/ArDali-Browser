(function () {
  if (window.__daliniraTranslate) return;

  const originalTexts = new WeakMap(); // Node/Element -> string (for text node) or { [attr]: string } (for element)
  const nodeMeta = new WeakMap(); // Text Node -> { state: 'original'|'pending'|'translated', originalText: string, translatedText: string, targetLang: string }
  const attrMeta = new WeakMap(); // Element -> { [attr]: { state: 'original'|'pending'|'translated', originalText: string, translatedText: string, targetLang: string } }
  const nodeMap = new Map(); // id -> Node | { element: Element, attr: string }
  const pendingNewNodes = new Map(); // id -> { id, text, type, attr, node }
  
  let nextNodeId = 1;
  let observer = null;
  let isTranslating = false;
  let isApplyingBatch = false;
  let hasPendingMutations = false;
  let currentTargetLanguage = '';

  function isIgnoredElement(el) {
    if (!el || el.nodeType !== 1) return false;
    const tag = el.tagName ? el.tagName.toUpperCase() : '';
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'CODE' ||
        tag === 'PRE' || tag === 'KBD' || tag === 'SAMP' || tag === 'TEXTAREA' ||
        tag === 'SELECT' || tag === 'OPTION') {
      return true;
    }
    // Form and password protection
    if (tag === 'INPUT') {
      const inputType = (el.getAttribute('type') || 'text').toLowerCase();
      if (inputType === 'password' || inputType === 'hidden' || inputType === 'submit' || inputType === 'button' || inputType === 'file') {
        return true;
      }
    }
    if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') return true;
    if (el.getAttribute('translate') === 'no') return true;
    if (el.classList && (el.classList.contains('notranslate') || el.classList.contains('no-translate'))) return true;
    if (el.querySelector && el.querySelector('input[type="password"]')) return true;
    return false;
  }

  function shouldTranslateTextNode(node) {
    if (!node || node.nodeType !== 3) return false;
    const orig = originalTexts.get(node);
    const text = (orig !== undefined ? orig : (node.nodeValue || '')).trim();
    if (!text || text.length < 2) return false;
    // Check if pure numbers/punctuation
    if (/^[\d\s\p{P}+<=>~$^|\\/]+$/u.test(text)) return false;

    let parent = node.parentElement;
    while (parent) {
      if (isIgnoredElement(parent)) return false;
      parent = parent.parentElement;
    }
    return true;
  }

  function shouldTranslateAttribute(el, attrName) {
    if (!el || el.nodeType !== 1 || isIgnoredElement(el)) return false;
    const origMap = originalTexts.get(el);
    const val = (origMap && origMap[attrName] !== undefined) ? origMap[attrName] : el.getAttribute(attrName);
    if (!val || typeof val !== 'string') return false;
    const trimmed = val.trim();
    if (!trimmed || trimmed.length < 2) return false;
    if (/^[\d\s\p{P}+<=>~$^|\\/]+$/u.test(trimmed)) return false;
    return true;
  }

  function registerTextNode(node) {
    if (!node || node.nodeType !== 3) return null;
    const currentVal = node.nodeValue;
    if (!currentVal || !currentVal.trim()) return null;

    let id = node.__dalinira_id;
    let origText = currentVal;
    if (!id) {
      id = nextNodeId++;
      node.__dalinira_id = id;
      originalTexts.set(node, currentVal);
      nodeMeta.set(node, {
        state: 'original',
        originalText: currentVal,
        translatedText: '',
        targetLang: ''
      });
    } else {
      const saved = originalTexts.get(node);
      if (saved !== undefined) {
        origText = saved;
      }
    }
    nodeMap.set(id, node);
    return { id: id, type: 'text', text: origText };
  }

  function registerAttribute(el, attrName) {
    if (!el || el.nodeType !== 1) return null;
    const currentVal = el.getAttribute(attrName);
    if (!currentVal || !currentVal.trim()) return null;

    let attrKey = '__dalinira_id_' + attrName;
    let id = el[attrKey];
    let origVal = currentVal;
    let origMap = originalTexts.get(el);
    if (!id) {
      id = nextNodeId++;
      el[attrKey] = id;
      if (!origMap || typeof origMap !== 'object') {
        origMap = {};
        originalTexts.set(el, origMap);
      }
      origMap[attrName] = currentVal;
      let metaMap = attrMeta.get(el);
      if (!metaMap) {
        metaMap = {};
        attrMeta.set(el, metaMap);
      }
      metaMap[attrName] = {
        state: 'original',
        originalText: currentVal,
        translatedText: '',
        targetLang: ''
      };
    } else {
      if (origMap && origMap[attrName] !== undefined) {
        origVal = origMap[attrName];
      }
    }
    nodeMap.set(id, { element: el, attr: attrName });
    return { id: id, type: 'attr', attr: attrName, text: origVal };
  }

  function isItemTranslatedForCurrentTarget(item) {
    if (!item) return true;
    if (!currentTargetLanguage) return false;
    const entry = nodeMap.get(item.id);
    if (!entry) return false;
    if (item.type === 'attr' || (entry.element && entry.attr)) {
      const el = entry.element || entry;
      const attr = item.attr || entry.attr;
      const metaMap = attrMeta.get(el);
      if (!metaMap || !metaMap[attr]) return false;
      return metaMap[attr].state === 'translated' && metaMap[attr].targetLang === currentTargetLanguage;
    } else if (entry.nodeType === 3) {
      const meta = nodeMeta.get(entry);
      if (!meta) return false;
      return meta.state === 'translated' && meta.targetLang === currentTargetLanguage;
    }
    return false;
  }

  function traverseNode(root, collectList) {
    if (!root) return;

    if (root.nodeType === 3) {
      if (shouldTranslateTextNode(root)) {
        const item = registerTextNode(root);
        if (item && collectList) collectList.push(item);
      }
      return;
    }

    if (root.nodeType === 1) {
      if (isIgnoredElement(root)) return;

      // Safe UI Attributes
      const safeAttrs = ['title', 'placeholder', 'aria-label'];
      for (const attr of safeAttrs) {
        if (shouldTranslateAttribute(root, attr)) {
          const item = registerAttribute(root, attr);
          if (item && collectList) collectList.push(item);
        }
      }

      // Check open Shadow DOM root
      if (root.shadowRoot && root.shadowRoot.mode === 'open') {
        traverseNode(root.shadowRoot, collectList);
      }

      // Check same-origin iframes
      if (root.tagName === 'IFRAME') {
        try {
          const doc = root.contentDocument;
          if (doc && doc.body) {
            traverseNode(doc.body, collectList);
          }
        } catch (e) {
          // Cross-origin iframe: skip silently
        }
      }
    }

    // Traverse children via TreeWalker
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      {
        acceptNode: function (node) {
          if (node.nodeType === 1) {
            if (isIgnoredElement(node)) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          }
          if (node.nodeType === 3) {
            return shouldTranslateTextNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
          }
          return NodeFilter.FILTER_SKIP;
        }
      }
    );

    while (walker.nextNode()) {
      const curr = walker.currentNode;
      if (curr.nodeType === 3) {
        const item = registerTextNode(curr);
        if (item && collectList) collectList.push(item);
      } else if (curr.nodeType === 1) {
        const safeAttrs = ['title', 'placeholder', 'aria-label'];
        for (const attr of safeAttrs) {
          if (shouldTranslateAttribute(curr, attr)) {
            const item = registerAttribute(curr, attr);
            if (item && collectList) collectList.push(item);
          }
        }
        if (curr.shadowRoot && curr.shadowRoot.mode === 'open') {
          traverseNode(curr.shadowRoot, collectList);
        }
      }
    }
  }

  function onMutations(mutations) {
    if (isApplyingBatch || !isTranslating) return;

    let foundNew = false;
    for (const mut of mutations) {
      if (mut.type === 'childList') {
        for (const added of mut.addedNodes) {
          if (added.nodeType === 3) {
            if (shouldTranslateTextNode(added)) {
              const item = registerTextNode(added);
              if (item && !isItemTranslatedForCurrentTarget(item)) {
                pendingNewNodes.set(item.id, item);
                foundNew = true;
              }
            }
          } else if (added.nodeType === 1) {
            if (!isIgnoredElement(added)) {
              const list = [];
              traverseNode(added, list);
              for (const item of list) {
                if (!isItemTranslatedForCurrentTarget(item)) {
                  pendingNewNodes.set(item.id, item);
                  foundNew = true;
                }
              }
            }
          }
        }
      } else if (mut.type === 'characterData') {
        const node = mut.target;
        if (node && node.nodeType === 3 && shouldTranslateTextNode(node)) {
          const meta = nodeMeta.get(node);
          const currentVal = node.nodeValue;
          if (meta) {
            if (currentVal !== meta.translatedText && currentVal !== meta.originalText) {
              // Text was updated by page script
              originalTexts.set(node, currentVal);
              meta.originalText = currentVal;
              meta.state = 'original';
              meta.translatedText = '';
              meta.targetLang = '';
              const item = registerTextNode(node);
              if (item) {
                pendingNewNodes.set(item.id, item);
                foundNew = true;
              }
            }
          } else {
            const item = registerTextNode(node);
            if (item && !isItemTranslatedForCurrentTarget(item)) {
              pendingNewNodes.set(item.id, item);
              foundNew = true;
            }
          }
        }
      }
    }

    if (foundNew) {
      hasPendingMutations = true;
    }
  }

  function handleSpaNavigation() {
    if (!isTranslating) return;
    setTimeout(function () {
      const list = [];
      traverseNode(document.body || document.documentElement, list);
      for (const item of list) {
        if (!isItemTranslatedForCurrentTarget(item)) {
          pendingNewNodes.set(item.id, item);
        }
      }
    }, 150);
  }

  window.__daliniraTranslate = {
    detect: function () {
      const html = document.documentElement;
      const htmlLang = html ? (html.getAttribute('lang') || html.getAttribute('xml:lang') || '') : '';
      
      let metaLang = '';
      const meta = document.querySelector('meta[http-equiv="content-language" i], meta[name="language" i]');
      if (meta) {
        metaLang = meta.getAttribute('content') || '';
      }

      let sampleText = '';
      const walker = document.createTreeWalker(
        document.body || document.documentElement,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: function (node) {
            return shouldTranslateTextNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
          }
        }
      );

      let count = 0;
      while (walker.nextNode() && count < 10) {
        sampleText += ' ' + walker.currentNode.nodeValue.trim();
        count++;
        if (sampleText.length > 500) break;
      }

      return {
        htmlLang: htmlLang,
        metaLang: metaLang,
        sampleText: sampleText.trim()
      };
    },

    extractNodes: function (options) {
      const targetLang = (typeof options === 'string' ? options : (options && options.lang)) || '';
      if (targetLang) {
        currentTargetLanguage = targetLang;
      }
      pendingNewNodes.clear();
      hasPendingMutations = false;

      const result = [];
      const root = document.body || document.documentElement;
      if (!root) return { nodes: [] };

      traverseNode(root, result);

      if (currentTargetLanguage) {
        for (const item of result) {
          const node = nodeMap.get(item.id);
          if (item.type === 'attr') {
            const actualNode = node && node.element;
            if (actualNode) {
              let metaMap = attrMeta.get(actualNode);
              if (!metaMap) {
                metaMap = {};
                attrMeta.set(actualNode, metaMap);
              }
              metaMap[item.attr] = {
                state: 'pending',
                originalText: item.text,
                translatedText: '',
                targetLang: currentTargetLanguage
              };
            }
          } else if (node && node.nodeType === 3) {
            let meta = nodeMeta.get(node);
            if (!meta) {
              meta = {
                state: 'pending',
                originalText: item.text,
                translatedText: '',
                targetLang: currentTargetLanguage
              };
              nodeMeta.set(node, meta);
            } else {
              meta.state = 'pending';
              meta.targetLang = currentTargetLanguage;
            }
          }
        }
      }

      return { nodes: result };
    },

    startObserving: function (options) {
      const targetLang = (typeof options === 'string' ? options : (options && options.lang)) || '';
      if (targetLang) {
        currentTargetLanguage = targetLang;
      }
      isTranslating = true;
      if (!observer) {
        observer = new MutationObserver(onMutations);
        const root = document.body || document.documentElement;
        if (root) {
          observer.observe(root, {
            childList: true,
            subtree: true,
            characterData: true
          });
        }
      }
    },

    stopObserving: function () {
      isTranslating = false;
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      pendingNewNodes.clear();
      hasPendingMutations = false;
    },

    checkPendingMutations: function () {
      if (!isTranslating || pendingNewNodes.size === 0) {
        return { nodes: [] };
      }
      const list = Array.from(pendingNewNodes.values());
      pendingNewNodes.clear();
      hasPendingMutations = false;
      return { nodes: list };
    },

    applyTranslations: function (items) {
      if (!Array.isArray(items)) return false;
      isApplyingBatch = true;
      try {
        for (const item of items) {
          const entry = nodeMap.get(item.id);
          if (!entry) continue;

          if (item.type === 'attr' || (entry.element && entry.attr)) {
            const el = entry.element || entry;
            const attr = item.attr || entry.attr;
            if (el && el.nodeType === 1) {
              el.setAttribute(attr, item.translated);
              let metaMap = attrMeta.get(el);
              if (!metaMap) {
                metaMap = {};
                attrMeta.set(el, metaMap);
              }
              metaMap[attr] = {
                state: 'translated',
                originalText: originalTexts.get(el) ? originalTexts.get(el)[attr] : '',
                translatedText: item.translated,
                targetLang: currentTargetLanguage
              };
            }
          } else if (entry.nodeType === 3) {
            entry.nodeValue = item.translated;
            let meta = nodeMeta.get(entry);
            if (!meta) {
              meta = {
                state: 'translated',
                originalText: originalTexts.get(entry) || '',
                translatedText: item.translated,
                targetLang: currentTargetLanguage
              };
              nodeMeta.set(entry, meta);
            } else {
              meta.state = 'translated';
              meta.translatedText = item.translated;
              meta.targetLang = currentTargetLanguage;
            }
          }
        }
      } finally {
        isApplyingBatch = false;
      }
      return true;
    },

    restoreOriginal: function () {
      isApplyingBatch = true;
      isTranslating = false;
      currentTargetLanguage = '';
      try {
        for (const [id, entry] of nodeMap.entries()) {
          if (!entry) continue;
          if (entry.element && entry.attr) {
            const el = entry.element;
            const attr = entry.attr;
            const orig = originalTexts.get(el);
            if (orig && orig[attr] !== undefined) {
              el.setAttribute(attr, orig[attr]);
            }
            let metaMap = attrMeta.get(el);
            if (metaMap && metaMap[attr]) {
              metaMap[attr].state = 'original';
              metaMap[attr].translatedText = '';
              metaMap[attr].targetLang = '';
            }
          } else if (entry.nodeType === 3) {
            const orig = originalTexts.get(entry);
            if (orig !== undefined) {
              entry.nodeValue = orig;
              const meta = nodeMeta.get(entry);
              if (meta) {
                meta.state = 'original';
                meta.translatedText = '';
                meta.targetLang = '';
              }
            }
          }
        }
      } finally {
        isApplyingBatch = false;
      }
      pendingNewNodes.clear();
      hasPendingMutations = false;
      return true;
    },

    reset: function () {
      this.stopObserving();
      nodeMap.clear();
      pendingNewNodes.clear();
      currentTargetLanguage = '';
      hasPendingMutations = false;
    }
  };

  // Setup SPA pushState / replaceState / popstate hooks
  if (typeof history !== 'undefined' && history.pushState && !history.__dalinira_patched) {
    history.__dalinira_patched = true;
    const origPush = history.pushState;
    history.pushState = function () {
      const res = origPush.apply(this, arguments);
      handleSpaNavigation();
      return res;
    };

    const origReplace = history.replaceState;
    history.replaceState = function () {
      const res = origReplace.apply(this, arguments);
      handleSpaNavigation();
      return res;
    };

    window.addEventListener('popstate', function () {
      handleSpaNavigation();
    });
  }
})();
