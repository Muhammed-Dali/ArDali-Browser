# ArDali Browser AdBlock Mimari Audit ve Legacy Parity Raporu

Tarih: 2026-08-21  
Source of truth: legacy `ArDali-WebMedia` checkout (salt okunur)  
Qt hedefi: `browser/`  
Doğrulanan build: `browser/build/`

## A. Eski ArDali-WebMedia Mimari Haritası

Legacy runtime zinciri:

1. `main.js` ayarları normalize eder ve `modules/adblock-ruleset-registry.js:getActiveRulesetPlan` ile tek plan üretir.
2. Plan, moda veya açık kullanıcı seçimine göre ID'leri çözer. Basic yalnız etkin `default`; Ideal tüm etkin main listeler + `tur-0`; Aggressive bunlara deneysel listeyi ekler.
3. `main.js:buildAdblockConfig` builtin noop/YouTube/platform kurallarını, her ID'nin `main` ve `regex` realm'ini, uygun `strictblock` realm'lerini ve custom network kurallarını birleştirir.
4. `modules/adblock-engine.js:evaluateDnrRules` site policy, method, resource type, domain, URL/regex ve priority/action sıralamasını değerlendirir.
5. `onBeforeRequest` sonucu allow/block/redirect olarak uygular; redirect URL, transform, regex substitution ve `web_accessible_resources` desteklenir.
6. `evaluateDnrHeaderModifications` request/response header aşamasını ayrı yürütür.
7. `webviewAdblockPreload.js:installDeliBlockScriptingBridge` generic/specific/procedural/scriptlet paketlerini host planına göre alır. Main scriptlet ana dünyada, isolated paket izole dünyada çalışır.
8. Specific/procedural indeks hostname uzunluğu, sonra lexicographic sırasına göre aranır; parent, subdomain, entity, regex ve negative exception referansları uygulanır.
9. Procedural executor task/action zincirini çalıştırır; tek debounce timer ve tek observer kullanır, navigation değişiminde state'i sıfırlar.
10. YouTube için erken ana-dünya patch'i, DNR core allow/block kuralları ve DOM temizliği birlikte çalışır. Generic procedural executor YouTube player DOM'unda özellikle devre dışıdır.
11. Her karar tab/site bağlamına yazılır; sayaç, logger ve persistent istatistik state'i güncellenir.
12. `adblock:refreshRulesets` uzaktan indirme yapmaz. Yerel `rulesetCache`, `strictblockCache` ve `scriptingCache` temizlenir, bundled plan yeniden parse/compile edilir.

## B. Yeni Qt ArDali Browser Mimari Haritası

Qt runtime zinciri:

1. `QWebEngineUrlRequestInterceptor` URL, first-party URL, method ve Qt resource type'ını `AdBlockService`'e iletir.
2. `AdBlockService` doğru tabı çözer, parent-domain site policy'yi alır ve `AdBlockFilterEngine`'i çağırır.
3. Engine custom allow/block kurallarını, ardından priority/action sıralı DNR adaylarını değerlendirir.
4. Aday plan resource-type, request-domain/domain-anchor ve güvenli URL trigram indekslerinden seçilir; full ruleset request başına taranmaz.
5. Interceptor block veya redirect uygular. Direct URL, query/URL transform, regex substitution, upgradeScheme ve bundled redirect data URL desteklenir.
6. Strict main-frame eşleşmesi `ardali://newtab?strictblock=1` uyarısına gider; 15 dakikalık bypass bir sonraki navigation'a gerçekten izin verir.
7. `BrowserPage::acceptNavigationRequest` ana-frame navigation kabul edilmeden önce tek `prepareAdBlockScripts` yolunu çağırır.
8. Bu yol dört isimli scripti kaldırıp yeni host için bir kez kurar: cosmetic, main scriptlet, isolated scriptlet, procedural.
9. Host preflight, scriptlet bundle'larını yalnız ilgili hostname/subdomain/entity/regex eşleşmesinde inject eder. Generated bundle kendi include/exclude/args semantics'ini yürütür.
10. Specific/procedural JSON ve script kaynakları cache'lenir. Whitelist tüm scripting/cosmetic katmanlarını kapatır.
11. YouTube dedicated patch'i tek observer + 120 ms debounce kullanır. Generic procedural observer YouTube'da kurulmaz.
12. Aggregate sayaçlar ve 120 günlük günlük kırılım `adblock-statistics.ini` içinde 5 saniyelik debounce ile tutulur; restart ve reset yaşam döngüsü ayrık test edilmiştir.
13. Filter update `QtConcurrent` worker'da doğrulama, disk okuma, JSON parse, sort ve compile yapar; GUI'ye progress yollar ve yalnız başarılı sonucu kısa mutex altında atomik swap eder.

