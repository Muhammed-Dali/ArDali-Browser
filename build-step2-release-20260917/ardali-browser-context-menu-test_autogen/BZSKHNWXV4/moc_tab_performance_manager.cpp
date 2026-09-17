/****************************************************************************
** Meta object code from reading C++ file 'tab_performance_manager.h'
**
** Created by: The Qt Meta Object Compiler version 69 (Qt 6.11.2)
**
** WARNING! All changes made in this file will be lost!
*****************************************************************************/

#include "../../../browser/native/desktop_tabs/tab_performance_manager.h"
#include <QtCore/qmetatype.h>

#include <QtCore/qtmochelpers.h>

#include <memory>


#include <QtCore/qxptype_traits.h>
#if !defined(Q_MOC_OUTPUT_REVISION)
#error "The header file 'tab_performance_manager.h' doesn't include <QObject>."
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
struct qt_meta_tag_ZN6ardali21TabPerformanceManagerE_t {};
} // unnamed namespace

template <> constexpr inline auto ardali::TabPerformanceManager::qt_create_metaobjectdata<qt_meta_tag_ZN6ardali21TabPerformanceManagerE_t>()
{
    namespace QMC = QtMocConstants;
    QtMocHelpers::StringRefStorage qt_stringData {
        "ardali::TabPerformanceManager",
        "tabMetadataChanged",
        "",
        "TabManager::TabId",
        "id",
        "ardali::TabPerformanceMetadata",
        "metadata",
        "tabProtectionChanged",
        "isProtected",
        "ardali::ProtectedReasons",
        "reasons",
        "tabRecentlyAudibleChanged",
        "audible",
        "tabRecommendedStateChanged",
        "QWebEnginePage::LifecycleState",
        "state",
        "tabLifecycleStateChanged",
        "tabFrozen",
        "tabResumed",
        "tabDiscarded",
        "tabRestored",
        "tabFormDirtyChanged",
        "dirty",
        "siteAllowlistChanged",
        "patterns",
        "policyModeChanged",
        "ardali::PerformancePolicyMode",
        "mode",
        "discardEnabledChanged",
        "enabled",
        "onTabRegistered",
        "TabManager::TabKind",
        "kind",
        "onTabActivated",
        "onTabTransferred",
        "newOwner",
        "detached",
        "onTabRemoved",
        "onTabUrlChanged",
        "QUrl",
        "url",
        "onPageRecentlyAudibleChanged",
        "onPageRecommendedStateChanged",
        "onPageLifecycleStateChanged",
        "onPageLoadStarted",
        "onPageLoadFinished",
        "ok",
        "onPageUrlChanged",
        "onDeadlineTimeout"
    };

    QtMocHelpers::UintData qt_methods {
        // Signal 'tabMetadataChanged'
        QtMocHelpers::SignalData<void(TabManager::TabId, const ardali::TabPerformanceMetadata &)>(1, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 3, 4 }, { 0x80000000 | 5, 6 },
        }}),
        // Signal 'tabProtectionChanged'
        QtMocHelpers::SignalData<void(TabManager::TabId, bool, ardali::ProtectedReasons)>(7, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 3, 4 }, { QMetaType::Bool, 8 }, { 0x80000000 | 9, 10 },
        }}),
        // Signal 'tabRecentlyAudibleChanged'
        QtMocHelpers::SignalData<void(TabManager::TabId, bool)>(11, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 3, 4 }, { QMetaType::Bool, 12 },
        }}),
        // Signal 'tabRecommendedStateChanged'
        QtMocHelpers::SignalData<void(TabManager::TabId, QWebEnginePage::LifecycleState)>(13, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 3, 4 }, { 0x80000000 | 14, 15 },
        }}),
        // Signal 'tabLifecycleStateChanged'
        QtMocHelpers::SignalData<void(TabManager::TabId, QWebEnginePage::LifecycleState)>(16, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 3, 4 }, { 0x80000000 | 14, 15 },
        }}),
        // Signal 'tabFrozen'
        QtMocHelpers::SignalData<void(TabManager::TabId)>(17, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 3, 4 },
        }}),
        // Signal 'tabResumed'
        QtMocHelpers::SignalData<void(TabManager::TabId)>(18, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 3, 4 },
        }}),
        // Signal 'tabDiscarded'
        QtMocHelpers::SignalData<void(TabManager::TabId)>(19, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 3, 4 },
        }}),
        // Signal 'tabRestored'
        QtMocHelpers::SignalData<void(TabManager::TabId)>(20, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 3, 4 },
        }}),
        // Signal 'tabFormDirtyChanged'
        QtMocHelpers::SignalData<void(TabManager::TabId, bool)>(21, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 3, 4 }, { QMetaType::Bool, 22 },
        }}),
        // Signal 'siteAllowlistChanged'
        QtMocHelpers::SignalData<void(const QStringList &)>(23, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::QStringList, 24 },
        }}),
        // Signal 'policyModeChanged'
        QtMocHelpers::SignalData<void(ardali::PerformancePolicyMode)>(25, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 26, 27 },
        }}),
        // Signal 'discardEnabledChanged'
        QtMocHelpers::SignalData<void(bool)>(28, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::Bool, 29 },
        }}),
        // Slot 'onTabRegistered'
        QtMocHelpers::SlotData<void(TabManager::TabId, TabManager::TabKind)>(30, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 3, 4 }, { 0x80000000 | 31, 32 },
        }}),
        // Slot 'onTabActivated'
        QtMocHelpers::SlotData<void(TabManager::TabId)>(33, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 3, 4 },
        }}),
        // Slot 'onTabTransferred'
        QtMocHelpers::SlotData<void(TabManager::TabId, QObject *, bool)>(34, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 3, 4 }, { QMetaType::QObjectStar, 35 }, { QMetaType::Bool, 36 },
        }}),
        // Slot 'onTabRemoved'
        QtMocHelpers::SlotData<void(TabManager::TabId)>(37, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 3, 4 },
        }}),
        // Slot 'onTabUrlChanged'
        QtMocHelpers::SlotData<void(TabManager::TabId, const QUrl &)>(38, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 3, 4 }, { 0x80000000 | 39, 40 },
        }}),
        // Slot 'onPageRecentlyAudibleChanged'
        QtMocHelpers::SlotData<void(bool)>(41, 2, QMC::AccessPrivate, QMetaType::Void, {{
            { QMetaType::Bool, 12 },
        }}),
        // Slot 'onPageRecommendedStateChanged'
        QtMocHelpers::SlotData<void(QWebEnginePage::LifecycleState)>(42, 2, QMC::AccessPrivate, QMetaType::Void, {{
            { 0x80000000 | 14, 15 },
        }}),
        // Slot 'onPageLifecycleStateChanged'
        QtMocHelpers::SlotData<void(QWebEnginePage::LifecycleState)>(43, 2, QMC::AccessPrivate, QMetaType::Void, {{
            { 0x80000000 | 14, 15 },
        }}),
        // Slot 'onPageLoadStarted'
        QtMocHelpers::SlotData<void()>(44, 2, QMC::AccessPrivate, QMetaType::Void),
        // Slot 'onPageLoadFinished'
        QtMocHelpers::SlotData<void(bool)>(45, 2, QMC::AccessPrivate, QMetaType::Void, {{
            { QMetaType::Bool, 46 },
        }}),
        // Slot 'onPageUrlChanged'
        QtMocHelpers::SlotData<void(const QUrl &)>(47, 2, QMC::AccessPrivate, QMetaType::Void, {{
            { 0x80000000 | 39, 40 },
        }}),
        // Slot 'onDeadlineTimeout'
        QtMocHelpers::SlotData<void()>(48, 2, QMC::AccessPrivate, QMetaType::Void),
    };
    QtMocHelpers::UintData qt_properties {
    };
    QtMocHelpers::UintData qt_enums {
    };
    return QtMocHelpers::metaObjectData<TabPerformanceManager, qt_meta_tag_ZN6ardali21TabPerformanceManagerE_t>(QMC::MetaObjectFlag{}, qt_stringData,
            qt_methods, qt_properties, qt_enums);
}
Q_CONSTINIT const QMetaObject ardali::TabPerformanceManager::staticMetaObject = { {
    QMetaObject::SuperData::link<QObject::staticMetaObject>(),
    qt_staticMetaObjectStaticContent<qt_meta_tag_ZN6ardali21TabPerformanceManagerE_t>.stringdata,
    qt_staticMetaObjectStaticContent<qt_meta_tag_ZN6ardali21TabPerformanceManagerE_t>.data,
    qt_static_metacall,
    nullptr,
    qt_staticMetaObjectRelocatingContent<qt_meta_tag_ZN6ardali21TabPerformanceManagerE_t>.metaTypes,
    nullptr
} };

