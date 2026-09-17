/****************************************************************************
** Meta object code from reading C++ file 'media_download_service.h'
**
** Created by: The Qt Meta Object Compiler version 69 (Qt 6.11.2)
**
** WARNING! All changes made in this file will be lost!
*****************************************************************************/

#include "../../../browser/native/downloads/media_download_service.h"
#include <QtCore/qmetatype.h>

#include <QtCore/qtmochelpers.h>

#include <memory>


#include <QtCore/qxptype_traits.h>
#if !defined(Q_MOC_OUTPUT_REVISION)
#error "The header file 'media_download_service.h' doesn't include <QObject>."
#elif Q_MOC_OUTPUT_REVISION != 69
#error "This file was generated using the moc from 6.11.2. It"
#error "cannot be used with the include files from this version of Qt."
#error "(The moc has changed too much.)"
#endif

#ifndef Q_CONSTINIT
#define Q_CONSTINIT
#endif

QT_WARNING_PUSH
QT_WARNING_DISABLE_DEPRECATED
QT_WARNING_DISABLE_GCC("-Wuseless-cast")
namespace {
struct qt_meta_tag_ZN20MediaDownloadServiceE_t {};
} // unnamed namespace

template <> constexpr inline auto MediaDownloadService::qt_create_metaobjectdata<qt_meta_tag_ZN20MediaDownloadServiceE_t>()
{
    namespace QMC = QtMocConstants;
    QtMocHelpers::StringRefStorage qt_stringData {
        "MediaDownloadService",
        "analysisStarted",
        "",
        "QUrl",
        "url",
        "analysisReady",
        "MediaAnalysisResult",
        "result",
        "analysisFailed",
        "message",
        "analysisCancelled",
        "enginePreparationStatus",
        "percent",
        "jobsChanged",
        "jobEnqueued",
        "QUuid",
        "id"
    };

    QtMocHelpers::UintData qt_methods {
        // Signal 'analysisStarted'
        QtMocHelpers::SignalData<void(const QUrl &)>(1, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 3, 4 },
        }}),
        // Signal 'analysisReady'
        QtMocHelpers::SignalData<void(const MediaAnalysisResult &)>(5, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 6, 7 },
        }}),
        // Signal 'analysisFailed'
        QtMocHelpers::SignalData<void(const QString &)>(8, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::QString, 9 },
        }}),
        // Signal 'analysisCancelled'
        QtMocHelpers::SignalData<void()>(10, 2, QMC::AccessPublic, QMetaType::Void),
        // Signal 'enginePreparationStatus'
        QtMocHelpers::SignalData<void(const QString &, int)>(11, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::QString, 9 }, { QMetaType::Int, 12 },
        }}),
        // Signal 'jobsChanged'
        QtMocHelpers::SignalData<void()>(13, 2, QMC::AccessPublic, QMetaType::Void),
        // Signal 'jobEnqueued'
        QtMocHelpers::SignalData<void(const QUuid &)>(14, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 15, 16 },
        }}),
    };
    QtMocHelpers::UintData qt_properties {
    };
    QtMocHelpers::UintData qt_enums {
    };
    return QtMocHelpers::metaObjectData<MediaDownloadService, qt_meta_tag_ZN20MediaDownloadServiceE_t>(QMC::MetaObjectFlag{}, qt_stringData,
            qt_methods, qt_properties, qt_enums);
}
Q_CONSTINIT const QMetaObject MediaDownloadService::staticMetaObject = { {
    QMetaObject::SuperData::link<QObject::staticMetaObject>(),
    qt_staticMetaObjectStaticContent<qt_meta_tag_ZN20MediaDownloadServiceE_t>.stringdata,
    qt_staticMetaObjectStaticContent<qt_meta_tag_ZN20MediaDownloadServiceE_t>.data,
    qt_static_metacall,
    nullptr,
    qt_staticMetaObjectRelocatingContent<qt_meta_tag_ZN20MediaDownloadServiceE_t>.metaTypes,
    nullptr
} };