## C. Parity Matrix

| Özellik | Legacy | Qt sonuç | Durum | Not / risk |
|---|---|---|---|---|
| Network filtering | DNR + builtin + custom | Aynı katmanlar | ✅ MATCH | Canlı request testli |
| DNR main + regex | Her aktif ID | Her aktif ID | ✅ MATCH | Önce regex realm eksikti |
| Priority/action rank | priority, allow > block > redirect | Aynı | ✅ MATCH | Deterministic ID tie-break |
| Case sensitivity | Koşula bağlı | Koşula bağlı | ✅ MATCH | Ayrı regex cache key |
| Resource types | Chromium türleri | Qt enum doğru eşleniyor | ✅ MATCH | WebSocket=254; preload 19/20 düzeltildi |
| Request methods | Dahil/hariç | Dahil/hariç | ✅ MATCH | YouTube POST regression kök düzeltmesi |
| Header conditions/modification | Request + response aşaması | Response aşaması yok | ⚠️ PARTIAL | Bundled corpus: 131 modifyHeaders + 28 header-condition; false-positive yerine fail-open |
| Whitelist | Tüm katmanlar kapalı | Tüm katmanlar kapalı | ✅ MATCH | Parent/subdomain ve restart testli |
| Site policy | Parent hostname lookup | Aynı | ✅ MATCH | ad/tracker/temporary/whitelist |
| Basic / Ideal / Aggressive | Registry planı | Tek resolver ile aynı | ✅ MATCH | Network ve scripting aynı ID planını kullanıyor |
| Strict blocking | Malware baseline + toggle/aggressive | Aynı | ✅ MATCH | Warning + bypass loop testi |
| Custom filters | Network/cosmetic/procedural + validation | Aynı üç katman | ✅ MATCH | `#?#`, `#@?#` ve standard extended cosmetic syntax parse ediliyor |
| Filter list selection | Explicit empty dahil | Aynı | ✅ MATCH | Gizli fallback kaldırıldı |
| Filter update | Bundled cache refresh | Bundled async rebuild | ✅ MATCH | Remote download iki tarafta da yok |
| Failed update rollback | Eski state korunur | Eski plan korunur | ✅ MATCH | Bozuk JSON testi |
| Cosmetic generic | Generated assets | ApplicationWorld/CSS | ✅ MATCH | Cache'li |
| Specific cosmetic | Length + lexical index | Aynı | ✅ MATCH | Synthetic root/sub/deep/exception testi |
| Procedural cosmetic | Task/action + debounce | Güncel asset task/action seti + deadline | ✅ MATCH | YouTube'da legacy gibi kapalı |
| Scriptlets | Host/entity/regex map | Aynı generated map preflight | ✅ MATCH | Args/exceptions bundle içinde yürür |
| MainWorld / isolated | Ayrı realm | MainWorld / ApplicationWorld | ✅ MATCH | DocumentCreation |
| Redirect resources | URL/transform/substitution/WAR | Aynı | ✅ MATCH | Build'e bundled 31 MB asset kopyası |
| YouTube core assets | Explicit allow | Explicit allow | ✅ MATCH | thumbnail/avatar/player/googlevideo testli |
| YouTube ad endpoints | Targeted block/redirect | Aynı | ✅ MATCH | adformat/pagead/doubleclick testli |
| YouTube sponsored cards | Dedicated cleanup | Dedicated cleanup | ✅ MATCH | Canlı DOM: 0 görünür |
| Counters | Ağ kararları ayrı | block/allow/redirect ayrı | ✅ MATCH | Cosmetic/scriptlet sahte sayılmaz |
| Logger | Ring/request detail | Ring/request detail | ✅ MATCH | URL/type/tab/rule/action |
| Backup/restore/reset | Versioned state | Versioned transactional state | ✅ MATCH | Runtime stats backup dışında |
| Settings persistence | Otomatik sync | Otomatik sync | ✅ MATCH | Tek settings source-of-truth |
| Auto reload | Son web tab | Son gerçek web view | ✅ MATCH | Internal tab reload edilmez |
| Tab context | WebContents/tab mapping | Registry + exact URL/host/active fallback | ✅ MATCH | Multi-tab isolation testi |
| SPA lifecycle | Tek observer/timer | Tek observer/timer | ✅ MATCH | Canlı üç reload: her seferinde 1/1 |
| Performance | Candidate cache | Resource/domain/token index | ✅ MATCH | No-match ortalama ~1.6 ms |
| Persistent statistics | Diskte tutulur | Ayrı disk store + daily history | ✅ MATCH | Restart/reset ve block/redirect ayrımı testli |

