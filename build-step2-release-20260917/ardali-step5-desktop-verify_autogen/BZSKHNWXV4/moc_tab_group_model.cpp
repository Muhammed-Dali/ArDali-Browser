/****************************************************************************
** Meta object code from reading C++ file 'tab_group_model.h'
**
** Created by: The Qt Meta Object Compiler version 69 (Qt 6.11.2)
**
** WARNING! All changes made in this file will be lost!
*****************************************************************************/

#include "../../../browser/native/desktop_tabs/tab_group_model.h"
#include <QtCore/qmetatype.h>

#include <QtCore/qtmochelpers.h>

#include <memory>


#include <QtCore/qxptype_traits.h>
#if !defined(Q_MOC_OUTPUT_REVISION)
#error "The header file 'tab_group_model.h' doesn't include <QObject>."
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
struct qt_meta_tag_ZN6ardali12desktop_tabs13TabGroupModelE_t {};
} // unnamed namespace

template <> constexpr inline auto ardali::desktop_tabs::TabGroupModel::qt_create_metaobjectdata<qt_meta_tag_ZN6ardali12desktop_tabs13TabGroupModelE_t>()
{
    namespace QMC = QtMocConstants;
    QtMocHelpers::StringRefStorage qt_stringData {
        "ardali::desktop_tabs::TabGroupModel",
        "groupAdded",
        "",
        "TabGroup",
        "group",
        "groupUpdated",
        "groupRemoved",
        "QUuid",
        "groupId",
        "tabGroupAssigned",
        "uint64_t",
        "tabId",
        "tabGroupRemoved"
    };

    QtMocHelpers::UintData qt_methods {
        // Signal 'groupAdded'
        QtMocHelpers::SignalData<void(const TabGroup &)>(1, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 3, 4 },
        }}),
        // Signal 'groupUpdated'
        QtMocHelpers::SignalData<void(const TabGroup &)>(5, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 3, 4 },
        }}),
        // Signal 'groupRemoved'
        QtMocHelpers::SignalData<void(const QUuid &)>(6, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 7, 8 },
        }}),
        // Signal 'tabGroupAssigned'
        QtMocHelpers::SignalData<void(uint64_t, const QUuid &)>(9, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 10, 11 }, { 0x80000000 | 7, 8 },
        }}),
        // Signal 'tabGroupRemoved'
        QtMocHelpers::SignalData<void(uint64_t)>(12, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 10, 11 },
        }}),
    };
    QtMocHelpers::UintData qt_properties {
    };
    QtMocHelpers::UintData qt_enums {
    };
    return QtMocHelpers::metaObjectData<TabGroupModel, qt_meta_tag_ZN6ardali12desktop_tabs13TabGroupModelE_t>(QMC::MetaObjectFlag{}, qt_stringData,
            qt_methods, qt_properties, qt_enums);
}
Q_CONSTINIT const QMetaObject ardali::desktop_tabs::TabGroupModel::staticMetaObject = { {
    QMetaObject::SuperData::link<QObject::staticMetaObject>(),
    qt_staticMetaObjectStaticContent<qt_meta_tag_ZN6ardali12desktop_tabs13TabGroupModelE_t>.stringdata,
    qt_staticMetaObjectStaticContent<qt_meta_tag_ZN6ardali12desktop_tabs13TabGroupModelE_t>.data,
    qt_static_metacall,
    nullptr,
    qt_staticMetaObjectRelocatingContent<qt_meta_tag_ZN6ardali12desktop_tabs13TabGroupModelE_t>.metaTypes,
    nullptr
} };

