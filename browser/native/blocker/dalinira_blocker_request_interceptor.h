#pragma once

#include <QMutex>
#include <QObject>
#include <QWebEngineUrlRequestInfo>
#include <QWebEngineUrlRequestInterceptor>

#include "dalinira_blocker_types.h"

class DaliNiraBlockerService;

class DaliNiraBlockerRequestInterceptor final : public QWebEngineUrlRequestInterceptor {
  Q_OBJECT
 public:
  explicit DaliNiraBlockerRequestInterceptor(DaliNiraBlockerService *service, QObject *parent = nullptr);
  ~DaliNiraBlockerRequestInterceptor() override = default;

  void interceptRequest(QWebEngineUrlRequestInfo &info) override;

 private:
  DaliNiraBlockerService *service_ = nullptr;
};

using AdBlockRequestInterceptor = DaliNiraBlockerRequestInterceptor;
