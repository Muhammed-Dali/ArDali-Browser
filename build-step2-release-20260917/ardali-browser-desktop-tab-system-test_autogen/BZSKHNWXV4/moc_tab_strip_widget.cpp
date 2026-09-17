/****************************************************************************
** Meta object code from reading C++ file 'tab_strip_widget.h'
**
** Created by: The Qt Meta Object Compiler version 69 (Qt 6.11.2)
**
** WARNING! All changes made in this file will be lost!
*****************************************************************************/

#include "../../../browser/native/desktop_tabs/tab_strip_widget.h"
#include <QtCore/qmetatype.h>

#include <QtCore/qtmochelpers.h>

#include <memory>


#include <QtCore/qxptype_traits.h>
#if !defined(Q_MOC_OUTPUT_REVISION)
#error "The header file 'tab_strip_widget.h' doesn't include <QObject>."
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
struct qt_meta_tag_ZN6ardali12desktop_tabs14TabStripWidgetE_t {};
} // unnamed namespace

template <> constexpr inline auto ardali::desktop_tabs::TabStripWidget::qt_create_metaobjectdata<qt_meta_tag_ZN6ardali12desktop_tabs14TabStripWidgetE_t>()
{
    namespace QMC = QtMocConstants;
    QtMocHelpers::StringRefStorage qt_stringData {
        "ardali::desktop_tabs::TabStripWidget",
        "currentChanged",
        "",
        "index",
        "tabCloseRequested",
        "newTabRequested",
        "tabMoved",
        "fromIndex",
        "toIndex",
        "tabHovered",
        "QPoint",
        "globalPos",
        "QRect",
        "globalTabRect",
        "tabHoverLeave",
        "dragInitiated",
        "offsetInTab",
        "QSize",
        "tabSize",
        "tabContextMenuRequested",
        "groupChipClicked",
        "QUuid",
        "groupId",
        "globalPosBelowChip",
        "onAnimationTick",
        "onHoverAnimationTick",
        "onHoverTimeout"
    };

    QtMocHelpers::UintData qt_methods {
        // Signal 'currentChanged'
        QtMocHelpers::SignalData<void(int)>(1, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::Int, 3 },
        }}),
        // Signal 'tabCloseRequested'
        QtMocHelpers::SignalData<void(int)>(4, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::Int, 3 },
        }}),
        // Signal 'newTabRequested'
        QtMocHelpers::SignalData<void()>(5, 2, QMC::AccessPublic, QMetaType::Void),
        // Signal 'tabMoved'
        QtMocHelpers::SignalData<void(int, int)>(6, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::Int, 7 }, { QMetaType::Int, 8 },
        }}),
        // Signal 'tabHovered'
        QtMocHelpers::SignalData<void(int, QPoint, QRect)>(9, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::Int, 3 }, { 0x80000000 | 10, 11 }, { 0x80000000 | 12, 13 },
        }}),
        // Signal 'tabHoverLeave'
        QtMocHelpers::SignalData<void()>(14, 2, QMC::AccessPublic, QMetaType::Void),
        // Signal 'dragInitiated'
        QtMocHelpers::SignalData<void(int, QPoint, QPoint, QSize)>(15, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::Int, 3 }, { 0x80000000 | 10, 11 }, { 0x80000000 | 10, 16 }, { 0x80000000 | 17, 18 },
        }}),
        // Signal 'tabContextMenuRequested'
        QtMocHelpers::SignalData<void(int, QPoint)>(19, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::Int, 3 }, { 0x80000000 | 10, 11 },
        }}),
        // Signal 'groupChipClicked'
        QtMocHelpers::SignalData<void(const QUuid &, const QPoint &)>(20, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 21, 22 }, { 0x80000000 | 10, 23 },
        }}),
        // Slot 'onAnimationTick'
        QtMocHelpers::SlotData<void()>(24, 2, QMC::AccessPrivate, QMetaType::Void),
        // Slot 'onHoverAnimationTick'
        QtMocHelpers::SlotData<void()>(25, 2, QMC::AccessPrivate, QMetaType::Void),
        // Slot 'onHoverTimeout'
        QtMocHelpers::SlotData<void()>(26, 2, QMC::AccessPrivate, QMetaType::Void),
    };
    QtMocHelpers::UintData qt_properties {
    };
    QtMocHelpers::UintData qt_enums {
    };
    return QtMocHelpers::metaObjectData<TabStripWidget, qt_meta_tag_ZN6ardali12desktop_tabs14TabStripWidgetE_t>(QMC::MetaObjectFlag{}, qt_stringData,
            qt_methods, qt_properties, qt_enums);
}
Q_CONSTINIT const QMetaObject ardali::desktop_tabs::TabStripWidget::staticMetaObject = { {
    QMetaObject::SuperData::link<QWidget::staticMetaObject>(),
    qt_staticMetaObjectStaticContent<qt_meta_tag_ZN6ardali12desktop_tabs14TabStripWidgetE_t>.stringdata,
    qt_staticMetaObjectStaticContent<qt_meta_tag_ZN6ardali12desktop_tabs14TabStripWidgetE_t>.data,
    qt_static_metacall,
    nullptr,
    qt_staticMetaObjectRelocatingContent<qt_meta_tag_ZN6ardali12desktop_tabs14TabStripWidgetE_t>.metaTypes,
    nullptr
} };

