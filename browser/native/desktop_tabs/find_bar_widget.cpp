#include "find_bar_widget.h"

#include <QHBoxLayout>
#include <QIcon>
#include <QStyle>

namespace dalinira::desktop_tabs {

FindBarWidget::FindBarWidget(QWidget *parent)
    : QWidget(parent) {
  setupUi();
  applyStyle();
}

void FindBarWidget::setupUi() {
  setObjectName(QStringLiteral("daliniraFindBar"));
  setAttribute(Qt::WA_StyledBackground, true);

  auto *layout = new QHBoxLayout(this);
  layout->setContentsMargins(8, 4, 8, 4);
  layout->setSpacing(6);

  searchEdit_ = new QLineEdit(this);
  searchEdit_->setPlaceholderText(QStringLiteral("Sayfada bul..."));
  searchEdit_->installEventFilter(this);
  connect(searchEdit_, &QLineEdit::textChanged, this, &FindBarWidget::onTextChanged);
  layout->addWidget(searchEdit_, 1);

  matchCountLabel_ = new QLabel(this);
  matchCountLabel_->setObjectName(QStringLiteral("matchCountLabel"));
  matchCountLabel_->setMinimumWidth(50);
  matchCountLabel_->setAlignment(Qt::AlignCenter);
  layout->addWidget(matchCountLabel_);

  caseBtn_ = new QToolButton(this);
  caseBtn_->setText(QStringLiteral("Aa"));
  caseBtn_->setCheckable(true);
  caseBtn_->setToolTip(QStringLiteral("Büyük/küçük harf eşleştir"));
  connect(caseBtn_, &QToolButton::toggled, this, &FindBarWidget::onCaseToggled);
  layout->addWidget(caseBtn_);

  prevBtn_ = new QToolButton(this);
  prevBtn_->setText(QStringLiteral("▲"));
  prevBtn_->setToolTip(QStringLiteral("Önceki eşleşme (Shift+Enter, Shift+F3)"));
  connect(prevBtn_, &QToolButton::clicked, this, &FindBarWidget::onPrevClicked);
  layout->addWidget(prevBtn_);

  nextBtn_ = new QToolButton(this);
  nextBtn_->setText(QStringLiteral("▼"));
  nextBtn_->setToolTip(QStringLiteral("Sonraki eşleşme (Enter, F3)"));
  connect(nextBtn_, &QToolButton::clicked, this, &FindBarWidget::onNextClicked);
  layout->addWidget(nextBtn_);

  closeBtn_ = new QToolButton(this);
  closeBtn_->setText(QStringLiteral("✕"));
  closeBtn_->setToolTip(QStringLiteral("Kapat (Esc)"));
  connect(closeBtn_, &QToolButton::clicked, this, &FindBarWidget::closeRequested);
  layout->addWidget(closeBtn_);

  setFixedHeight(38);
  setMinimumWidth(320);
}

void FindBarWidget::applyStyle() {
  setStyleSheet(QStringLiteral(
      "#daliniraFindBar {"
      "  background-color: #1b232d;"
      "  border: 1px solid #3a4857;"
      "  border-radius: 8px;"
      "}"
      "QLineEdit {"
      "  background-color: #121820;"
      "  color: #e8eef5;"
      "  border: 1px solid #2d3b4b;"
      "  border-radius: 5px;"
      "  padding: 3px 8px;"
      "  font-size: 13px;"
      "}"
      "QLineEdit:focus {"
      "  border: 1px solid #3b82f6;"
      "}"
      "#matchCountLabel {"
      "  color: #8c9ba8;"
      "  font-size: 12px;"
      "  padding: 0 4px;"
      "}"
      "QToolButton {"
      "  background-color: transparent;"
      "  color: #c0cdd9;"
      "  border: 1px solid transparent;"
      "  border-radius: 4px;"
      "  padding: 2px 6px;"
      "  font-size: 12px;"
      "}"
      "QToolButton:hover {"
      "  background-color: #273444;"
      "  border: 1px solid #3d4f63;"
      "  color: #ffffff;"
      "}"
      "QToolButton:checked {"
      "  background-color: #2563eb;"
      "  border: 1px solid #3b82f6;"
      "  color: #ffffff;"
      "}"
  ));
}

void FindBarWidget::setFindText(const QString &text) {
  if (searchEdit_) {
    searchEdit_->setText(text);
  }
}

QString FindBarWidget::findText() const {
  return searchEdit_ ? searchEdit_->text() : QString();
}

bool FindBarWidget::isCaseSensitive() const {
  return caseBtn_ && caseBtn_->isChecked();
}

void FindBarWidget::setMatchCount(int current, int total) {
  if (!matchCountLabel_) return;
  if (total <= 0) {
    if (findText().isEmpty()) {
      matchCountLabel_->clear();
    } else {
      matchCountLabel_->setText(QStringLiteral("Eşleşme yok"));
      matchCountLabel_->setStyleSheet(QStringLiteral("color: #ef4444; font-size: 12px;"));
    }
  } else {
    matchCountLabel_->setText(QStringLiteral("%1 / %2").arg(current).arg(total));
    matchCountLabel_->setStyleSheet(QStringLiteral("color: #8c9ba8; font-size: 12px;"));
  }
}

void FindBarWidget::clearMatchCount() {
  if (matchCountLabel_) {
    matchCountLabel_->clear();
  }
}

void FindBarWidget::focusAndSelectAll() {
  if (searchEdit_) {
    searchEdit_->setFocus();
    searchEdit_->selectAll();
  }
}

void FindBarWidget::onTextChanged(const QString &text) {
  if (text.isEmpty()) {
    clearMatchCount();
    emit clearFindRequested();
  } else {
    emit findRequested(text, true, isCaseSensitive());
  }
}

void FindBarWidget::onNextClicked() {
  const QString text = findText();
  if (!text.isEmpty()) {
    emit findRequested(text, true, isCaseSensitive());
  }
}

void FindBarWidget::onPrevClicked() {
  const QString text = findText();
  if (!text.isEmpty()) {
    emit findRequested(text, false, isCaseSensitive());
  }
}

void FindBarWidget::onCaseToggled() {
  const QString text = findText();
  if (!text.isEmpty()) {
    emit findRequested(text, true, isCaseSensitive());
  }
}

bool FindBarWidget::eventFilter(QObject *watched, QEvent *event) {
  if (watched == searchEdit_ && event->type() == QEvent::KeyPress) {
    auto *keyEvent = static_cast<QKeyEvent *>(event);
    if (keyEvent->key() == Qt::Key_Return || keyEvent->key() == Qt::Key_Enter) {
      const bool forward = !(keyEvent->modifiers() & Qt::ShiftModifier);
      const QString text = findText();
      if (!text.isEmpty()) {
        emit findRequested(text, forward, isCaseSensitive());
      }
      return true;
    }
    if (keyEvent->key() == Qt::Key_F3) {
      const bool forward = !(keyEvent->modifiers() & Qt::ShiftModifier);
      const QString text = findText();
      if (!text.isEmpty()) {
        emit findRequested(text, forward, isCaseSensitive());
      }
      return true;
    }
    if (keyEvent->key() == Qt::Key_Escape) {
      emit closeRequested();
      return true;
    }
  }
  return QWidget::eventFilter(watched, event);
}

void FindBarWidget::keyPressEvent(QKeyEvent *event) {
  if (event->key() == Qt::Key_Escape) {
    emit closeRequested();
    event->accept();
    return;
  }
  QWidget::keyPressEvent(event);
}

}  // namespace dalinira::desktop_tabs
