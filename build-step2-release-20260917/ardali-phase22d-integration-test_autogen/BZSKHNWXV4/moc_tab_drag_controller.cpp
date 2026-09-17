/****************************************************************************
** Meta object code from reading C++ file 'tab_drag_controller.h'
**
** Created by: The Qt Meta Object Compiler version 69 (Qt 6.11.2)
**
** WARNING! All changes made in this file will be lost!
*****************************************************************************/

#include "../../../browser/native/desktop_tabs/tab_drag_controller.h"
#include <QtCore/qmetatype.h>

#include <QtCore/qtmochelpers.h>

#include <memory>


#include <QtCore/qxptype_traits.h>
#if !defined(Q_MOC_OUTPUT_REVISION)
#error "The header file 'tab_drag_controller.h' doesn't include <QObject>."
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
struct qt_meta_tag_ZN6ardali12desktop_tabs17TabDragControllerE_t {};
} // unnamed namespace

template <> constexpr inline auto ardali::desktop_tabs::TabDragController::qt_create_metaobjectdata<qt_meta_tag_ZN6ardali12desktop_tabs17TabDragControllerE_t>()
{
    namespace QMC = QtMocConstants;
    QtMocHelpers::StringRefStorage qt_stringData {
        "ardali::desktop_tabs::TabDragController",
        "dragStarted",
        "",
        "dragFinished",
        "EndDragReason",
        "reason",
        "stateChanged",
        "DragState",
        "newState"
    };

    QtMocHelpers::UintData qt_methods {
        // Signal 'dragStarted'
        QtMocHelpers::SignalData<void()>(1, 2, QMC::AccessPublic, QMetaType::Void),
        // Signal 'dragFinished'
        QtMocHelpers::SignalData<void(EndDragReason)>(3, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 4, 5 },
        }}),
        // Signal 'stateChanged'
        QtMocHelpers::SignalData<void(DragState)>(6, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 7, 8 },
        }}),
    };
    QtMocHelpers::UintData qt_properties {
    };
    QtMocHelpers::UintData qt_enums {
    };
    return QtMocHelpers::metaObjectData<TabDragController, qt_meta_tag_ZN6ardali12desktop_tabs17TabDragControllerE_t>(QMC::MetaObjectFlag{}, qt_stringData,
            qt_methods, qt_properties, qt_enums);
}
Q_CONSTINIT const QMetaObject ardali::desktop_tabs::TabDragController::staticMetaObject = { {
    QMetaObject::SuperData::link<QObject::staticMetaObject>(),
    qt_staticMetaObjectStaticContent<qt_meta_tag_ZN6ardali12desktop_tabs17TabDragControllerE_t>.stringdata,
    qt_staticMetaObjectStaticContent<qt_meta_tag_ZN6ardali12desktop_tabs17TabDragControllerE_t>.data,
    qt_static_metacall,
    nullptr,
    qt_staticMetaObjectRelocatingContent<qt_meta_tag_ZN6ardali12desktop_tabs17TabDragControllerE_t>.metaTypes,
    nullptr
} };

void ardali::desktop_tabs::TabDragController::qt_static_metacall(QObject *_o, QMetaObject::Call _c, int _id, void **_a)
{
    auto *_t = static_cast<TabDragController *>(_o);
    if (_c == QMetaObject::InvokeMetaMethod) {
        switch (_id) {
        case 0: _t->dragStarted(); break;
        case 1: _t->dragFinished((*reinterpret_cast<std::add_pointer_t<EndDragReason>>(_a[1]))); break;
        case 2: _t->stateChanged((*reinterpret_cast<std::add_pointer_t<DragState>>(_a[1]))); break;
        default: ;
        }
    }
    if (_c == QMetaObject::IndexOfMethod) {
        if (QtMocHelpers::indexOfMethod<void (TabDragController::*)()>(_a, &TabDragController::dragStarted, 0))
            return;
        if (QtMocHelpers::indexOfMethod<void (TabDragController::*)(EndDragReason )>(_a, &TabDragController::dragFinished, 1))
            return;
        if (QtMocHelpers::indexOfMethod<void (TabDragController::*)(DragState )>(_a, &TabDragController::stateChanged, 2))
            return;
    }
}

const QMetaObject *ardali::desktop_tabs::TabDragController::metaObject() const
{
    return QObject::d_ptr->metaObject ? QObject::d_ptr->dynamicMetaObject() : &staticMetaObject;
}

void *ardali::desktop_tabs::TabDragController::qt_metacast(const char *_clname)
{
    if (!_clname) return nullptr;
    if (!strcmp(_clname, qt_staticMetaObjectStaticContent<qt_meta_tag_ZN6ardali12desktop_tabs17TabDragControllerE_t>.strings))
        return static_cast<void*>(this);
    return QObject::qt_metacast(_clname);
}

int ardali::desktop_tabs::TabDragController::qt_metacall(QMetaObject::Call _c, int _id, void **_a)
{
    _id = QObject::qt_metacall(_c, _id, _a);
    if (_id < 0)
        return _id;
    if (_c == QMetaObject::InvokeMetaMethod) {
        if (_id < 3)
            qt_static_metacall(this, _c, _id, _a);
        _id -= 3;
    }
    if (_c == QMetaObject::RegisterMethodArgumentMetaType) {
        if (_id < 3)
            *reinterpret_cast<QMetaType *>(_a[0]) = QMetaType();
        _id -= 3;
    }
    return _id;
}

// SIGNAL 0
void ardali::desktop_tabs::TabDragController::dragStarted()
{
    QMetaObject::activate(this, &staticMetaObject, 0, nullptr);
}

// SIGNAL 1
void ardali::desktop_tabs::TabDragController::dragFinished(EndDragReason _t1)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 1, nullptr, _t1);
}

// SIGNAL 2
void ardali::desktop_tabs::TabDragController::stateChanged(DragState _t1)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 2, nullptr, _t1);
}
QT_WARNING_POP
