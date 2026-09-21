#include "settings_page.h"
#include "settings_ui_helpers.h"
#include "browser_profile_service.h"

using namespace ardali::settings_ui;

QWidget *SettingsPage::createContentSection() {
  Section section = makeSection(QStringLiteral("İçerik"), QStringLiteral("Web sitelerinin JavaScript, resim, çerez ve açılır pencere davranışlarını yönetin."));

  auto *contentCard = makeCard(section.page, QStringLiteral("İÇERİK"));

  // Çerezleri engelle
  const auto getCookieSub = [this] {
    const auto pol = profileService_->cookiePolicy();
    if (pol == QStringLiteral("block_all")) return QStringLiteral("Tüm çerezler engelleniyor");
    if (pol == QStringLiteral("allow_all")) return QStringLiteral("Tüm çerezlere izin veriliyor");
    return QStringLiteral("Üçüncü taraf çerezleri engelleniyor");
  };
  InteractiveSettingRowResult cookieRow;
  cookieRow = makeInteractiveSettingRow(
      contentCard, BrowserIcon::Cookie, QStringLiteral("Çerezleri engelle"), getCookieSub(),
      [this](QLabel *subLabel) {
        const auto pol = profileService_->cookiePolicy();
        int idx = pol == QStringLiteral("block_all") ? 2 : (pol == QStringLiteral("allow_all") ? 1 : 0);
        showOptionDialog(
            this, QStringLiteral("Çerez Ayarları"), BrowserIcon::Cookie,
            QStringLiteral("Web sitelerinin çerez saklama ve izleme verisi davranışını belirleyin."),
            {
                {QStringLiteral("Üçüncü taraf çerezleri engelle (önerilir)"), QStringLiteral("Siteler normal çalışır ancak üçüncü taraf izleyici ve analiz çerezleri engellenir.")},
                {QStringLiteral("Tüm çerezlere izin ver"), QStringLiteral("Siteler hem birinci hem de üçüncü taraf çerezleri saklayabilir.")},
                {QStringLiteral("Tüm çerezlere engelle (önerilmez)"), QStringLiteral("Çerezler tamamen engellenir. Birçok web sitesi oturum açma işlevi çalışmayabilir.")}
            },
            idx,
            [this, subLabel](int chosen) {
              QString newPol = chosen == 2 ? QStringLiteral("block_all") : (chosen == 1 ? QStringLiteral("allow_all") : QStringLiteral("third_party"));
              profileService_->setCookiePolicy(newPol);
              if (subLabel) {
                subLabel->setText(chosen == 2 ? QStringLiteral("Tüm çerezler engelleniyor") : (chosen == 1 ? QStringLiteral("Tüm çerezlere izin veriliyor") : QStringLiteral("Üçüncü taraf çerezleri engelleniyor")));
              }
            });
      });
  addRow(contentCard, cookieRow.frame);

  // JavaScript
  const auto getJsSub = [this] {
    return profileService_->isJavascriptEnabled()
        ? QStringLiteral("Siteler JavaScript kullanabilir")
        : QStringLiteral("Sitelerin JavaScript kullanmasına izin verme");
  };
  InteractiveSettingRowResult jsRow;
  jsRow = makeInteractiveSettingRow(
      contentCard, BrowserIcon::Javascript, QStringLiteral("JavaScript"), getJsSub(),
      [this](QLabel *subLabel) {
        showOptionDialog(
            this, QStringLiteral("JavaScript"), BrowserIcon::Javascript,
            QStringLiteral("Web sitelerinin JavaScript kodu çalıştırma davranışını yönetin."),
            {
                {QStringLiteral("Siteler JavaScript kullanabilir (önerilir)"), QStringLiteral("Web siteleri etkileşimli özellikler, dinamik butonlar ve modern içeriklerle sorunsuz çalışır.")},
                {QStringLiteral("Sitelerin JavaScript kullanmasına izin verme"), QStringLiteral("JavaScript kodu engellenir. Sitelerin dinamik özellikleri çalışmayabilir ancak hız ve güvenlik artar.")}
            },
            profileService_->isJavascriptEnabled() ? 0 : 1,
            [this, subLabel](int chosen) {
              profileService_->setJavascriptEnabled(chosen == 0);
              if (subLabel) {
                subLabel->setText(chosen == 0 ? QStringLiteral("Siteler JavaScript kullanabilir") : QStringLiteral("Sitelerin JavaScript kullanmasına izin verme"));
              }
            });
      });
  addRow(contentCard, jsRow.frame);

  // Resimler
  const auto getImgSub = [this] {
    return profileService_->isAutoLoadImagesEnabled()
        ? QStringLiteral("Siteler resim gösterebilir")
        : QStringLiteral("Sitelerin resim göstermesine izin verme");
  };
  InteractiveSettingRowResult imgRow;
  imgRow = makeInteractiveSettingRow(
      contentCard, BrowserIcon::Image, QStringLiteral("Resimler"), getImgSub(),
      [this](QLabel *subLabel) {
        showOptionDialog(
            this, QStringLiteral("Resimler"), BrowserIcon::Image,
            QStringLiteral("Web sitelerinin resim ve grafik yükleme davranışını belirleyin."),
            {
                {QStringLiteral("Siteler resim gösterebilir (önerilir)"), QStringLiteral("Tüm web sitelerinde resimler, fotoğraflar ve grafikler otomatik yüklenir.")},
                {QStringLiteral("Sitelerin resim göstermesine izin verme"), QStringLiteral("Resimler yüklenmez; veri tasarrufu sağlanır ve yalnızca metin içerikler gösterilir.")}
            },
            profileService_->isAutoLoadImagesEnabled() ? 0 : 1,
            [this, subLabel](int chosen) {
              profileService_->setAutoLoadImagesEnabled(chosen == 0);
              if (subLabel) {
                subLabel->setText(chosen == 0 ? QStringLiteral("Siteler resim gösterebilir") : QStringLiteral("Sitelerin resim göstermesine izin verme"));
              }
            });
      });
  addRow(contentCard, imgRow.frame);

  // Pop-up ve yönlendirmeler
  const auto getPopupSub = [this] {
    return !profileService_->arePopupsAllowed()
        ? QStringLiteral("Sitelerin pop-up'lar göndermesine veya yönlendirmeler kullanmasına izin verme")
        : QStringLiteral("Siteler pop-up gönderebilir ve yönlendirmeler kullanabilir");
  };
  InteractiveSettingRowResult popupRow;
  popupRow = makeInteractiveSettingRow(
      contentCard, BrowserIcon::Popup, QStringLiteral("Pop-up ve yönlendirmeler"), getPopupSub(),
      [this](QLabel *subLabel) {
        showOptionDialog(
            this, QStringLiteral("Pop-up ve yönlendirmeler"), BrowserIcon::Popup,
            QStringLiteral("Sitelerin yeni pencere açma veya otomatik yönlendirme davranışını belirleyin."),
            {
                {QStringLiteral("Sitelerin pop-up'lar göndermesine veya yönlendirmeler kullanmasına izin verme (önerilir)"), QStringLiteral("İstenmeyen açılır pencereler ve otomatik yönlendirmeler engellenir.")},
                {QStringLiteral("Siteler pop-up gönderebilir ve yönlendirmeler kullanabilir"), QStringLiteral("Web sitelerinin pop-up pencereler açmasına izin verilir.")}
            },
            !profileService_->arePopupsAllowed() ? 0 : 1,
            [this, subLabel](int chosen) {
              profileService_->setPopupsAllowed(chosen == 1);
              if (subLabel) {
                subLabel->setText(chosen == 0 ? QStringLiteral("Sitelerin pop-up'lar göndermesine veya yönlendirmeler kullanmasına izin verme") : QStringLiteral("Siteler pop-up gönderebilir ve yönlendirmeler kullanabilir"));
              }
            });
      });
  addRow(contentCard, popupRow.frame);

  section.layout->addWidget(contentCard);
  section.layout->addStretch();
  return section.page;
}