## D. Code Hygiene Audit

Sonuç:

- Duplicate critical logic: 0 — mode/list çözümü `resolveRulesetIds` içinde.
- Duplicate engine rebuild: 0 — yalnız `filteringPlanChanged` derleme tetikler.
- Duplicate script injection: 0 — yalnız `prepareAdBlockScripts` kaldırır/kurar.
- Duplicate YouTube selector source: 0 — `kYouTubeAdSelector` tek kaynak.
- Duplicate MutationObserver: 0 — YouTube dedicated ve non-YouTube procedural yolları ayrık.
- Leaked timer/listener: 0 — document lifecycle ile temizlenir; tek debounce flag.
- Conflicting defaults: 0 — `AdBlockDefaults` tek kaynak.
- GUI thread parse/sort: 0 — filter update worker'da.
- `processEvents` ile donma gizleme: AdBlock yolunda yok.
- Developer absolute resource fallback: 0 — build runtime asset'i kendi yanında taşır.

UI'nin bütün sekmeleri her 1.5 saniyede yeniden oluşturması kaldırıldı. Yalnız görünür Statistics/Logger/Develop canlı verisi periyodik yenileniyor; logger her request'te tabloyu baştan kurmuyor.

## E. Removed / Merged / Rewritten Code

| Dosya / alan | İlk audit sınıfı | Son işlem |
|---|---|---|
| `adblock_filter_engine.*` | PARTIAL/RISKY | REWRITE + KEEP: compile/swap, network/cosmetic/procedural custom parser, redirect, candidate index |
| `adblock_filter_list_manager.*` | PARTIAL/WRONG | REWRITE: tek plan, main+regex+strict, host caches |
| `adblock_service.*` | PARTIAL/DUPLICATE | MERGE: tek rebuild signal, async update, strict/counter ve persistent statistics |
| `adblock_settings.*` | DUPLICATE/RISKY | MERGE: tek defaults, transactional restore, parent policy |
| `adblock_page.*` | PARTIAL/RISKY | MERGE: gerçek progress, validation, görünür-tab refresh |
| `adblock_request_interceptor.*` | PARTIAL | KEEP + method propagation/resource correction |
| `adblock_shield_button.*` | KEEP | Sayaç/site policy entegrasyonu korundu |
| `adblock_types.h` | PARTIAL | MERGE: method, redirect metadata, ayrı redirect stats |
| `main.cpp` injection | DUPLICATE/WRONG | MERGE: navigation öncesi tek lifecycle yolu |
| `adblock_test.cpp` | PARTIAL | REWRITE/EXTEND: 17 audit kontrolü + gerçek ruleset |
| `resources/adblock` | KEEP | Legacy bundled assets Qt build runtime paketine alındı |

## F. YouTube Root Cause

Canlı DevTools kanıtı:

- Önce: normal `googlevideo/videoplayback` Fetch istekleri `POST` idi ve `net::ERR_ACCESS_DENIED` ile bitiyordu; video `readyState=0`, spinner açıktı.
- Legacy builtin kural `1000009`, expire regex'ini yalnız `requestMethods: ['get']` için engelliyor.
- Qt builtin kopyasında bu method koşulu eksikti. Yüksek priority 120 kural normal POST medya parçalarını da block ediyordu.
- Düzeltme: builtin kurala GET method scope eklendi ve interceptor gerçek `requestMethod` bilgisini engine'e taşır hale getirildi.
- Sonra: aynı `videoplayback` POST istekleri HTTP 200 `application/vnd.yt-ump`; video `readyState=4`, `currentTime=10.12`, `paused=false`, spinner kapalı.
- Genel procedural executor'ın YouTube'da çalışması kaldırıldı; legacy'nin dedicated hafif yolu kullanılıyor.
- Riskli global Promise/Map/JSON/fetch/XHR monkey patch'leri Qt tarafına eklenmedi.

## G. Filter Update Freeze Root Cause

