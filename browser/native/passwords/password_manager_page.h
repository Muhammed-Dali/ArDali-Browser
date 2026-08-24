#pragma once

#include <QWidget>

class CredentialVaultManager;
class QLineEdit;
class QListWidget;
class QLabel;

class PasswordManagerPage final : public QWidget {
  Q_OBJECT
 public:
  explicit PasswordManagerPage(CredentialVaultManager *vault, QWidget *parent = nullptr);
  void refresh();

 private:
  void showSetup();
  void showConsent();
  void showUnlock();
  void showRecords();
  void createVault();
  void exportBackup();
  void importBackup();
  void addCredential(const QString &id = {});
  void copyPassword(const QString &id);
  CredentialVaultManager *vault_ = nullptr;
  QLineEdit *master_ = nullptr;
  QLineEdit *confirm_ = nullptr;
  QLineEdit *search_ = nullptr;
  QListWidget *records_ = nullptr;
  QLabel *status_ = nullptr;
  QString statusMessage_;
  bool usernamesVisible_ = false;
};
