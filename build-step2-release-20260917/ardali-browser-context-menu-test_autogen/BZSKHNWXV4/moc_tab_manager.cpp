/****************************************************************************
** Meta object code from reading C++ file 'tab_manager.h'
**
** Created by: The Qt Meta Object Compiler version 69 (Qt 6.11.2)
**
** WARNING! All changes made in this file will be lost!
*****************************************************************************/

#include "../../../browser/native/desktop_tabs/tab_manager.h"
#include <QtCore/qmetatype.h>

#include <QtCore/qtmochelpers.h>

#include <memory>


#include <QtCore/qxptype_traits.h>
#if !defined(Q_MOC_OUTPUT_REVISION)
#error "The header file 'tab_manager.h' doesn't include <QObject>."
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
struct qt_meta_tag_ZN10TabManagerE_t {};
} // unnamed namespace

template <> constexpr inline auto TabManager::qt_create_metaobjectdata<qt_meta_tag_ZN10TabManagerE_t>()
{
    namespace QMC = QtMocConstants;
    QtMocHelpers::StringRefStorage qt_stringData {
        "TabManager",
        "tabRegistered",
        "",
        "TabManager::TabId",
        "id",
        "TabManager::TabKind",
        "kind",
        "tabActivated",
        "tabTransferred",
        "newOwner",
        "detached",
        "tabRemoved",
        "tabUrlChanged",
        "QUrl",
        "url",
        "tabRecentlyAudibleChanged",
        "audible"
    };

    QtMocHelpers::UintData qt_methods {
        // Signal 'tabRegistered'
        QtMocHelpers::SignalData<void(TabManager::TabId, TabManager::TabKind)>(1, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 3, 4 }, { 0x80000000 | 5, 6 },
        }}),
        // Signal 'tabActivated'
        QtMocHelpers::SignalData<void(TabManager::TabId)>(7, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 3, 4 },
        }}),
        // Signal 'tabTransferred'
        QtMocHelpers::SignalData<void(TabManager::TabId, QObject *, bool)>(8, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 3, 4 }, { QMetaType::QObjectStar, 9 }, { QMetaType::Bool, 10 },
        }}),
        // Signal 'tabRemoved'
        QtMocHelpers::SignalData<void(TabManager::TabId)>(11, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 3, 4 },
        }}),
        // Signal 'tabUrlChanged'
        QtMocHelpers::SignalData<void(TabManager::TabId, const QUrl &)>(12, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 3, 4 }, { 0x80000000 | 13, 14 },
        }}),
        // Signal 'tabRecentlyAudibleChanged'
        QtMocHelpers::SignalData<void(TabManager::TabId, bool)>(15, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 3, 4 }, { QMetaType::Bool, 16 },
        }}),
    };
    QtMocHelpers::UintData qt_properties {
    };
    QtMocHelpers::UintData qt_enums {
    };
    return QtMocHelpers::metaObjectData<TabManager, qt_meta_tag_ZN10TabManagerE_t>(QMC::MetaObjectFlag{}, qt_stringData,
            qt_methods, qt_properties, qt_enums);
}
Q_CONSTINIT const QMetaObject TabManager::staticMetaObject = { {
    QMetaObject::SuperData::link<QObject::staticMetaObject>(),
    qt_staticMetaObjectStaticContent<qt_meta_tag_ZN10TabManagerE_t>.stringdata,
    qt_staticMetaObjectStaticContent<qt_meta_tag_ZN10TabManagerE_t>.data,
    qt_static_metacall,
    nullptr,
    qt_staticMetaObjectRelocatingContent<qt_meta_tag_ZN10TabManagerE_t>.metaTypes,
    nullptr
} };

