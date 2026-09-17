/****************************************************************************
** Meta object code from reading C++ file 'song_recognition_service.h'
**
** Created by: The Qt Meta Object Compiler version 69 (Qt 6.11.2)
**
** WARNING! All changes made in this file will be lost!
*****************************************************************************/

#include "../../../browser/native/pulse/song_recognition_service.h"
#include <QtNetwork/QSslError>
#include <QtCore/qmetatype.h>
#include <QtCore/QList>

#include <QtCore/qtmochelpers.h>

#include <memory>


#include <QtCore/qxptype_traits.h>
#if !defined(Q_MOC_OUTPUT_REVISION)
#error "The header file 'song_recognition_service.h' doesn't include <QObject>."
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
struct qt_meta_tag_ZN22SongRecognitionServiceE_t {};
} // unnamed namespace

template <> constexpr inline auto SongRecognitionService::qt_create_metaobjectdata<qt_meta_tag_ZN22SongRecognitionServiceE_t>()
{
    namespace QMC = QtMocConstants;
    QtMocHelpers::StringRefStorage qt_stringData {
        "SongRecognitionService",
        "stateChanged",
        "",
        "State",
        "state",
        "message",
        "songFound",
        "SongResult",
        "result",
        "activeResultChanged",
        "hasActive",
        "volumeChanged",
        "levelPercent",
        "bufferFillPercent",
        "activeSourceName",
        "devicesUpdated",
        "QList<AudioDeviceInfo>",
        "devices",
        "AutoRouteInfo",
        "route",
        "autoOpenRequested",
        "SongFinderSettings::OpenPlatform",
        "platform",
        "onCaptureVolumeChanged",
        "AudioCaptureService::ActiveSourceType",
        "sourceType",
        "sourceName",
        "onCaptureError",
        "error",
        "onRecognitionTimerTimeout",
        "onDeviceManagerChanges"
    };

    QtMocHelpers::UintData qt_methods {
        // Signal 'stateChanged'
        QtMocHelpers::SignalData<void(enum State, const QString &)>(1, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 3, 4 }, { QMetaType::QString, 5 },
        }}),
        // Signal 'songFound'
        QtMocHelpers::SignalData<void(const SongResult &)>(6, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 7, 8 },
        }}),
        // Signal 'activeResultChanged'
        QtMocHelpers::SignalData<void(const SongResult &, bool)>(9, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 7, 8 }, { QMetaType::Bool, 10 },
        }}),
        // Signal 'volumeChanged'
        QtMocHelpers::SignalData<void(double, double, const QString &)>(11, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::Double, 12 }, { QMetaType::Double, 13 }, { QMetaType::QString, 14 },
        }}),
        // Signal 'devicesUpdated'
        QtMocHelpers::SignalData<void(const QVector<AudioDeviceInfo> &, const AutoRouteInfo &)>(15, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 16, 17 }, { 0x80000000 | 18, 19 },
        }}),
        // Signal 'autoOpenRequested'
        QtMocHelpers::SignalData<void(const SongResult &, SongFinderSettings::OpenPlatform)>(20, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 7, 8 }, { 0x80000000 | 21, 22 },
        }}),
        // Slot 'onCaptureVolumeChanged'
        QtMocHelpers::SlotData<void(double, double, AudioCaptureService::ActiveSourceType, const QString &)>(23, 2, QMC::AccessPrivate, QMetaType::Void, {{
            { QMetaType::Double, 12 }, { QMetaType::Double, 13 }, { 0x80000000 | 24, 25 }, { QMetaType::QString, 26 },
        }}),
        // Slot 'onCaptureError'
        QtMocHelpers::SlotData<void(const QString &)>(27, 2, QMC::AccessPrivate, QMetaType::Void, {{
            { QMetaType::QString, 28 },
        }}),
        // Slot 'onRecognitionTimerTimeout'
        QtMocHelpers::SlotData<void()>(29, 2, QMC::AccessPrivate, QMetaType::Void),
        // Slot 'onDeviceManagerChanges'
        QtMocHelpers::SlotData<void(const QVector<AudioDeviceInfo> &, const AutoRouteInfo &)>(30, 2, QMC::AccessPrivate, QMetaType::Void, {{
            { 0x80000000 | 16, 17 }, { 0x80000000 | 18, 19 },
        }}),
    };
    QtMocHelpers::UintData qt_properties {
    };
    QtMocHelpers::UintData qt_enums {
    };
    return QtMocHelpers::metaObjectData<SongRecognitionService, qt_meta_tag_ZN22SongRecognitionServiceE_t>(QMC::MetaObjectFlag{}, qt_stringData,
            qt_methods, qt_properties, qt_enums);
}
Q_CONSTINIT const QMetaObject SongRecognitionService::staticMetaObject = { {
    QMetaObject::SuperData::link<QObject::staticMetaObject>(),
    qt_staticMetaObjectStaticContent<qt_meta_tag_ZN22SongRecognitionServiceE_t>.stringdata,
    qt_staticMetaObjectStaticContent<qt_meta_tag_ZN22SongRecognitionServiceE_t>.data,
    qt_static_metacall,
    nullptr,
    qt_staticMetaObjectRelocatingContent<qt_meta_tag_ZN22SongRecognitionServiceE_t>.metaTypes,
    nullptr
} };

