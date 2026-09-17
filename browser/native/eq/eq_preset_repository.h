#pragma once

#include <QStringList>
#include <QVector>

class QJsonArray;

struct EqPreset {
  QString id;
  QString name;
  QString description;
  QStringList groups;
  QVector<double> bands;
};

class EqPresetRepository final {
 public:
  bool load();
  const QVector<EqPreset> &presets() const { return presets_; }
  int invalidCount() const { return invalidCount_; }
  QString dataPath() const { return dataPath_; }
  static QStringList groupOrder();

 private:
  static QVector<double> normalizedBands(const QJsonArray &values, bool *valid);
  static QVector<double> bandsFromPoints(const QJsonArray &points, bool *valid);
  static QStringList groupsFor(const EqPreset &preset);
  QVector<EqPreset> presets_;
  int invalidCount_ = 0;
  QString dataPath_;
};
