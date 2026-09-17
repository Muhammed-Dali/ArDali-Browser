#pragma once

#include <QMutex>
#include <QObject>
#include <QWebEngineUrlRequestInfo>
#include <QWebEngineUrlRequestInterceptor>

#include "ardali_blocker_types.h"

class ArDaliBlockerService;

class ArDaliBlockerRequestInterceptor final : public QWebEngineUrlRequestInterceptor {
  Q_OBJECT
 public:
  explicit ArDaliBlockerRequestInterceptor(ArDaliBlockerService *service, QObject *parent = nullptr);
  ~ArDaliBlockerRequestInterceptor() override = default;

  void interceptRequest(QWebEngineUrlRequestInfo &info) override;

 private:
  ArDaliBlockerService *service_ = nullptr;
};

using AdBlockRequestInterceptor = ArDaliBlockerRequestInterceptor;
