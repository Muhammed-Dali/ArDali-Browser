(function () {
  if (window.__ardaliTranslate) return;

  const originalTexts = new WeakMap(); // Node -> original text or { attr: text }
  const nodeMeta = new WeakMap(); // Node -> { state: 'original'|'pending'|'translated', translatedText: string, originalText: string }
  const nodeMap = new Map(); // id -> Node
  const pendingNewNodes = new Map(); // id -> { id, text, type, attr, node }
  
  let nextNodeId = 1;
  let observer = null;
  let isTranslating = false;
  let isApplyingBatch = false;
  let hasPendingMutations = false;

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
    const text = node.nodeValue ? node.nodeValue.trim() : '';
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
    const val = el.getAttribute(attrName);
    if (!val || typeof val !== 'string') return false;
    const trimmed = val.trim();
    if (!trimmed || trimmed.length < 2) return false;
    if (/^[\d\s\p{P}+<=>~$^|\\/]+$/u.test(trimmed)) return false;
    return true;
  }

  function registerTextNode(node) {
    if (!node || node.nodeType !== 3) return null;
    const text = node.nodeValue;
    if (!text || !text.trim()) return null;

    let id = node.__ardali_id;
    if (!id) {
      id = nextNodeId++;
      node.__ardali_id = id;
      originalTexts.set(node, text);
      nodeMeta.set(node, {
        state: 'original',
        originalText: text,
        translatedText: ''
      });
    }
    nodeMap.set(id, node);
    return { id: id, type: 'text', text: text };
  }

  function registerAttribute(el, attrName) {
    if (!el || el.nodeType !== 1) return null;
    const val = el.getAttribute(attrName);
    if (!val || !val.trim()) return null;

    let attrKey = '__ardali_id_' + attrName;
    let id = el[attrKey];
    if (!id) {
      id = nextNodeId++;
      el[attrKey] = id;
      let origMap = originalTexts.get(el);
      if (!origMap || typeof origMap !== 'object') {
        origMap = {};
        originalTexts.set(el, origMap);
      }
      origMap[attrName] = val;
    }
    nodeMap.set(id, { element: el, attr: attrName });
    return { id: id, type: 'attr', attr: attrName, text: val };
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
              const meta = nodeMeta.get(added);
              if (!meta || meta.state === 'original') {
                const item = registerTextNode(added);
                if (item) {
                  pendingNewNodes.set(item.id, item);
                  foundNew = true;
                }
              }
            }
          } else if (added.nodeType === 1) {
            if (!isIgnoredElement(added)) {
              const list = [];
              traverseNode(added, list);
              for (const item of list) {
                const node = nodeMap.get(item.id);
                const actualNode = (item.type === 'attr') ? (node && node.element) : node;
                const meta = actualNode ? nodeMeta.get(actualNode) : null;
                if (!meta || meta.state !== 'translated') {
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
              const item = registerTextNode(node);
              if (item) {
                pendingNewNodes.set(item.id, item);
                foundNew = true;
              }
            }
          } else {
            const item = registerTextNode(node);
            if (item) {
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

  window.__ardaliTranslate = {
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

    extractNodes: function () {
      const result = [];
      const root = document.body || document.documentElement;
      if (!root) return { nodes: [] };

      traverseNode(root, result);
      return { nodes: result };
    },

    startObserving: function () {
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
            }
          } else if (entry.nodeType === 3) {
            entry.nodeValue = item.translated;
            const meta = nodeMeta.get(entry);
            if (meta) {
              meta.state = 'translated';
              meta.translatedText = item.translated;
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
          } else if (entry.nodeType === 3) {
            const orig = originalTexts.get(entry);
            if (orig !== undefined) {
              entry.nodeValue = orig;
              const meta = nodeMeta.get(entry);
              if (meta) {
                meta.state = 'original';
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
      nextNodeId = 1;
      hasPendingMutations = false;
    }
  };

  // Setup SPA pushState / replaceState / popstate hooks
  if (typeof history !== 'undefined' && history.pushState && !history.__ardali_patched) {
    history.__ardali_patched = true;
    const origPush = history.pushState;
    history.pushState = function () {
      const res = origPush.apply(this, arguments);
      if (isTranslating) {
        setTimeout(function () {
          const list = [];
          traverseNode(document.body || document.documentElement, list);
          for (const item of list) {
            const node = nodeMap.get(item.id);
            const actualNode = (item.type === 'attr') ? (node && node.element) : node;
            const meta = actualNode ? nodeMeta.get(actualNode) : null;
            if (!meta || meta.state !== 'translated') {
              pendingNewNodes.set(item.id, item);
            }
          }
        }, 150);
      }
      return res;
    };

    const origReplace = history.replaceState;
    history.replaceState = function () {
      const res = origReplace.apply(this, arguments);
      if (isTranslating) {
        setTimeout(function () {
          const list = [];
          traverseNode(document.body || document.documentElement, list);
          for (const item of list) {
            const node = nodeMap.get(item.id);
            const actualNode = (item.type === 'attr') ? (node && node.element) : node;
            const meta = actualNode ? nodeMeta.get(actualNode) : null;
            if (!meta || meta.state !== 'translated') {
              pendingNewNodes.set(item.id, item);
            }
          }
        }, 150);
      }
      return res;
    };

    window.addEventListener('popstate', function () {
      if (isTranslating) {
        setTimeout(function () {
          const list = [];
          traverseNode(document.body || document.documentElement, list);
          for (const item of list) {
            const node = nodeMap.get(item.id);
            const actualNode = (item.type === 'attr') ? (node && node.element) : node;
            const meta = actualNode ? nodeMeta.get(actualNode) : null;
            if (!meta || meta.state !== 'translated') {
              pendingNewNodes.set(item.id, item);
            }
          }
        }, 150);
      }
    });
  }
})();
