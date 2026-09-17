#include "credential_vault_manager.h"
#include "password_manager_page.h"

#include <QApplication>
#include <QCheckBox>
#include <QComboBox>
#include <QLabel>
#include <QIcon>
#include <QLineEdit>
#include <QPushButton>
#include <QPixmap>
#include <QSettings>
#include <QScrollArea>
#include <QScrollBar>
#include <QVBoxLayout>
#include <QMouseEvent>
#include <QTemporaryDir>

#include <cassert>

int main(int argc, char **argv) {
  QApplication app(argc, argv);
  const QString consentKey = QStringLiteral("browser/passwords/experimentalConsentAccepted");
  QSettings settings;
  const bool hadConsent = settings.contains(consentKey);
  const QVariant previousConsent = settings.value(consentKey);
  settings.setValue(consentKey, false);

  QTemporaryDir root;
  assert(root.isValid());
  CredentialVaultManager vault(root.path());
  PasswordManagerPage page(&vault);
  page.resize(980, 720);

  auto *card = page.findChild<QFrame *>(QStringLiteral("vault-consent-card"));
  auto *checkboxSection = page.findChild<QWidget *>(QStringLiteral("vault-consent-checkbox-section"));
  auto *row1 = page.findChild<QWidget *>(QStringLiteral("vault-consent-row-notice"));
  auto *row2 = page.findChild<QWidget *>(QStringLiteral("vault-consent-row-activation"));
  auto *notice = page.findChild<QCheckBox *>(QStringLiteral("vault-notice-acknowledgement"));
  auto *activation = page.findChild<QCheckBox *>(QStringLiteral("vault-activation-acknowledgement"));
  auto *enable = page.findChild<QPushButton *>(QStringLiteral("vault-enable-experimental"));
  auto *later = page.findChild<QPushButton *>(); // will check below
  assert(card && checkboxSection && row1 && row2);
  assert(notice && activation && enable && !enable->isEnabled());
  assert(!notice->isEnabled() && !activation->isEnabled());

  page.show();
  QApplication::processEvents();

  // Test across multiple window widths including narrow widths
  const QList<QSize> testSizes = {
    QSize(980, 800),
    QSize(980, 720), // 100% normal
    QSize(784, 576), // ~125% effective viewport
    QSize(653, 480), // ~150% effective viewport
    QSize(480, 700), // Narrow window
    QSize(400, 700)  // Very narrow window
  };

  for (const QSize &size : testSizes) {
    page.resize(size);
    QApplication::processEvents();

    auto *noticeScroll = page.findChild<QScrollArea *>(QStringLiteral("vault-notice-scroll"));
    assert(noticeScroll);

    // Rule 1: Politika scroll alanı ile checkbox bölümü arasında >= 12 px boşluk
    const int scrollBottom = noticeScroll->mapTo(card, QPoint(0, noticeScroll->height())).y();
    const int row1Top = row1->mapTo(card, QPoint(0, 0)).y();
    const int sectionTop = checkboxSection->mapTo(card, QPoint(0, 0)).y();
    const int scrollGap = row1Top - scrollBottom;
    assert(scrollGap >= 12);

    // Rule 6: İki checkbox satırı arasında >= 8 px dikey boşluk
    const int row1Bottom = row1->mapTo(card, QPoint(0, row1->height())).y();
    const int row2Top = row2->mapTo(card, QPoint(0, 0)).y();
    const int rowGap = row2Top - row1Bottom;
    assert(rowGap >= 8);

    // Rule 7: Checkbox bölümü ile buton grubu arasında >= 14 px boşluk
    const int sectionBottom = checkboxSection->mapTo(card, QPoint(0, checkboxSection->height())).y();
    const int enableTop = enable->mapTo(card, QPoint(0, 0)).y();
    const int buttonGap = enableTop - sectionBottom;
    assert(buttonGap >= 14);

    // Rule 4: Checkbox ilk satıra hizalı (top aligned)
    const int noticeCheckYInRow = notice->mapTo(row1, QPoint(0, 0)).y();
    assert(noticeCheckYInRow <= 4); // Aligned to top of row
    const int activationCheckYInRow = activation->mapTo(row2, QPoint(0, 0)).y();
    assert(activationCheckYInRow <= 4);

    // Rule 5: Label wrap testi: row2 uzun metin içerir, dar genişlikte düzgün wrap olmalı
    assert(row2->width() > 0);
    assert(row2->height() >= 18);
  }

  // Restore normal size for logic tests
  page.resize(980, 720);
  QApplication::processEvents();

  auto *noticeScroll = page.findChild<QScrollArea *>(QStringLiteral("vault-notice-scroll"));
  assert(noticeScroll && noticeScroll->verticalScrollBar()->maximum() > 0);
  assert(!notice->isEnabled() && !activation->isEnabled());

  // Scroll to bottom to unlock checkboxes
  noticeScroll->verticalScrollBar()->setValue(noticeScroll->verticalScrollBar()->maximum());
  QApplication::processEvents();
  assert(notice->isEnabled() && activation->isEnabled());
  assert(!enable->isEnabled());

  // Checkbox logic: only notice checked -> still disabled
  notice->setChecked(true);
  QApplication::processEvents();
  assert(!enable->isEnabled());

  // Both checked -> enabled
  activation->setChecked(true);
  QApplication::processEvents();
  assert(enable->isEnabled());

  // One unchecked -> disabled
  notice->setChecked(false);
  QApplication::processEvents();
  assert(!enable->isEnabled());

  // Test companion label click toggling
  // Clicking row1's label should toggle notice check
  const auto row1Labels = row1->findChildren<QLabel *>();
  assert(!row1Labels.isEmpty());
  auto *noticeLabel = row1Labels.first();
  QMouseEvent pressEvent(QEvent::MouseButtonPress, QPointF(5, 5), QPointF(5, 5), Qt::LeftButton, Qt::LeftButton, Qt::NoModifier);
  QApplication::sendEvent(noticeLabel, &pressEvent);
  QApplication::processEvents();
  assert(notice->isChecked());
  assert(enable->isEnabled()); // Both now checked!

  settings.setValue(consentKey, true);
  page.refresh();
  auto *master = page.findChild<QLineEdit *>(QStringLiteral("vault-master-password"));
  auto *confirm = page.findChild<QLineEdit *>(QStringLiteral("vault-confirm-password"));
  auto *create = page.findChild<QPushButton *>(QStringLiteral("vault-create"));
  assert(master && confirm && create && !create->isEnabled());
  master->setText(QStringLiteral("StrongMaster2026"));
  confirm->setText(QStringLiteral("StrongMaster2026"));
  QApplication::processEvents();
  assert(!create->isEnabled());
  master->setText(QStringLiteral("StrongMaster#2026"));
  confirm->setText(QStringLiteral("StrongMaster#2026"));
  QApplication::processEvents();
  assert(create->isEnabled());
  for (const QString &rule : {QStringLiteral("length"), QStringLiteral("lower"), QStringLiteral("upper"), QStringLiteral("number"), QStringLiteral("symbol")}) {
    const auto *label = page.findChild<QLabel *>(QStringLiteral("vault-rule-%1").arg(rule));
    assert(label && label->styleSheet().contains(QStringLiteral("55e69a")));
  }

  assert(vault.create(QStringLiteral("StrongMaster#2026")));
  QApplication::processEvents();
  page.refresh();
  assert(page.findChild<QLineEdit *>(QStringLiteral("vault-search")));
  assert(page.findChild<QPushButton *>(QStringLiteral("vault-toggle-usernames")));
  assert(page.findChild<QPushButton *>(QStringLiteral("vault-add-credential")));
  assert(page.findChild<QPushButton *>(QStringLiteral("vault-lock")));
  assert(page.findChild<QComboBox *>(QStringLiteral("vault-auto-lock")));
  assert(page.findChild<QPushButton *>(QStringLiteral("vault-disable")));
  assert(page.findChild<QPushButton *>(QStringLiteral("vault-change-master")));
  assert(page.findChild<QPushButton *>(QStringLiteral("vault-reset")));
  for (QPushButton *button : page.findChildren<QPushButton *>()) {
    assert(button->cursor().shape() == Qt::PointingHandCursor);
  }
  assert(page.styleSheet().contains(QStringLiteral("QPushButton:pressed")));
  assert(page.styleSheet().contains(QStringLiteral("[ghost=\"true\"]:pressed")));
  assert(page.styleSheet().contains(QStringLiteral("[danger=\"true\"]:pressed")));

  int faviconLookups = 0;
  page.setFaviconLookupForTesting(
      [&faviconLookups](const QUrl &url, PasswordManagerPage::FaviconResultCallback callback) {
        ++faviconLookups;
        QPixmap pixmap(32, 32);
        pixmap.fill(Qt::red);
        callback(QIcon(pixmap), url);
      });
  CredentialSecret iconRecord{QStringLiteral("https://favicon-cache.example"),
                              QStringLiteral("icon-user"),
                              QStringLiteral("IconSecret#2026"),
                              QStringLiteral("this-must-not-be-stored")};
  assert(vault.save(iconRecord));
  QApplication::processEvents();
  page.refresh();
  QApplication::processEvents();
  auto *siteIcon = page.findChild<QLabel *>(QStringLiteral("credential-site-icon"));
  assert(siteIcon && !siteIcon->pixmap().isNull());
  assert(faviconLookups > 0);
  assert(siteIcon->property("faviconSource").toString() == QStringLiteral("browser-cache"));
  CredentialSecret iconRecordRead;
  assert(vault.reveal(vault.list().front().id, &iconRecordRead));
  assert(iconRecordRead.iconPngBase64.isEmpty());

  PasswordManagerPage fallbackPage(&vault);
  fallbackPage.refresh();
  QApplication::processEvents();
  auto *fallbackIcon = fallbackPage.findChild<QLabel *>(QStringLiteral("credential-site-icon"));
  assert(fallbackIcon && !fallbackIcon->pixmap().isNull());
  assert(fallbackIcon->property("faviconSource").toString() == QStringLiteral("generic"));

  if (hadConsent) settings.setValue(consentKey, previousConsent); else settings.remove(consentKey);
}
