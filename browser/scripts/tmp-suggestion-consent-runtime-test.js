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
    await evaluate(`new Promise((resolve,reject)=>{const started=Date.now();const check=()=>{if(document.getElementById('ardali-native-suggestions'))resolve(true);else if(Date.now()-started>5000)reject(new Error('suggestion UI missing'));else setTimeout(check,50)};check()})`);
    const before = await evaluate(`new Promise(resolve=>{
      localStorage.removeItem('ardali.searchSuggestions');
      window.dispatchEvent(new Event('ardali-settings-search-suggestions'));
      window.ardaliRemoteSuggestions=[];
      const input=document.getElementById('query');input.value='eba';input.dispatchEvent(new FocusEvent('focus'));input.dispatchEvent(new Event('input',{bubbles:true}));
      setTimeout(()=>resolve({consent:localStorage.getItem('ardali.searchSuggestions'),prompt:!!document.querySelector('.ardali-consent'),titles:[...document.querySelectorAll('.ardali-suggestion-title')].map(x=>x.textContent),icons:document.querySelectorAll('.ardali-suggestion-icon').length}),250);
    })`);
    const after = await evaluate(`new Promise(resolve=>{
      document.querySelector('.ardali-consent-enable').click();
      setTimeout(()=>resolve({consent:localStorage.getItem('ardali.searchSuggestions'),prompt:!!document.querySelector('.ardali-consent'),titles:[...document.querySelectorAll('.ardali-suggestion-title')].map(x=>x.textContent),icons:[...document.querySelectorAll('.ardali-suggestion-icon')].map(x=>({src:x.src,complete:x.complete,width:x.naturalWidth}))}),1800);
    })`);
    const disabled = await evaluate(`new Promise(resolve=>{
      localStorage.setItem('ardali.searchSuggestions','disabled');window.dispatchEvent(new Event('ardali-settings-search-suggestions'));
      setTimeout(()=>resolve({consent:localStorage.getItem('ardali.searchSuggestions'),titles:[...document.querySelectorAll('.ardali-suggestion-title')].map(x=>x.textContent),icons:document.querySelectorAll('.ardali-suggestion-icon').length}),350);
    })`);
    console.log(JSON.stringify({ before, after, disabled }, null, 2));
    const hasEbay = after.titles.some(title => title.toLocaleLowerCase('tr-TR') === 'ebay');
    const hasEbayIcon = after.icons.some(icon => icon.src.includes('ebay.com') && icon.complete && icon.width > 0);
    const ok = before.prompt && before.consent === null && before.titles.length === 1 && before.icons === 0
      && !after.prompt && after.consent === 'enabled' && hasEbay && hasEbayIcon
      && disabled.consent === 'disabled' && disabled.titles.length === 1 && disabled.icons === 0;
    process.exit(ok ? 0 : 2);
  } catch (error) {
    console.error(error.stack || error.message);
    process.exit(1);
  }
};
setTimeout(() => { console.error('runtime test timed out'); process.exit(3); }, 10000);
