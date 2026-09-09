#pragma once
#include <QNetworkReply>
#include <QNetworkAccessManager>
#include <QTimer>
#include <cstring>
class Reply final : public QNetworkReply {
 public:
  QByteArray bytes; qint64 position=0;
  Reply(const QNetworkRequest &request, QByteArray body, int delay, QObject *parent) : QNetworkReply(parent),bytes(body) {
    setRequest(request);setUrl(request.url());setOperation(QNetworkAccessManager::GetOperation);
    setAttribute(QNetworkRequest::HttpStatusCodeAttribute,200);open(QIODevice::ReadOnly);
    QTimer::singleShot(delay,this,[this]{if(isFinished())return;emit readyRead();setFinished(true);emit finished();});
  }
  void abort() override { if(isFinished())return;setError(OperationCanceledError,QStringLiteral("cancelled"));setFinished(true);emit finished(); }
  qint64 bytesAvailable() const override {return bytes.size()-position+QIODevice::bytesAvailable();}
 protected:
  qint64 readData(char *data,qint64 max) override {const qint64 count=qMin(max,bytes.size()-position);if(count<=0)return -1;memcpy(data,bytes.constData()+position,count);position+=count;return count;}
};
class Network final : public QNetworkAccessManager {
 public:
  int requests=0,delay=30;QByteArray body=R"JSON(["hav",["hava","hava durumu","hava","javascript:alert(1)","file:///etc/passwd"]])JSON";
  QNetworkRequest last;
 protected:
  QNetworkReply *createRequest(Operation, const QNetworkRequest &request,QIODevice *) override {
    ++requests;last=request;return new Reply(request,body,delay,this);
  }
};
