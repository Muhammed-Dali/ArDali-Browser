/****************************************************************************
** Meta object code from reading C++ file 'ardali_blocker_service.h'
**
** Created by: The Qt Meta Object Compiler version 69 (Qt 6.11.2)
**
** WARNING! All changes made in this file will be lost!
*****************************************************************************/

#include "../../../browser/native/blocker/ardali_blocker_service.h"
#include <QtCore/qmetatype.h>

#include <QtCore/qtmochelpers.h>

#include <memory>


#include <QtCore/qxptype_traits.h>
#if !defined(Q_MOC_OUTPUT_REVISION)
#error "The header file 'ardali_blocker_service.h' doesn't include <QObject>."
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
struct qt_meta_tag_ZN20ArDaliBlockerServiceE_t {};
} // unnamed namespace

template <> constexpr inline auto ArDaliBlockerService::qt_create_metaobjectdata<qt_meta_tag_ZN20ArDaliBlockerServiceE_t>()
{
    namespace QMC = QtMocConstants;
    QtMocHelpers::StringRefStorage qt_stringData {
        "ArDaliBlockerService",
        "siteClosed",
        "",
        "host",
        "siteOpened",
        "tabStatsChanged",
        "tabId",
        "TabBlockerStats",
        "stats",
        "globalStatsChanged",
        "sessionBlocked",
        "totalBlocked",
        "requestLogged",
        "NetworkLogEntry",
        "entry",
        "autoReloadRequested",
        "filterUpdateStarted",
        "filterUpdateProgress",
        "completed",
        "total",
        "stage",
        "filterUpdateFinished",
        "success",
        "message"
    };

    QtMocHelpers::UintData qt_methods {
        // Signal 'siteClosed'
        QtMocHelpers::SignalData<void(const QString &)>(1, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::QString, 3 },
        }}),
        // Signal 'siteOpened'
        QtMocHelpers::SignalData<void(const QString &)>(4, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::QString, 3 },
        }}),
        // Signal 'tabStatsChanged'
        QtMocHelpers::SignalData<void(quint64, const TabBlockerStats &)>(5, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::ULongLong, 6 }, { 0x80000000 | 7, 8 },
        }}),
        // Signal 'globalStatsChanged'
        QtMocHelpers::SignalData<void(quint64, quint64)>(9, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::ULongLong, 10 }, { QMetaType::ULongLong, 11 },
        }}),
        // Signal 'requestLogged'
        QtMocHelpers::SignalData<void(const NetworkLogEntry &)>(12, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 13, 14 },
        }}),
        // Signal 'autoReloadRequested'
        QtMocHelpers::SignalData<void()>(15, 2, QMC::AccessPublic, QMetaType::Void),
        // Signal 'filterUpdateStarted'
        QtMocHelpers::SignalData<void()>(16, 2, QMC::AccessPublic, QMetaType::Void),
        // Signal 'filterUpdateProgress'
        QtMocHelpers::SignalData<void(int, int, const QString &)>(17, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::Int, 18 }, { QMetaType::Int, 19 }, { QMetaType::QString, 20 },
        }}),
        // Signal 'filterUpdateFinished'
        QtMocHelpers::SignalData<void(bool, const QString &)>(21, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::Bool, 22 }, { QMetaType::QString, 23 },
        }}),
    };
    QtMocHelpers::UintData qt_properties {
    };
    QtMocHelpers::UintData qt_enums {
    };
    return QtMocHelpers::metaObjectData<ArDaliBlockerService, qt_meta_tag_ZN20ArDaliBlockerServiceE_t>(QMC::MetaObjectFlag{}, qt_stringData,
            qt_methods, qt_properties, qt_enums);
}
Q_CONSTINIT const QMetaObject ArDaliBlockerService::staticMetaObject = { {
    QMetaObject::SuperData::link<QObject::staticMetaObject>(),
    qt_staticMetaObjectStaticContent<qt_meta_tag_ZN20ArDaliBlockerServiceE_t>.stringdata,
    qt_staticMetaObjectStaticContent<qt_meta_tag_ZN20ArDaliBlockerServiceE_t>.data,
    qt_static_metacall,
    nullptr,
    qt_staticMetaObjectRelocatingContent<qt_meta_tag_ZN20ArDaliBlockerServiceE_t>.metaTypes,
    nullptr
} };

