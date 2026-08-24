#pragma once

#include <QAbstractButton>
#include <QColor>
#include <QPainter>
#include <QTimer>

class BigListenButton final : public QAbstractButton {
  Q_OBJECT

 public:
  explicit BigListenButton(QWidget *parent = nullptr);
  explicit BigListenButton(int diameter, QWidget *parent = nullptr);
  ~BigListenButton() override;

  bool isListening() const { return isListening_; }
  void setListening(bool listening);
  void setLevel(double levelPercent);
  void setDiameter(int diameter);
  int diameter() const { return diameter_; }

  QSize sizeHint() const override { return QSize(diameter_, diameter_); }
  QSize minimumSizeHint() const override { return QSize(80, 80); }

 protected:
  void paintEvent(QPaintEvent *event) override;
  void enterEvent(QEnterEvent *event) override;
  void leaveEvent(QEvent *event) override;

 private slots:
  void onAnimationTick();

 private:
  int diameter_ = 140;
  bool isListening_ = false;
  bool isHovered_ = false;
  double levelPercent_ = 0.0;
  double animationPhase_ = 0.0;
  QTimer *animTimer_ = nullptr;
};