İlk Qt kodunda update gerçek iş ilerlemesi olmadan queued metadata adımları gösteriyor, parse/sort/rebuild ise GUI thread'de yapılabiliyordu. Büyük JSON ve script paketleri UI'yi kilitliyordu.

Yeni akış:

`button -> immediate busy/progress -> QtConcurrent validation/parse/cosmetic/compile/index -> result -> atomic swap -> finished -> optional web reload`

Bozuk/missing JSON, çalışan engine'i değiştirmeden hata verir. Worker kapanışta service/list manager ömründen uzun yaşayamaz.

## H. Eksik Özellikler

1. Qt `QWebEngineUrlRequestInterceptor`, response header aşaması sağlamaz. Bundled corpus içindeki 131 `modifyHeaders` kuralı ile response header kullanan 28 koşul birebir uygulanamıyor. Yanlış block üretmemek için header-condition kuralları fail-open.

Qt 6.11.1'in extension manager yolu da güvenli bir çözüm vermedi. İzole persistent profil, aktif `QWebEnginePage`, `loadFinished` sinyali, sinyalden kopyalanmış stabil `QWebEngineExtensionInfo` ve gecikmeli enable ile tekrarlandı: background/service-worker içermeyen minimal MV3 extension `loadExtension()` ile hatasız ve `loaded=1, enabled=0` yüklendi; `setExtensionEnabled(..., true)` çağrısı ise ana thread'de `/usr/lib/libQt6WebEngineCore.so.6` içinde deterministik `SIGSEGV` üretti. Aynı extension'ı enable öncesi reload etmek reload yolunda da `SIGSEGV` verdi.

Kurulu paketler `qt6-webengine 6.11.1-5`, `qt6-base 6.11.1-1.1`; probe ile uygulama aynı sistem kütüphanelerini kullandı. `QTWEBENGINE_CHROMIUM_FLAGS=--load-extension=... --disable-extensions-except=...` denemesinde manager yalnız built-in Chromium PDF ve Google Hangouts extension'larını gördü. Qt'nin kendi 6.11.1 kaynak zinciri extension'ı önce disabled registry'ye ekliyor ve tek public enable yolu `ExtensionRegistrar::EnableExtension` üzerinden geçiyor. Güncel qutebrowser kodu da Qt 6.11 için `setExtensionEnabled` segfault'u nedeniyle bu API'yi kullanmayıp unload workaround'u uyguluyor.

Crash riski taşıyan MV3 köprü üretim koduna alınmadı. Mevcut native interceptor mimarisi değiştirilmeden bu parity platform tarafından bloklanıyor; çözüm için çalışan bir Qt WebEngine extension-enable sürümü veya Qt'nin response interception API'si gerekiyor. Yerel MITM proxy/CDP daemon gibi yeni bir ağ mimarisi görevin açık kısıtına aykırı olduğu için eklenmedi.

## I. Fazla / Riskli Özellikler

- Önceki duplicate `urlChanged` + `loadStarted` script injection kaldırıldı.
- Sonsuz 500/1000 ms YouTube polling timer'ları kaldırıldı.
- Generic procedural observer'ın YouTube player DOM'unda çalışması kaldırıldı.
- Her hostta tüm main/isolated scriptlet bundle'larını inject etme davranışı kaldırıldı.
- Geliştirici makinesine ait mutlak `/home/...` ruleset fallback'leri kaldırıldı.
- Header koşullarını header bilgisi yokken true sayıp medya bloklama riski fail-open yapıldı.

## J. Performance Findings

- İlk gerçek no-match benchmark: yaklaşık 69–145 ms/request.
- Son benchmark: yaklaşık 1.6 ms/request.
- Kazanç: resource/domain/domain-anchor/trigram candidate indeksleri ve hot path'teki tekrar regex construction'ın kaldırılması.
- JSON/source disk tekrarları host cache'leriyle kaldırıldı.
- Scriptlet applicability sonucu path+host bazında cache'leniyor.
- Procedural executor çalışma başına 12 ms deadline, 90 ms debounce ve attribute filter kullanıyor.
- Custom procedural kurallar parse sırasında compile edilip host/exception planına ekleniyor; request hot path'inde tekrar parse edilmiyor.
- YouTube dedicated cleanup 120 ms burst debounce kullanıyor; sürekli interval yok.
- Canlı üç reload sonucu: her document'ta 1 ArDali observer, 1 cosmetic style, 0 generic procedural observer.