void TabManager::qt_static_metacall(QObject *_o, QMetaObject::Call _c, int _id, void **_a)
{
    auto *_t = static_cast<TabManager *>(_o);
    if (_c == QMetaObject::InvokeMetaMethod) {
        switch (_id) {
        case 0: _t->tabRegistered((*reinterpret_cast<std::add_pointer_t<TabManager::TabId>>(_a[1])),(*reinterpret_cast<std::add_pointer_t<TabManager::TabKind>>(_a[2]))); break;
        case 1: _t->tabActivated((*reinterpret_cast<std::add_pointer_t<TabManager::TabId>>(_a[1]))); break;
        case 2: _t->tabTransferred((*reinterpret_cast<std::add_pointer_t<TabManager::TabId>>(_a[1])),(*reinterpret_cast<std::add_pointer_t<QObject*>>(_a[2])),(*reinterpret_cast<std::add_pointer_t<bool>>(_a[3]))); break;
        case 3: _t->tabRemoved((*reinterpret_cast<std::add_pointer_t<TabManager::TabId>>(_a[1]))); break;
        case 4: _t->tabUrlChanged((*reinterpret_cast<std::add_pointer_t<TabManager::TabId>>(_a[1])),(*reinterpret_cast<std::add_pointer_t<QUrl>>(_a[2]))); break;
        case 5: _t->tabRecentlyAudibleChanged((*reinterpret_cast<std::add_pointer_t<TabManager::TabId>>(_a[1])),(*reinterpret_cast<std::add_pointer_t<bool>>(_a[2]))); break;
        default: ;
        }
    }
    if (_c == QMetaObject::IndexOfMethod) {
        if (QtMocHelpers::indexOfMethod<void (TabManager::*)(TabManager::TabId , TabManager::TabKind )>(_a, &TabManager::tabRegistered, 0))
            return;
        if (QtMocHelpers::indexOfMethod<void (TabManager::*)(TabManager::TabId )>(_a, &TabManager::tabActivated, 1))
            return;
        if (QtMocHelpers::indexOfMethod<void (TabManager::*)(TabManager::TabId , QObject * , bool )>(_a, &TabManager::tabTransferred, 2))
            return;
        if (QtMocHelpers::indexOfMethod<void (TabManager::*)(TabManager::TabId )>(_a, &TabManager::tabRemoved, 3))
            return;
        if (QtMocHelpers::indexOfMethod<void (TabManager::*)(TabManager::TabId , const QUrl & )>(_a, &TabManager::tabUrlChanged, 4))
            return;
        if (QtMocHelpers::indexOfMethod<void (TabManager::*)(TabManager::TabId , bool )>(_a, &TabManager::tabRecentlyAudibleChanged, 5))
            return;
    }
}

const QMetaObject *TabManager::metaObject() const
{
    return QObject::d_ptr->metaObject ? QObject::d_ptr->dynamicMetaObject() : &staticMetaObject;
}

void *TabManager::qt_metacast(const char *_clname)
{
    if (!_clname) return nullptr;
    if (!strcmp(_clname, qt_staticMetaObjectStaticContent<qt_meta_tag_ZN10TabManagerE_t>.strings))
        return static_cast<void*>(this);
    return QObject::qt_metacast(_clname);
}

int TabManager::qt_metacall(QMetaObject::Call _c, int _id, void **_a)
{
    _id = QObject::qt_metacall(_c, _id, _a);
    if (_id < 0)
        return _id;
    if (_c == QMetaObject::InvokeMetaMethod) {
        if (_id < 6)
            qt_static_metacall(this, _c, _id, _a);
        _id -= 6;
    }
    if (_c == QMetaObject::RegisterMethodArgumentMetaType) {
        if (_id < 6)
            *reinterpret_cast<QMetaType *>(_a[0]) = QMetaType();
        _id -= 6;
    }
    return _id;
}

// SIGNAL 0
void TabManager::tabRegistered(TabManager::TabId _t1, TabManager::TabKind _t2)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 0, nullptr, _t1, _t2);
}

// SIGNAL 1
void TabManager::tabActivated(TabManager::TabId _t1)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 1, nullptr, _t1);
}

// SIGNAL 2
void TabManager::tabTransferred(TabManager::TabId _t1, QObject * _t2, bool _t3)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 2, nullptr, _t1, _t2, _t3);
}

// SIGNAL 3
void TabManager::tabRemoved(TabManager::TabId _t1)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 3, nullptr, _t1);
}

// SIGNAL 4
void TabManager::tabUrlChanged(TabManager::TabId _t1, const QUrl & _t2)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 4, nullptr, _t1, _t2);
}

// SIGNAL 5
void TabManager::tabRecentlyAudibleChanged(TabManager::TabId _t1, bool _t2)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 5, nullptr, _t1, _t2);
}
QT_WARNING_POP
