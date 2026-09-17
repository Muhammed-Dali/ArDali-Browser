#pragma once

#include <QFrame>
#include <QLabel>
#include <QPointer>
#include <QPushButton>
#include <QToolButton>
#include <QMenu>
#include <QVBoxLayout>

#include "page_translator.h"

class TranslateBubblePopup : public QFrame {
  Q_OBJECT

 public:
  explicit TranslateBubblePopup(QWidget *parent = nullptr);
  ~TranslateBubblePopup() override = default;

  void setTranslator(PageTranslator *translator);
  void showAtAnchor(const QPoint &globalPos);

 signals:
  void openSettingsRequested();

 private:
  void updateUi();
  void setupMoreMenu();

  QPointer<PageTranslator> translator_;

  QPushButton *sourceLangBtn_ = nullptr;
  QPushButton *targetLangBtn_ = nullptr;
  QToolButton *moreBtn_ = nullptr;
  QToolButton *closeBtn_ = nullptr;
  QPushButton *openSettingsBtn_ = nullptr;
  QLabel *statusLabel_ = nullptr;
  QLabel *brandLabel_ = nullptr;
  QMenu *moreMenu_ = nullptr;
};
