#pragma once

#include <QFrame>
#include <QLabel>
#include <QPointer>
#include <QPushButton>
#include <QToolButton>
#include <QUrl>
#include <QVBoxLayout>

enum class CredentialSaveMode {
  Verifying,
  ReadyNew,
  ReadyUpdate,
  Cancelled,
  // Compatibility names used by existing callers/tests.
  NewCredential = ReadyNew,
  UpdatePassword = ReadyUpdate
};

class CredentialSaveBubble : public QFrame {
  Q_OBJECT
 public:
  explicit CredentialSaveBubble(QWidget *parent = nullptr);
  ~CredentialSaveBubble() override = default;

  void setupPrompt(CredentialSaveMode mode, const QString &origin, const QString &username);

  CredentialSaveMode mode() const { return mode_; }
  QString origin() const { return origin_; }
  QString username() const { return username_; }

  QString titleText() const { return titleLabel_ ? titleLabel_->text() : QString(); }
  QString descriptionText() const { return descriptionLabel_ ? descriptionLabel_->text() : QString(); }
  QString primaryButtonText() const { return primaryBtn_ ? primaryBtn_->text() : QString(); }
  QString secondaryButtonText() const { return secondaryBtn_ ? secondaryBtn_->text() : QString(); }
  bool isPrimaryButtonEnabled() const { return primaryBtn_ && primaryBtn_->isEnabled(); }

  void clickPrimary();
  void clickSecondary();
  void clickClose();

 signals:
  void saveAccepted();
  void saveRejected();

 protected:
  bool eventFilter(QObject *watched, QEvent *event) override;
  void keyPressEvent(QKeyEvent *event) override;
  void paintEvent(QPaintEvent *event) override;

 private:
  void initializeUi();

  CredentialSaveMode mode_ = CredentialSaveMode::NewCredential;
  QString origin_;
  QString username_;

  QLabel *iconLabel_ = nullptr;
  QLabel *titleLabel_ = nullptr;
  QToolButton *closeBtn_ = nullptr;
  QLabel *originLabel_ = nullptr;
  QLabel *userLabel_ = nullptr;
  QLabel *descriptionLabel_ = nullptr;
  QPushButton *primaryBtn_ = nullptr;
  QPushButton *secondaryBtn_ = nullptr;
};