void ardali::desktop_tabs::TabStripWidget::qt_static_metacall(QObject *_o, QMetaObject::Call _c, int _id, void **_a)
{
    auto *_t = static_cast<TabStripWidget *>(_o);
    if (_c == QMetaObject::InvokeMetaMethod) {
        switch (_id) {
        case 0: _t->currentChanged((*reinterpret_cast<std::add_pointer_t<int>>(_a[1]))); break;
        case 1: _t->tabCloseRequested((*reinterpret_cast<std::add_pointer_t<int>>(_a[1]))); break;
        case 2: _t->newTabRequested(); break;
        case 3: _t->tabMoved((*reinterpret_cast<std::add_pointer_t<int>>(_a[1])),(*reinterpret_cast<std::add_pointer_t<int>>(_a[2]))); break;
        case 4: _t->tabHovered((*reinterpret_cast<std::add_pointer_t<int>>(_a[1])),(*reinterpret_cast<std::add_pointer_t<QPoint>>(_a[2])),(*reinterpret_cast<std::add_pointer_t<QRect>>(_a[3]))); break;
        case 5: _t->tabHoverLeave(); break;
        case 6: _t->dragInitiated((*reinterpret_cast<std::add_pointer_t<int>>(_a[1])),(*reinterpret_cast<std::add_pointer_t<QPoint>>(_a[2])),(*reinterpret_cast<std::add_pointer_t<QPoint>>(_a[3])),(*reinterpret_cast<std::add_pointer_t<QSize>>(_a[4]))); break;
        case 7: _t->tabContextMenuRequested((*reinterpret_cast<std::add_pointer_t<int>>(_a[1])),(*reinterpret_cast<std::add_pointer_t<QPoint>>(_a[2]))); break;
        case 8: _t->groupChipClicked((*reinterpret_cast<std::add_pointer_t<QUuid>>(_a[1])),(*reinterpret_cast<std::add_pointer_t<QPoint>>(_a[2]))); break;
        case 9: _t->onAnimationTick(); break;
        case 10: _t->onHoverAnimationTick(); break;
        case 11: _t->onHoverTimeout(); break;
        default: ;
        }
    }
    if (_c == QMetaObject::IndexOfMethod) {
        if (QtMocHelpers::indexOfMethod<void (TabStripWidget::*)(int )>(_a, &TabStripWidget::currentChanged, 0))
            return;
        if (QtMocHelpers::indexOfMethod<void (TabStripWidget::*)(int )>(_a, &TabStripWidget::tabCloseRequested, 1))
            return;
        if (QtMocHelpers::indexOfMethod<void (TabStripWidget::*)()>(_a, &TabStripWidget::newTabRequested, 2))
            return;
        if (QtMocHelpers::indexOfMethod<void (TabStripWidget::*)(int , int )>(_a, &TabStripWidget::tabMoved, 3))
            return;
        if (QtMocHelpers::indexOfMethod<void (TabStripWidget::*)(int , QPoint , QRect )>(_a, &TabStripWidget::tabHovered, 4))
            return;
        if (QtMocHelpers::indexOfMethod<void (TabStripWidget::*)()>(_a, &TabStripWidget::tabHoverLeave, 5))
            return;
        if (QtMocHelpers::indexOfMethod<void (TabStripWidget::*)(int , QPoint , QPoint , QSize )>(_a, &TabStripWidget::dragInitiated, 6))
            return;
        if (QtMocHelpers::indexOfMethod<void (TabStripWidget::*)(int , QPoint )>(_a, &TabStripWidget::tabContextMenuRequested, 7))
            return;
        if (QtMocHelpers::indexOfMethod<void (TabStripWidget::*)(const QUuid & , const QPoint & )>(_a, &TabStripWidget::groupChipClicked, 8))
            return;
    }
}

