/* Sonogram for ArDali
 * Based on ArDali's Sonogram
 * Original Author: Melchior FRANZ <mfranz@kde.org> 2004
 */

#ifndef ANALYZERS_SONOGRAM_H_
#define ANALYZERS_SONOGRAM_H_

#include "analyzerbase.h"

class Sonogram : public Analyzer::Base {
  Q_OBJECT
 public:
  Q_INVOKABLE Sonogram(QWidget*);
  ~Sonogram();

  static const char* kName;

 protected:
  void analyze(QPainter& p, const Analyzer::Scope&, bool new_frame);
  void transform(Analyzer::Scope&);
  void demo(QPainter& p);
  void resizeEvent(QResizeEvent*);
  void psychedelicModeChanged(bool);

  QPixmap canvas_;
  int scope_size_;
};

#endif  // ANALYZERS_SONOGRAM_H_
