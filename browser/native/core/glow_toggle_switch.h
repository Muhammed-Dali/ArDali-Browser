#pragma once

#include <QCheckBox>
#include <QEasingCurve>
#include <QFontMetrics>
#include <QLinearGradient>
#include <QPainter>
#include <QPointer>
#include <QVariantAnimation>

#include <algorithm>

// Shared animated on/off control used by the audio-effects and AdBlock UIs.
class GlowToggleSwitch final : public QCheckBox {
 public:
  explicit GlowToggleSwitch(const QString &text = {}, QWidget *parent = nullptr)
      : QCheckBox(text, parent) {
    setCursor(Qt::PointingHandCursor);
    setAttribute(Qt::WA_Hover, true);
    animationProgress_ = isChecked() ? 1.0 : 0.0;
    connect(this, &QCheckBox::toggled, this, [this](bool checked) { startAnimation(checked); });
  }

  explicit GlowToggleSwitch(QWidget *parent) : GlowToggleSwitch(QString{}, parent) {}

  QSize sizeHint() const override {
    constexpr int trackWidth = 54;
    constexpr int trackHeight = 28;
    if (text().isEmpty()) return QSize(trackWidth, trackHeight);
    const QFontMetrics metrics(font());
    return QSize(trackWidth + 12 + metrics.horizontalAdvance(text()),
                 std::max(trackHeight, metrics.height()));
  }

 protected:
  void paintEvent(QPaintEvent *) override {
    QPainter painter(this);
    painter.setRenderHints(QPainter::Antialiasing | QPainter::SmoothPixmapTransform |
                           QPainter::TextAntialiasing);

    constexpr int trackWidth = 50;
    constexpr int trackHeight = 26;
    const qreal radius = trackHeight / 2.0;
    const int offsetY = (height() - trackHeight) / 2;
    const QRectF trackRect(1, offsetY, trackWidth, trackHeight);

    // setChecked() is intentionally used under QSignalBlocker while settings
    // are loaded. In that path toggled() does not run, so paint from the real
    // checked state whenever no animation is active.
    const bool animationMatchesState = animation_ && animation_->state() == QAbstractAnimation::Running &&
        (animation_->endValue().toDouble() > 0.5) == isChecked();
    const double progress = animationMatchesState ? animationProgress_ : (isChecked() ? 1.0 : 0.0);
    const bool enabled = isEnabled();

    if (!enabled) {
      painter.setPen(QPen(QColor(49, 58, 69), 1.5));
      painter.setBrush(QColor(16, 21, 27));
      painter.drawRoundedRect(trackRect, radius, radius);
    } else if (progress > 0.001) {
      painter.setPen(QPen(QColor(55, 213, 255, qRound(progress * 255)), 2.0));
      QLinearGradient gradient(trackRect.topLeft(), trackRect.bottomRight());
      gradient.setColorAt(0.0, QColor(8, 38, 48, qRound(progress * 255)));
      gradient.setColorAt(1.0, QColor(5, 20, 28, qRound(progress * 255)));
      painter.setBrush(gradient);
      painter.drawRoundedRect(trackRect, radius, radius);
    }
    if (enabled && progress < 0.999) {
      painter.setPen(QPen(QColor(46, 54, 64, qRound((1.0 - progress) * 255)), 1.5));
      QLinearGradient gradient(trackRect.topLeft(), trackRect.bottomRight());
      gradient.setColorAt(0.0, QColor(20, 26, 32, qRound((1.0 - progress) * 255)));
      gradient.setColorAt(1.0, QColor(10, 14, 18, qRound((1.0 - progress) * 255)));
      painter.setBrush(gradient);
      painter.drawRoundedRect(trackRect, radius, radius);
    }

    painter.setPen(Qt::NoPen);
    painter.setBrush(!enabled ? QColor(82, 94, 108)
                              : (isChecked() ? QColor(0, 255, 180) : QColor(240, 60, 60)));
    painter.drawEllipse(QPointF(trackRect.left() + 7.5, trackRect.top() + 6.5), 2.5, 2.5);

    const qreal minX = trackRect.left() + 12.5;
    const qreal maxX = trackRect.right() - 12.5;
    const qreal currentX = minX + progress * (maxX - minX);
    const QPointF knobCenter(currentX, trackRect.top() + radius);
    painter.setBrush(QColor(0, 0, 0, 140));
    painter.drawEllipse(knobCenter + QPointF(0, 1.5), 9.5, 9.5);

    QLinearGradient knobGradient(knobCenter - QPointF(0, 9.5), knobCenter + QPointF(0, 9.5));
    knobGradient.setColorAt(0.0, QColor(75, 86, 98));
    knobGradient.setColorAt(0.5, QColor(40, 47, 55));
    knobGradient.setColorAt(1.0, QColor(22, 26, 31));
    painter.setBrush(knobGradient);
    painter.setPen(QPen(QColor(95, 108, 122, 200), 1.0));
    painter.drawEllipse(knobCenter, 9.5, 9.5);
    painter.setPen(QPen(!enabled ? QColor(100, 112, 126, 80)
                                 : (isChecked() ? QColor(0, 229, 255, 180)
                                                : QColor(130, 142, 158, 70)), 1.0));
    painter.setBrush(Qt::NoBrush);
    painter.drawEllipse(knobCenter, 7.5, 7.5);

    if (!text().isEmpty()) {
      painter.setPen(isEnabled() ? QColor(QStringLiteral("#e9edf2"))
                                 : QColor(QStringLiteral("#667383")));
      QFont labelFont = font();
      labelFont.setBold(true);
      labelFont.setPointSize(10);
      painter.setFont(labelFont);
      painter.drawText(QRectF(trackWidth + 10, 0, width() - (trackWidth + 10), height()),
                       Qt::AlignLeft | Qt::AlignVCenter, text());
    }
  }

 private:
  void startAnimation(bool checked) {
    if (animation_) animation_->stop();
    animation_ = new QVariantAnimation(this);
    animation_->setDuration(160);
    animation_->setStartValue(animationProgress_);
    animation_->setEndValue(checked ? 1.0 : 0.0);
    animation_->setEasingCurve(QEasingCurve::OutCubic);
    connect(animation_, &QVariantAnimation::valueChanged, this, [this](const QVariant &value) {
      animationProgress_ = value.toDouble();
      update();
    });
    animation_->start(QAbstractAnimation::DeleteWhenStopped);
  }

  double animationProgress_ = 0.0;
  QPointer<QVariantAnimation> animation_;
};