void ardali::TabPerformanceManager::qt_static_metacall(QObject *_o, QMetaObject::Call _c, int _id, void **_a)
{
    auto *_t = static_cast<TabPerformanceManager *>(_o);
    if (_c == QMetaObject::InvokeMetaMethod) {
        switch (_id) {
        case 0: _t->tabMetadataChanged((*reinterpret_cast<std::add_pointer_t<TabManager::TabId>>(_a[1])),(*reinterpret_cast<std::add_pointer_t<ardali::TabPerformanceMetadata>>(_a[2]))); break;
        case 1: _t->tabProtectionChanged((*reinterpret_cast<std::add_pointer_t<TabManager::TabId>>(_a[1])),(*reinterpret_cast<std::add_pointer_t<bool>>(_a[2])),(*reinterpret_cast<std::add_pointer_t<ardali::ProtectedReasons>>(_a[3]))); break;
        case 2: _t->tabRecentlyAudibleChanged((*reinterpret_cast<std::add_pointer_t<TabManager::TabId>>(_a[1])),(*reinterpret_cast<std::add_pointer_t<bool>>(_a[2]))); break;
        case 3: _t->tabRecommendedStateChanged((*reinterpret_cast<std::add_pointer_t<TabManager::TabId>>(_a[1])),(*reinterpret_cast<std::add_pointer_t<QWebEnginePage::LifecycleState>>(_a[2]))); break;
        case 4: _t->tabLifecycleStateChanged((*reinterpret_cast<std::add_pointer_t<TabManager::TabId>>(_a[1])),(*reinterpret_cast<std::add_pointer_t<QWebEnginePage::LifecycleState>>(_a[2]))); break;
        case 5: _t->tabFrozen((*reinterpret_cast<std::add_pointer_t<TabManager::TabId>>(_a[1]))); break;
        case 6: _t->tabResumed((*reinterpret_cast<std::add_pointer_t<TabManager::TabId>>(_a[1]))); break;
        case 7: _t->tabDiscarded((*reinterpret_cast<std::add_pointer_t<TabManager::TabId>>(_a[1]))); break;
        case 8: _t->tabRestored((*reinterpret_cast<std::add_pointer_t<TabManager::TabId>>(_a[1]))); break;
        case 9: _t->tabFormDirtyChanged((*reinterpret_cast<std::add_pointer_t<TabManager::TabId>>(_a[1])),(*reinterpret_cast<std::add_pointer_t<bool>>(_a[2]))); break;
        case 10: _t->siteAllowlistChanged((*reinterpret_cast<std::add_pointer_t<QStringList>>(_a[1]))); break;
        case 11: _t->policyModeChanged((*reinterpret_cast<std::add_pointer_t<ardali::PerformancePolicyMode>>(_a[1]))); break;
        case 12: _t->discardEnabledChanged((*reinterpret_cast<std::add_pointer_t<bool>>(_a[1]))); break;
        case 13: _t->onTabRegistered((*reinterpret_cast<std::add_pointer_t<TabManager::TabId>>(_a[1])),(*reinterpret_cast<std::add_pointer_t<TabManager::TabKind>>(_a[2]))); break;
        case 14: _t->onTabActivated((*reinterpret_cast<std::add_pointer_t<TabManager::TabId>>(_a[1]))); break;
        case 15: _t->onTabTransferred((*reinterpret_cast<std::add_pointer_t<TabManager::TabId>>(_a[1])),(*reinterpret_cast<std::add_pointer_t<QObject*>>(_a[2])),(*reinterpret_cast<std::add_pointer_t<bool>>(_a[3]))); break;
        case 16: _t->onTabRemoved((*reinterpret_cast<std::add_pointer_t<TabManager::TabId>>(_a[1]))); break;
        case 17: _t->onTabUrlChanged((*reinterpret_cast<std::add_pointer_t<TabManager::TabId>>(_a[1])),(*reinterpret_cast<std::add_pointer_t<QUrl>>(_a[2]))); break;
        case 18: _t->onPageRecentlyAudibleChanged((*reinterpret_cast<std::add_pointer_t<bool>>(_a[1]))); break;
        case 19: _t->onPageRecommendedStateChanged((*reinterpret_cast<std::add_pointer_t<QWebEnginePage::LifecycleState>>(_a[1]))); break;
        case 20: _t->onPageLifecycleStateChanged((*reinterpret_cast<std::add_pointer_t<QWebEnginePage::LifecycleState>>(_a[1]))); break;
        case 21: _t->onPageLoadStarted(); break;
        case 22: _t->onPageLoadFinished((*reinterpret_cast<std::add_pointer_t<bool>>(_a[1]))); break;
        case 23: _t->onPageUrlChanged((*reinterpret_cast<std::add_pointer_t<QUrl>>(_a[1]))); break;
        case 24: _t->onDeadlineTimeout(); break;
        default: ;
        }
    }
    if (_c == QMetaObject::IndexOfMethod) {
        if (QtMocHelpers::indexOfMethod<void (TabPerformanceManager::*)(TabManager::TabId , const ardali::TabPerformanceMetadata & )>(_a, &TabPerformanceManager::tabMetadataChanged, 0))
            return;
        if (QtMocHelpers::indexOfMethod<void (TabPerformanceManager::*)(TabManager::TabId , bool , ardali::ProtectedReasons )>(_a, &TabPerformanceManager::tabProtectionChanged, 1))
            return;
        if (QtMocHelpers::indexOfMethod<void (TabPerformanceManager::*)(TabManager::TabId , bool )>(_a, &TabPerformanceManager::tabRecentlyAudibleChanged, 2))
            return;
        if (QtMocHelpers::indexOfMethod<void (TabPerformanceManager::*)(TabManager::TabId , QWebEnginePage::LifecycleState )>(_a, &TabPerformanceManager::tabRecommendedStateChanged, 3))
            return;
        if (QtMocHelpers::indexOfMethod<void (TabPerformanceManager::*)(TabManager::TabId , QWebEnginePage::LifecycleState )>(_a, &TabPerformanceManager::tabLifecycleStateChanged, 4))
            return;
        if (QtMocHelpers::indexOfMethod<void (TabPerformanceManager::*)(TabManager::TabId )>(_a, &TabPerformanceManager::tabFrozen, 5))
            return;
        if (QtMocHelpers::indexOfMethod<void (TabPerformanceManager::*)(TabManager::TabId )>(_a, &TabPerformanceManager::tabResumed, 6))
            return;
        if (QtMocHelpers::indexOfMethod<void (TabPerformanceManager::*)(TabManager::TabId )>(_a, &TabPerformanceManager::tabDiscarded, 7))
            return;
        if (QtMocHelpers::indexOfMethod<void (TabPerformanceManager::*)(TabManager::TabId )>(_a, &TabPerformanceManager::tabRestored, 8))
            return;
        if (QtMocHelpers::indexOfMethod<void (TabPerformanceManager::*)(TabManager::TabId , bool )>(_a, &TabPerformanceManager::tabFormDirtyChanged, 9))
            return;
        if (QtMocHelpers::indexOfMethod<void (TabPerformanceManager::*)(const QStringList & )>(_a, &TabPerformanceManager::siteAllowlistChanged, 10))
            return;
        if (QtMocHelpers::indexOfMethod<void (TabPerformanceManager::*)(ardali::PerformancePolicyMode )>(_a, &TabPerformanceManager::policyModeChanged, 11))
            return;
        if (QtMocHelpers::indexOfMethod<void (TabPerformanceManager::*)(bool )>(_a, &TabPerformanceManager::discardEnabledChanged, 12))
            return;
    }
}