void ardali::desktop_tabs::TabGroupModel::qt_static_metacall(QObject *_o, QMetaObject::Call _c, int _id, void **_a)
{
    auto *_t = static_cast<TabGroupModel *>(_o);
    if (_c == QMetaObject::InvokeMetaMethod) {
        switch (_id) {
        case 0: _t->groupAdded((*reinterpret_cast<std::add_pointer_t<TabGroup>>(_a[1]))); break;
        case 1: _t->groupUpdated((*reinterpret_cast<std::add_pointer_t<TabGroup>>(_a[1]))); break;
        case 2: _t->groupRemoved((*reinterpret_cast<std::add_pointer_t<QUuid>>(_a[1]))); break;
        case 3: _t->tabGroupAssigned((*reinterpret_cast<std::add_pointer_t<uint64_t>>(_a[1])),(*reinterpret_cast<std::add_pointer_t<QUuid>>(_a[2]))); break;
        case 4: _t->tabGroupRemoved((*reinterpret_cast<std::add_pointer_t<uint64_t>>(_a[1]))); break;
        default: ;
        }
    }
    if (_c == QMetaObject::IndexOfMethod) {
        if (QtMocHelpers::indexOfMethod<void (TabGroupModel::*)(const TabGroup & )>(_a, &TabGroupModel::groupAdded, 0))
            return;
        if (QtMocHelpers::indexOfMethod<void (TabGroupModel::*)(const TabGroup & )>(_a, &TabGroupModel::groupUpdated, 1))
            return;
        if (QtMocHelpers::indexOfMethod<void (TabGroupModel::*)(const QUuid & )>(_a, &TabGroupModel::groupRemoved, 2))
            return;
        if (QtMocHelpers::indexOfMethod<void (TabGroupModel::*)(uint64_t , const QUuid & )>(_a, &TabGroupModel::tabGroupAssigned, 3))
            return;
        if (QtMocHelpers::indexOfMethod<void (TabGroupModel::*)(uint64_t )>(_a, &TabGroupModel::tabGroupRemoved, 4))
            return;
    }
}

const QMetaObject *ardali::desktop_tabs::TabGroupModel::metaObject() const
{
    return QObject::d_ptr->metaObject ? QObject::d_ptr->dynamicMetaObject() : &staticMetaObject;
}

void *ardali::desktop_tabs::TabGroupModel::qt_metacast(const char *_clname)
{
    if (!_clname) return nullptr;
    if (!strcmp(_clname, qt_staticMetaObjectStaticContent<qt_meta_tag_ZN6ardali12desktop_tabs13TabGroupModelE_t>.strings))
        return static_cast<void*>(this);
    return QObject::qt_metacast(_clname);
}

int ardali::desktop_tabs::TabGroupModel::qt_metacall(QMetaObject::Call _c, int _id, void **_a)
{
    _id = QObject::qt_metacall(_c, _id, _a);
    if (_id < 0)
        return _id;
    if (_c == QMetaObject::InvokeMetaMethod) {
        if (_id < 5)
            qt_static_metacall(this, _c, _id, _a);
        _id -= 5;
    }
    if (_c == QMetaObject::RegisterMethodArgumentMetaType) {
        if (_id < 5)
            *reinterpret_cast<QMetaType *>(_a[0]) = QMetaType();
        _id -= 5;
    }
    return _id;
}

// SIGNAL 0
void ardali::desktop_tabs::TabGroupModel::groupAdded(const TabGroup & _t1)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 0, nullptr, _t1);
}

// SIGNAL 1
void ardali::desktop_tabs::TabGroupModel::groupUpdated(const TabGroup & _t1)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 1, nullptr, _t1);
}

// SIGNAL 2
void ardali::desktop_tabs::TabGroupModel::groupRemoved(const QUuid & _t1)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 2, nullptr, _t1);
}

// SIGNAL 3
void ardali::desktop_tabs::TabGroupModel::tabGroupAssigned(uint64_t _t1, const QUuid & _t2)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 3, nullptr, _t1, _t2);
}

// SIGNAL 4
void ardali::desktop_tabs::TabGroupModel::tabGroupRemoved(uint64_t _t1)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 4, nullptr, _t1);
}
QT_WARNING_POP