void ArDaliBlockerService::qt_static_metacall(QObject *_o, QMetaObject::Call _c, int _id, void **_a)
{
    auto *_t = static_cast<ArDaliBlockerService *>(_o);
    if (_c == QMetaObject::InvokeMetaMethod) {
        switch (_id) {
        case 0: _t->siteClosed((*reinterpret_cast<std::add_pointer_t<QString>>(_a[1]))); break;
        case 1: _t->siteOpened((*reinterpret_cast<std::add_pointer_t<QString>>(_a[1]))); break;
        case 2: _t->tabStatsChanged((*reinterpret_cast<std::add_pointer_t<quint64>>(_a[1])),(*reinterpret_cast<std::add_pointer_t<TabBlockerStats>>(_a[2]))); break;
        case 3: _t->globalStatsChanged((*reinterpret_cast<std::add_pointer_t<quint64>>(_a[1])),(*reinterpret_cast<std::add_pointer_t<quint64>>(_a[2]))); break;
        case 4: _t->requestLogged((*reinterpret_cast<std::add_pointer_t<NetworkLogEntry>>(_a[1]))); break;
        case 5: _t->autoReloadRequested(); break;
        case 6: _t->filterUpdateStarted(); break;
        case 7: _t->filterUpdateProgress((*reinterpret_cast<std::add_pointer_t<int>>(_a[1])),(*reinterpret_cast<std::add_pointer_t<int>>(_a[2])),(*reinterpret_cast<std::add_pointer_t<QString>>(_a[3]))); break;
        case 8: _t->filterUpdateFinished((*reinterpret_cast<std::add_pointer_t<bool>>(_a[1])),(*reinterpret_cast<std::add_pointer_t<QString>>(_a[2]))); break;
        default: ;
        }
    }
    if (_c == QMetaObject::IndexOfMethod) {
        if (QtMocHelpers::indexOfMethod<void (ArDaliBlockerService::*)(const QString & )>(_a, &ArDaliBlockerService::siteClosed, 0))
            return;
        if (QtMocHelpers::indexOfMethod<void (ArDaliBlockerService::*)(const QString & )>(_a, &ArDaliBlockerService::siteOpened, 1))
            return;
        if (QtMocHelpers::indexOfMethod<void (ArDaliBlockerService::*)(quint64 , const TabBlockerStats & )>(_a, &ArDaliBlockerService::tabStatsChanged, 2))
            return;
        if (QtMocHelpers::indexOfMethod<void (ArDaliBlockerService::*)(quint64 , quint64 )>(_a, &ArDaliBlockerService::globalStatsChanged, 3))
            return;
        if (QtMocHelpers::indexOfMethod<void (ArDaliBlockerService::*)(const NetworkLogEntry & )>(_a, &ArDaliBlockerService::requestLogged, 4))
            return;
        if (QtMocHelpers::indexOfMethod<void (ArDaliBlockerService::*)()>(_a, &ArDaliBlockerService::autoReloadRequested, 5))
            return;
        if (QtMocHelpers::indexOfMethod<void (ArDaliBlockerService::*)()>(_a, &ArDaliBlockerService::filterUpdateStarted, 6))
            return;
        if (QtMocHelpers::indexOfMethod<void (ArDaliBlockerService::*)(int , int , const QString & )>(_a, &ArDaliBlockerService::filterUpdateProgress, 7))
            return;
        if (QtMocHelpers::indexOfMethod<void (ArDaliBlockerService::*)(bool , const QString & )>(_a, &ArDaliBlockerService::filterUpdateFinished, 8))
            return;
    }
}

const QMetaObject *ArDaliBlockerService::metaObject() const
{
    return QObject::d_ptr->metaObject ? QObject::d_ptr->dynamicMetaObject() : &staticMetaObject;
}

void *ArDaliBlockerService::qt_metacast(const char *_clname)
{
    if (!_clname) return nullptr;
    if (!strcmp(_clname, qt_staticMetaObjectStaticContent<qt_meta_tag_ZN20ArDaliBlockerServiceE_t>.strings))
        return static_cast<void*>(this);
    return QObject::qt_metacast(_clname);
}

int ArDaliBlockerService::qt_metacall(QMetaObject::Call _c, int _id, void **_a)
{
    _id = QObject::qt_metacall(_c, _id, _a);
    if (_id < 0)
        return _id;
    if (_c == QMetaObject::InvokeMetaMethod) {
        if (_id < 9)
            qt_static_metacall(this, _c, _id, _a);
        _id -= 9;
    }
    if (_c == QMetaObject::RegisterMethodArgumentMetaType) {
        if (_id < 9)
            *reinterpret_cast<QMetaType *>(_a[0]) = QMetaType();
        _id -= 9;
    }
    return _id;
}

// SIGNAL 0
void ArDaliBlockerService::siteClosed(const QString & _t1)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 0, nullptr, _t1);
}

// SIGNAL 1
void ArDaliBlockerService::siteOpened(const QString & _t1)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 1, nullptr, _t1);
}

// SIGNAL 2
void ArDaliBlockerService::tabStatsChanged(quint64 _t1, const TabBlockerStats & _t2)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 2, nullptr, _t1, _t2);
}

// SIGNAL 3
void ArDaliBlockerService::globalStatsChanged(quint64 _t1, quint64 _t2)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 3, nullptr, _t1, _t2);
}

// SIGNAL 4
void ArDaliBlockerService::requestLogged(const NetworkLogEntry & _t1)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 4, nullptr, _t1);
}

// SIGNAL 5
void ArDaliBlockerService::autoReloadRequested()
{
    QMetaObject::activate(this, &staticMetaObject, 5, nullptr);
}

// SIGNAL 6
void ArDaliBlockerService::filterUpdateStarted()
{
    QMetaObject::activate(this, &staticMetaObject, 6, nullptr);
}

// SIGNAL 7
void ArDaliBlockerService::filterUpdateProgress(int _t1, int _t2, const QString & _t3)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 7, nullptr, _t1, _t2, _t3);
}

// SIGNAL 8
void ArDaliBlockerService::filterUpdateFinished(bool _t1, const QString & _t2)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 8, nullptr, _t1, _t2);
}
QT_WARNING_POP
