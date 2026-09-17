const endpoint = process.argv[2];
if (!endpoint) throw new Error('websocket endpoint required');

const socket = new WebSocket(endpoint);
let nextId = 1;
const pending = new Map();

const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});

socket.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.exceptionThrown') {
    console.error('PAGE_EXCEPTION', JSON.stringify(message.params.exceptionDetails));
  }
  if (!message.id || !pending.has(message.id)) return;
  const request = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) request.reject(new Error(message.error.message));
  else request.resolve(message.result);
};

const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
};

socket.onopen = async () => {
  try {
    await call('Runtime.enable');
    await call('Page.enable');
    await evaluate(`new Promise((resolve, reject) => {
      const started = Date.now();
      const check = () => {
        if (document.getElementById('search') && document.getElementById('ardali-native-suggestions')) resolve(true);
        else if (Date.now() - started > 5000) reject(new Error('new-tab search did not initialize'));
        else setTimeout(check, 50);
      };
      check();
    })`);
    const normal = await evaluate(`(() => {
      const search = document.getElementById('search').getBoundingClientRect();
      const shortcuts = document.getElementById('shortcuts');
      return {width:search.width, top:search.top, focused:document.body.classList.contains('ardali-search-focused'), shortcutsOpacity:getComputedStyle(shortcuts).opacity, shortcutsVisibility:getComputedStyle(shortcuts).visibility};
    })()`);
    const focused = await evaluate(`new Promise(resolve => {
      const input = document.getElementById('query');
      input.focus();
      if (!document.body.classList.contains('ardali-search-focused')) input.dispatchEvent(new FocusEvent('focus'));
      setTimeout(() => {
        const search = document.getElementById('search').getBoundingClientRect();
        const shortcuts = document.getElementById('shortcuts');
        resolve({width:search.width, top:search.top, focused:document.body.classList.contains('ardali-search-focused'), shortcutsOpacity:getComputedStyle(shortcuts).opacity, shortcutsVisibility:getComputedStyle(shortcuts).visibility});
      }, 450);
    })`);
    const restored = await evaluate(`new Promise(resolve => {
      const input = document.getElementById('query');
      input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
      setTimeout(() => {
        const search = document.getElementById('search').getBoundingClientRect();
        const shortcuts = document.getElementById('shortcuts');
        resolve({width:search.width, top:search.top, focused:document.body.classList.contains('ardali-search-focused'), shortcutsOpacity:getComputedStyle(shortcuts).opacity, shortcutsVisibility:getComputedStyle(shortcuts).visibility});
      }, 450);
    })`);
    console.log(JSON.stringify({ normal, focused, restored }, null, 2));
    const ok = !normal.focused && focused.focused && focused.width > normal.width
      && focused.top > normal.top && focused.shortcutsVisibility === 'hidden'
      && !restored.focused && Math.abs(restored.width - normal.width) < 2
      && restored.shortcutsVisibility === 'visible';
    process.exit(ok ? 0 : 2);
  } catch (error) {
    console.error(error.stack || error.message);
    process.exit(1);
  }
};

setTimeout(() => {
  console.error('runtime test timed out');
  process.exit(3);
}, 10000);