const QMetaObject *ardali::TabPerformanceManager::metaObject() const
{
    return QObject::d_ptr->metaObject ? QObject::d_ptr->dynamicMetaObject() : &staticMetaObject;
}

void *ardali::TabPerformanceManager::qt_metacast(const char *_clname)
{
    if (!_clname) return nullptr;
    if (!strcmp(_clname, qt_staticMetaObjectStaticContent<qt_meta_tag_ZN6ardali21TabPerformanceManagerE_t>.strings))
        return static_cast<void*>(this);
    return QObject::qt_metacast(_clname);
}

int ardali::TabPerformanceManager::qt_metacall(QMetaObject::Call _c, int _id, void **_a)
{
    _id = QObject::qt_metacall(_c, _id, _a);
    if (_id < 0)
        return _id;
    if (_c == QMetaObject::InvokeMetaMethod) {
        if (_id < 25)
            qt_static_metacall(this, _c, _id, _a);
        _id -= 25;
    }
    if (_c == QMetaObject::RegisterMethodArgumentMetaType) {
        if (_id < 25)
            *reinterpret_cast<QMetaType *>(_a[0]) = QMetaType();
        _id -= 25;
    }
    return _id;
}

// SIGNAL 0
void ardali::TabPerformanceManager::tabMetadataChanged(TabManager::TabId _t1, const ardali::TabPerformanceMetadata & _t2)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 0, nullptr, _t1, _t2);
}