void MediaDownloadService::qt_static_metacall(QObject *_o, QMetaObject::Call _c, int _id, void **_a)
{
    auto *_t = static_cast<MediaDownloadService *>(_o);
    if (_c == QMetaObject::InvokeMetaMethod) {
        switch (_id) {
        case 0: _t->analysisStarted((*reinterpret_cast<std::add_pointer_t<QUrl>>(_a[1]))); break;
        case 1: _t->analysisReady((*reinterpret_cast<std::add_pointer_t<MediaAnalysisResult>>(_a[1]))); break;
        case 2: _t->analysisFailed((*reinterpret_cast<std::add_pointer_t<QString>>(_a[1]))); break;
        case 3: _t->analysisCancelled(); break;
        case 4: _t->enginePreparationStatus((*reinterpret_cast<std::add_pointer_t<QString>>(_a[1])),(*reinterpret_cast<std::add_pointer_t<int>>(_a[2]))); break;
        case 5: _t->jobsChanged(); break;
        case 6: _t->jobEnqueued((*reinterpret_cast<std::add_pointer_t<QUuid>>(_a[1]))); break;
        default: ;
        }
    }
    if (_c == QMetaObject::RegisterMethodArgumentMetaType) {
        switch (_id) {
        default: *reinterpret_cast<QMetaType *>(_a[0]) = QMetaType(); break;
        case 1:
            switch (*reinterpret_cast<int*>(_a[1])) {
            default: *reinterpret_cast<QMetaType *>(_a[0]) = QMetaType(); break;
            case 0:
                *reinterpret_cast<QMetaType *>(_a[0]) = QMetaType::fromType< MediaAnalysisResult >(); break;
            }
            break;
        }
    }
    if (_c == QMetaObject::IndexOfMethod) {
        if (QtMocHelpers::indexOfMethod<void (MediaDownloadService::*)(const QUrl & )>(_a, &MediaDownloadService::analysisStarted, 0))
            return;
        if (QtMocHelpers::indexOfMethod<void (MediaDownloadService::*)(const MediaAnalysisResult & )>(_a, &MediaDownloadService::analysisReady, 1))
            return;
        if (QtMocHelpers::indexOfMethod<void (MediaDownloadService::*)(const QString & )>(_a, &MediaDownloadService::analysisFailed, 2))
            return;
        if (QtMocHelpers::indexOfMethod<void (MediaDownloadService::*)()>(_a, &MediaDownloadService::analysisCancelled, 3))
            return;
        if (QtMocHelpers::indexOfMethod<void (MediaDownloadService::*)(const QString & , int )>(_a, &MediaDownloadService::enginePreparationStatus, 4))
            return;
        if (QtMocHelpers::indexOfMethod<void (MediaDownloadService::*)()>(_a, &MediaDownloadService::jobsChanged, 5))
            return;
        if (QtMocHelpers::indexOfMethod<void (MediaDownloadService::*)(const QUuid & )>(_a, &MediaDownloadService::jobEnqueued, 6))
            return;
    }
}

const QMetaObject *MediaDownloadService::metaObject() const
{
    return QObject::d_ptr->metaObject ? QObject::d_ptr->dynamicMetaObject() : &staticMetaObject;
}

void *MediaDownloadService::qt_metacast(const char *_clname)
{
    if (!_clname) return nullptr;
    if (!strcmp(_clname, qt_staticMetaObjectStaticContent<qt_meta_tag_ZN20MediaDownloadServiceE_t>.strings))
        return static_cast<void*>(this);
    return QObject::qt_metacast(_clname);
}

int MediaDownloadService::qt_metacall(QMetaObject::Call _c, int _id, void **_a)
{
    _id = QObject::qt_metacall(_c, _id, _a);
    if (_id < 0)
        return _id;
    if (_c == QMetaObject::InvokeMetaMethod) {
        if (_id < 7)
            qt_static_metacall(this, _c, _id, _a);
        _id -= 7;
    }
    if (_c == QMetaObject::RegisterMethodArgumentMetaType) {
        if (_id < 7)
            qt_static_metacall(this, _c, _id, _a);
        _id -= 7;
    }
    return _id;
}

// SIGNAL 0
void MediaDownloadService::analysisStarted(const QUrl & _t1)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 0, nullptr, _t1);
}

// SIGNAL 1
void MediaDownloadService::analysisReady(const MediaAnalysisResult & _t1)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 1, nullptr, _t1);
}

// SIGNAL 2
void MediaDownloadService::analysisFailed(const QString & _t1)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 2, nullptr, _t1);
}

// SIGNAL 3
void MediaDownloadService::analysisCancelled()
{
    QMetaObject::activate(this, &staticMetaObject, 3, nullptr);
}

// SIGNAL 4
void MediaDownloadService::enginePreparationStatus(const QString & _t1, int _t2)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 4, nullptr, _t1, _t2);
}

// SIGNAL 5
void MediaDownloadService::jobsChanged()
{
    QMetaObject::activate(this, &staticMetaObject, 5, nullptr);
}

// SIGNAL 6
void MediaDownloadService::jobEnqueued(const QUuid & _t1)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 6, nullptr, _t1);
}
QT_WARNING_POP
