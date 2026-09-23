#include "settings_page.h"
#include "settings_ui_helpers.h"
#include "browser_profile_service.h"
#include "translate/translate_service.h"
#include "translate/language_detector.h"
#include "glow_toggle_switch.h"
#include "i18n/i18n.h"
#include "i18n/language_manager.h"

#include <QButtonGroup>
#include <QCheckBox>
#include <QComboBox>
#include <QDesktopServices>
#include <QDialog>
#include <QFrame>
#include <QHBoxLayout>
#include <QLabel>
#include <QLineEdit>
#include <QListWidget>
#include <QMenu>
#include <QAction>
#include <QMessageBox>
#include <QPushButton>
#include <QRadioButton>
#include <QScrollArea>
#include <QSettings>
#include <QStackedWidget>
#include <QVBoxLayout>
#include <QWebEngineProfile>

using namespace dalinira::settings_ui;

namespace {
struct LanguageMeta {
  QString code;
  QString displayName;
  QString spellCheckCode;
};

static const QList<LanguageMeta> kLanguagesList = {
  {QStringLiteral("tr"), QStringLiteral("Türkçe"), QStringLiteral("tr-TR")},
  {QStringLiteral("en-US"), QStringLiteral("İngilizce (Amerika Birleşik Devletleri)"), QStringLiteral("en-US")},
  {QStringLiteral("en"), QStringLiteral("İngilizce"), QStringLiteral("en-GB")},
  {QStringLiteral("en-GB"), QStringLiteral("İngilizce (Birleşik Krallık)"), QStringLiteral("en-GB")},
  {QStringLiteral("de"), QStringLiteral("Almanca"), QStringLiteral("de-DE")},
  {QStringLiteral("fr"), QStringLiteral("Fransızca"), QStringLiteral("fr-FR")},
  {QStringLiteral("es"), QStringLiteral("İspanyolca"), QStringLiteral("es-ES")},
  {QStringLiteral("it"), QStringLiteral("İtalyanca"), QStringLiteral("it-IT")},
  {QStringLiteral("ar"), QStringLiteral("Arapça"), QStringLiteral("ar")},
  {QStringLiteral("ru"), QStringLiteral("Rusça"), QStringLiteral("ru-RU")},
  {QStringLiteral("ja"), QStringLiteral("Japonca"), QStringLiteral("ja")},
  {QStringLiteral("zh-CN"), QStringLiteral("Çince (Basitleştirilmiş)"), QStringLiteral("zh-CN")},
  {QStringLiteral("ko"), QStringLiteral("Korece"), QStringLiteral("ko")},
  {QStringLiteral("pt-BR"), QStringLiteral("Portekizce (Brezilya)"), QStringLiteral("pt-BR")},
  {QStringLiteral("pt"), QStringLiteral("Portekizce"), QStringLiteral("pt-PT")},
  {QStringLiteral("nl"), QStringLiteral("Felemenkçe"), QStringLiteral("nl-NL")},
  {QStringLiteral("pl"), QStringLiteral("Lehçe"), QStringLiteral("pl-PL")},
  {QStringLiteral("uk"), QStringLiteral("Ukraynaca"), QStringLiteral("uk-UA")},
  {QStringLiteral("az"), QStringLiteral("Azerice"), QStringLiteral("az")},
  {QStringLiteral("el"), QStringLiteral("Yunanca"), QStringLiteral("el-GR")},
  {QStringLiteral("hi"), QStringLiteral("Hintçe"), QStringLiteral("hi-IN")},
  {QStringLiteral("sv"), QStringLiteral("İsveççe"), QStringLiteral("sv-SE")},
  {QStringLiteral("no"), QStringLiteral("Norveççe"), QStringLiteral("nb-NO")},
  {QStringLiteral("da"), QStringLiteral("Danca"), QStringLiteral("da-DK")},
  {QStringLiteral("fi"), QStringLiteral("Fince"), QStringLiteral("fi-FI")},
  {QStringLiteral("cs"), QStringLiteral("Çekçe"), QStringLiteral("cs-CZ")},
  {QStringLiteral("hu"), QStringLiteral("Macarca"), QStringLiteral("hu-HU")},
  {QStringLiteral("ro"), QStringLiteral("Rumence"), QStringLiteral("ro-RO")},
  {QStringLiteral("id"), QStringLiteral("Endonezce"), QStringLiteral("id-ID")},
  {QStringLiteral("vi"), QStringLiteral("Vietnamca"), QStringLiteral("vi-VN")}
};

static QString getLanguageDisplayName(const QString &code) {
  for (const auto &item : kLanguagesList) {
    if (item.code.compare(code, Qt::CaseInsensitive) == 0) {
      return item.displayName;
    }
  }
  return LanguageDetector::languageDisplayName(code);
}

static QString getSpellCheckCode(const QString &code) {
  for (const auto &item : kLanguagesList) {
    if (item.code.compare(code, Qt::CaseInsensitive) == 0) {
      return item.spellCheckCode;
    }
  }
  return code;
}

class AddLanguageDialog : public QDialog {
 public:
  explicit AddLanguageDialog(const QStringList &excludeCodes, QWidget *parent = nullptr)
      : QDialog(parent) {
    setWindowTitle(QStringLiteral("Dil ekle"));
    setMinimumWidth(380);
    setMinimumHeight(440);
    setStyleSheet(QStringLiteral(
        "QDialog { background: #171e27; color: #e8eef6; }"
        "QLineEdit { min-height: 32px; background: #111820; color: #e6edf5; border: 1px solid #3a4958; border-radius: 7px; padding: 0 10px; }"
        "QLineEdit:focus { border: 2px solid #58a6c7; }"
        "QListWidget { background: #121820; color: #e1e8f0; border: 1px solid #2e3b49; border-radius: 8px; outline: 0; padding: 4px; }"
        "QListWidget::item { min-height: 34px; padding: 4px 8px; border-radius: 5px; }"
        "QListWidget::item:hover { background: #202b36; }"
        "QPushButton { min-height: 30px; border-radius: 7px; padding: 2px 14px; font-weight: 550; font-size: 12px; }"
        "#dlg-cancel-btn { background: #253342; color: #edf5fc; border: 1px solid #3c4f63; }"
        "#dlg-cancel-btn:hover { background: #2f4052; }"
        "#dlg-add-btn { background: #1a73e8; color: #ffffff; border: 0; }"
        "#dlg-add-btn:hover { background: #1b66ca; }"
    ));

    auto *layout = new QVBoxLayout(this);
    layout->setContentsMargins(18, 18, 18, 18);
    layout->setSpacing(12);

    auto *search = new QLineEdit(this);
    search->setPlaceholderText(QStringLiteral("Dillerde ara"));
    search->setClearButtonEnabled(true);
    layout->addWidget(search);

    auto *listWidget = new QListWidget(this);
    layout->addWidget(listWidget, 1);

    for (const auto &item : kLanguagesList) {
      if (excludeCodes.contains(item.code, Qt::CaseInsensitive)) continue;
      auto *listItem = new QListWidgetItem(item.displayName, listWidget);
      listItem->setData(Qt::UserRole, item.code);
      listItem->setFlags(listItem->flags() | Qt::ItemIsUserCheckable);
      listItem->setCheckState(Qt::Unchecked);
    }

    connect(search, &QLineEdit::textChanged, this, [listWidget](const QString &filter) {
      for (int i = 0; i < listWidget->count(); ++i) {
        auto *it = listWidget->item(i);
        const bool match = filter.isEmpty() || it->text().contains(filter, Qt::CaseInsensitive)
                           || it->data(Qt::UserRole).toString().contains(filter, Qt::CaseInsensitive);
        it->setHidden(!match);
      }
    });

    auto *btnRow = new QHBoxLayout();
    btnRow->addStretch();
    auto *cancelBtn = new QPushButton(QStringLiteral("İptal"), this);
    cancelBtn->setObjectName(QStringLiteral("dlg-cancel-btn"));
    connect(cancelBtn, &QPushButton::clicked, this, &QDialog::reject);
    btnRow->addWidget(cancelBtn);

    auto *addBtn = new QPushButton(QStringLiteral("Ekle"), this);
    addBtn->setObjectName(QStringLiteral("dlg-add-btn"));
    connect(addBtn, &QPushButton::clicked, this, [this, listWidget]() {
      for (int i = 0; i < listWidget->count(); ++i) {
        auto *it = listWidget->item(i);
        if (it->checkState() == Qt::Checked) {
          selectedCodes_.append(it->data(Qt::UserRole).toString());
        }
      }
      accept();
    });
    btnRow->addWidget(addBtn);
    layout->addLayout(btnRow);
  }