## K. Değiştirilen Dosyalar

- `browser/CMakeLists.txt`
- `browser/native/main.cpp`
- `browser/native/adblock_types.h`
- `browser/native/adblock_settings.{h,cpp}`
- `browser/native/adblock_filter_engine.{h,cpp}`
- `browser/native/adblock_filter_list_manager.{h,cpp}`
- `browser/native/adblock_request_interceptor.{h,cpp}`
- `browser/native/adblock_service.{h,cpp}`
- `browser/native/adblock_page.{h,cpp}`
- `browser/native/adblock_shield_button.{h,cpp}`
- `browser/native/adblock_test.cpp`
- `browser/resources/adblock/**`
- `browser/docs/ADBLOCK_AUDIT.md`

Legacy `ArDali-WebMedia` checkout'unda hiçbir dosya değiştirilmedi. Sistem install veya desktop entry işlemi yapılmadı.

## L. Test Sonuçları

- `npm run build`: son kaynaklarla PASS; çıktı yalnız sistemde opsiyonel Vulkan header paketinin bulunmadığını bildirdi.
- `npm test` sandbox dışında, son kaynaklarla: **15/15 PASS**, 53.85 s.
- AdBlock audit executable: **17/17 kontrol PASS**.
- İlk tam turda kapanış sırasında yeni-sekme JavaScript callback'inin yok edilmekte olan `QStackedWidget`'a eriştiği bir lifecycle segfault'u yakalandı; bağımsız shutdown guard ile düzeltildi ve hem izole test hem son tam paket geçti.
- Async success progress: 0→1→2→3 ve success.
- Async corrupt JSON: failure + eski rule count korunuyor.
- YouTube canlı Ideal/strict OFF:
  - homepage thumbnail/image mevcut;
  - Sponsorlu DOM node'ları olsa da görünür node 0;
  - normal video POST parçaları HTTP 200;
  - readyState 4, currentTime ilerliyor, spinner false;
  - muted false ve volume > 0;
  - seek hedefi uygulanıyor, readyState 4 korunuyor;
  - playlist/radio URL'si yükleniyor.
- YouTube canlı Ideal/strict ON, gerçek kullanıcı ayarı UI üzerinden açılarak:
  - reload sonrası normal `googlevideo/videoplayback` POST parçaları HTTP 200;
  - readyState 4, paused false, spinner false ve currentTime ilerliyor;
  - seek 46.20 s hedefine uygulandı, altı saniye sonra 52.14 s ve readyState 4;
  - radyo/list URL'si korunuyor;
  - sekiz kaydırma örneğinde görünür sponsor 0, video kesintisiz;
  - muted false, volume 0.58; otomasyon ses hattının aktif olduğunu doğruladı, fiziksel işitsel değerlendirme yapmadı.
- Strict warning/bypass lifecycle native testte PASS. Canlı tur sonunda kullanıcıdaki strict ayarı başlangıçtaki OFF durumuna geri döndürüldü ve tekrar okundu.
- Üç gerçek YouTube reload: observer/style sayıları her seferinde `1/1`, procedural `false`, görünür sponsor `0`.

## M. Remaining Technical Debt

| Seviye | Borç | Etki |
|---|---|---|
| Medium | Response header condition/modifyHeaders parity | Bazı anti-popup/CSP kuralları fail-open |

## N. Release Verdict

- High: 0
- Medium: 1
- Low: 0

| Alan | Verdict |
|---|---|
| Legacy parity | NOT READY: response-header parity platform tarafından bloklu |
| YouTube playback | READY |
| YouTube sponsored cards | READY |
| Filter updating | READY |
| Settings persistence | READY |
| Reset defaults | READY |
| Whitelist | READY |
| Specific cosmetics | READY |
| Procedural filtering | READY for bundled + custom realm |
| Scriptlets | READY |
| Redirect resources | READY |
| Tab context | READY |
| Counter | READY for session/runtime + persistent aggregate separation |
| Performance | READY |
| Code duplication | READY |
| Lifecycle cleanup | READY |

**FINAL: NOT READY**

Core browsing, iki strict modunda YouTube playback/sponsored-card temizliği, custom procedural filtreler, persistent statistics ve filter-update akışı release-ready durumdadır. Ancak görev tam legacy parity istediği için Qt'nin mevcut native request interceptor API'sinde uygulanamayan response-header/`modifyHeaders` katmanı çözülmeden bütün sistem için `READY` denemez.
