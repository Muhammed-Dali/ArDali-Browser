/* Turbine Analyzer for ArDali
 * Based on ArDali's TurbineAnalyzer
 * Original Author: Stanislav Karchebny <berkus@users.sf.net> 2003
 */

#ifndef ANALYZERS_TURBINE_H_
#define ANALYZERS_TURBINE_H_

#include "boomanalyzer.h"

class TurbineAnalyzer : public BoomAnalyzer {
  Q_OBJECT
 public:
  Q_INVOKABLE TurbineAnalyzer(QWidget* parent) : BoomAnalyzer(parent) {}

  void analyze(QPainter& p, const Analyzer::Scope&, bool new_frame);

  static const char* kName;
};

#endif  // ANALYZERS_TURBINE_H_
