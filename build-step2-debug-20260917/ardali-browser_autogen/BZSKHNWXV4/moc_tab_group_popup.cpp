/****************************************************************************
** Meta object code from reading C++ file 'tab_group_popup.h'
**
** Created by: The Qt Meta Object Compiler version 69 (Qt 6.11.2)
**
** WARNING! All changes made in this file will be lost!
*****************************************************************************/

#include "../../../browser/native/desktop_tabs/tab_group_popup.h"
#include <QtGui/qtextcursor.h>
#include <QtCore/qmetatype.h>

#include <QtCore/qtmochelpers.h>

#include <memory>


#include <QtCore/qxptype_traits.h>
#if !defined(Q_MOC_OUTPUT_REVISION)
#error "The header file 'tab_group_popup.h' doesn't include <QObject>."
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
struct qt_meta_tag_ZN6ardali12desktop_tabs13TabGroupPopupE_t {};
} // unnamed namespace

template <> constexpr inline auto ardali::desktop_tabs::TabGroupPopup::qt_create_metaobjectdata<qt_meta_tag_ZN6ardali12desktop_tabs13TabGroupPopupE_t>()
{
    namespace QMC = QtMocConstants;
    QtMocHelpers::StringRefStorage qt_stringData {
        "ardali::desktop_tabs::TabGroupPopup",
        "newTabInGroupRequested",
        "",
        "QUuid",
        "groupId",
        "moveGroupToNewWindowRequested",
        "closeGroupRequested",
        "ungroupRequested",
        "deleteGroupRequested"
    };

    QtMocHelpers::UintData qt_methods {
        // Signal 'newTabInGroupRequested'
        QtMocHelpers::SignalData<void(const QUuid &)>(1, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 3, 4 },
        }}),
        // Signal 'moveGroupToNewWindowRequested'
        QtMocHelpers::SignalData<void(const QUuid &)>(5, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 3, 4 },
        }}),
        // Signal 'closeGroupRequested'
        QtMocHelpers::SignalData<void(const QUuid &)>(6, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 3, 4 },
        }}),
        // Signal 'ungroupRequested'
        QtMocHelpers::SignalData<void(const QUuid &)>(7, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 3, 4 },
        }}),
        // Signal 'deleteGroupRequested'
        QtMocHelpers::SignalData<void(const QUuid &)>(8, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 3, 4 },
        }}),
    };
    QtMocHelpers::UintData qt_properties {
    };
    QtMocHelpers::UintData qt_enums {
    };
    return QtMocHelpers::metaObjectData<TabGroupPopup, qt_meta_tag_ZN6ardali12desktop_tabs13TabGroupPopupE_t>(QMC::MetaObjectFlag{}, qt_stringData,
            qt_methods, qt_properties, qt_enums);
}
Q_CONSTINIT const QMetaObject ardali::desktop_tabs::TabGroupPopup::staticMetaObject = { {
    QMetaObject::SuperData::link<QWidget::staticMetaObject>(),
    qt_staticMetaObjectStaticContent<qt_meta_tag_ZN6ardali12desktop_tabs13TabGroupPopupE_t>.stringdata,
    qt_staticMetaObjectStaticContent<qt_meta_tag_ZN6ardali12desktop_tabs13TabGroupPopupE_t>.data,
    qt_static_metacall,
    nullptr,
    qt_staticMetaObjectRelocatingContent<qt_meta_tag_ZN6ardali12desktop_tabs13TabGroupPopupE_t>.metaTypes,
    nullptr
} };

void ardali::desktop_tabs::TabGroupPopup::qt_static_metacall(QObject *_o, QMetaObject::Call _c, int _id, void **_a)
{
    auto *_t = static_cast<TabGroupPopup *>(_o);
    if (_c == QMetaObject::InvokeMetaMethod) {
        switch (_id) {
        case 0: _t->newTabInGroupRequested((*reinterpret_cast<std::add_pointer_t<QUuid>>(_a[1]))); break;
        case 1: _t->moveGroupToNewWindowRequested((*reinterpret_cast<std::add_pointer_t<QUuid>>(_a[1]))); break;
        case 2: _t->closeGroupRequested((*reinterpret_cast<std::add_pointer_t<QUuid>>(_a[1]))); break;
        case 3: _t->ungroupRequested((*reinterpret_cast<std::add_pointer_t<QUuid>>(_a[1]))); break;
        case 4: _t->deleteGroupRequested((*reinterpret_cast<std::add_pointer_t<QUuid>>(_a[1]))); break;
        default: ;
        }
    }
    if (_c == QMetaObject::IndexOfMethod) {
        if (QtMocHelpers::indexOfMethod<void (TabGroupPopup::*)(const QUuid & )>(_a, &TabGroupPopup::newTabInGroupRequested, 0))
            return;
        if (QtMocHelpers::indexOfMethod<void (TabGroupPopup::*)(const QUuid & )>(_a, &TabGroupPopup::moveGroupToNewWindowRequested, 1))
            return;
        if (QtMocHelpers::indexOfMethod<void (TabGroupPopup::*)(const QUuid & )>(_a, &TabGroupPopup::closeGroupRequested, 2))
            return;
        if (QtMocHelpers::indexOfMethod<void (TabGroupPopup::*)(const QUuid & )>(_a, &TabGroupPopup::ungroupRequested, 3))
            return;
        if (QtMocHelpers::indexOfMethod<void (TabGroupPopup::*)(const QUuid & )>(_a, &TabGroupPopup::deleteGroupRequested, 4))
            return;
    }
}

const QMetaObject *ardali::desktop_tabs::TabGroupPopup::metaObject() const
{
    return QObject::d_ptr->metaObject ? QObject::d_ptr->dynamicMetaObject() : &staticMetaObject;
}

void *ardali::desktop_tabs::TabGroupPopup::qt_metacast(const char *_clname)
{
    if (!_clname) return nullptr;
    if (!strcmp(_clname, qt_staticMetaObjectStaticContent<qt_meta_tag_ZN6ardali12desktop_tabs13TabGroupPopupE_t>.strings))
        return static_cast<void*>(this);
    return QWidget::qt_metacast(_clname);
}

int ardali::desktop_tabs::TabGroupPopup::qt_metacall(QMetaObject::Call _c, int _id, void **_a)
{
    _id = QWidget::qt_metacall(_c, _id, _a);
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
void ardali::desktop_tabs::TabGroupPopup::newTabInGroupRequested(const QUuid & _t1)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 0, nullptr, _t1);
}

// SIGNAL 1
void ardali::desktop_tabs::TabGroupPopup::moveGroupToNewWindowRequested(const QUuid & _t1)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 1, nullptr, _t1);
}

// SIGNAL 2
void ardali::desktop_tabs::TabGroupPopup::closeGroupRequested(const QUuid & _t1)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 2, nullptr, _t1);
}

// SIGNAL 3
void ardali::desktop_tabs::TabGroupPopup::ungroupRequested(const QUuid & _t1)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 3, nullptr, _t1);
}

// SIGNAL 4
void ardali::desktop_tabs::TabGroupPopup::deleteGroupRequested(const QUuid & _t1)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 4, nullptr, _t1);
}
QT_WARNING_POP