void SongRecognitionService::qt_static_metacall(QObject *_o, QMetaObject::Call _c, int _id, void **_a)
{
    auto *_t = static_cast<SongRecognitionService *>(_o);
    if (_c == QMetaObject::InvokeMetaMethod) {
        switch (_id) {
        case 0: _t->stateChanged((*reinterpret_cast<std::add_pointer_t<enum State>>(_a[1])),(*reinterpret_cast<std::add_pointer_t<QString>>(_a[2]))); break;
        case 1: _t->songFound((*reinterpret_cast<std::add_pointer_t<SongResult>>(_a[1]))); break;
        case 2: _t->activeResultChanged((*reinterpret_cast<std::add_pointer_t<SongResult>>(_a[1])),(*reinterpret_cast<std::add_pointer_t<bool>>(_a[2]))); break;
        case 3: _t->volumeChanged((*reinterpret_cast<std::add_pointer_t<double>>(_a[1])),(*reinterpret_cast<std::add_pointer_t<double>>(_a[2])),(*reinterpret_cast<std::add_pointer_t<QString>>(_a[3]))); break;
        case 4: _t->devicesUpdated((*reinterpret_cast<std::add_pointer_t<QList<AudioDeviceInfo>>>(_a[1])),(*reinterpret_cast<std::add_pointer_t<AutoRouteInfo>>(_a[2]))); break;
        case 5: _t->autoOpenRequested((*reinterpret_cast<std::add_pointer_t<SongResult>>(_a[1])),(*reinterpret_cast<std::add_pointer_t<SongFinderSettings::OpenPlatform>>(_a[2]))); break;
        case 6: _t->onCaptureVolumeChanged((*reinterpret_cast<std::add_pointer_t<double>>(_a[1])),(*reinterpret_cast<std::add_pointer_t<double>>(_a[2])),(*reinterpret_cast<std::add_pointer_t<AudioCaptureService::ActiveSourceType>>(_a[3])),(*reinterpret_cast<std::add_pointer_t<QString>>(_a[4]))); break;
        case 7: _t->onCaptureError((*reinterpret_cast<std::add_pointer_t<QString>>(_a[1]))); break;
        case 8: _t->onRecognitionTimerTimeout(); break;
        case 9: _t->onDeviceManagerChanges((*reinterpret_cast<std::add_pointer_t<QList<AudioDeviceInfo>>>(_a[1])),(*reinterpret_cast<std::add_pointer_t<AutoRouteInfo>>(_a[2]))); break;
        default: ;
        }
    }
    if (_c == QMetaObject::IndexOfMethod) {
        if (QtMocHelpers::indexOfMethod<void (SongRecognitionService::*)(State , const QString & )>(_a, &SongRecognitionService::stateChanged, 0))
            return;
        if (QtMocHelpers::indexOfMethod<void (SongRecognitionService::*)(const SongResult & )>(_a, &SongRecognitionService::songFound, 1))
            return;
        if (QtMocHelpers::indexOfMethod<void (SongRecognitionService::*)(const SongResult & , bool )>(_a, &SongRecognitionService::activeResultChanged, 2))
            return;
        if (QtMocHelpers::indexOfMethod<void (SongRecognitionService::*)(double , double , const QString & )>(_a, &SongRecognitionService::volumeChanged, 3))
            return;
        if (QtMocHelpers::indexOfMethod<void (SongRecognitionService::*)(const QVector<AudioDeviceInfo> & , const AutoRouteInfo & )>(_a, &SongRecognitionService::devicesUpdated, 4))
            return;
        if (QtMocHelpers::indexOfMethod<void (SongRecognitionService::*)(const SongResult & , SongFinderSettings::OpenPlatform )>(_a, &SongRecognitionService::autoOpenRequested, 5))
            return;
    }
}

const QMetaObject *SongRecognitionService::metaObject() const
{
    return QObject::d_ptr->metaObject ? QObject::d_ptr->dynamicMetaObject() : &staticMetaObject;
}

void *SongRecognitionService::qt_metacast(const char *_clname)
{
    if (!_clname) return nullptr;
    if (!strcmp(_clname, qt_staticMetaObjectStaticContent<qt_meta_tag_ZN22SongRecognitionServiceE_t>.strings))
        return static_cast<void*>(this);
    return QObject::qt_metacast(_clname);
}

int SongRecognitionService::qt_metacall(QMetaObject::Call _c, int _id, void **_a)
{
    _id = QObject::qt_metacall(_c, _id, _a);
    if (_id < 0)
        return _id;
    if (_c == QMetaObject::InvokeMetaMethod) {
        if (_id < 10)
            qt_static_metacall(this, _c, _id, _a);
        _id -= 10;
    }
    if (_c == QMetaObject::RegisterMethodArgumentMetaType) {
        if (_id < 10)
            *reinterpret_cast<QMetaType *>(_a[0]) = QMetaType();
        _id -= 10;
    }
    return _id;
}

// SIGNAL 0
void SongRecognitionService::stateChanged(State _t1, const QString & _t2)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 0, nullptr, _t1, _t2);
}

// SIGNAL 1
void SongRecognitionService::songFound(const SongResult & _t1)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 1, nullptr, _t1);
}

// SIGNAL 2
void SongRecognitionService::activeResultChanged(const SongResult & _t1, bool _t2)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 2, nullptr, _t1, _t2);
}

// SIGNAL 3
void SongRecognitionService::volumeChanged(double _t1, double _t2, const QString & _t3)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 3, nullptr, _t1, _t2, _t3);
}

// SIGNAL 4
void SongRecognitionService::devicesUpdated(const QVector<AudioDeviceInfo> & _t1, const AutoRouteInfo & _t2)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 4, nullptr, _t1, _t2);
}

// SIGNAL 5
void SongRecognitionService::autoOpenRequested(const SongResult & _t1, SongFinderSettings::OpenPlatform _t2)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 5, nullptr, _t1, _t2);
}
QT_WARNING_POP