  QStringList selectedCodes() const { return selectedCodes_; }

 private:
  QStringList selectedCodes_;
};

class CustomizeSpellCheckDialog : public QDialog {
 public:
  explicit CustomizeSpellCheckDialog(QWidget *parent = nullptr) : QDialog(parent) {
    setWindowTitle(QStringLiteral("Yazım denetimini özelleştir"));
    setMinimumWidth(400);
    setMinimumHeight(440);
    setStyleSheet(QStringLiteral(
        "QDialog { background: #171e27; color: #e8eef6; }"
        "QLineEdit { min-height: 32px; background: #111820; color: #e6edf5; border: 1px solid #3a4958; border-radius: 7px; padding: 0 10px; }"
        "QLineEdit:focus { border: 2px solid #58a6c7; }"
        "QListWidget { background: #121820; color: #e1e8f0; border: 1px solid #2e3b49; border-radius: 8px; outline: 0; padding: 4px; }"
        "QListWidget::item { min-height: 34px; padding: 4px 8px; border-radius: 5px; }"
        "QPushButton { min-height: 30px; border-radius: 7px; padding: 2px 14px; font-weight: 550; font-size: 12px; }"
        "#dlg-add-word-btn { background: #1a73e8; color: #ffffff; border: 0; }"
        "#dlg-add-word-btn:hover { background: #1b66ca; }"
        "#dlg-close-btn { background: #253342; color: #edf5fc; border: 1px solid #3c4f63; }"
        "#dlg-close-btn:hover { background: #2f4052; }"
    ));

    auto *layout = new QVBoxLayout(this);
    layout->setContentsMargins(18, 18, 18, 18);
    layout->setSpacing(12);

    auto *desc = new QLabel(QStringLiteral("Özel sözcükler ekleyin. Bu sözcükler web sayfalarında metin yazarken yazım denetiminde yanlış olarak işaretlenmez."), this);
    desc->setWordWrap(true);
    desc->setStyleSheet(QStringLiteral("color: #91a1b2; font-size: 12px;"));
    layout->addWidget(desc);

    auto *inputRow = new QHBoxLayout();
    auto *wordEdit = new QLineEdit(this);
    wordEdit->setPlaceholderText(QStringLiteral("Sözcük ekle"));
    inputRow->addWidget(wordEdit, 1);

    auto *addBtn = new QPushButton(QStringLiteral("Ekle"), this);
    addBtn->setObjectName(QStringLiteral("dlg-add-word-btn"));
    inputRow->addWidget(addBtn);
    layout->addLayout(inputRow);

    auto *listWidget = new QListWidget(this);
    layout->addWidget(listWidget, 1);

    auto *btnRow = new QHBoxLayout();
    btnRow->addStretch();
    auto *closeBtn = new QPushButton(QStringLiteral("Kapat"), this);
    closeBtn->setObjectName(QStringLiteral("dlg-close-btn"));
    connect(closeBtn, &QPushButton::clicked, this, &QDialog::accept);
    btnRow->addWidget(closeBtn);
    layout->addLayout(btnRow);

    QSettings settings;
    auto words = std::make_shared<QStringList>(settings.value(QStringLiteral("spellcheck/customWords")).toStringList());

    const auto refreshList = [listWidget, words]() {
      listWidget->clear();
      for (const QString &w : *words) {
        auto *item = new QListWidgetItem(listWidget);
        auto *wgt = new QWidget();
        auto *h = new QHBoxLayout(wgt);
        h->setContentsMargins(8, 2, 8, 2);
        auto *lbl = new QLabel(w, wgt);
        lbl->setStyleSheet(QStringLiteral("color: #e8eef6; font-size: 13px;"));
        h->addWidget(lbl, 1);
        auto *delBtn = new QPushButton(QStringLiteral("✕"), wgt);
        delBtn->setObjectName(QStringLiteral("settings-icon-del-btn"));
        delBtn->setToolTip(QStringLiteral("Kaldır"));
        QObject::connect(delBtn, &QPushButton::clicked, [w, words, listWidget]() {
          words->removeAll(w);
          QSettings s;
          s.setValue(QStringLiteral("spellcheck/customWords"), *words);
          for (int i = 0; i < listWidget->count(); ++i) {
            if (listWidget->item(i)->data(Qt::UserRole).toString() == w) {
              delete listWidget->takeItem(i);
              break;
            }
          }
        });
        h->addWidget(delBtn);
        item->setData(Qt::UserRole, w);
        item->setSizeHint(wgt->sizeHint());
        listWidget->setItemWidget(item, wgt);
      }
    };

    refreshList();

    connect(addBtn, &QPushButton::clicked, this, [wordEdit, words, refreshList]() {
      const QString txt = wordEdit->text().trimmed();
      if (!txt.isEmpty() && !words->contains(txt)) {
        words->append(txt);
        QSettings s;
        s.setValue(QStringLiteral("spellcheck/customWords"), *words);
        wordEdit->clear();
        refreshList();
      }
    });
    connect(wordEdit, &QLineEdit::returnPressed, addBtn, &QPushButton::click);
  }
};
}  // namespace

