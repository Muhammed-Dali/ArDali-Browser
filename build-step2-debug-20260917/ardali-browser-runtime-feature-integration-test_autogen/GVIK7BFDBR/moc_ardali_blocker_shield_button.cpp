/****************************************************************************
** Meta object code from reading C++ file 'ardali_blocker_shield_button.h'
**
** Created by: The Qt Meta Object Compiler version 69 (Qt 6.11.2)
**
** WARNING! All changes made in this file will be lost!
*****************************************************************************/

#include "../../../browser/native/blocker/ardali_blocker_shield_button.h"
#include <QtCore/qmetatype.h>

#include <QtCore/qtmochelpers.h>

#include <memory>


#include <QtCore/qxptype_traits.h>
#if !defined(Q_MOC_OUTPUT_REVISION)
#error "The header file 'ardali_blocker_shield_button.h' doesn't include <QObject>."
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
struct qt_meta_tag_ZN23ArDaliBlockerQuickPopupE_t {};
} // unnamed namespace

template <> constexpr inline auto ArDaliBlockerQuickPopup::qt_create_metaobjectdata<qt_meta_tag_ZN23ArDaliBlockerQuickPopupE_t>()
{
    namespace QMC = QtMocConstants;
    QtMocHelpers::StringRefStorage qt_stringData {
        "ArDaliBlockerQuickPopup",
        "openSettingsRequested",
        "",
        "openRulesetsRequested",
        "openLoggerRequested",
        "reloadRequested"
    };

    QtMocHelpers::UintData qt_methods {
        // Signal 'openSettingsRequested'
        QtMocHelpers::SignalData<void()>(1, 2, QMC::AccessPublic, QMetaType::Void),
        // Signal 'openRulesetsRequested'
        QtMocHelpers::SignalData<void()>(3, 2, QMC::AccessPublic, QMetaType::Void),
        // Signal 'openLoggerRequested'
        QtMocHelpers::SignalData<void()>(4, 2, QMC::AccessPublic, QMetaType::Void),
        // Signal 'reloadRequested'
        QtMocHelpers::SignalData<void()>(5, 2, QMC::AccessPublic, QMetaType::Void),
    };
    QtMocHelpers::UintData qt_properties {
    };
    QtMocHelpers::UintData qt_enums {
    };
    return QtMocHelpers::metaObjectData<ArDaliBlockerQuickPopup, qt_meta_tag_ZN23ArDaliBlockerQuickPopupE_t>(QMC::MetaObjectFlag{}, qt_stringData,
            qt_methods, qt_properties, qt_enums);
}
Q_CONSTINIT const QMetaObject ArDaliBlockerQuickPopup::staticMetaObject = { {
    QMetaObject::SuperData::link<QFrame::staticMetaObject>(),
    qt_staticMetaObjectStaticContent<qt_meta_tag_ZN23ArDaliBlockerQuickPopupE_t>.stringdata,
    qt_staticMetaObjectStaticContent<qt_meta_tag_ZN23ArDaliBlockerQuickPopupE_t>.data,
    qt_static_metacall,
    nullptr,
    qt_staticMetaObjectRelocatingContent<qt_meta_tag_ZN23ArDaliBlockerQuickPopupE_t>.metaTypes,
    nullptr
} };

void ArDaliBlockerQuickPopup::qt_static_metacall(QObject *_o, QMetaObject::Call _c, int _id, void **_a)
{
    auto *_t = static_cast<ArDaliBlockerQuickPopup *>(_o);
    if (_c == QMetaObject::InvokeMetaMethod) {
        switch (_id) {
        case 0: _t->openSettingsRequested(); break;
        case 1: _t->openRulesetsRequested(); break;
        case 2: _t->openLoggerRequested(); break;
        case 3: _t->reloadRequested(); break;
        default: ;
        }
    }
    if (_c == QMetaObject::IndexOfMethod) {
        if (QtMocHelpers::indexOfMethod<void (ArDaliBlockerQuickPopup::*)()>(_a, &ArDaliBlockerQuickPopup::openSettingsRequested, 0))
            return;
        if (QtMocHelpers::indexOfMethod<void (ArDaliBlockerQuickPopup::*)()>(_a, &ArDaliBlockerQuickPopup::openRulesetsRequested, 1))
            return;
        if (QtMocHelpers::indexOfMethod<void (ArDaliBlockerQuickPopup::*)()>(_a, &ArDaliBlockerQuickPopup::openLoggerRequested, 2))
            return;
        if (QtMocHelpers::indexOfMethod<void (ArDaliBlockerQuickPopup::*)()>(_a, &ArDaliBlockerQuickPopup::reloadRequested, 3))
            return;
    }
}

const QMetaObject *ArDaliBlockerQuickPopup::metaObject() const
{
    return QObject::d_ptr->metaObject ? QObject::d_ptr->dynamicMetaObject() : &staticMetaObject;
}

void *ArDaliBlockerQuickPopup::qt_metacast(const char *_clname)
{
    if (!_clname) return nullptr;
    if (!strcmp(_clname, qt_staticMetaObjectStaticContent<qt_meta_tag_ZN23ArDaliBlockerQuickPopupE_t>.strings))
        return static_cast<void*>(this);
    return QFrame::qt_metacast(_clname);
}

