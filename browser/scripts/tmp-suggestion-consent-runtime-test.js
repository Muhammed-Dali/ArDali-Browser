// Manual DevTools-protocol smoke test for the current native new-tab
// suggestion bridge. This attaches to a developer-launched debug endpoint.
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
  if (!message.id || !pending.has(message.id)) return;
  const request = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) request.reject(new Error(message.error.message));
  else request.resolve(message.result);
};
const evaluate = async expression => {
  const response = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
  return response.result.value;
};

socket.onopen = async () => {
  try {
    await call('Runtime.enable');
    await evaluate(`new Promise((resolve,reject)=>{const started=Date.now();const check=()=>{if(document.getElementById('search-suggestions')&&typeof window.daliniraShowSuggestions==='function')resolve(true);else if(Date.now()-started>5000)reject(new Error('current suggestion UI missing'));else setTimeout(check,50)};check()})`);
    const result = await evaluate(`new Promise(resolve=>{
      const input=document.getElementById('query');
      const list=document.getElementById('search-suggestions');
      input.focus();
      input.value='dalinira';
      input.dispatchEvent(new Event('input',{bubbles:true}));
      const rows=[
        {type:'history',text:'DaliNira History',url:'https://history.example/'},
        {type:'remote',text:'DaliNira Remote',url:'https://search.example/?q=dalinira'}
      ];
      // The matching generation is accepted; stale generations must be ignored.
      for(let id=0;id<32;id++)window.daliniraShowSuggestions(id,'dalinira',rows);
      const shown={hidden:list.hidden,count:list.querySelectorAll('.suggestion-row').length,expanded:input.getAttribute('aria-expanded')};
      input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
      const escaped={hidden:list.hidden,expanded:input.getAttribute('aria-expanded')};
      input.focus();input.dispatchEvent(new Event('input',{bubbles:true}));
      for(let id=0;id<32;id++)window.daliniraShowSuggestions(id,'dalinira',rows);
      input.dispatchEvent(new FocusEvent('blur'));
      setTimeout(()=>resolve({shown,escaped,blurred:{hidden:list.hidden,expanded:input.getAttribute('aria-expanded')}}),20);
    })`);
    console.log(JSON.stringify(result, null, 2));
    const ok = !result.shown.hidden && result.shown.count === 2 && result.shown.expanded === 'true'
      && result.escaped.hidden && result.escaped.expanded === 'false'
      && result.blurred.hidden && result.blurred.expanded === 'false';
    process.exit(ok ? 0 : 2);
  } catch (error) {
    console.error(error.stack || error.message);
    process.exit(1);
  }
};
setTimeout(() => { console.error('runtime test timed out'); process.exit(3); }, 10000);
