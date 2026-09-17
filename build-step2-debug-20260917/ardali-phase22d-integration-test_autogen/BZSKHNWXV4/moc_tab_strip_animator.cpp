/****************************************************************************
** Meta object code from reading C++ file 'tab_strip_animator.h'
**
** Created by: The Qt Meta Object Compiler version 69 (Qt 6.11.2)
**
** WARNING! All changes made in this file will be lost!
*****************************************************************************/

#include "../../../browser/native/desktop_tabs/tab_strip_animator.h"
#include <QtCore/qmetatype.h>

#include <QtCore/qtmochelpers.h>

#include <memory>


#include <QtCore/qxptype_traits.h>
#if !defined(Q_MOC_OUTPUT_REVISION)
#error "The header file 'tab_strip_animator.h' doesn't include <QObject>."
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
struct qt_meta_tag_ZN6ardali12desktop_tabs16TabStripAnimatorE_t {};
} // unnamed namespace

template <> constexpr inline auto ardali::desktop_tabs::TabStripAnimator::qt_create_metaobjectdata<qt_meta_tag_ZN6ardali12desktop_tabs16TabStripAnimatorE_t>()
{
    namespace QMC = QtMocConstants;
    QtMocHelpers::StringRefStorage qt_stringData {
        "ardali::desktop_tabs::TabStripAnimator",
        "animationProgressed",
        "",
        "animationFinished",
        "closingTransitionFinished",
        "transitionId",
        "onTick"
    };

    QtMocHelpers::UintData qt_methods {
        // Signal 'animationProgressed'
        QtMocHelpers::SignalData<void()>(1, 2, QMC::AccessPublic, QMetaType::Void),
        // Signal 'animationFinished'
        QtMocHelpers::SignalData<void()>(3, 2, QMC::AccessPublic, QMetaType::Void),
        // Signal 'closingTransitionFinished'
        QtMocHelpers::SignalData<void(quint64)>(4, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::ULongLong, 5 },
        }}),
        // Slot 'onTick'
        QtMocHelpers::SlotData<void()>(6, 2, QMC::AccessPrivate, QMetaType::Void),
    };
    QtMocHelpers::UintData qt_properties {
    };
    QtMocHelpers::UintData qt_enums {
    };
    return QtMocHelpers::metaObjectData<TabStripAnimator, qt_meta_tag_ZN6ardali12desktop_tabs16TabStripAnimatorE_t>(QMC::MetaObjectFlag{}, qt_stringData,
            qt_methods, qt_properties, qt_enums);
}
Q_CONSTINIT const QMetaObject ardali::desktop_tabs::TabStripAnimator::staticMetaObject = { {
    QMetaObject::SuperData::link<QObject::staticMetaObject>(),
    qt_staticMetaObjectStaticContent<qt_meta_tag_ZN6ardali12desktop_tabs16TabStripAnimatorE_t>.stringdata,
    qt_staticMetaObjectStaticContent<qt_meta_tag_ZN6ardali12desktop_tabs16TabStripAnimatorE_t>.data,
    qt_static_metacall,
    nullptr,
    qt_staticMetaObjectRelocatingContent<qt_meta_tag_ZN6ardali12desktop_tabs16TabStripAnimatorE_t>.metaTypes,
    nullptr
} };

void ardali::desktop_tabs::TabStripAnimator::qt_static_metacall(QObject *_o, QMetaObject::Call _c, int _id, void **_a)
{
    auto *_t = static_cast<TabStripAnimator *>(_o);
    if (_c == QMetaObject::InvokeMetaMethod) {
        switch (_id) {
        case 0: _t->animationProgressed(); break;
        case 1: _t->animationFinished(); break;
        case 2: _t->closingTransitionFinished((*reinterpret_cast<std::add_pointer_t<quint64>>(_a[1]))); break;
        case 3: _t->onTick(); break;
        default: ;
        }
    }
    if (_c == QMetaObject::IndexOfMethod) {
        if (QtMocHelpers::indexOfMethod<void (TabStripAnimator::*)()>(_a, &TabStripAnimator::animationProgressed, 0))
            return;
        if (QtMocHelpers::indexOfMethod<void (TabStripAnimator::*)()>(_a, &TabStripAnimator::animationFinished, 1))
            return;
        if (QtMocHelpers::indexOfMethod<void (TabStripAnimator::*)(quint64 )>(_a, &TabStripAnimator::closingTransitionFinished, 2))
            return;
    }
}

const QMetaObject *ardali::desktop_tabs::TabStripAnimator::metaObject() const
{
    return QObject::d_ptr->metaObject ? QObject::d_ptr->dynamicMetaObject() : &staticMetaObject;
}

void *ardali::desktop_tabs::TabStripAnimator::qt_metacast(const char *_clname)
{
    if (!_clname) return nullptr;
    if (!strcmp(_clname, qt_staticMetaObjectStaticContent<qt_meta_tag_ZN6ardali12desktop_tabs16TabStripAnimatorE_t>.strings))
        return static_cast<void*>(this);
    return QObject::qt_metacast(_clname);
}

int ardali::desktop_tabs::TabStripAnimator::qt_metacall(QMetaObject::Call _c, int _id, void **_a)
{
    _id = QObject::qt_metacall(_c, _id, _a);
    if (_id < 0)
        return _id;
    if (_c == QMetaObject::InvokeMetaMethod) {
        if (_id < 4)
            qt_static_metacall(this, _c, _id, _a);
        _id -= 4;
    }
    if (_c == QMetaObject::RegisterMethodArgumentMetaType) {
        if (_id < 4)
            *reinterpret_cast<QMetaType *>(_a[0]) = QMetaType();
        _id -= 4;
    }
    return _id;
}

// SIGNAL 0
void ardali::desktop_tabs::TabStripAnimator::animationProgressed()
{
    QMetaObject::activate(this, &staticMetaObject, 0, nullptr);
}

// SIGNAL 1
void ardali::desktop_tabs::TabStripAnimator::animationFinished()
{
    QMetaObject::activate(this, &staticMetaObject, 1, nullptr);
}

// SIGNAL 2
void ardali::desktop_tabs::TabStripAnimator::closingTransitionFinished(quint64 _t1)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 2, nullptr, _t1);
}
QT_WARNING_POP
