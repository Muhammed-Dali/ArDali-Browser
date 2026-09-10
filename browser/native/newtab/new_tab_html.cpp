#include "new_tab_html.h"

#include <QJsonArray>
#include <QJsonDocument>
#include <QUrlQuery>
#include "core/search_engine_definition.h"

QString searchEnginePlaceholder(const QString &engine) {
  return ardali::core::searchEnginePlaceholderText(engine);
}

namespace {
QString normalizedStrictBlockHost(QString host) {
  host = host.trimmed().toLower();
  while (host.endsWith(QLatin1Char('.'))) host.chop(1);
  return host;
}

QString jsonStringLiteral(const QString &value) {
  const QByteArray array = QJsonDocument(QJsonArray{value}).toJson(QJsonDocument::Compact);
  return QString::fromUtf8(array.mid(1, array.size() - 2));
}

QString jsonForInlineScript(const QJsonArray &values) {
  QString json = QString::fromUtf8(QJsonDocument(values).toJson(QJsonDocument::Compact));
  if (json.isEmpty()) json = QStringLiteral("[]");
  json.replace(QLatin1String("</"), QLatin1String("<\\/"));
  json.replace(QChar(0x2028), QStringLiteral("\\u2028"));
  json.replace(QChar(0x2029), QStringLiteral("\\u2029"));
  return json;
}
}  // namespace

QUrl validatedStrictBlockTarget(const QString &domain, const QString &targetUrl) {
  const QString expectedHost = normalizedStrictBlockHost(domain);
  if (expectedHost.isEmpty()) return {};

  QUrl target(targetUrl);
  if (targetUrl.isEmpty()) {
    target.setScheme(QStringLiteral("https"));
    target.setHost(expectedHost);
  }
  const QString scheme = target.scheme().toLower();
  if (!target.isValid() || (scheme != QLatin1String("http") && scheme != QLatin1String("https"))
      || normalizedStrictBlockHost(target.host()) != expectedHost
      || !target.userName().isEmpty() || !target.password().isEmpty()) {
    return {};
  }
  return target;
}

bool isAuthorizedStrictBlockBypass(const QUrl &requestUrl, const QUrl &initiator) {
  if (!requestUrl.isValid() || requestUrl.scheme() != QLatin1String("ardali")
      || requestUrl.host() != QLatin1String("bypass-strictblock")
      || initiator.scheme() != QLatin1String("ardali") || initiator.host() != QLatin1String("newtab")) {
    return false;
  }
  const QUrlQuery query(requestUrl);
  return validatedStrictBlockTarget(query.queryItemValue(QStringLiteral("domain"), QUrl::FullyDecoded),
                                    query.queryItemValue(QStringLiteral("target"), QUrl::FullyDecoded)).isValid();
}