const QMetaObject *ardali::desktop_tabs::TabStripWidget::metaObject() const
{
    return QObject::d_ptr->metaObject ? QObject::d_ptr->dynamicMetaObject() : &staticMetaObject;
}

void *ardali::desktop_tabs::TabStripWidget::qt_metacast(const char *_clname)
{
    if (!_clname) return nullptr;
    if (!strcmp(_clname, qt_staticMetaObjectStaticContent<qt_meta_tag_ZN6ardali12desktop_tabs14TabStripWidgetE_t>.strings))
        return static_cast<void*>(this);
    return QWidget::qt_metacast(_clname);
}

int ardali::desktop_tabs::TabStripWidget::qt_metacall(QMetaObject::Call _c, int _id, void **_a)
{
    _id = QWidget::qt_metacall(_c, _id, _a);
    if (_id < 0)
        return _id;
    if (_c == QMetaObject::InvokeMetaMethod) {
        if (_id < 12)
            qt_static_metacall(this, _c, _id, _a);
        _id -= 12;
    }
    if (_c == QMetaObject::RegisterMethodArgumentMetaType) {
        if (_id < 12)
            *reinterpret_cast<QMetaType *>(_a[0]) = QMetaType();
        _id -= 12;
    }
    return _id;
}

// SIGNAL 0
void ardali::desktop_tabs::TabStripWidget::currentChanged(int _t1)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 0, nullptr, _t1);
}

// SIGNAL 1
void ardali::desktop_tabs::TabStripWidget::tabCloseRequested(int _t1)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 1, nullptr, _t1);
}

// SIGNAL 2
void ardali::desktop_tabs::TabStripWidget::newTabRequested()
{
    QMetaObject::activate(this, &staticMetaObject, 2, nullptr);
}

// SIGNAL 3
void ardali::desktop_tabs::TabStripWidget::tabMoved(int _t1, int _t2)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 3, nullptr, _t1, _t2);
}

// SIGNAL 4
void ardali::desktop_tabs::TabStripWidget::tabHovered(int _t1, QPoint _t2, QRect _t3)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 4, nullptr, _t1, _t2, _t3);
}

// SIGNAL 5
void ardali::desktop_tabs::TabStripWidget::tabHoverLeave()
{
    QMetaObject::activate(this, &staticMetaObject, 5, nullptr);
}

// SIGNAL 6
void ardali::desktop_tabs::TabStripWidget::dragInitiated(int _t1, QPoint _t2, QPoint _t3, QSize _t4)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 6, nullptr, _t1, _t2, _t3, _t4);
}

// SIGNAL 7
void ardali::desktop_tabs::TabStripWidget::tabContextMenuRequested(int _t1, QPoint _t2)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 7, nullptr, _t1, _t2);
}

// SIGNAL 8
void ardali::desktop_tabs::TabStripWidget::groupChipClicked(const QUuid & _t1, const QPoint & _t2)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 8, nullptr, _t1, _t2);
}
QT_WARNING_POP
