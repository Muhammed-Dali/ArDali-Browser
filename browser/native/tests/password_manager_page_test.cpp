#include "credential_vault_manager.h"
#include "password_manager_page.h"

#include <QApplication>
#include <QCheckBox>
#include <QComboBox>
#include <QLabel>
#include <QLineEdit>
#include <QPushButton>
#include <QSettings>
#include <QScrollArea>
#include <QScrollBar>
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

  auto *notice = page.findChild<QCheckBox *>(QStringLiteral("vault-notice-acknowledgement"));
  auto *activation = page.findChild<QCheckBox *>(QStringLiteral("vault-activation-acknowledgement"));
  auto *enable = page.findChild<QPushButton *>(QStringLiteral("vault-enable-experimental"));
  assert(notice && activation && enable && !enable->isEnabled());
  assert(!notice->isEnabled() && !activation->isEnabled());
  auto *noticeScroll = page.findChild<QScrollArea *>(QStringLiteral("vault-notice-scroll"));
  assert(noticeScroll && noticeScroll->verticalScrollBar()->maximum() > 0);
  noticeScroll->verticalScrollBar()->setValue(noticeScroll->verticalScrollBar()->maximum());
  QApplication::processEvents();
  assert(notice->isEnabled() && activation->isEnabled());
  notice->setChecked(true);
  activation->setChecked(true);
  QApplication::processEvents();
  assert(enable->isEnabled());

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

  if (hadConsent) settings.setValue(consentKey, previousConsent); else settings.remove(consentKey);
}