int ArDaliBlockerQuickPopup::qt_metacall(QMetaObject::Call _c, int _id, void **_a)
{
    _id = QFrame::qt_metacall(_c, _id, _a);
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
void ArDaliBlockerQuickPopup::openSettingsRequested()
{
    QMetaObject::activate(this, &staticMetaObject, 0, nullptr);
}

// SIGNAL 1
void ArDaliBlockerQuickPopup::openRulesetsRequested()
{
    QMetaObject::activate(this, &staticMetaObject, 1, nullptr);
}

// SIGNAL 2
void ArDaliBlockerQuickPopup::openLoggerRequested()
{
    QMetaObject::activate(this, &staticMetaObject, 2, nullptr);
}

// SIGNAL 3
void ArDaliBlockerQuickPopup::reloadRequested()
{
    QMetaObject::activate(this, &staticMetaObject, 3, nullptr);
}
namespace {
struct qt_meta_tag_ZN25ArDaliBlockerShieldButtonE_t {};
} // unnamed namespace

template <> constexpr inline auto ArDaliBlockerShieldButton::qt_create_metaobjectdata<qt_meta_tag_ZN25ArDaliBlockerShieldButtonE_t>()
{
    namespace QMC = QtMocConstants;
    QtMocHelpers::StringRefStorage qt_stringData {
        "ArDaliBlockerShieldButton",
        "openSettingsRequested",
        "",
        "openRulesetsRequested",
        "openLoggerRequested",
        "reloadRequested"
    };

    QtMocHelpers::UintData qt_methods {
        // Signal 'openSettingsRequested'
        QtMocHelpers::SignalData<void()>(1, 2, QMC::AccessPublic, QMetaType::Void),
        // Signal 'openRulesetsRequested'
        QtMocHelpers::SignalData<void()>(3, 2, QMC::AccessPublic, QMetaType::Void),
        // Signal 'openLoggerRequested'
        QtMocHelpers::SignalData<void()>(4, 2, QMC::AccessPublic, QMetaType::Void),
        // Signal 'reloadRequested'
        QtMocHelpers::SignalData<void()>(5, 2, QMC::AccessPublic, QMetaType::Void),
    };
    QtMocHelpers::UintData qt_properties {
    };
    QtMocHelpers::UintData qt_enums {
    };
    return QtMocHelpers::metaObjectData<ArDaliBlockerShieldButton, qt_meta_tag_ZN25ArDaliBlockerShieldButtonE_t>(QMC::MetaObjectFlag{}, qt_stringData,
            qt_methods, qt_properties, qt_enums);
}
Q_CONSTINIT const QMetaObject ArDaliBlockerShieldButton::staticMetaObject = { {
    QMetaObject::SuperData::link<QToolButton::staticMetaObject>(),
    qt_staticMetaObjectStaticContent<qt_meta_tag_ZN25ArDaliBlockerShieldButtonE_t>.stringdata,
    qt_staticMetaObjectStaticContent<qt_meta_tag_ZN25ArDaliBlockerShieldButtonE_t>.data,
    qt_static_metacall,
    nullptr,
    qt_staticMetaObjectRelocatingContent<qt_meta_tag_ZN25ArDaliBlockerShieldButtonE_t>.metaTypes,
    nullptr
} };

void ArDaliBlockerShieldButton::qt_static_metacall(QObject *_o, QMetaObject::Call _c, int _id, void **_a)
{
    auto *_t = static_cast<ArDaliBlockerShieldButton *>(_o);
    if (_c == QMetaObject::InvokeMetaMethod) {
        switch (_id) {
        case 0: _t->openSettingsRequested(); break;
        case 1: _t->openRulesetsRequested(); break;
        case 2: _t->openLoggerRequested(); break;
        case 3: _t->reloadRequested(); break;
        default: ;
        }
    }
    if (_c == QMetaObject::IndexOfMethod) {
        if (QtMocHelpers::indexOfMethod<void (ArDaliBlockerShieldButton::*)()>(_a, &ArDaliBlockerShieldButton::openSettingsRequested, 0))
            return;
        if (QtMocHelpers::indexOfMethod<void (ArDaliBlockerShieldButton::*)()>(_a, &ArDaliBlockerShieldButton::openRulesetsRequested, 1))
            return;
        if (QtMocHelpers::indexOfMethod<void (ArDaliBlockerShieldButton::*)()>(_a, &ArDaliBlockerShieldButton::openLoggerRequested, 2))
            return;
        if (QtMocHelpers::indexOfMethod<void (ArDaliBlockerShieldButton::*)()>(_a, &ArDaliBlockerShieldButton::reloadRequested, 3))
            return;
    }
}

const QMetaObject *ArDaliBlockerShieldButton::metaObject() const
{
    return QObject::d_ptr->metaObject ? QObject::d_ptr->dynamicMetaObject() : &staticMetaObject;
}

void *ArDaliBlockerShieldButton::qt_metacast(const char *_clname)
{
    if (!_clname) return nullptr;
    if (!strcmp(_clname, qt_staticMetaObjectStaticContent<qt_meta_tag_ZN25ArDaliBlockerShieldButtonE_t>.strings))
        return static_cast<void*>(this);
    return QToolButton::qt_metacast(_clname);
}

int ArDaliBlockerShieldButton::qt_metacall(QMetaObject::Call _c, int _id, void **_a)
{
    _id = QToolButton::qt_metacall(_c, _id, _a);
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
void ArDaliBlockerShieldButton::openSettingsRequested()
{
    QMetaObject::activate(this, &staticMetaObject, 0, nullptr);
}

// SIGNAL 1
void ArDaliBlockerShieldButton::openRulesetsRequested()
{
    QMetaObject::activate(this, &staticMetaObject, 1, nullptr);
}

// SIGNAL 2
void ArDaliBlockerShieldButton::openLoggerRequested()
{
    QMetaObject::activate(this, &staticMetaObject, 2, nullptr);
}

// SIGNAL 3
void ArDaliBlockerShieldButton::reloadRequested()
{
    QMetaObject::activate(this, &staticMetaObject, 3, nullptr);
}
QT_WARNING_POP
