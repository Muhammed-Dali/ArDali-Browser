#include "new_tab_html.h"

QString newTabHtml(const QString &defaultEngine) {
  const QString google = defaultEngine == QLatin1String("Google") ? QStringLiteral(" selected") : QString();
  const QString duck = defaultEngine == QLatin1String("DuckDuckGo") ? QStringLiteral(" selected") : QString();
  const QString brave = defaultEngine == QLatin1String("Brave Search") ? QStringLiteral(" selected") : QString();
  const QString bing = defaultEngine == QLatin1String("Bing") ? QStringLiteral(" selected") : QString();
  return QString::fromUtf8(R"NTP(<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Yeni Sekme</title>
<style>
:root{color-scheme:dark;--overlay:.38;--frequent-panel-alpha:.72;--frequent-icon-alpha:.82;--accent:#58a6c7;--surface:#121a24;--surface-raised:#18222d;--card:#1b2632;--border:#344353;--text:#edf4fb;--muted:#9dafc1}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background-color:#07111f;background-image:var(--new-tab-background,url('ardali-flow-blue.png'));background-position:center;background-size:cover;background-attachment:fixed;background-repeat:no-repeat;color:#fff;font:14px system-ui,sans-serif}
body.plain,body.background-hidden{background-color:#0b1420;background-image:none}
body.customization-open{overflow:hidden}
body:before{content:'';position:fixed;inset:0;background:rgba(2,8,18,var(--overlay));pointer-events:none}
button,input,select{font:inherit}
button{color:inherit}
[hidden]{display:none!important}
.page{position:relative;width:min(620px,calc(100% - 32px));margin:clamp(70px,14vh,145px) auto;text-align:center}
.clock{font-size:clamp(54px,7vw,82px);font-weight:300;letter-spacing:-.06em}
.date{margin:10px 0 20px;color:#d4ddec}
.brand{width:58px;height:58px;margin:auto auto 17px;display:grid;place-items:center;border-radius:15px;background:#101827;overflow:hidden}
.brand img{width:100%;height:100%;object-fit:cover}
.search{position:relative;z-index:20;display:flex;height:52px;border:2px solid #11c5fa;border-radius:28px;background:#05080bdd;overflow:visible}
.search>.search-icon{width:48px;flex:0 0 48px;display:grid;place-items:center;padding-left:5px}
.search>.search-icon img{width:26px;height:26px;border-radius:7px;object-fit:cover}
.search input{flex:1;min-width:0;border:0;outline:0;background:transparent;color:#fff;padding:0 13px 0 2px;font-size:16px}
.engine-picker{position:relative;align-self:center;margin:0 8px 0 0;height:38px}
.engine-current,.engine-option{border:0;background:transparent;cursor:pointer}
.engine-current{width:40px;height:38px;border-left:1px solid #334356;display:grid;place-items:center}
.engine-menu{position:absolute;right:0;top:46px;z-index:21;display:flex;flex-direction:column;gap:2px;min-width:158px;padding:6px;border:1px solid #334356;border-radius:12px;background:#101722;box-shadow:0 10px 25px #0009}
.engine-option{width:100%;height:36px;border-radius:8px;display:flex;align-items:center;gap:10px;padding:0 8px;color:#fff;text-align:left}
.engine-option:hover,.engine-current:hover{background:#24354a}
.engine-current:focus-visible,.engine-option:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.engine-logo{display:grid;place-items:center;width:22px;height:22px}
.engine-logo img{display:block;width:22px;height:22px;object-fit:contain}
.engine-option-label{font-size:13px;line-height:22px}
.module{position:relative;margin-top:30px;padding:17px;text-align:left;background:rgba(12,20,34,var(--frequent-panel-alpha));border:1px solid rgba(44,60,83,var(--frequent-panel-alpha));border-radius:18px;transition:background .16s,border-color .16s}
.head{display:flex;align-items:center;justify-content:space-between;font-weight:700}
.frequent-settings{width:30px;height:30px;margin:-8px;border:0;border-radius:9px;background:#263750dd;cursor:pointer;opacity:0;transform:scale(.92);transition:.16s;display:grid;place-items:center}
.frequent-settings img{width:17px;height:17px}
.module:hover .frequent-settings,.module:focus-within .frequent-settings{opacity:1;transform:none}
.frequent-settings:hover{background:#36506f}
.frequent-settings:focus-visible{opacity:1;transform:none;outline:2px solid var(--accent)}
.shortcuts{display:flex;gap:18px;margin-top:22px;overflow:visible}
.shortcut-wrap{position:relative;width:72px;min-width:72px}
.shortcut{width:100%;border:0;background:transparent;color:#fff;cursor:pointer;padding:0;text-align:center}
.shortcut:hover .shortcut-icon{box-shadow:0 5px 16px #0008}
.shortcut-icon{display:grid;place-items:center;width:44px;height:44px;margin:auto auto 8px;border-radius:50%;background:rgba(255,255,255,var(--frequent-icon-alpha));color:#101827;font-size:20px;font-weight:700;overflow:hidden;transition:box-shadow .16s}
.shortcut-icon img{display:block;width:100%;height:100%;padding:7px;object-fit:contain}
.shortcut-name{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}
.shortcut-remove{position:absolute;z-index:3;right:-4px;top:-10px;width:22px;height:22px;padding:0;border:0;display:grid;place-items:center;background:transparent;color:#dce7f5;font-size:19px;line-height:1;cursor:pointer;opacity:0;filter:drop-shadow(0 1px 2px #000);transition:opacity .14s,color .14s}
.shortcut-wrap:hover .shortcut-remove,.shortcut-remove:focus-visible{opacity:1}
.shortcut-remove:hover{color:#ff6978}
.shortcut-empty{color:#aebbd0;padding:8px 0}
.cards{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px}
.cards article{padding:15px;text-align:left;background:#0c1422e8;border:1px solid #2c3c53;border-radius:18px}
.customize{position:fixed;z-index:40;right:22px;top:22px;width:46px;height:46px;border:1px solid #485469;border-radius:17px;background:#101827dd;cursor:pointer;display:grid;place-items:center;transition:background .15s,border-color .15s,transform .15s}
.customize img{width:21px;height:21px}
.customize:hover{background:#1b2a3d;border-color:#60748b}
.customize:active{transform:scale(.96)}
.customize:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.customization-overlay{position:fixed;z-index:100;inset:0;padding:24px 16px;display:grid;place-items:center;background:rgba(3,7,12,.58)}
.customization-modal{width:min(790px,calc(100vw - 32px));height:min(610px,calc(100vh - 48px));min-height:440px;display:flex;flex-direction:column;overflow:hidden;text-align:left;background:var(--surface);border:1px solid #405064;border-radius:18px;box-shadow:0 24px 70px #000b;color:var(--text)}
.modal-header{height:68px;flex:0 0 68px;display:flex;align-items:center;justify-content:space-between;padding:0 18px 0 24px;border-bottom:1px solid #2d3947}
.modal-header h2{margin:0;font-size:20px;letter-spacing:-.015em}
.modal-close{width:36px;height:36px;border:0;border-radius:10px;background:transparent;cursor:pointer;display:grid;place-items:center}
.modal-close img{width:18px;height:18px}
.modal-close:hover{background:#293745}
.modal-close:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.modal-body{display:grid;grid-template-columns:210px minmax(0,1fr);min-height:0;flex:1}
.category-sidebar{padding:16px 12px;border-right:1px solid #2d3947;background:#151e28;overflow:auto}
.category-button{position:relative;width:100%;height:44px;margin:2px 0;padding:0 12px;border:0;border-radius:9px;background:transparent;color:#b8c5d3;cursor:pointer;display:flex;align-items:center;gap:11px;text-align:left}
.category-button img{width:18px;height:18px;opacity:.82}
.category-button:hover{background:#202d39;color:#e7eef6}
.category-button[aria-selected=true]{background:#263a49;color:#f4f8fc}
.category-button[aria-selected=true]:before{content:'';position:absolute;left:0;top:8px;bottom:8px;width:3px;border-radius:3px;background:#63b0d0}
.category-button[aria-selected=true] img{opacity:1}
.category-button:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.modal-content{min-width:0;overflow:auto;padding:27px 30px 34px;scrollbar-color:#516274 transparent}
.category-panel h3{margin:0 0 5px;font-size:22px}
.category-intro{margin:0 0 22px;color:var(--muted);line-height:1.5}
.settings-card{overflow:hidden;border:1px solid var(--border);border-radius:13px;background:var(--card)}
.setting-row{min-height:74px;padding:15px 17px;display:flex;align-items:center;justify-content:space-between;gap:22px;border-top:1px solid #303e4c}
.setting-row:first-child{border-top:0}
.setting-row.slider-row{display:block}
.setting-copy{min-width:0;flex:1}
.setting-title{display:block;font-weight:600;color:#e9f0f7;line-height:1.35}
.setting-description{display:block;margin-top:4px;color:var(--muted);font-size:12px;line-height:1.45}
.switch{position:relative;flex:0 0 auto;width:42px;height:24px}
.switch input{position:absolute;width:1px;height:1px;opacity:0}
.switch-track{position:absolute;inset:0;border:1px solid #566778;border-radius:15px;background:#303c48;cursor:pointer;transition:.15s}
.switch-track:after{content:'';position:absolute;width:16px;height:16px;left:3px;top:3px;border-radius:50%;background:#cad5df;transition:.15s}
.switch input:checked+.switch-track{border-color:#62accb;background:#276b87}
.switch input:checked+.switch-track:after{transform:translateX(18px);background:#fff}
.switch input:focus-visible+.switch-track{outline:2px solid #8ed2ed;outline-offset:2px}
.range-line{display:grid;grid-template-columns:minmax(120px,1fr) 48px;align-items:center;gap:14px;margin-top:14px}
input[type=range]{width:100%;accent-color:#60b4d6;cursor:pointer}
input[type=range]:focus-visible{outline:2px solid #8ed2ed;outline-offset:4px;border-radius:8px}
.value{color:#c4d2df;text-align:right;font-variant-numeric:tabular-nums}
.themes{display:flex;flex:0 0 auto;padding:3px;border:1px solid #425163;border-radius:10px;background:#131b24}
.themes button{min-width:66px;height:32px;border:0;border-radius:7px;background:transparent;color:#aebdcc;cursor:pointer}
.themes button:hover{color:#fff;background:#263442}
.themes button.active{color:#f6fbff;background:#2d5268;box-shadow:inset 0 0 0 1px #5791ae}
.themes button:focus-visible{outline:2px solid #8ed2ed;outline-offset:1px}
.background-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:15px}
.background-card{position:relative;min-height:118px;padding:0;overflow:hidden;border:2px solid transparent;border-radius:13px;background:#111a24;color:#fff;cursor:pointer;text-align:left}
.background-card img{display:block;width:100%;height:116px;object-fit:cover}
.background-card .background-label{position:absolute;left:9px;right:9px;bottom:8px;padding:7px 9px;border-radius:8px;background:#07101ddd;font-weight:600}
.background-card.selected{border-color:#63b7d8}.background-card.selected:after{content:'✓';position:absolute;right:9px;top:9px;width:25px;height:25px;display:grid;place-items:center;border-radius:50%;background:#287d9f;font-weight:700}
.background-card:focus-visible{outline:2px solid #a1def5;outline-offset:2px}
.upload-card{display:grid;place-items:center;align-content:center;gap:8px;border:1px dashed #60758a;background:#17232f}.upload-card strong{font-size:15px}.upload-card span{color:var(--muted);font-size:12px}
.background-actions{display:flex;justify-content:flex-end;margin-top:12px}.background-status{margin:10px 0 0;color:#a9bacb;font-size:12px;min-height:18px}.background-status.error{color:#ff9ca5}
.radio-list{display:grid}.radio-option{min-height:58px;padding:10px 14px;display:flex;align-items:center;gap:12px;border-top:1px solid #303e4c;cursor:pointer}.radio-option:first-child{border-top:0}.radio-option:hover{background:#202d39}.radio-option input{accent-color:#65b7d7}.radio-option img{width:25px;height:25px;object-fit:contain}.radio-copy{display:flex;flex-direction:column;gap:2px}.radio-copy small{color:var(--muted)}
.radio-option:has(input:focus-visible){outline:2px solid #8ed2ed;outline-offset:-3px}
.setting-select{min-width:180px;height:38px;padding:0 34px 0 11px;border:1px solid #46576a;border-radius:9px;background:#151f29;color:#e9f0f7}
.setting-select:hover,.setting-select:focus{border-color:#65a8c5;outline:0}
.restore{min-height:38px;padding:0 13px;border:1px solid #4c6075;border-radius:9px;background:#202d3a;color:#e5edf5;cursor:pointer}
.restore:hover:not(:disabled){background:#293a49;border-color:#637a91}
.restore:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.restore:disabled{opacity:.45;cursor:default}
@media(max-width:680px){.customization-overlay{padding:12px}.customization-modal{width:calc(100vw - 24px);height:calc(100vh - 24px)}.modal-body{grid-template-columns:164px minmax(0,1fr)}.category-sidebar{padding:12px 8px}.category-button{padding:0 9px;gap:8px}.modal-content{padding:22px 20px}.setting-row{gap:14px;padding:14px}.setting-select{min-width:150px}.shortcuts{gap:10px;overflow-x:auto;overflow-y:visible;padding-top:10px;margin-top:12px}.shortcut-wrap{width:64px;min-width:64px}}
@media(max-width:520px){.modal-header{padding-left:17px}.modal-header h2{font-size:17px}.modal-body{display:flex;flex-direction:column}.category-sidebar{flex:0 0 auto;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px;overflow-x:hidden;border-right:0;border-bottom:1px solid #2d3947}.category-button{width:100%;min-width:0;padding:0 11px}.category-button span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.category-button[aria-selected=true]:before{left:10px;right:10px;top:auto;bottom:0;width:auto;height:3px}.modal-content{padding:20px 16px}.setting-row{align-items:flex-start;flex-wrap:wrap}.setting-row>.switch,.setting-row>.themes,.setting-row>.setting-select,.setting-row>.restore{margin-left:auto}.background-grid,.cards{grid-template-columns:1fr}.customize{right:12px}}
</style>
</head>
<body>
<button class="customize" id="customize" type="button" title="Yeni sekme sayfasını özelleştir" aria-label="Yeni sekme sayfasını özelleştir" aria-haspopup="dialog" aria-controls="customization-modal" aria-expanded="false"><img src="icons/appearance.svg" alt=""></button>

<div class="customization-overlay" id="customization-overlay" hidden>
  <section class="customization-modal" id="customization-modal" role="dialog" aria-modal="true" aria-labelledby="customization-title" tabindex="-1">
    <header class="modal-header">
      <h2 id="customization-title">Yeni Sekme Sayfasını Özelleştir</h2>
      <button class="modal-close" id="customization-close" type="button" title="Kapat" aria-label="Özelleştirme penceresini kapat"><img src="icons/close.svg" alt=""></button>
    </header>
    <div class="modal-body">
      <nav class="category-sidebar" aria-label="Yeni sekme özelleştirme kategorileri">
        <button class="category-button" type="button" data-category="background" aria-selected="true"><img src="icons/appearance.svg" alt=""><span>Arka Plan</span></button>
        <button class="category-button" type="button" data-category="search" aria-selected="false"><img src="icons/search.svg" alt=""><span>Ara</span></button>
        <button class="category-button" type="button" data-category="topsites" aria-selected="false"><img src="icons/grid.svg" alt=""><span>En İyi Siteler</span></button>
        <button class="category-button" type="button" data-category="clock" aria-selected="false"><img src="icons/clock.svg" alt=""><span>Saat</span></button>
        <button class="category-button" type="button" data-category="cards" aria-selected="false"><img src="icons/cards.svg" alt=""><span>Kartlar</span></button>
      </nav>
      <div class="modal-content">
        <section class="category-panel" data-category-panel="background">
          <h3>Arka Plan</h3><p class="category-intro">Yeni sekmenin arka plan stilini ve görsel yoğunluğunu ayarlayın.</p>
          <div class="settings-card">
            <div class="setting-row"><div class="setting-copy"><label class="setting-title" for="background-toggle">Arka plan resimlerini göster</label><span class="setting-description">Kapatıldığında seçiminiz korunur ve düz koyu zemin kullanılır.</span></div><label class="switch"><input id="background-toggle" type="checkbox" aria-label="Arka plan resimlerini göster"><span class="switch-track"></span></label></div>
            <div class="setting-row"><div class="setting-copy"><span class="setting-title">Arka plan stili</span><span class="setting-description">Flow görselini kullanın veya sade koyu zemine geçin.</span></div><div class="themes" role="group" aria-label="Arka plan stili"><button data-theme="flow" type="button">Flow</button><button data-theme="plain" type="button">Düz</button></div></div>
            <div class="setting-row slider-row"><div class="setting-copy"><label class="setting-title" for="dim">Koyuluk</label><span class="setting-description">Arka plan görselinin karanlık seviyesini ayarlayın.</span></div><div class="range-line"><input id="dim" type="range" min="0" max="80" step="5" aria-describedby="dim-value"><output class="value" id="dim-value"></output></div></div>
          </div>
          <div class="background-grid" aria-label="Arka plan seçenekleri"><button class="background-card upload-card" id="background-upload" type="button"><strong>＋ Cihazdan yükle</strong><span>PNG, JPG/JPEG veya WebP</span></button><button class="background-card" data-background="builtin" type="button"><img src="ardali-flow-blue.png" alt="ArDali Flow arka plan önizlemesi"><span class="background-label">ArDali arka planı</span></button><button class="background-card" id="custom-background-card" data-background="custom" type="button" hidden><img id="custom-background-thumbnail" src="managed-background-thumbnail" alt="Özel arka plan önizlemesi"><span class="background-label">Özel arka plan</span></button></div>
          <div class="background-actions"><button class="restore" id="background-remove" type="button" hidden>Özel resmi kaldır</button></div><p class="background-status" id="background-status" role="status" aria-live="polite"></p>
        </section>
        <section class="category-panel" data-category-panel="search" hidden>
          <h3>Ara</h3><p class="category-intro">Yeni sekme aramasında kullanılan mevcut tarayıcı tercihlerini yönetin.</p>
          <div class="settings-card">
            <div class="setting-row"><div class="setting-copy"><label class="setting-title" for="search-toggle">Arama kutusunu göster</label><span class="setting-description">Yeni sekmedeki arama kutusunu gizler; adres çubuğu etkilenmez.</span></div><label class="switch"><input id="search-toggle" type="checkbox" aria-label="Arama kutusunu göster"><span class="switch-track"></span></label></div>
            <div class="radio-list" id="engine-radio-list" role="radiogroup" aria-label="Varsayılan arama motoru"><label class="radio-option"><input type="radio" name="custom-engine" value="Google"><img src="google.ico" alt=""><span class="radio-copy"><strong>Google</strong><small>Adres çubuğu ve yeni sekme</small></span></label><label class="radio-option"><input type="radio" name="custom-engine" value="DuckDuckGo"><img src="duckduckgo.ico" alt=""><span class="radio-copy"><strong>DuckDuckGo</strong><small>Adres çubuğu ve yeni sekme</small></span></label><label class="radio-option"><input type="radio" name="custom-engine" value="Brave Search"><img src="brave.ico" alt=""><span class="radio-copy"><strong>Brave Search</strong><small>Adres çubuğu ve yeni sekme</small></span></label><label class="radio-option"><input type="radio" name="custom-engine" value="Bing"><img src="bing.ico" alt=""><span class="radio-copy"><strong>Bing</strong><small>Adres çubuğu ve yeni sekme</small></span></label></div>
            <div class="setting-row"><div class="setting-copy"><label class="setting-title" for="suggestions-toggle">Arama önerileri</label><span class="setting-description">Etkin olduğunda yazdığınız sorgu seçili arama motorunun öneri servisine gönderilebilir.</span></div><label class="switch"><input id="suggestions-toggle" type="checkbox" aria-label="Arama önerilerini etkinleştir"><span class="switch-track"></span></label></div>
          </div>
        </section>
        <section class="category-panel frequent-options" id="frequent-options" data-category-panel="topsites" hidden>
          <h3>En İyi Siteler</h3><p class="category-intro">Sık ziyaret ettiğiniz sitelerin görünümünü ve yoğunluğunu ayarlayın.</p>
          <div class="settings-card">
            <div class="setting-row"><div class="setting-copy"><label class="setting-title" for="shortcuts-toggle">En iyi siteleri göster</label><span class="setting-description">Seçili kaynaktaki siteleri yeni sekmede gösterir.</span></div><label class="switch"><input id="shortcuts-toggle" type="checkbox" aria-label="En iyi siteleri göster"><span class="switch-track"></span></label></div>
            <div class="radio-list" role="radiogroup" aria-label="En iyi siteler kaynağı"><label class="radio-option"><input type="radio" name="top-sites-source" value="frequent"><span class="radio-copy"><strong>Sık ziyaret edilenler</strong><small>Geçmişteki gerçek ziyaret sıklığına göre</small></span></label><label class="radio-option"><input type="radio" name="top-sites-source" value="bookmarks"><span class="radio-copy"><strong>Yer imleri</strong><small>BrowserProfileService yer imlerinden</small></span></label></div>
            <div class="setting-row slider-row"><div class="setting-copy"><label class="setting-title" for="frequent-panel-opacity">Panel saydamlığı</label><span class="setting-description">Site panelinin arka plan yoğunluğunu ayarlayın.</span></div><div class="range-line"><input id="frequent-panel-opacity" type="range" min="0" max="100" aria-describedby="frequent-panel-value"><output class="value" id="frequent-panel-value"></output></div></div>
            <div class="setting-row slider-row"><div class="setting-copy"><label class="setting-title" for="frequent-icon-opacity">İkon zemini</label><span class="setting-description">Site ikonlarının arka plan saydamlığını ayarlayın.</span></div><div class="range-line"><input id="frequent-icon-opacity" type="range" min="0" max="100" aria-describedby="frequent-icon-value"><output class="value" id="frequent-icon-value"></output></div></div>
            <div class="setting-row"><div class="setting-copy"><span class="setting-title">Kaldırılan siteler</span><span class="setting-description">Daha önce gizlediğiniz siteleri yeniden listeye alın.</span></div><button class="restore" id="restore-frequent-sites" type="button">Geri getir</button></div>
          </div>
        </section>
        <section class="category-panel" data-category-panel="clock" hidden>
          <h3>Saat</h3><p class="category-intro">Yeni sekmenin saat ve tarih görünümünü yönetin.</p>
          <div class="settings-card">
            <div class="setting-row"><div class="setting-copy"><label class="setting-title" for="clock-toggle">Saati göster</label><span class="setting-description">Geçerli saati yeni sekmenin üst bölümünde gösterir.</span></div><label class="switch"><input id="clock-toggle" type="checkbox" aria-label="Saati göster"><span class="switch-track"></span></label></div>
            <div class="setting-row"><div class="setting-copy"><label class="setting-title" for="date-toggle">Tarihi göster</label><span class="setting-description">Gün ve tarih bilgisini saatin altında gösterir.</span></div><label class="switch"><input id="date-toggle" type="checkbox" aria-label="Tarihi göster"><span class="switch-track"></span></label></div>
            <div class="setting-row"><div class="setting-copy"><label class="setting-title" for="clock-format">Saat biçimi</label><span class="setting-description">Otomatik seçim sistem dilinizin saat biçimini kullanır.</span></div><select class="setting-select" id="clock-format"><option value="auto">Otomatik</option><option value="12">12 saat</option><option value="24">24 saat</option></select></div>
          </div>
        </section>
        <section class="category-panel" data-category-panel="cards" hidden>
          <h3>Kartlar</h3><p class="category-intro">Son indirmeler ve web koruması bilgi kartlarının görünürlüğünü yönetin.</p>
          <div class="settings-card"><div class="setting-row"><div class="setting-copy"><label class="setting-title" for="cards-toggle">Bilgi kartlarını göster</label><span class="setting-description">Mevcut bilgi kartlarını yeni sekmenin alt bölümünde birlikte gösterir.</span></div><label class="switch"><input id="cards-toggle" type="checkbox" aria-label="Bilgi kartlarını göster"><span class="switch-track"></span></label></div></div>
        </section>
      </div>
    </div>
  </section>
</div>

<main class="page"><div class="clock" id="clock"></div><div class="date" id="date"></div><div class="brand"><img src="ardali-browser.png" alt="ArDali Browser"></div><form class="search" id="search"><span class="search-icon"><img src="ardali-browser.png" alt=""></span><input id="query" autofocus placeholder="Web'de bir şeyler arayın veya URL girin..."><select id="engine" hidden><option%1>Google</option><option%2>DuckDuckGo</option><option%3>Brave Search</option><option%4>Bing</option></select><div class="engine-picker"><button id="engine-current" class="engine-current" type="button" aria-label="Arama motorunu seç"><span class="engine-logo"><img id="engine-current-icon" src="google.ico" alt="Google"></span></button><div class="engine-menu" id="engine-menu" hidden><button class="engine-option" data-engine="Google" type="button"><span class="engine-logo"><img src="google.ico" alt="Google"></span><span class="engine-option-label">Google</span></button><button class="engine-option" data-engine="DuckDuckGo" type="button"><span class="engine-logo"><img src="duckduckgo.ico" alt="DuckDuckGo"></span><span class="engine-option-label">DuckDuckGo</span></button><button class="engine-option" data-engine="Brave Search" type="button"><span class="engine-logo"><img src="brave.ico" alt="Brave Search"></span><span class="engine-option-label">Brave Search</span></button><button class="engine-option" data-engine="Bing" type="button"><span class="engine-logo"><img src="bing.ico" alt="Bing"></span><span class="engine-option-label">Bing</span></button></div></div></form><section class="module" id="shortcuts"><div class="head"><span id="top-sites-title">Sık Ziyaret Edilen Siteler</span><button class="frequent-settings" id="frequent-settings" type="button" title="En iyi siteleri özelleştir" aria-label="En iyi siteleri özelleştir"><img src="icons/appearance.svg" alt=""></button></div><div class="shortcuts" id="shortcut-list"></div></section><section class="cards" id="cards"><article><b id="downloads-card-value">0</b><br><small>Son indirmeler</small></article><article><b id="protection-card-value">Etkin</b><br><small>İzleme parametresi koruması</small></article></section></main>
<script>
const $=selector=>document.querySelector(selector);
const engineIcons={Google:'google.ico',DuckDuckGo:'duckduckgo.ico','Brave Search':'brave.ico',Bing:'bing.ico'};
function setEngine(value,notify=false){if(!engineIcons[value])value='Google';const select=$('#engine');const changed=select.value!==value;select.value=value;document.querySelectorAll('input[name="custom-engine"]').forEach(input=>input.checked=input.value===value);const icon=$('#engine-current-icon');icon.src=engineIcons[value];icon.alt=value;$('#engine-current').setAttribute('aria-label',value+' arama motoru');$('#engine-menu').hidden=true;if(notify&&changed)select.dispatchEvent(new Event('change',{bubbles:true}))}
window.ardaliSetSearchEngine=value=>setEngine(value,false);
const defaults={theme:'flow',backgroundVisible:true,backgroundSource:'builtin',searchVisible:true,dim:38,clock:true,date:true,clockFormat:'auto',shortcuts:true,topSitesSource:'frequent',cards:true,frequentPanelOpacity:72,frequentIconOpacity:82,hiddenFrequentSites:[]};
let stored={};try{stored=JSON.parse(localStorage.getItem('ardali.newtab')||'{}')}catch{}
let p=Object.assign({},defaults,stored);if(!Array.isArray(p.hiddenFrequentSites))p.hiddenFrequentSites=[];const clamp=value=>Math.max(0,Math.min(100,Number(value)||0));const save=()=>localStorage.setItem('ardali.newtab',JSON.stringify(p));
window.ardaliFrequentSites=Array.isArray(window.ardaliFrequentSites)?window.ardaliFrequentSites:[];
window.ardaliFrequentSiteIcons=window.ardaliFrequentSiteIcons||{};
window.ardaliTopSiteSources=window.ardaliTopSiteSources||{frequent:window.ardaliFrequentSites,bookmarks:[]};
window.ardaliCardData=window.ardaliCardData||{downloads:0,protection:true};
function settingsChanged(){save();window.dispatchEvent(new Event('ardali-frequent-settings-changed'))}
function removeFrequentSite(site){if(p.topSitesSource!=='frequent')return;if(!p.hiddenFrequentSites.includes(site.url))p.hiddenFrequentSites.push(site.url);settingsChanged();render()}
function renderFrequentSites(){const list=$('#shortcut-list');list.replaceChildren();const source=p.topSitesSource==='bookmarks'?'bookmarks':'frequent';const hidden=new Set(source==='frequent'?p.hiddenFrequentSites:[]);const sites=(window.ardaliTopSiteSources[source]||[]).filter(site=>!hidden.has(site.url)).slice(0,6);$('#top-sites-title').textContent=source==='bookmarks'?'Yer İmleri':'Sık Ziyaret Edilen Siteler';if(!sites.length){const empty=document.createElement('div');empty.className='shortcut-empty';empty.textContent=source==='bookmarks'?'Yer imi eklediğinizde siteler burada görünecek.':'Ziyaret ettikçe en sık kullandığınız siteler burada görünecek.';list.appendChild(empty);return}for(const site of sites){const wrap=document.createElement('div');wrap.className='shortcut-wrap';const button=document.createElement('button');button.type='button';button.className='shortcut';button.title=source==='frequent'?(site.title||site.name)+' · '+site.visitCount+' ziyaret':site.title||site.name;const remove=document.createElement('button');remove.type='button';remove.className='shortcut-remove';remove.textContent='×';remove.title=(site.name||'Site')+' listesinden kaldır';remove.setAttribute('aria-label',remove.title);remove.hidden=source!=='frequent';remove.onclick=event=>{event.preventDefault();event.stopPropagation();removeFrequentSite(site)};const badge=document.createElement('span');badge.className='shortcut-icon';const iconData=window.ardaliFrequentSiteIcons[site.url];if(iconData){const image=document.createElement('img');image.src=iconData;image.alt='';image.onerror=()=>{image.remove();badge.textContent=(site.name||'?').charAt(0).toLocaleUpperCase('tr-TR')};badge.appendChild(image)}else badge.textContent=(site.name||'?').charAt(0).toLocaleUpperCase('tr-TR');const label=document.createElement('span');label.className='shortcut-name';label.textContent=site.name;button.append(badge,label);button.onclick=()=>location.href=site.url;wrap.append(button,remove);list.appendChild(wrap)}}
function render(){p.frequentPanelOpacity=clamp(p.frequentPanelOpacity);p.frequentIconOpacity=clamp(p.frequentIconOpacity);if(!['builtin','custom'].includes(p.backgroundSource))p.backgroundSource='builtin';if(!['auto','12','24'].includes(p.clockFormat))p.clockFormat='auto';if(!['frequent','bookmarks'].includes(p.topSitesSource))p.topSitesSource='frequent';document.body.classList.toggle('plain',p.theme==='plain');document.body.classList.toggle('background-hidden',!p.backgroundVisible);document.documentElement.style.setProperty('--new-tab-background',p.backgroundSource==='custom'&&window.ardaliManagedBackgroundAvailable?"url('managed-background')":"url('ardali-flow-blue.png')");document.documentElement.style.setProperty('--overlay',p.dim/100);document.documentElement.style.setProperty('--frequent-panel-alpha',p.frequentPanelOpacity/100);document.documentElement.style.setProperty('--frequent-icon-alpha',p.frequentIconOpacity/100);$('#clock').hidden=!p.clock;$('#date').hidden=!p.date;$('#search').hidden=!p.searchVisible;$('#shortcuts').hidden=!p.shortcuts;$('#cards').hidden=!p.cards;$('#dim').value=p.dim;$('#dim-value').textContent=p.dim+'%';$('#clock-toggle').checked=p.clock;$('#date-toggle').checked=p.date;$('#background-toggle').checked=p.backgroundVisible;$('#search-toggle').checked=p.searchVisible;$('#shortcuts-toggle').checked=p.shortcuts;$('#cards-toggle').checked=p.cards;$('#clock-format').value=p.clockFormat;$('#frequent-panel-opacity').value=p.frequentPanelOpacity;$('#frequent-icon-opacity').value=p.frequentIconOpacity;$('#frequent-panel-value').textContent=p.frequentPanelOpacity+'%';$('#frequent-icon-value').textContent=p.frequentIconOpacity+'%';$('#restore-frequent-sites').disabled=!p.hiddenFrequentSites.length;$('#restore-frequent-sites').closest('.setting-row').hidden=p.topSitesSource!=='frequent';$('#suggestions-toggle').checked=localStorage.getItem('ardali.searchSuggestions')==='enabled';$('#custom-background-card').hidden=!window.ardaliManagedBackgroundAvailable;$('#background-remove').hidden=!window.ardaliManagedBackgroundAvailable;document.querySelectorAll('[data-background]').forEach(button=>{const selected=button.dataset.background===p.backgroundSource;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected))});document.querySelectorAll('input[name="top-sites-source"]').forEach(input=>input.checked=input.value===p.topSitesSource);document.querySelectorAll('[data-theme]').forEach(button=>{const active=button.dataset.theme===p.theme;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active))});$('#downloads-card-value').textContent=String(window.ardaliCardData.downloads||0);$('#protection-card-value').textContent=window.ardaliCardData.protection?'Etkin':'Kapalı';renderFrequentSites();tick()}
function applyFrequentConfig(){const config=window.ardaliFrequentSiteConfig;if(config&&typeof config==='object'){p.shortcuts=config.visible!==false;p.frequentPanelOpacity=clamp(config.panelOpacity);p.frequentIconOpacity=clamp(config.iconOpacity);p.hiddenFrequentSites=Array.isArray(config.hiddenSites)?config.hiddenSites:[];p.backgroundVisible=config.backgroundVisible!==false;p.backgroundSource=config.backgroundSource==='custom'?'custom':'builtin';p.searchVisible=config.searchVisible!==false;p.topSitesSource=config.topSitesSource==='bookmarks'?'bookmarks':'frequent';p.clockFormat=['12','24'].includes(config.clockFormat)?config.clockFormat:'auto';p.theme=config.theme==='plain'?'plain':'flow';p.dim=Math.max(0,Math.min(80,Number(config.dim)||0));p.clock=config.clock!==false;p.date=config.date!==false;p.cards=config.cards!==false;window.ardaliManagedBackgroundAvailable=!!config.managedBackgroundAvailable;if(!window.ardaliManagedBackgroundAvailable&&p.backgroundSource==='custom')p.backgroundSource='builtin';save()}render()}
function tick(){const date=new Date();const locale=(navigator.languages&&navigator.languages[0])||navigator.language||undefined;const options={hour:'numeric',minute:'2-digit'};if(p.clockFormat==='12')options.hour12=true;else if(p.clockFormat==='24')options.hour12=false;$('#clock').textContent=date.toLocaleTimeString(locale,options);$('#date').textContent=date.toLocaleDateString(locale,{weekday:'long',day:'numeric',month:'long'})}
for(const [id,key] of [['clock-toggle','clock'],['date-toggle','date'],['cards-toggle','cards']])$('#'+id).onchange=event=>{p[key]=event.target.checked;settingsChanged();render()};
for(const [id,key] of [['background-toggle','backgroundVisible'],['search-toggle','searchVisible']])$('#'+id).onchange=event=>{p[key]=event.target.checked;settingsChanged();render()};
$('#shortcuts-toggle').onchange=event=>{p.shortcuts=event.target.checked;settingsChanged();render()};
$('#dim').oninput=event=>{p.dim=+event.target.value;settingsChanged();render()};
$('#frequent-panel-opacity').oninput=event=>{p.frequentPanelOpacity=+event.target.value;settingsChanged();render()};
$('#frequent-icon-opacity').oninput=event=>{p.frequentIconOpacity=+event.target.value;settingsChanged();render()};
$('#restore-frequent-sites').onclick=()=>{p.hiddenFrequentSites=[];settingsChanged();render()};
document.querySelectorAll('[data-theme]').forEach(button=>button.onclick=()=>{p.theme=button.dataset.theme;settingsChanged();render()});
document.querySelectorAll('input[name="custom-engine"]').forEach(input=>input.onchange=event=>setEngine(event.target.value,true));
document.querySelectorAll('input[name="top-sites-source"]').forEach(input=>input.onchange=event=>{p.topSitesSource=event.target.value;settingsChanged();render()});
document.querySelectorAll('[data-background]').forEach(button=>button.onclick=()=>{p.backgroundSource=button.dataset.background;settingsChanged();render()});
$('#clock-format').onchange=event=>{p.clockFormat=event.target.value;settingsChanged();render()};
$('#background-upload').onclick=()=>{window.ardaliNewTabCommand={type:'pickBackground',nonce:Date.now()};$('#background-status').textContent='Dosya seçici açılıyor…'};
$('#background-remove').onclick=()=>{window.ardaliNewTabCommand={type:'removeBackground',nonce:Date.now()}};
window.ardaliBackgroundResult=(ok,message,available)=>{window.ardaliManagedBackgroundAvailable=!!available;const status=$('#background-status');status.textContent=message||'';status.classList.toggle('error',!ok);if(ok&&available)p.backgroundSource='custom';if(!available&&p.backgroundSource==='custom')p.backgroundSource='builtin';settingsChanged();render()};
$('#suggestions-toggle').onchange=event=>{localStorage.setItem('ardali.searchSuggestions',event.target.checked?'enabled':'disabled');window.dispatchEvent(new Event('ardali-suggestion-consent-changed'));render()};

const overlay=$('#customization-overlay');const modal=$('#customization-modal');const categoryButtons=[...document.querySelectorAll('[data-category]')];let selectedCategory='background';let lastModalFocus=null;
function selectCategory(category,focus=false){if(!categoryButtons.some(button=>button.dataset.category===category))category='background';selectedCategory=category;categoryButtons.forEach(button=>{const selected=button.dataset.category===category;button.setAttribute('aria-selected',String(selected));if(selected&&focus)button.focus()});document.querySelectorAll('[data-category-panel]').forEach(panel=>panel.hidden=panel.dataset.categoryPanel!==category)}
function openCustomization(category=selectedCategory){lastModalFocus=document.activeElement;document.body.classList.add('customization-open');overlay.hidden=false;$('#customize').setAttribute('aria-expanded','true');selectCategory(category);requestAnimationFrame(()=>categoryButtons.find(button=>button.dataset.category===selectedCategory).focus())}
function closeCustomization(){if(overlay.hidden)return;document.body.classList.remove('customization-open');overlay.hidden=true;$('#customize').setAttribute('aria-expanded','false');(lastModalFocus&&document.contains(lastModalFocus)?lastModalFocus:$('#customize')).focus()}
categoryButtons.forEach(button=>button.onclick=()=>selectCategory(button.dataset.category,true));
$('#customization-close').onclick=closeCustomization;
$('#customize').onclick=()=>overlay.hidden?openCustomization():closeCustomization();
$('#frequent-settings').onclick=()=>openCustomization('topsites');
overlay.addEventListener('pointerdown',event=>{if(event.target===overlay)closeCustomization()});
document.addEventListener('keydown',event=>{if(event.key==='Escape'){if(!overlay.hidden){event.preventDefault();closeCustomization()}else $('#engine-menu').hidden=true;return}if(event.key!=='Tab'||overlay.hidden)return;const focusable=[...modal.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex]:not([tabindex="-1"])')].filter(item=>!item.closest('[hidden]'));if(!focusable.length)return;const first=focusable[0],last=focusable.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}});
window.ardaliCustomization={open:openCustomization,close:closeCustomization,select:selectCategory,isOpen:()=>!overlay.hidden,category:()=>selectedCategory};
document.documentElement.dataset.customizationReady='true';

$('#search').onsubmit=event=>{event.preventDefault();let value=$('#query').value.trim();if(!value)return;if(/^https?:\/\//.test(value)||(!/\s/.test(value)&&(/\./.test(value)||value==='localhost')))location.href=/^https?:/.test(value)?value:'https://'+value;else{const base={Google:'https://www.google.com/search?q=',DuckDuckGo:'https://duckduckgo.com/?q=','Brave Search':'https://search.brave.com/search?q=',Bing:'https://www.bing.com/search?q='}[$('#engine').value];location.href=base+encodeURIComponent(value)}};
$('#engine-current').onclick=event=>{event.preventDefault();$('#engine-menu').hidden=!$('#engine-menu').hidden};
document.querySelectorAll('.engine-option').forEach(button=>button.onclick=()=>setEngine(button.dataset.engine,true));
document.addEventListener('pointerdown',event=>{if(!event.target.closest('.engine-picker'))$('#engine-menu').hidden=true});
window.addEventListener('ardali-frequent-sites',applyFrequentConfig);
window.addEventListener('ardali-frequent-site-icons',renderFrequentSites);
window.addEventListener('ardali-settings-search-suggestions',render);
setEngine($('#engine').value);applyFrequentConfig();tick();setInterval(tick,1000);
</script>
</body>
</html>)NTP").arg(google, duck, brave, bing);
}