// SIGNAL 1
void ardali::TabPerformanceManager::tabProtectionChanged(TabManager::TabId _t1, bool _t2, ardali::ProtectedReasons _t3)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 1, nullptr, _t1, _t2, _t3);
}

// SIGNAL 2
void ardali::TabPerformanceManager::tabRecentlyAudibleChanged(TabManager::TabId _t1, bool _t2)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 2, nullptr, _t1, _t2);
}

// SIGNAL 3
void ardali::TabPerformanceManager::tabRecommendedStateChanged(TabManager::TabId _t1, QWebEnginePage::LifecycleState _t2)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 3, nullptr, _t1, _t2);
}

// SIGNAL 4
void ardali::TabPerformanceManager::tabLifecycleStateChanged(TabManager::TabId _t1, QWebEnginePage::LifecycleState _t2)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 4, nullptr, _t1, _t2);
}

// SIGNAL 5
void ardali::TabPerformanceManager::tabFrozen(TabManager::TabId _t1)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 5, nullptr, _t1);
}

// SIGNAL 6
void ardali::TabPerformanceManager::tabResumed(TabManager::TabId _t1)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 6, nullptr, _t1);
}

// SIGNAL 7
void ardali::TabPerformanceManager::tabDiscarded(TabManager::TabId _t1)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 7, nullptr, _t1);
}

// SIGNAL 8
void ardali::TabPerformanceManager::tabRestored(TabManager::TabId _t1)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 8, nullptr, _t1);
}

// SIGNAL 9
void ardali::TabPerformanceManager::tabFormDirtyChanged(TabManager::TabId _t1, bool _t2)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 9, nullptr, _t1, _t2);
}

// SIGNAL 10
void ardali::TabPerformanceManager::siteAllowlistChanged(const QStringList & _t1)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 10, nullptr, _t1);
}

// SIGNAL 11
void ardali::TabPerformanceManager::policyModeChanged(ardali::PerformancePolicyMode _t1)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 11, nullptr, _t1);
}

// SIGNAL 12
void ardali::TabPerformanceManager::discardEnabledChanged(bool _t1)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 12, nullptr, _t1);
}
QT_WARNING_POP