QWidget *SettingsPage::createLanguagesSection() {
  Section section = makeSection(I18n::text(QStringLiteral("settings.language.header"), QStringLiteral("Diller")),
                                I18n::text(QStringLiteral("settings.language.subtitle"), QStringLiteral("Tercih edilen web sitesi dilleri, yazım denetimi ve sayfa çevirisi yapılandırması.")));

  QSettings settings;
  auto preferredLangs = std::make_shared<QStringList>(settings.value(QStringLiteral("language/preferredLanguages")).toStringList());
  if (preferredLangs->isEmpty()) {
    *preferredLangs = {QStringLiteral("tr"), QStringLiteral("en-US"), QStringLiteral("en")};
  }

  auto *translateSvc = profileService_ ? profileService_->translateService() : nullptr;

  auto syncAcceptLanguage = [this](const QStringList &langs) {
    QStringList parts;
    double q = 1.0;
    for (int i = 0; i < langs.size(); ++i) {
      if (i == 0) {
        parts.append(langs[i]);
      } else {
        parts.append(QStringLiteral("%1;q=%2").arg(langs[i], QString::number(q, 'f', 1)));
      }
      q = std::max(0.1, q - 0.1);
    }
    if (profileService_ && profileService_->profile()) {
      profileService_->profile()->setHttpAcceptLanguage(parts.join(QStringLiteral(",")));
    }
  };

  syncAcceptLanguage(*preferredLangs);

  // =========================================================================
  // 1. TERCİH EDİLEN DİLLER
  // =========================================================================
  auto *prefHeading = new QLabel(QStringLiteral("Tercih edilen diller"), section.page);
  prefHeading->setStyleSheet(QStringLiteral("font-size: 15px; font-weight: 650; color: #f2f6fb; margin-top: 10px; margin-bottom: 6px;"));
  section.layout->addWidget(prefHeading);

  auto *prefCard = makeCard(section.page);

  // --- Uygulama Arayüz Dili Satırı ---
  auto *uiLangCombo = new QComboBox(prefCard);
  uiLangCombo_ = uiLangCombo;
  uiLangCombo->setObjectName(QStringLiteral("settings-ui-language-combo"));
  uiLangCombo->addItem(dalinira::i18n::LanguageManager::instance().formatSystemLanguageLabel(), QStringLiteral("system"));
  for (const auto &info : dalinira::i18n::LanguageManager::instance().supportedLanguages()) {
    uiLangCombo->addItem(info.nativeName, info.code);
  }
  const QString currentPref = dalinira::i18n::LanguageManager::instance().languagePreference();
  int prefIdx = uiLangCombo->findData(currentPref);
  if (prefIdx >= 0) uiLangCombo->setCurrentIndex(prefIdx);
  else uiLangCombo->setCurrentIndex(0);

  connect(uiLangCombo, QOverload<int>::of(&QComboBox::currentIndexChanged), this, [uiLangCombo](int idx) {
    if (idx >= 0) {
      const QString chosen = uiLangCombo->itemData(idx).toString();
      dalinira::i18n::LanguageManager::instance().setLanguagePreference(chosen);
    }
  });

  auto *uiLangRow = settingRow(prefCard,
                               QStringLiteral("Uygulama Dili"),
                               QStringLiteral("Menüler, ayarlar ve tarayıcı arayüzü için kullanılacak dili belirler."),
                               uiLangCombo, BrowserIcon::Language, true);
  addRow(prefCard, uiLangRow);

  auto *addLangBtn = new QPushButton(QStringLiteral("Dil ekle"), prefCard);
  addLangBtn->setObjectName(QStringLiteral("settings-pill-btn"));

  auto *topRow = settingRow(prefCard,
                            QStringLiteral("Konuştuğunuz dillerdeki web siteleri"),
                            QStringLiteral("Konuştuğunuz dilleri web sitelerine bildirin. Mümkün olduğunda bu dillerde içerik gösterirler."),
                            addLangBtn);
  addRow(prefCard, topRow);

  auto *langsContainer = new QWidget(prefCard);
  auto *langsLayout = new QVBoxLayout(langsContainer);
  langsLayout->setContentsMargins(0, 0, 0, 0);
  langsLayout->setSpacing(0);
  addRow(prefCard, langsContainer);

  section.layout->addWidget(prefCard);

  // =========================================================================
  // 2. YAZIM DENETİMİ
  // =========================================================================
  auto *spellHeading = new QLabel(QStringLiteral("Yazım denetimi"), section.page);
  spellHeading->setStyleSheet(QStringLiteral("font-size: 15px; font-weight: 650; color: #f2f6fb; margin-top: 24px; margin-bottom: 6px;"));
  section.layout->addWidget(spellHeading);

  auto *spellCard = makeCard(section.page);

  auto *spellMasterSwitch = new GlowToggleSwitch(spellCard);
  const bool initialSpellEnabled = profileService_ && profileService_->profile() ? profileService_->profile()->isSpellCheckEnabled() : true;
  spellMasterSwitch->setChecked(initialSpellEnabled);
  addRow(spellCard, settingRow(spellCard,
                               QStringLiteral("Web sayfalarında metin yazarken yazım hatalarını kontrol et"),
                               QString{},
                               spellMasterSwitch));

  auto *spellSubhead = new QLabel(QStringLiteral("Şu diller için yazım denetimi kullan:"), spellCard);
  spellSubhead->setStyleSheet(QStringLiteral("color: #91a1b2; font-size: 13px; font-weight: 550; padding: 12px 18px 4px;"));
  cardLayout(spellCard)->addWidget(spellSubhead);

  auto *spellLangsContainer = new QWidget(spellCard);
  auto *spellLangsLayout = new QVBoxLayout(spellLangsContainer);
  spellLangsLayout->setContentsMargins(0, 0, 0, 0);
  spellLangsLayout->setSpacing(0);
  addRow(spellCard, spellLangsContainer);

  auto *customDictBtn = new QPushButton(QStringLiteral("›"), spellCard);
  customDictBtn->setObjectName(QStringLiteral("settings-chevron-btn"));
  auto *customDictRow = settingRow(spellCard, QStringLiteral("Yazım denetimini özelleştir"), QString{}, customDictBtn);
  addRow(spellCard, customDictRow);

  connect(customDictBtn, &QPushButton::clicked, this, [this]() {
    CustomizeSpellCheckDialog dlg(this);
    dlg.exec();
  });

  section.layout->addWidget(spellCard);

  // =========================================================================
  // 3. DALINIRA ÇEVİRİ
  // =========================================================================
  auto *translateHeading = new QLabel(QStringLiteral("DaliNira Çeviri"), section.page);
  translateHeading->setStyleSheet(QStringLiteral("font-size: 15px; font-weight: 650; color: #f2f6fb; margin-top: 24px; margin-bottom: 6px;"));
  section.layout->addWidget(translateHeading);

  auto *transCard = makeCard(section.page);

  auto *transMasterSwitch = new GlowToggleSwitch(transCard);
  transMasterSwitch->setChecked(translateSvc ? translateSvc->isEnabled() : true);
  addRow(transCard, settingRow(transCard,
                               QStringLiteral("DaliNira Çeviri'yi kullan"),
                               QStringLiteral("Bu ayar açıkken DaliNira Çeviri, siteleri tercih ettiğiniz dile çevirmeyi önerir. Ayrıca, siteleri otomatik olarak da çevirebilir."),
                               transMasterSwitch));

  auto *targetCombo = new QComboBox(transCard);
  for (const auto &item : kLanguagesList) {
    targetCombo->addItem(item.displayName, item.code);
  }
  const QString curTarget = translateSvc ? translateSvc->defaultTargetLanguage() : QStringLiteral("tr");
  int targetIdx = targetCombo->findData(curTarget);
  if (targetIdx < 0) {
    for (int i = 0; i < targetCombo->count(); ++i) {
      if (targetCombo->itemData(i).toString().startsWith(curTarget, Qt::CaseInsensitive)) {
        targetIdx = i;
        break;
      }
    }
  }
  if (targetIdx >= 0) targetCombo->setCurrentIndex(targetIdx);

  connect(targetCombo, QOverload<int>::of(&QComboBox::currentIndexChanged), this, [translateSvc, targetCombo](int idx) {
    if (translateSvc && idx >= 0) {
      translateSvc->setDefaultTargetLanguage(targetCombo->itemData(idx).toString());
      QSettings s;
      translateSvc->savePreferences(s);
    }
  });
  addRow(transCard, settingRow(transCard, QStringLiteral("Şu dile çevir"), QString{}, targetCombo));

  auto *addAutoBtn = new QPushButton(QStringLiteral("Dil ekle"), transCard);
  addAutoBtn->setObjectName(QStringLiteral("settings-pill-btn"));
  addRow(transCard, settingRow(transCard, QStringLiteral("Şu dilleri otomatik olarak çevir"), QString{}, addAutoBtn));

  auto *autoLangsContainer = new QWidget(transCard);
  auto *autoLangsLayout = new QVBoxLayout(autoLangsContainer);
  autoLangsLayout->setContentsMargins(0, 0, 0, 6);
  autoLangsLayout->setSpacing(0);
  addRow(transCard, autoLangsContainer);

  auto *addNeverBtn = new QPushButton(QStringLiteral("Dil ekle"), transCard);
  addNeverBtn->setObjectName(QStringLiteral("settings-pill-btn"));
  addRow(transCard, settingRow(transCard, QStringLiteral("Şu dilleri çevirmeyi hiçbir zaman önerme"), QString{}, addNeverBtn));

  auto *neverLangsContainer = new QWidget(transCard);
  auto *neverLangsLayout = new QVBoxLayout(neverLangsContainer);
  neverLangsLayout->setContentsMargins(0, 0, 0, 6);
  neverLangsLayout->setSpacing(0);
  addRow(transCard, neverLangsContainer);

  section.layout->addWidget(transCard);

  // Dynamic Refreshers
  auto refreshSpellLangs = std::make_shared<std::function<void()>>();
  auto refreshPreferredLangs = std::make_shared<std::function<void()>>();

  *refreshSpellLangs = [this, spellLangsContainer, spellLangsLayout, preferredLangs]() {
    while (QLayoutItem *item = spellLangsLayout->takeAt(0)) {
      delete item->widget();
      delete item;
    }
    QStringList activeSpellLangs;
    if (profileService_ && profileService_->profile()) {
      activeSpellLangs = profileService_->profile()->spellCheckLanguages();
    }
    for (const QString &code : *preferredLangs) {
      const QString disp = getLanguageDisplayName(code);
      const QString spellCode = getSpellCheckCode(code);
      auto *row = new QWidget(spellLangsContainer);
      row->setObjectName(QStringLiteral("settings-row"));
      auto *h = new QHBoxLayout(row);
      h->setContentsMargins(18, 10, 18, 10);
      auto *lbl = new QLabel(disp, row);
      lbl->setObjectName(QStringLiteral("settings-row-title"));
      h->addWidget(lbl, 1);

      auto *toggle = new GlowToggleSwitch(row);
      toggle->setChecked(activeSpellLangs.contains(spellCode, Qt::CaseInsensitive) || activeSpellLangs.contains(code, Qt::CaseInsensitive));
      QObject::connect(toggle, &QCheckBox::toggled, [this, spellCode](bool checked) {
        if (!profileService_ || !profileService_->profile()) return;
        QStringList cur = profileService_->profile()->spellCheckLanguages();
        if (checked) {
          if (!cur.contains(spellCode, Qt::CaseInsensitive)) cur.append(spellCode);
        } else {
          cur.removeAll(spellCode);
        }
        profileService_->profile()->setSpellCheckLanguages(cur);
        QSettings s;
        s.setValue(QStringLiteral("spellcheck/languages"), cur);
      });
      h->addWidget(toggle, 0, Qt::AlignVCenter);
      spellLangsLayout->addWidget(row);
    }
  };

  *refreshPreferredLangs = [langsContainer, langsLayout, preferredLangs, syncAcceptLanguage, refreshSpellLangs, refreshPreferredLangs, translateSvc, targetCombo]() {
    while (QLayoutItem *item = langsLayout->takeAt(0)) {
      delete item->widget();
      delete item;
    }
    for (int i = 0; i < preferredLangs->size(); ++i) {
      const QString code = (*preferredLangs)[i];
      const QString disp = getLanguageDisplayName(code);
      auto *row = new QWidget(langsContainer);
      row->setObjectName(QStringLiteral("settings-row"));
      auto *h = new QHBoxLayout(row);
      h->setContentsMargins(18, 10, 18, 10);
      h->setSpacing(12);

      auto *textWgt = new QWidget(row);
      auto *v = new QVBoxLayout(textWgt);
      v->setContentsMargins(0, 0, 0, 0);
      v->setSpacing(2);

      auto *titleLbl = new QLabel(QStringLiteral("%1. %2").arg(i + 1).arg(disp), textWgt);
      titleLbl->setObjectName(QStringLiteral("settings-row-title"));
      v->addWidget(titleLbl);

      if (i == 0) {
        auto *subLbl = new QLabel(QStringLiteral("Bu dil, sayfalar çevrilirken kullanılır"), textWgt);
        subLbl->setObjectName(QStringLiteral("settings-row-description"));
        v->addWidget(subLbl);
      }
      h->addWidget(textWgt, 1);

      auto *moreBtn = new QPushButton(QStringLiteral("⋮"), row);
      moreBtn->setObjectName(QStringLiteral("settings-more-btn"));
      moreBtn->setToolTip(QStringLiteral("Daha fazla işlem"));

      QObject::connect(moreBtn, &QPushButton::clicked, [moreBtn, i, code, preferredLangs, syncAcceptLanguage, refreshPreferredLangs, translateSvc, targetCombo]() {
        auto *menu = new QMenu(moreBtn);
        menu->setStyleSheet(QStringLiteral(
            "QMenu { background: #202a36; color: #e8eef6; border: 1px solid #3a4958; border-radius: 8px; padding: 4px; }"
            "QMenu::item { padding: 6px 20px; border-radius: 5px; font-size: 13px; }"
            "QMenu::item:selected { background: #2f4052; color: #ffffff; }"
            "QMenu::item:disabled { color: #6b7a8a; }"
            "QMenu::separator { height: 1px; background: #2e3b49; margin: 4px 6px; }"
        ));

        // 1. DaliNira Browser'ı bu dilde görüntüle
        const QString currentPref = dalinira::i18n::LanguageManager::instance().languagePreference();
        QString targetUiCode = code.toLower();
        if (targetUiCode.startsWith(QLatin1String("tr"))) targetUiCode = QStringLiteral("tr");
        else if (targetUiCode.startsWith(QLatin1String("en"))) targetUiCode = QStringLiteral("en");
        else if (targetUiCode.startsWith(QLatin1String("ar"))) targetUiCode = QStringLiteral("ar");

        auto *uiAct = menu->addAction(QStringLiteral("DaliNira Browser'ı bu dilde görüntüle"));
        uiAct->setCheckable(true);
        const bool isCurrentUi = (currentPref == targetUiCode || (currentPref == QLatin1String("system") && targetUiCode == dalinira::i18n::LanguageManager::instance().activeLanguage().code));
        uiAct->setChecked(isCurrentUi);
        if (isCurrentUi) {
          uiAct->setEnabled(false);
        } else {
          QObject::connect(uiAct, &QAction::triggered, [targetUiCode]() {
            dalinira::i18n::LanguageManager::instance().setLanguagePreference(targetUiCode);
          });
        }

        menu->addSeparator();

        // 2. En üste taşı
        auto *topAct = menu->addAction(QStringLiteral("En üste taşı"));
        topAct->setEnabled(i > 0);
        QObject::connect(topAct, &QAction::triggered, [preferredLangs, i, syncAcceptLanguage, refreshPreferredLangs, translateSvc, targetCombo]() {
          preferredLangs->move(i, 0);
          QSettings s;
          s.setValue(QStringLiteral("language/preferredLanguages"), *preferredLangs);
          syncAcceptLanguage(*preferredLangs);
          if (translateSvc) {
            translateSvc->setDefaultTargetLanguage(preferredLangs->first());
            translateSvc->savePreferences(s);
            int idx = targetCombo->findData(preferredLangs->first());
            if (idx >= 0) targetCombo->setCurrentIndex(idx);
          }
          (*refreshPreferredLangs)();
        });

        // 3. Yukarı taşı
        auto *upAct = menu->addAction(QStringLiteral("Yukarı taşı"));
        upAct->setEnabled(i > 0);
        QObject::connect(upAct, &QAction::triggered, [preferredLangs, i, syncAcceptLanguage, refreshPreferredLangs]() {
          preferredLangs->swapItemsAt(i, i - 1);
          QSettings s;
          s.setValue(QStringLiteral("language/preferredLanguages"), *preferredLangs);
          syncAcceptLanguage(*preferredLangs);
          (*refreshPreferredLangs)();
        });

        // 4. Aşağı taşı
        auto *downAct = menu->addAction(QStringLiteral("Aşağı taşı"));
        downAct->setEnabled(i < preferredLangs->size() - 1);
        QObject::connect(downAct, &QAction::triggered, [preferredLangs, i, syncAcceptLanguage, refreshPreferredLangs]() {
          preferredLangs->swapItemsAt(i, i + 1);
          QSettings s;
          s.setValue(QStringLiteral("language/preferredLanguages"), *preferredLangs);
          syncAcceptLanguage(*preferredLangs);
          (*refreshPreferredLangs)();
        });

        // 5. Kaldır
        auto *removeAct = menu->addAction(QStringLiteral("Kaldır"));
        removeAct->setEnabled(preferredLangs->size() > 1);
        QObject::connect(removeAct, &QAction::triggered, [preferredLangs, i, syncAcceptLanguage, refreshPreferredLangs]() {
          preferredLangs->removeAt(i);
          QSettings s;
          s.setValue(QStringLiteral("language/preferredLanguages"), *preferredLangs);
          syncAcceptLanguage(*preferredLangs);
          (*refreshPreferredLangs)();
        });

        menu->addSeparator();

        // 6. Bu dildeki sayfaları çevirmeyi öner
        auto *offerAct = menu->addAction(QStringLiteral("Bu dildeki sayfaları çevirmeyi öner"));
        offerAct->setCheckable(true);
        const bool never = translateSvc && translateSvc->neverTranslateLanguages().contains(code);
        offerAct->setChecked(!never);
        QObject::connect(offerAct, &QAction::triggered, [translateSvc, code](bool checked) {
          if (translateSvc) {
            if (checked) {
              translateSvc->removeNeverTranslateLanguage(code);
            } else {
              translateSvc->addNeverTranslateLanguage(code);
            }
            QSettings s;
            translateSvc->savePreferences(s);
          }
        });

        menu->exec(moreBtn->mapToGlobal(QPoint(0, moreBtn->height())));
        menu->deleteLater();
      });

      h->addWidget(moreBtn, 0, Qt::AlignVCenter);
      langsLayout->addWidget(row);
    }
    (*refreshSpellLangs)();
  };

  // Auto-translate list refresher
  auto refreshAutoTranslateList = [autoLangsContainer, autoLangsLayout, translateSvc]() {
    while (QLayoutItem *item = autoLangsLayout->takeAt(0)) {
      delete item->widget();
      delete item;
    }
    const QStringList autoLangs = translateSvc ? translateSvc->autoTranslateLanguages() : QStringList{};
    if (autoLangs.isEmpty()) {
      auto *emptyLbl = new QLabel(QStringLiteral("Dil eklenmedi"), autoLangsContainer);
      emptyLbl->setStyleSheet(QStringLiteral("color: #7b8c9d; font-size: 13px; padding-left: 18px; padding-top: 4px; padding-bottom: 8px;"));
      autoLangsLayout->addWidget(emptyLbl);
    } else {
      for (const QString &code : autoLangs) {
        auto *row = new QWidget(autoLangsContainer);
        row->setObjectName(QStringLiteral("settings-row"));
        auto *h = new QHBoxLayout(row);
        h->setContentsMargins(18, 6, 18, 6);
        auto *lbl = new QLabel(getLanguageDisplayName(code), row);
        lbl->setObjectName(QStringLiteral("settings-row-title"));
        h->addWidget(lbl, 1);

        auto *delBtn = new QPushButton(QStringLiteral("🗑"), row);
        delBtn->setObjectName(QStringLiteral("settings-icon-del-btn"));
        delBtn->setToolTip(QStringLiteral("Kaldır"));
        QObject::connect(delBtn, &QPushButton::clicked, [translateSvc, code, autoLangsContainer, autoLangsLayout]() {
          if (translateSvc) {
            translateSvc->removeAutoTranslateLanguage(code);
            QSettings s;
            translateSvc->savePreferences(s);
            for (int i = 0; i < autoLangsLayout->count(); ++i) {
              auto *w = autoLangsLayout->itemAt(i)->widget();
              if (w) {
                auto *l = w->findChild<QLabel *>();
                if (l && l->text() == getLanguageDisplayName(code)) {
                  delete autoLangsLayout->takeAt(i)->widget();
                  break;
                }
              }
            }
            if (translateSvc->autoTranslateLanguages().isEmpty()) {
              auto *emptyLbl = new QLabel(QStringLiteral("Dil eklenmedi"), autoLangsContainer);
              emptyLbl->setStyleSheet(QStringLiteral("color: #7b8c9d; font-size: 13px; padding-left: 18px; padding-top: 4px; padding-bottom: 8px;"));
              autoLangsLayout->addWidget(emptyLbl);
            }
          }
        });
        h->addWidget(delBtn, 0, Qt::AlignVCenter);
        autoLangsLayout->addWidget(row);
      }
    }
  };

  // Never-translate list refresher
  auto refreshNeverTranslateList = [neverLangsContainer, neverLangsLayout, translateSvc]() {
    while (QLayoutItem *item = neverLangsLayout->takeAt(0)) {
      delete item->widget();
      delete item;
    }
    const QStringList neverLangs = translateSvc ? translateSvc->neverTranslateLanguages() : QStringList{QStringLiteral("tr")};
    if (neverLangs.isEmpty()) {
      auto *emptyLbl = new QLabel(QStringLiteral("Dil eklenmedi"), neverLangsContainer);
      emptyLbl->setStyleSheet(QStringLiteral("color: #7b8c9d; font-size: 13px; padding-left: 18px; padding-top: 4px; padding-bottom: 8px;"));
      neverLangsLayout->addWidget(emptyLbl);
    } else {
      for (const QString &code : neverLangs) {
        auto *row = new QWidget(neverLangsContainer);
        row->setObjectName(QStringLiteral("settings-row"));
        auto *h = new QHBoxLayout(row);
        h->setContentsMargins(18, 6, 18, 6);
        auto *lbl = new QLabel(getLanguageDisplayName(code), row);
        lbl->setObjectName(QStringLiteral("settings-row-title"));
        h->addWidget(lbl, 1);

        auto *delBtn = new QPushButton(QStringLiteral("🗑"), row);
        delBtn->setObjectName(QStringLiteral("settings-icon-del-btn"));
        delBtn->setToolTip(QStringLiteral("Kaldır"));
        QObject::connect(delBtn, &QPushButton::clicked, [translateSvc, code, neverLangsContainer, neverLangsLayout]() {
          if (translateSvc) {
            translateSvc->removeNeverTranslateLanguage(code);
            QSettings s;
            translateSvc->savePreferences(s);
            for (int i = 0; i < neverLangsLayout->count(); ++i) {
              auto *w = neverLangsLayout->itemAt(i)->widget();
              if (w) {
                auto *l = w->findChild<QLabel *>();
                if (l && l->text() == getLanguageDisplayName(code)) {
                  delete neverLangsLayout->takeAt(i)->widget();
                  break;
                }
              }
            }
            if (translateSvc->neverTranslateLanguages().isEmpty()) {
              auto *emptyLbl = new QLabel(QStringLiteral("Dil eklenmedi"), neverLangsContainer);
              emptyLbl->setStyleSheet(QStringLiteral("color: #7b8c9d; font-size: 13px; padding-left: 18px; padding-top: 4px; padding-bottom: 8px;"));
              neverLangsLayout->addWidget(emptyLbl);
            }
          }
        });
        h->addWidget(delBtn, 0, Qt::AlignVCenter);
        neverLangsLayout->addWidget(row);
      }
    }
  };

  (*refreshPreferredLangs)();
  refreshAutoTranslateList();
  refreshNeverTranslateList();

  // Connections for Add Language buttons
  connect(addLangBtn, &QPushButton::clicked, this, [this, preferredLangs, syncAcceptLanguage, refreshPreferredLangs]() {
    AddLanguageDialog dlg(*preferredLangs, this);
    if (dlg.exec() == QDialog::Accepted) {
      for (const QString &c : dlg.selectedCodes()) {
        if (!preferredLangs->contains(c)) preferredLangs->append(c);
      }
      QSettings s;
      s.setValue(QStringLiteral("language/preferredLanguages"), *preferredLangs);
      syncAcceptLanguage(*preferredLangs);
      (*refreshPreferredLangs)();
    }
  });

  connect(addAutoBtn, &QPushButton::clicked, this, [this, translateSvc, refreshAutoTranslateList]() {
    const QStringList existing = translateSvc ? translateSvc->autoTranslateLanguages() : QStringList{};
    AddLanguageDialog dlg(existing, this);
    if (dlg.exec() == QDialog::Accepted) {
      if (translateSvc) {
        for (const QString &c : dlg.selectedCodes()) translateSvc->addAutoTranslateLanguage(c);
        QSettings s;
        translateSvc->savePreferences(s);
        refreshAutoTranslateList();
      }
    }
  });

  connect(addNeverBtn, &QPushButton::clicked, this, [this, translateSvc, refreshNeverTranslateList]() {
    const QStringList existing = translateSvc ? translateSvc->neverTranslateLanguages() : QStringList{};
    AddLanguageDialog dlg(existing, this);
    if (dlg.exec() == QDialog::Accepted) {
      if (translateSvc) {
        for (const QString &c : dlg.selectedCodes()) translateSvc->addNeverTranslateLanguage(c);
        QSettings s;
        translateSvc->savePreferences(s);
        refreshNeverTranslateList();
      }
    }
  });

  connect(spellMasterSwitch, &QCheckBox::toggled, this, [this, spellLangsContainer, customDictRow](bool checked) {
    if (profileService_ && profileService_->profile()) {
      profileService_->profile()->setSpellCheckEnabled(checked);
    }
    QSettings s;
    s.setValue(QStringLiteral("spellcheck/enabled"), checked);
    spellLangsContainer->setEnabled(checked);
    customDictRow->setEnabled(checked);
  });

  connect(transMasterSwitch, &QCheckBox::toggled, this, [translateSvc, targetCombo, addAutoBtn, autoLangsContainer, addNeverBtn, neverLangsContainer](bool checked) {
    if (translateSvc) {
      translateSvc->setEnabled(checked);
      QSettings s;
      translateSvc->savePreferences(s);
    }
    targetCombo->setEnabled(checked);
    addAutoBtn->setEnabled(checked);
    autoLangsContainer->setEnabled(checked);
    addNeverBtn->setEnabled(checked);
    neverLangsContainer->setEnabled(checked);
  });

  // =========================================================================
  // 4. ÇEVİRİ SAĞLAYICISI VE API YAPILANDIRMASI
  // =========================================================================
  auto *configCard = makeCard(section.page, QStringLiteral("ÇEVİRİ SAĞLAYICISI VE API YAPILANDIRMASI"));

  auto *providerCombo = new QComboBox(configCard);
  providerCombo->setObjectName(QStringLiteral("settings-translation-provider"));
  providerCombo->addItem(QStringLiteral("Yapılandırılmamış"), QStringLiteral("none"));
  providerCombo->addItem(QStringLiteral("LibreTranslate"), QStringLiteral("libretranslate"));
  providerCombo->addItem(QStringLiteral("DeepL"), QStringLiteral("deepl"));
  providerCombo->addItem(QStringLiteral("Google Cloud Translation"), QStringLiteral("google_cloud"));
  providerCombo->addItem(QStringLiteral("Google Translate (Experimental / Unofficial)"), QStringLiteral("google_gtx"));

  QString currentProviderId = translateSvc ? translateSvc->providerId() : QStringLiteral("google_gtx");
  if (currentProviderId == QLatin1String("none")) {
    currentProviderId = QStringLiteral("google_gtx");
    if (translateSvc) {
      translateSvc->setProvider(currentProviderId);
      QSettings prefs;
      translateSvc->savePreferences(prefs);
    }
  }
  int pIdx = providerCombo->findData(currentProviderId);
  if (pIdx >= 0) providerCombo->setCurrentIndex(pIdx);

  addRow(configCard, settingRow(configCard, QStringLiteral("Çeviri sağlayıcısı"),
                                QStringLiteral("Sayfaların metinlerini çevirecek backend servisi."),
                                providerCombo));

  auto *stacked = new QStackedWidget(configCard);
  stacked->setObjectName(QStringLiteral("settings-translation-config-stack"));

  // Page 0: None / Unconfigured
  auto *nonePage = new QWidget(stacked);
  auto *noneLayout = new QVBoxLayout(nonePage);
  noneLayout->setContentsMargins(18, 14, 18, 14);
  auto *noneLabel = new QLabel(QStringLiteral("Sayfa çevirisi için bir sağlayıcı seçilmedi. Çeviriyi kullanmak için yukarıdaki listeden LibreTranslate, DeepL veya Google Cloud seçin."), nonePage);
  noneLabel->setObjectName(QStringLiteral("settings-row-description"));
  noneLabel->setWordWrap(true);
  noneLayout->addWidget(noneLabel);
  stacked->addWidget(nonePage);

  // Page 1: LibreTranslate
  auto *ltPage = new QWidget(stacked);
  auto *ltLayout = new QVBoxLayout(ltPage);
  ltLayout->setContentsMargins(0, 0, 0, 0);
  ltLayout->setSpacing(0);

  auto *ltUrlEdit = new QLineEdit(ltPage);
  ltUrlEdit->setObjectName(QStringLiteral("settings-lt-endpoint"));
  ltUrlEdit->setPlaceholderText(QStringLiteral("https://translate.example.com/translate"));
  if (translateSvc && translateSvc->libreTranslateEndpoint().isValid()) {
    ltUrlEdit->setText(translateSvc->libreTranslateEndpoint().toString());
  }
  ltLayout->addWidget(settingRow(ltPage, QStringLiteral("Sunucu adresi"), QStringLiteral("Self-hosted veya özel LibreTranslate REST uç noktası."), ltUrlEdit));

  auto *ltKeyEdit = new QLineEdit(ltPage);
  ltKeyEdit->setObjectName(QStringLiteral("settings-lt-key"));
  ltKeyEdit->setEchoMode(QLineEdit::Password);
  ltKeyEdit->setPlaceholderText(QStringLiteral("Opsiyonel API Anahtarı"));
  if (translateSvc) {
    ltKeyEdit->setText(translateSvc->loadApiKey(QStringLiteral("libretranslate")));
  }
  ltLayout->addWidget(settingRow(ltPage, QStringLiteral("API anahtarı (Opsiyonel)"), QStringLiteral("Sunucunuz kimlik doğrulama gerektiriyorsa girin."), ltKeyEdit));

  auto *ltTestBtn = new QPushButton(QStringLiteral("Bağlantıyı Test Et"), ltPage);
  auto *ltStatusLabel = new QLabel(ltPage);
  ltStatusLabel->setObjectName(QStringLiteral("settings-row-description"));
  ltLayout->addWidget(settingRow(ltPage, QStringLiteral("Bağlantı testi"), QStringLiteral("LibreTranslate sunucusuna test isteği göndererek doğrular."), ltTestBtn));
  ltLayout->addWidget(ltStatusLabel);
  stacked->addWidget(ltPage);

  // Page 2: DeepL
  auto *deeplPage = new QWidget(stacked);
  auto *deeplLayout = new QVBoxLayout(deeplPage);
  deeplLayout->setContentsMargins(0, 0, 0, 0);

  auto *deeplKeyEdit = new QLineEdit(deeplPage);
  deeplKeyEdit->setObjectName(QStringLiteral("settings-deepl-key"));
  deeplKeyEdit->setEchoMode(QLineEdit::Password);
  deeplKeyEdit->setPlaceholderText(QStringLiteral("DeepL API Anahtarı (örn: ...:fx)"));
  if (translateSvc) {
    deeplKeyEdit->setText(translateSvc->loadApiKey(QStringLiteral("deepl")));
  }
  deeplLayout->addWidget(settingRow(deeplPage, QStringLiteral("API anahtarı"), QStringLiteral("DeepL Free veya Pro abonelik anahtarınız."), deeplKeyEdit));

  auto *deeplPlanCombo = new QComboBox(deeplPage);
  deeplPlanCombo->addItem(QStringLiteral("DeepL API Free"), QStringLiteral("free"));
  deeplPlanCombo->addItem(QStringLiteral("DeepL API Pro"), QStringLiteral("pro"));
  if (translateSvc && translateSvc->deepLIsPro()) deeplPlanCombo->setCurrentIndex(1);
  deeplLayout->addWidget(settingRow(deeplPage, QStringLiteral("Plan türü"), QStringLiteral("Ücretsiz planlar için api-free.deepl.com, ücretli planlar için api.deepl.com kullanılır."), deeplPlanCombo));

  auto *deeplTestBtn = new QPushButton(QStringLiteral("Bağlantıyı Test Et"), deeplPage);
  auto *deeplStatusLabel = new QLabel(deeplPage);
  deeplStatusLabel->setObjectName(QStringLiteral("settings-row-description"));
  deeplLayout->addWidget(settingRow(deeplPage, QStringLiteral("Bağlantı testi"), QStringLiteral("DeepL API anahtarınızı test metniyle doğrular."), deeplTestBtn));
  deeplLayout->addWidget(deeplStatusLabel);
  stacked->addWidget(deeplPage);

  // Page 3: Google Cloud
  auto *gcpPage = new QWidget(stacked);
  auto *gcpLayout = new QVBoxLayout(gcpPage);
  gcpLayout->setContentsMargins(0, 0, 0, 0);

  auto *gcpKeyEdit = new QLineEdit(gcpPage);
  gcpKeyEdit->setObjectName(QStringLiteral("settings-gcp-key"));
  gcpKeyEdit->setEchoMode(QLineEdit::Password);
  gcpKeyEdit->setPlaceholderText(QStringLiteral("Google Cloud API Anahtarı"));
  if (translateSvc) {
    gcpKeyEdit->setText(translateSvc->loadApiKey(QStringLiteral("google_cloud")));
  }
  gcpLayout->addWidget(settingRow(gcpPage, QStringLiteral("API anahtarı"), QStringLiteral("Google Cloud Console üzerinden alınan Translation API anahtarı."), gcpKeyEdit));

  auto *gcpTestBtn = new QPushButton(QStringLiteral("Bağlantıyı Test Et"), gcpPage);
  auto *gcpStatusLabel = new QLabel(gcpPage);
  gcpStatusLabel->setObjectName(QStringLiteral("settings-row-description"));
  gcpLayout->addWidget(settingRow(gcpPage, QStringLiteral("Bağlantı testi"), QStringLiteral("Google Cloud API anahtarını doğrular."), gcpTestBtn));
  gcpLayout->addWidget(gcpStatusLabel);
  stacked->addWidget(gcpPage);

  // Page 4: Google GTX
  auto *gtxPage = new QWidget(stacked);
  auto *gtxLayout = new QVBoxLayout(gtxPage);
  gtxLayout->setContentsMargins(18, 14, 18, 14);
  auto *gtxNotice = new QLabel(QStringLiteral("<b>Deneysel / Resmi Olmayan Sağlayıcı</b><br>Bu sağlayıcı Google'ın resmi Cloud Translation API'si değildir. Dokümante edilmemiş bir web endpoint'i kullanır ve gelecekte Google tarafından haber verilmeden çalışmayı durdurabilir veya sınırlandırılabilir."), gtxPage);
  gtxNotice->setObjectName(QStringLiteral("settings-row-description"));
  gtxNotice->setWordWrap(true);
  gtxLayout->addWidget(gtxNotice);
  stacked->addWidget(gtxPage);

  const auto updateStack = [stacked, providerCombo]() {
    const QString p = providerCombo->currentData().toString();
    if (p == QLatin1String("libretranslate")) stacked->setCurrentIndex(1);
    else if (p == QLatin1String("deepl")) stacked->setCurrentIndex(2);
    else if (p == QLatin1String("google_cloud")) stacked->setCurrentIndex(3);
    else if (p == QLatin1String("google_gtx")) stacked->setCurrentIndex(4);
    else stacked->setCurrentIndex(0);
  };

  updateStack();

  connect(providerCombo, QOverload<int>::of(&QComboBox::currentIndexChanged), this, [translateSvc, providerCombo, updateStack]() {
    updateStack();
    if (translateSvc) {
      translateSvc->setProvider(providerCombo->currentData().toString());
      QSettings prefs;
      translateSvc->savePreferences(prefs);
    }
  });

  connect(ltUrlEdit, &QLineEdit::textChanged, this, [translateSvc](const QString &text) {
    if (translateSvc) {
      translateSvc->setLibreTranslateEndpoint(QUrl(text.trimmed()));
      QSettings prefs;
      translateSvc->savePreferences(prefs);
    }
  });

  connect(ltKeyEdit, &QLineEdit::textChanged, this, [translateSvc](const QString &text) {
    if (translateSvc) {
      translateSvc->saveApiKey(QStringLiteral("libretranslate"), text.trimmed());
    }
  });

  connect(deeplKeyEdit, &QLineEdit::textChanged, this, [translateSvc](const QString &text) {
    if (translateSvc) {
      translateSvc->saveApiKey(QStringLiteral("deepl"), text.trimmed());
    }
  });

  connect(deeplPlanCombo, QOverload<int>::of(&QComboBox::currentIndexChanged), this, [translateSvc](int idx) {
    if (translateSvc) {
      translateSvc->setDeepLIsPro(idx == 1);
      QSettings prefs;
      translateSvc->savePreferences(prefs);
    }
  });

  connect(gcpKeyEdit, &QLineEdit::textChanged, this, [translateSvc](const QString &text) {
    if (translateSvc) {
      translateSvc->saveApiKey(QStringLiteral("google_cloud"), text.trimmed());
    }
  });

  connect(ltTestBtn, &QPushButton::clicked, this, [translateSvc, ltStatusLabel]() {
    ltStatusLabel->setText(QStringLiteral("⏳ Test ediliyor..."));
    if (translateSvc) {
      translateSvc->testConnection(QStringLiteral("libretranslate"), [ltStatusLabel](bool success, const QString &msg) {
        ltStatusLabel->setText(msg);
        ltStatusLabel->setStyleSheet(success ? QStringLiteral("color: #81c995; padding-left: 18px;") : QStringLiteral("color: #f28b82; padding-left: 18px;"));
      });
    }
  });

  connect(deeplTestBtn, &QPushButton::clicked, this, [translateSvc, deeplStatusLabel]() {
    deeplStatusLabel->setText(QStringLiteral("⏳ Test ediliyor..."));
    if (translateSvc) {
      translateSvc->testConnection(QStringLiteral("deepl"), [deeplStatusLabel](bool success, const QString &msg) {
        deeplStatusLabel->setText(msg);
        deeplStatusLabel->setStyleSheet(success ? QStringLiteral("color: #81c995; padding-left: 18px;") : QStringLiteral("color: #f28b82; padding-left: 18px;"));
      });
    }
  });

  connect(gcpTestBtn, &QPushButton::clicked, this, [translateSvc, gcpStatusLabel]() {
    gcpStatusLabel->setText(QStringLiteral("⏳ Test ediliyor..."));
    if (translateSvc) {
      translateSvc->testConnection(QStringLiteral("google_cloud"), [gcpStatusLabel](bool success, const QString &msg) {
        gcpStatusLabel->setText(msg);
        gcpStatusLabel->setStyleSheet(success ? QStringLiteral("color: #81c995; padding-left: 18px;") : QStringLiteral("color: #f28b82; padding-left: 18px;"));
      });
    }
  });

  cardLayout(configCard)->addWidget(stacked);
  section.layout->addWidget(configCard);
  section.layout->addStretch();
  return section.page;
}