QString newTabHtml(const QString &defaultEngine,
                   const QJsonArray &frequentSites,
                   const QJsonArray &bookmarks) {
  const QString google = defaultEngine == QLatin1String("Google") ? QStringLiteral(" selected") : QString();
  const QString duck = defaultEngine == QLatin1String("DuckDuckGo") ? QStringLiteral(" selected") : QString();
  const QString brave = defaultEngine == QLatin1String("Brave Search") ? QStringLiteral(" selected") : QString();
  const QString bing = defaultEngine == QLatin1String("Bing") ? QStringLiteral(" selected") : QString();

  const QString freqJson = jsonForInlineScript(frequentSites);
  const QString bkmkJson = jsonForInlineScript(bookmarks);
  QString html = QString::fromUtf8(R"NTP(<!doctype html>
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
.page{position:relative;width:min(760px,calc(100% - 32px));margin:clamp(70px,14vh,145px) auto;text-align:center}
.clock{font-size:clamp(54px,7vw,82px);font-weight:300;letter-spacing:-.06em}
.date{margin:10px 0 20px;color:#d4ddec}
.brand{width:112px;height:112px;margin:8px auto 15px;display:grid;place-items:center;background:transparent}
.brand img{display:block;width:100%;height:100%;object-fit:contain;filter:drop-shadow(0 8px 16px #0008)}
.suggestion-list{position:absolute;left:0;right:0;top:calc(100% + 8px);padding:6px;background:#111b29;border:1px solid #354b62;border-radius:16px;max-height:380px;overflow:auto;box-shadow:0 12px 32px #0008}
.suggestion-row{display:flex;align-items:center;gap:12px;width:100%;border:0;border-radius:10px;background:transparent;color:#e5efff;padding:10px 14px;text-align:left;font:inherit;cursor:pointer}
.suggestion-row[aria-selected="true"],.suggestion-row:hover{background:#253e56}.suggestion-row img{width:20px;height:20px;object-fit:contain}.suggestion-row span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.search{position:relative;z-index:20;display:flex;width:min(620px,100%);height:52px;margin:0 auto;border:2px solid #11c5fa;border-radius:28px;background:#05080bdd;overflow:visible;transition:width .2s ease,height .2s ease,transform .2s ease,box-shadow .2s ease}
.page.search-focused .search{width:min(700px,100%);height:56px;transform:translateY(34px);box-shadow:0 14px 35px #0008}
.search>.search-icon{width:48px;flex:0 0 48px;display:grid;place-items:center;padding-left:5px}
.search>.search-icon img{width:30px;height:30px;object-fit:contain}
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
.top-sites-strip{position:relative;margin-top:24px;transition:opacity .2s ease,transform .2s ease,visibility 0s linear 0s}
.page.search-focused .top-sites-strip{opacity:0;transform:translateY(-10px);visibility:hidden;pointer-events:none;transition:opacity .18s ease,transform .2s ease,visibility 0s linear .2s}
.shortcuts{display:flex;justify-content:center;gap:12px;overflow-x:auto;overflow-y:hidden;padding:4px 2px 8px;scrollbar-width:thin}
.shortcut-wrap{position:relative;width:104px;min-width:104px}
.shortcut{width:100%;height:88px;border:1px solid rgba(255,255,255,.10);border-radius:16px;background:rgba(18,26,36,var(--frequent-panel-alpha));color:#fff;cursor:pointer;padding:10px 8px 8px;text-align:center;transition:background .16s ease,border-color .16s ease,transform .16s ease,box-shadow .16s ease}
.shortcut:hover{background:rgba(35,49,66,.9);border-color:rgba(255,255,255,.2);transform:translateY(-2px);box-shadow:0 8px 20px #0007}
.shortcut:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.shortcut-icon{display:grid;place-items:center;width:42px;height:42px;margin:auto auto 7px;border-radius:12px;background:rgba(255,255,255,var(--frequent-icon-alpha));color:#101827;font-size:20px;font-weight:700;overflow:hidden}
.shortcut-icon img{display:block;width:100%;height:100%;padding:7px;object-fit:contain}
.shortcut-name{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}
.shortcut-remove{position:absolute;z-index:3;right:-4px;top:-10px;width:22px;height:22px;padding:0;border:0;display:grid;place-items:center;background:transparent;color:#dce7f5;font-size:19px;line-height:1;cursor:pointer;opacity:0;filter:drop-shadow(0 1px 2px #000);transition:opacity .14s,color .14s}
.shortcut-wrap:hover .shortcut-remove,.shortcut-remove:focus-visible{opacity:1}
.shortcut-remove:hover{color:#ff6978}
.cards{position:relative;display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px;transition:opacity .2s ease,transform .2s ease,visibility 0s linear 0s}
.page.search-focused .cards{opacity:0;transform:translateY(-10px);visibility:hidden;pointer-events:none;transition:opacity .18s ease,transform .2s ease,visibility 0s linear .2s}
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
@media(max-width:680px){.customization-overlay{padding:12px}.customization-modal{width:calc(100vw - 24px);height:calc(100vh - 24px)}.modal-body{grid-template-columns:164px minmax(0,1fr)}.category-sidebar{padding:12px 8px}.category-button{padding:0 9px;gap:8px}.modal-content{padding:22px 20px}.setting-row{gap:14px;padding:14px}.setting-select{min-width:150px}.shortcuts{justify-content:flex-start;gap:10px}.shortcut-wrap{width:92px;min-width:92px}.page.search-focused .search{transform:translateY(26px)}}
@media(max-width:520px){.modal-header{padding-left:17px}.modal-header h2{font-size:17px}.modal-body{display:flex;flex-direction:column}.category-sidebar{flex:0 0 auto;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px;overflow-x:hidden;border-right:0;border-bottom:1px solid #2d3947}.category-button{width:100%;min-width:0;padding:0 11px}.category-button span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.category-button[aria-selected=true]:before{left:10px;right:10px;top:auto;bottom:0;width:auto;height:3px}.modal-content{padding:20px 16px}.setting-row{align-items:flex-start;flex-wrap:wrap}.setting-row>.switch,.setting-row>.themes,.setting-row>.setting-select,.setting-row>.restore{margin-left:auto}.background-grid,.cards{grid-template-columns:1fr}.customize{right:12px}}
</style>
</head>
<body>
<button class="customize" id="customize" type="button" title="Yeni sekme ayarları" aria-label="Yeni sekme ayarlarını aç" aria-haspopup="dialog" aria-controls="customization-modal" aria-expanded="false"><img src="icons/settings.svg" alt=""></button>

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
            <div class="radio-list" id="engine-radio-list" role="radiogroup" aria-label="Varsayılan arama motoru"><label class="radio-option"><input type="radio" name="custom-engine" value="Google"><img src="__GOOGLE_ENGINE_ICON__" alt=""><span class="radio-copy"><strong>Google</strong><small>Adres çubuğu ve yeni sekme</small></span></label><label class="radio-option"><input type="radio" name="custom-engine" value="DuckDuckGo"><img src="__DUCKDUCKGO_ENGINE_ICON__" alt=""><span class="radio-copy"><strong>DuckDuckGo</strong><small>Adres çubuğu ve yeni sekme</small></span></label><label class="radio-option"><input type="radio" name="custom-engine" value="Brave Search"><img src="__BRAVE_SEARCH_ENGINE_ICON__" alt=""><span class="radio-copy"><strong>Brave Search</strong><small>Adres çubuğu ve yeni sekme</small></span></label><label class="radio-option"><input type="radio" name="custom-engine" value="Bing"><img src="__BING_ENGINE_ICON__" alt=""><span class="radio-copy"><strong>Bing</strong><small>Adres çubuğu ve yeni sekme</small></span></label></div>
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

<main class="page" id="page"><div class="clock" id="clock"></div><div class="date" id="date"></div><div class="brand"><img src="ardali-browser.png" alt="ArDali Browser"></div><form class="search" id="search"><span class="search-icon"><img src="ardali-browser.png" alt=""></span><input id="query" placeholder="__SEARCH_PLACEHOLDER__"><select id="engine" hidden><option%1>Google</option><option%2>DuckDuckGo</option><option%3>Brave Search</option><option%4>Bing</option></select><div class="engine-picker"><button id="engine-current" class="engine-current" type="button" aria-label="Arama motorunu seç"><span class="engine-logo"><img id="engine-current-icon" src="__GOOGLE_ENGINE_ICON__" alt="Google"></span></button><div class="engine-menu" id="engine-menu" hidden><button class="engine-option" data-engine="Google" type="button"><span class="engine-logo"><img src="__GOOGLE_ENGINE_ICON__" alt="Google"></span><span class="engine-option-label">Google</span></button><button class="engine-option" data-engine="DuckDuckGo" type="button"><span class="engine-logo"><img src="__DUCKDUCKGO_ENGINE_ICON__" alt="DuckDuckGo"></span><span class="engine-option-label">DuckDuckGo</span></button><button class="engine-option" data-engine="Brave Search" type="button"><span class="engine-logo"><img src="__BRAVE_SEARCH_ENGINE_ICON__" alt="Brave Search"></span><span class="engine-option-label">Brave Search</span></button><button class="engine-option" data-engine="Bing" type="button"><span class="engine-logo"><img src="__BING_ENGINE_ICON__" alt="Bing"></span><span class="engine-option-label">Bing</span></button></div></div></form><section class="top-sites-strip" id="shortcuts" aria-label="Sık ziyaret edilen siteler"><div class="shortcuts" id="shortcut-list"></div></section><section class="cards" id="cards"><article><b id="downloads-card-value">0</b><br><small>Son indirmeler</small></article><article><b id="protection-card-value">Etkin</b><br><small>İzleme parametresi koruması</small></article></section></main>
<script>
const $=selector=>document.querySelector(selector);
const searchPlaceholders=__SEARCH_PLACEHOLDERS__;
const engineIcons=__SEARCH_ENGINE_ICONS__;
function setEngine(value,notify=false){if(!engineIcons[value])value='Google';const select=$('#engine');const changed=select.value!==value;select.value=value;$('#query').placeholder=searchPlaceholders[value];document.querySelectorAll('input[name="custom-engine"]').forEach(input=>input.checked=input.value===value);const icon=$('#engine-current-icon');icon.src=engineIcons[value];icon.alt=value;$('#engine-current').setAttribute('aria-label',value+' arama motoru');$('#engine-menu').hidden=true;if(notify&&changed){select.dispatchEvent(new Event('change',{bubbles:true}));location.href='ardali://search-engine?engine='+encodeURIComponent(value)+'&cap='+encodeURIComponent(suggestionCapability)}}
window.ardaliSetSearchEngine=value=>{setEngine(value,false);if(window.ardaliSuggestionBridge&&document.activeElement===$('#query'))requestSuggestions()};
const defaults={theme:'flow',backgroundVisible:true,backgroundSource:'builtin',searchVisible:true,dim:38,clock:true,date:true,clockFormat:'auto',shortcuts:true,topSitesSource:'frequent',cards:true,frequentPanelOpacity:72,frequentIconOpacity:82,hiddenFrequentSites:[]};
let stored={};try{stored=JSON.parse(localStorage.getItem('ardali.newtab')||'{}')}catch{}
let p=Object.assign({},defaults,stored);if(!Array.isArray(p.hiddenFrequentSites))p.hiddenFrequentSites=[];const clamp=value=>Math.max(0,Math.min(100,Number(value)||0));const save=()=>localStorage.setItem('ardali.newtab',JSON.stringify(p));
window.ardaliFrequentSites=__ARDALI_FREQUENT_SITES__;
window.ardaliFrequentSiteIcons=window.ardaliFrequentSiteIcons||{};
window.ardaliTopSiteSources={frequent:window.ardaliFrequentSites,bookmarks:__ARDALI_BOOKMARKS__};
window.ardaliCardData=window.ardaliCardData||{downloads:0,protection:true};
function settingsChanged(){save();window.dispatchEvent(new Event('ardali-frequent-settings-changed'))}
function removeFrequentSite(site){if(p.topSitesSource!=='frequent')return;if(!p.hiddenFrequentSites.includes(site.url))p.hiddenFrequentSites.push(site.url);settingsChanged();render()}
function renderFrequentSites(){const strip=$('#shortcuts');const list=$('#shortcut-list');list.replaceChildren();const source=p.topSitesSource==='bookmarks'?'bookmarks':'frequent';const hidden=new Set(source==='frequent'?p.hiddenFrequentSites:[]);const sites=(window.ardaliTopSiteSources[source]||[]).filter(site=>!hidden.has(site.url)).slice(0,6);strip.hidden=!p.shortcuts||!sites.length;if(!sites.length)return;for(const site of sites){const wrap=document.createElement('div');wrap.className='shortcut-wrap';const button=document.createElement('button');button.type='button';button.className='shortcut';button.title=source==='frequent'?(site.title||site.name)+' · '+site.visitCount+' ziyaret':site.title||site.name;const remove=document.createElement('button');remove.type='button';remove.className='shortcut-remove';remove.textContent='×';remove.title=(site.name||'Site')+' listesinden kaldır';remove.setAttribute('aria-label',remove.title);remove.hidden=source!=='frequent';remove.onclick=event=>{event.preventDefault();event.stopPropagation();removeFrequentSite(site)};const badge=document.createElement('span');badge.className='shortcut-icon';const iconData=site.icon||window.ardaliFrequentSiteIcons[site.url];if(iconData){const image=document.createElement('img');image.src=iconData;image.alt='';image.onerror=()=>{image.remove();badge.textContent=(site.name||'?').charAt(0).toLocaleUpperCase('tr-TR')};badge.appendChild(image)}else badge.textContent=(site.name||'?').charAt(0).toLocaleUpperCase('tr-TR');const label=document.createElement('span');label.className='shortcut-name';label.textContent=site.name;button.append(badge,label);button.onclick=()=>location.href=site.url;wrap.append(button,remove);list.appendChild(wrap)}}
function render(){p.frequentPanelOpacity=clamp(p.frequentPanelOpacity);p.frequentIconOpacity=clamp(p.frequentIconOpacity);if(!['builtin','custom'].includes(p.backgroundSource))p.backgroundSource='builtin';if(!['auto','12','24'].includes(p.clockFormat))p.clockFormat='auto';if(!['frequent','bookmarks'].includes(p.topSitesSource))p.topSitesSource='frequent';document.body.classList.toggle('plain',p.theme==='plain');document.body.classList.toggle('background-hidden',!p.backgroundVisible);document.documentElement.style.setProperty('--new-tab-background',p.backgroundSource==='custom'&&window.ardaliManagedBackgroundAvailable?"url('managed-background')":"url('ardali-flow-blue.png')");document.documentElement.style.setProperty('--overlay',p.dim/100);document.documentElement.style.setProperty('--frequent-panel-alpha',p.frequentPanelOpacity/100);document.documentElement.style.setProperty('--frequent-icon-alpha',p.frequentIconOpacity/100);$('#clock').hidden=!p.clock;$('#date').hidden=!p.date;$('#search').hidden=!p.searchVisible;$('#shortcuts').hidden=!p.shortcuts;$('#cards').hidden=!p.cards;$('#dim').value=p.dim;$('#dim-value').textContent=p.dim+'%';$('#clock-toggle').checked=p.clock;$('#date-toggle').checked=p.date;$('#background-toggle').checked=p.backgroundVisible;$('#search-toggle').checked=p.searchVisible;$('#shortcuts-toggle').checked=p.shortcuts;$('#cards-toggle').checked=p.cards;$('#clock-format').value=p.clockFormat;$('#frequent-panel-opacity').value=p.frequentPanelOpacity;$('#frequent-icon-opacity').value=p.frequentIconOpacity;$('#frequent-panel-value').textContent=p.frequentPanelOpacity+'%';$('#frequent-icon-value').textContent=p.frequentIconOpacity+'%';$('#restore-frequent-sites').disabled=!p.hiddenFrequentSites.length;$('#restore-frequent-sites').closest('.setting-row').hidden=p.topSitesSource!=='frequent';$('#suggestions-toggle').checked=window.ardaliSuggestionsEnabled===true;$('#custom-background-card').hidden=!window.ardaliManagedBackgroundAvailable;$('#background-remove').hidden=!window.ardaliManagedBackgroundAvailable;document.querySelectorAll('[data-background]').forEach(button=>{const selected=button.dataset.background===p.backgroundSource;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected))});document.querySelectorAll('input[name="top-sites-source"]').forEach(input=>input.checked=input.value===p.topSitesSource);document.querySelectorAll('[data-theme]').forEach(button=>{const active=button.dataset.theme===p.theme;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active))});$('#downloads-card-value').textContent=String(window.ardaliCardData.downloads||0);$('#protection-card-value').textContent=window.ardaliCardData.protection?'Etkin':'Kapalı';renderFrequentSites();tick()}
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
$('#suggestions-toggle').onchange=event=>{suggestionCommand('consent',{enabled:String(event.target.checked)});};

const overlay=$('#customization-overlay');const modal=$('#customization-modal');const categoryButtons=[...document.querySelectorAll('[data-category]')];let selectedCategory='background';let lastModalFocus=null;
const query=$('#query');const engineMenu=$('#engine-menu');
let suggestionCapability='',suggestionId=0,suggestionIndex=-1,suggestionRows=[];
const suggestionList=document.createElement('div');suggestionList.className='suggestion-list';suggestionList.id='search-suggestions';suggestionList.setAttribute('role','listbox');suggestionList.hidden=true;$('#search').append(suggestionList);
query.setAttribute('role','combobox');query.setAttribute('aria-autocomplete','list');query.setAttribute('aria-controls','search-suggestions');query.setAttribute('aria-expanded','false');query.autocomplete='off';
function suggestionCommand(op,params={}){if(!suggestionCapability)return;location.href='ardali://suggest?'+new URLSearchParams({op,cap:suggestionCapability,...params}).toString().replace(/\+/g,'%20')}
function closeSuggestions(){suggestionList.hidden=true;query.setAttribute('aria-expanded','false');query.removeAttribute('aria-activedescendant');suggestionIndex=-1;}
function requestSuggestions(){++suggestionId;closeSuggestions();if(document.activeElement!==query)return;suggestionCommand('query',{q:query.value.slice(0,256),id:String(suggestionId)})}
function selectSuggestion(index){const row=suggestionRows[index];if(!row)return;let url;try{url=new URL(row.url)}catch(_){return}if(!['https:','http:'].includes(url.protocol)||url.username||url.password)return;closeSuggestions();location.href=url.href}
function highlightSuggestion(index){suggestionIndex=index;Array.from(suggestionList.children).forEach((row,i)=>row.setAttribute('aria-selected',String(i===index)));if(index>=0){query.setAttribute('aria-activedescendant','suggestion-'+index);suggestionList.children[index]?.scrollIntoView({block:'nearest'})}}
window.ardaliSuggestionBridge=cap=>{suggestionCapability=cap;if(document.activeElement===query)requestSuggestions()};
window.ardaliSuggestionConsent=(enabled,allowed=true)=>{window.ardaliSuggestionsEnabled=enabled===true;$('#suggestions-toggle').disabled=!allowed;render();++suggestionId;closeSuggestions();if(document.activeElement===query)requestSuggestions()};
window.ardaliShowSuggestions=(id,text,rows)=>{
 if(id!==suggestionId||text!==query.value||document.activeElement!==query||!Array.isArray(rows))return;
 suggestionRows=rows.slice(0,12);suggestionList.replaceChildren();suggestionIndex=-1;
 suggestionRows.forEach((row,index)=>{const button=document.createElement('button');button.type='button';button.className='suggestion-row';button.id='suggestion-'+index;button.setAttribute('role','option');button.setAttribute('aria-selected','false');
 const icon=document.createElement('img');icon.alt='';icon.src=engineIcons[$('#engine').value];
 if(!['remote','search'].includes(row.type)&&typeof row.icon==='string'&&row.icon.startsWith('ardali://newtab/favicon?')){icon.src=row.icon;icon.onerror=()=>{icon.onerror=null;icon.src=engineIcons[$('#engine').value]};}
 const label=document.createElement('span');label.textContent=String(row.text||'');button.append(icon,label);button.onpointerdown=event=>event.preventDefault();button.onmouseenter=()=>highlightSuggestion(index);button.onclick=()=>selectSuggestion(index);suggestionList.append(button)});
 suggestionList.hidden=!suggestionRows.length;query.setAttribute('aria-expanded',String(!!suggestionRows.length));
};
query.addEventListener('input',requestSuggestions);query.addEventListener('focus',requestSuggestions);query.addEventListener('blur',closeSuggestions);
query.addEventListener('keydown',event=>{if(event.key==='Escape'){++suggestionId;closeSuggestions();return}if(suggestionList.hidden)return;if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();const delta=event.key==='ArrowDown'?1:-1;highlightSuggestion((suggestionIndex+delta+suggestionRows.length)%suggestionRows.length)}else if(event.key==='Enter'&&suggestionIndex>=0){event.preventDefault();selectSuggestion(suggestionIndex)}});
$('#engine').addEventListener('change',()=>{++suggestionId;closeSuggestions()});

function updateSearchMode(){const pickerActive=!!document.activeElement.closest?.('.engine-picker');const active=document.activeElement===query||pickerActive||!engineMenu.hidden||query.value.length>0;$('#page').classList.toggle('search-focused',active)}
query.addEventListener('focus',()=>$('#page').classList.add('search-focused'));query.addEventListener('input',updateSearchMode);query.addEventListener('blur',()=>setTimeout(updateSearchMode,0));
function selectCategory(category,focus=false){if(!categoryButtons.some(button=>button.dataset.category===category))category='background';selectedCategory=category;categoryButtons.forEach(button=>{const selected=button.dataset.category===category;button.setAttribute('aria-selected',String(selected));if(selected&&focus)button.focus()});document.querySelectorAll('[data-category-panel]').forEach(panel=>panel.hidden=panel.dataset.categoryPanel!==category)}
function openCustomization(category=selectedCategory){lastModalFocus=document.activeElement;document.body.classList.add('customization-open');overlay.hidden=false;$('#customize').setAttribute('aria-expanded','true');selectCategory(category);requestAnimationFrame(()=>categoryButtons.find(button=>button.dataset.category===selectedCategory).focus())}
function closeCustomization(){if(overlay.hidden)return;document.body.classList.remove('customization-open');overlay.hidden=true;$('#customize').setAttribute('aria-expanded','false');(lastModalFocus&&document.contains(lastModalFocus)?lastModalFocus:$('#customize')).focus()}
categoryButtons.forEach(button=>button.onclick=()=>selectCategory(button.dataset.category,true));
$('#customization-close').onclick=closeCustomization;
$('#customize').onclick=()=>overlay.hidden?openCustomization():closeCustomization();
overlay.addEventListener('pointerdown',event=>{if(event.target===overlay)closeCustomization()});
document.addEventListener('keydown',event=>{if(event.key==='Escape'){if(!overlay.hidden){event.preventDefault();closeCustomization()}else{engineMenu.hidden=true;if(!query.value){query.blur();document.activeElement.blur?.()}updateSearchMode()}return}if(event.key!=='Tab'||overlay.hidden)return;const focusable=[...modal.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex]:not([tabindex="-1"])')].filter(item=>!item.closest('[hidden]'));if(!focusable.length)return;const first=focusable[0],last=focusable.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}});
window.ardaliCustomization={open:openCustomization,close:closeCustomization,select:selectCategory,isOpen:()=>!overlay.hidden,category:()=>selectedCategory};
document.documentElement.dataset.customizationReady='true';

$('#search').onsubmit=event=>{event.preventDefault();const value=$('#query').value.trim();if(!value)return;const engine=$('#engine').value||'Google';location.href='ardali://navigate?q='+encodeURIComponent(value)+'&engine='+encodeURIComponent(engine)+'&cap='+encodeURIComponent(suggestionCapability);};
$('#engine-current').onclick=event=>{event.preventDefault();engineMenu.hidden=!engineMenu.hidden;updateSearchMode()};
document.querySelectorAll('.engine-option').forEach(button=>button.onclick=()=>{setEngine(button.dataset.engine,true);query.focus();updateSearchMode()});
document.addEventListener('pointerdown',event=>{if(!event.target.closest('.engine-picker')){engineMenu.hidden=true;setTimeout(updateSearchMode,0)}});
window.addEventListener('ardali-frequent-sites',applyFrequentConfig);
window.addEventListener('ardali-frequent-site-icons',renderFrequentSites);
window.addEventListener('ardali-settings-search-suggestions',render);
setEngine($('#engine').value);applyFrequentConfig();tick();setInterval(tick,1000);
</script>
</body>
</html>)NTP").arg(google, duck, brave, bing);
  html.replace(QLatin1String("__SEARCH_PLACEHOLDER__"), searchEnginePlaceholder(defaultEngine).toHtmlEscaped());
  QStringList placeholders;
  QStringList engineIcons;
  for (const auto &definition : ardali::core::searchEngineDefinitions()) {
    const QString engine = QString::fromLatin1(definition.id);
    const QString iconAsset = QString::fromLatin1(definition.iconAsset);
    placeholders.append(jsonStringLiteral(engine) + QLatin1Char(':') + jsonStringLiteral(searchEnginePlaceholder(engine)));
    engineIcons.append(jsonStringLiteral(engine) + QLatin1Char(':') + jsonStringLiteral(iconAsset));
    QString token = engine.toUpper();
    token.replace(QLatin1Char(' '), QLatin1Char('_'));
    html.replace(QStringLiteral("__%1_ENGINE_ICON__").arg(token), iconAsset.toHtmlEscaped());
  }
  QString placeholderJson = QLatin1Char('{') + placeholders.join(QLatin1Char(',')) + QLatin1Char('}');
  placeholderJson.replace(QLatin1String("</"), QLatin1String("<\\/"));
  html.replace(QLatin1String("__SEARCH_PLACEHOLDERS__"), placeholderJson);
  html.replace(QLatin1String("__SEARCH_ENGINE_ICONS__"),
               QLatin1Char('{') + engineIcons.join(QLatin1Char(',')) + QLatin1Char('}'));
  html.replace(QLatin1String("__ARDALI_FREQUENT_SITES__"), freqJson);
  html.replace(QLatin1String("__ARDALI_BOOKMARKS__"), bkmkJson);
  return html;
}

QString newTabTopSitesUpdateScript(const QJsonArray &frequentSites,
                                   const QJsonArray &bookmarks) {
  return QStringLiteral(
      "(()=>{const frequent=%1;const bookmarks=%2;"
      "window.ardaliFrequentSites=frequent;"
      "window.ardaliTopSiteSources={frequent,bookmarks};"
      "if(typeof window.renderFrequentSites==='function')window.renderFrequentSites();})()")
      .arg(jsonForInlineScript(frequentSites), jsonForInlineScript(bookmarks));
}

QString strictBlockWarningHtml(const QString &domain, const QString &targetUrl) {
  const QString safeDomain = domain.toHtmlEscaped();
  const QUrl bypassTarget = validatedStrictBlockTarget(domain, targetUrl);
  if (!bypassTarget.isValid()) return {};
  const QString domainLiteral = jsonStringLiteral(domain);
  const QString targetLiteral = jsonStringLiteral(bypassTarget.toString(QUrl::FullyEncoded));

  return QString::fromUtf8(R"SBW(<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>Site Engellendi — ArDali Koruması</title>
<style>
:root { color-scheme: dark; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Ubuntu, sans-serif; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; background: #0c1017; color: #e4ebf5; display: grid; place-items: center; padding: 24px; }
.card { background: #151b24; border: 1.5px solid #3c1e24; border-radius: 16px; padding: 36px 32px; max-width: 560px; width: 100%; box-shadow: 0 12px 36px rgba(0,0,0,0.6); text-align: center; }
.icon-box { width: 68px; height: 68px; margin: 0 auto 20px; border-radius: 50%; background: #3b171c; border: 2px solid #ff4d4d; display: grid; place-items: center; font-size: 32px; }
h1 { font-size: 20px; font-weight: 700; margin: 0 0 12px; color: #ff6b6b; }
.domain-badge { display: inline-block; background: #221217; color: #ff9999; border: 1px solid #5a232b; border-radius: 8px; padding: 6px 16px; font-family: monospace; font-size: 14px; font-weight: 600; margin-bottom: 16px; word-break: break-all; }
p { font-size: 14px; color: #9aa7b8; line-height: 1.6; margin: 0 0 28px; }
.actions { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
button { border: 0; border-radius: 8px; padding: 10px 22px; font-size: 13px; font-weight: 600; cursor: pointer; transition: all .16s; }
.btn-back { background: #2367d1; color: #ffffff; }
.btn-back:hover { background: #2f79ec; }
.btn-proceed { background: #252e3b; color: #b8c4d4; border: 1px solid #3d4c61; }
.btn-proceed:hover { background: #333f52; color: #ffffff; border-color: #5a6e8c; }
</style>
</head>
<body>
<div class="card">
  <div class="icon-box">🛡️</div>
  <h1>Bu Site ArDali Koruması Tarafından Engellendi</h1>
  <div class="domain-badge">%1</div>
  <p>Bu alan adı mevcut filtreleme kuralları tarafından <strong>katı engelleme (strict blocking)</strong> veya potansiyel zararlı içerik kapsamında durduruldu.</p>
  <div class="actions">
    <button class="btn-back" onclick="goBack()">← Geri Dön (Güvenli)</button>
    <button class="btn-proceed" onclick="proceedBypass()">Engeli Aş ve Devam Et (15 dk İzin)</button>
  </div>
</div>
<script>
const bypassDomain = %2;
const bypassTarget = %3;
function goBack() {
  if (window.history.length > 1) window.history.back();
  else window.location.href = 'ardali://newtab';
}
function proceedBypass() {
  window.location.href = 'ardali://bypass-strictblock?domain=' + encodeURIComponent(bypassDomain) + '&target=' + encodeURIComponent(bypassTarget);
}
</script>
</body>
</html>)SBW").arg(safeDomain, domainLiteral, targetLiteral);
}

QString incognitoNewTabHtml(const QString &defaultEngine) {
  const QString engine = (defaultEngine == QLatin1String("DuckDuckGo") ||
                          defaultEngine == QLatin1String("Brave Search") ||
                          defaultEngine == QLatin1String("Bing"))
                             ? defaultEngine
                             : QStringLiteral("Google");
  const QString placeholder = QStringLiteral("%1'da gizli ara veya URL yazın").arg(engine);

  return QString::fromUtf8(R"INCOGNITO(<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Yeni Gizli Sekme</title>
<style>
:root {
  color-scheme: dark;
  --bg-dark: #090e15;
  --card-bg: rgba(18, 25, 36, 0.78);
  --card-border: rgba(255, 255, 255, 0.08);
  --accent-cyan: #38bdf8;
  --accent-glow: rgba(56, 189, 248, 0.18);
  --text-main: #f1f5f9;
  --text-muted: #94a3b8;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  background-color: var(--bg-dark);
  background: radial-gradient(ellipse 900px 520px at 50% 120px, rgba(24, 38, 58, 0.55) 0%, var(--bg-dark) 85%);
  color: var(--text-main);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
}
.container {
  width: min(740px, 100%);
  text-align: center;
  animation: fadeIn 0.35s ease-out;
}
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
.badge-wrap {
  width: 96px;
  height: 96px;
  border-radius: 50%;
  background: linear-gradient(145deg, #182332, #101722);
  border: 2px solid rgba(56, 189, 248, 0.3);
  box-shadow: 0 16px 36px rgba(0, 0, 0, 0.55), 0 0 30px var(--accent-glow);
  display: grid;
  place-items: center;
  margin: 0 auto 22px;
}
.badge-wrap svg {
  width: 52px;
  height: 52px;
  stroke: #f8fafc;
}
h1 {
  font-size: 28px;
  font-weight: 700;
  margin: 0 0 10px;
  letter-spacing: -0.02em;
  color: #ffffff;
}
.intro {
  font-size: 14.5px;
  line-height: 1.6;
  color: var(--text-muted);
  max-width: 620px;
  margin: 0 auto 28px;
}
.search-bar {
  position: relative;
  display: flex;
  align-items: center;
  width: min(580px, 100%);
  height: 50px;
  margin: 0 auto 34px;
  border: 1.5px solid rgba(56, 189, 248, 0.45);
  border-radius: 26px;
  background: rgba(13, 19, 29, 0.9);
  padding: 0 16px;
  box-shadow: 0 8px 25px rgba(0,0,0,0.45);
  transition: border-color 0.2s, box-shadow 0.2s, transform 0.2s;
}
.search-bar:focus-within {
  border-color: #38bdf8;
  box-shadow: 0 10px 30px rgba(0,0,0,0.55), 0 0 20px var(--accent-glow);
  transform: translateY(-1px);
}
.search-icon {
  width: 20px;
  height: 20px;
  margin-right: 12px;
  opacity: 0.75;
}
.search-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: #fff;
  font-size: 15px;
}
.search-input::placeholder {
  color: #64748b;
}
.search-btn {
  background: rgba(56, 189, 248, 0.15);
  border: 1px solid rgba(56, 189, 248, 0.35);
  color: #38bdf8;
  border-radius: 16px;
  padding: 6px 14px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}
.search-btn:hover {
  background: rgba(56, 189, 248, 0.28);
}
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  text-align: left;
  margin-bottom: 16px;
}
@media (max-width: 640px) {
  .grid { grid-template-columns: 1fr; }
}
.card {
  background: var(--card-bg);
  backdrop-filter: blur(16px);
  border: 1px solid var(--card-border);
  border-radius: 16px;
  padding: 20px 22px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.3);
  transition: border-color 0.2s, transform 0.2s;
}
.card:hover {
  border-color: rgba(56, 189, 248, 0.25);
  transform: translateY(-1px);
}
.card h2 {
  font-size: 14.5px;
  font-weight: 650;
  margin: 0 0 14px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.card.danger h2 { color: #f87171; }
.card.info h2 { color: #38bdf8; }
.icon-indicator {
  font-size: 13px;
  font-weight: bold;
}
ul {
  margin: 0;
  padding-left: 18px;
  font-size: 13.5px;
  line-height: 1.7;
  color: #cbd5e1;
}
.shield-card {
  grid-column: 1 / -1;
  border-left: 3px solid #38bdf8;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 20px;
}
.shield-icon {
  flex: 0 0 28px;
  display: grid;
  place-items: center;
}
.shield-icon svg {
  stroke: #38bdf8;
}
.shield-content {
  flex: 1;
}
.shield-content h3 {
  font-size: 14px;
  font-weight: 650;
  margin: 0 0 4px;
  color: #f1f5f9;
}
.shield-content p {
  margin: 0;
  font-size: 13px;
  color: var(--text-muted);
  line-height: 1.5;
}
</style>
</head>
<body>
<div class="container">
  <div class="badge-wrap">
    <svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="m5 10 2-6h10l2 6M3 10h18"/>
      <circle cx="7" cy="15" r="3.2"/>
      <circle cx="17" cy="15" r="3.2"/>
      <path d="M10.2 15h3.6"/>
    </svg>
  </div>
  <h1>Gizli Moddasınız</h1>
  <p class="intro">Etkinliğiniz bu cihazı kullanan diğer kişiler tarafından görülmediğinden daha gizli bir şekilde göz atabilirsiniz. İndirdiğiniz dosyalar ve oluşturduğunuz yer işaretleri kaydedilir.</p>

  <form class="search-bar" id="incognitoSearchForm" action="#" method="get">
    <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
    <input type="text" class="search-input" id="searchQuery" placeholder="%1" autocomplete="off" autofocus>
    <button type="submit" class="search-btn">Ara</button>
  </form>

  <div class="grid">
    <div class="card danger">
      <h2><span class="icon-indicator">✕</span> ArDali şunları kaydetmez:</h2>
      <ul>
        <li>Tarama ve arama geçmişiniz</li>
        <li>Çerezler ve site verileri</li>
        <li>Formlara ve giriş alanlarına yazılan bilgiler</li>
        <li>Oturum şifreleri ve geçici önbellek</li>
      </ul>
    </div>
    <div class="card info">
      <h2><span class="icon-indicator">ℹ</span> Etkinliğiniz şunlar tarafından görülebilir:</h2>
      <ul>
        <li>Ziyaret ettiğiniz web siteleri</li>
        <li>İşvereniniz veya okul ağ yöneticiniz</li>
        <li>İnternet servis sağlayıcınız (ISS)</li>
      </ul>
    </div>
    <div class="card shield-card">
      <div class="shield-icon">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
      </div>
      <div class="shield-content">
        <h3>ArDali Kalkanı Gizlilik Koruması</h3>
        <p>Üçüncü taraf takipçiler, izleme kodları ve reklamlar ArDali Kalkanı tarafından bu gizli oturumda da otomatik olarak engellenir.</p>
      </div>
    </div>
  </div>
</div>

<script>
let suggestionCapability = '';
window.ardaliSuggestionBridge = function(cap) {
  suggestionCapability = cap;
};
const activeEngine = %2;
document.getElementById('incognitoSearchForm').onsubmit = function(event) {
  event.preventDefault();
  const q = document.getElementById('searchQuery').value.trim();
  if (!q) return;
  location.href = 'ardali://navigate?q=' + encodeURIComponent(q) + '&engine=' + encodeURIComponent(activeEngine) + '&cap=' + encodeURIComponent(suggestionCapability);
};
</script>
</body>
</html>)INCOGNITO").arg(placeholder, jsonStringLiteral(engine));
}

