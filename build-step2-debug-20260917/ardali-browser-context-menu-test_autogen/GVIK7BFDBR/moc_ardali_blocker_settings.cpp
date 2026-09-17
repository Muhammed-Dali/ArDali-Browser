/****************************************************************************
** Meta object code from reading C++ file 'ardali_blocker_settings.h'
**
** Created by: The Qt Meta Object Compiler version 69 (Qt 6.11.2)
**
** WARNING! All changes made in this file will be lost!
*****************************************************************************/

#include "../../../browser/native/blocker/ardali_blocker_settings.h"
#include <QtCore/qmetatype.h>

#include <QtCore/qtmochelpers.h>

#include <memory>


#include <QtCore/qxptype_traits.h>
#if !defined(Q_MOC_OUTPUT_REVISION)
#error "The header file 'ardali_blocker_settings.h' doesn't include <QObject>."
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
struct qt_meta_tag_ZN21ArDaliBlockerSettingsE_t {};
} // unnamed namespace

template <> constexpr inline auto ArDaliBlockerSettings::qt_create_metaobjectdata<qt_meta_tag_ZN21ArDaliBlockerSettingsE_t>()
{
    namespace QMC = QtMocConstants;
    QtMocHelpers::StringRefStorage qt_stringData {
        "ArDaliBlockerSettings",
        "settingsChanged",
        "",
        "filteringPlanChanged",
        "modeChanged",
        "ArDaliBlockerMode",
        "mode",
        "protectionEnabledChanged",
        "enabled",
        "toolbarCountVisibilityChanged",
        "visible",
        "popupBlockChanged",
        "customFiltersChanged",
        "sitePoliciesChanged",
        "rulesetsChanged"
    };

    QtMocHelpers::UintData qt_methods {
        // Signal 'settingsChanged'
        QtMocHelpers::SignalData<void()>(1, 2, QMC::AccessPublic, QMetaType::Void),
        // Signal 'filteringPlanChanged'
        QtMocHelpers::SignalData<void()>(3, 2, QMC::AccessPublic, QMetaType::Void),
        // Signal 'modeChanged'
        QtMocHelpers::SignalData<void(ArDaliBlockerMode)>(4, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 5, 6 },
        }}),
        // Signal 'protectionEnabledChanged'
        QtMocHelpers::SignalData<void(bool)>(7, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::Bool, 8 },
        }}),
        // Signal 'toolbarCountVisibilityChanged'
        QtMocHelpers::SignalData<void(bool)>(9, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::Bool, 10 },
        }}),
        // Signal 'popupBlockChanged'
        QtMocHelpers::SignalData<void(bool)>(11, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::Bool, 8 },
        }}),
        // Signal 'customFiltersChanged'
        QtMocHelpers::SignalData<void()>(12, 2, QMC::AccessPublic, QMetaType::Void),
        // Signal 'sitePoliciesChanged'
        QtMocHelpers::SignalData<void()>(13, 2, QMC::AccessPublic, QMetaType::Void),
        // Signal 'rulesetsChanged'
        QtMocHelpers::SignalData<void()>(14, 2, QMC::AccessPublic, QMetaType::Void),
    };
    QtMocHelpers::UintData qt_properties {
    };
    QtMocHelpers::UintData qt_enums {
    };
    return QtMocHelpers::metaObjectData<ArDaliBlockerSettings, qt_meta_tag_ZN21ArDaliBlockerSettingsE_t>(QMC::MetaObjectFlag{}, qt_stringData,
            qt_methods, qt_properties, qt_enums);
}
Q_CONSTINIT const QMetaObject ArDaliBlockerSettings::staticMetaObject = { {
    QMetaObject::SuperData::link<QObject::staticMetaObject>(),
    qt_staticMetaObjectStaticContent<qt_meta_tag_ZN21ArDaliBlockerSettingsE_t>.stringdata,
    qt_staticMetaObjectStaticContent<qt_meta_tag_ZN21ArDaliBlockerSettingsE_t>.data,
    qt_static_metacall,
    nullptr,
    qt_staticMetaObjectRelocatingContent<qt_meta_tag_ZN21ArDaliBlockerSettingsE_t>.metaTypes,
    nullptr
} };

void ArDaliBlockerSettings::qt_static_metacall(QObject *_o, QMetaObject::Call _c, int _id, void **_a)
{
    auto *_t = static_cast<ArDaliBlockerSettings *>(_o);
    if (_c == QMetaObject::InvokeMetaMethod) {
        switch (_id) {
        case 0: _t->settingsChanged(); break;
        case 1: _t->filteringPlanChanged(); break;
        case 2: _t->modeChanged((*reinterpret_cast<std::add_pointer_t<ArDaliBlockerMode>>(_a[1]))); break;
        case 3: _t->protectionEnabledChanged((*reinterpret_cast<std::add_pointer_t<bool>>(_a[1]))); break;
        case 4: _t->toolbarCountVisibilityChanged((*reinterpret_cast<std::add_pointer_t<bool>>(_a[1]))); break;
        case 5: _t->popupBlockChanged((*reinterpret_cast<std::add_pointer_t<bool>>(_a[1]))); break;
        case 6: _t->customFiltersChanged(); break;
        case 7: _t->sitePoliciesChanged(); break;
        case 8: _t->rulesetsChanged(); break;
        default: ;
        }
    }
    if (_c == QMetaObject::IndexOfMethod) {
        if (QtMocHelpers::indexOfMethod<void (ArDaliBlockerSettings::*)()>(_a, &ArDaliBlockerSettings::settingsChanged, 0))
            return;
        if (QtMocHelpers::indexOfMethod<void (ArDaliBlockerSettings::*)()>(_a, &ArDaliBlockerSettings::filteringPlanChanged, 1))
            return;
        if (QtMocHelpers::indexOfMethod<void (ArDaliBlockerSettings::*)(ArDaliBlockerMode )>(_a, &ArDaliBlockerSettings::modeChanged, 2))
            return;
        if (QtMocHelpers::indexOfMethod<void (ArDaliBlockerSettings::*)(bool )>(_a, &ArDaliBlockerSettings::protectionEnabledChanged, 3))
            return;
        if (QtMocHelpers::indexOfMethod<void (ArDaliBlockerSettings::*)(bool )>(_a, &ArDaliBlockerSettings::toolbarCountVisibilityChanged, 4))
            return;
        if (QtMocHelpers::indexOfMethod<void (ArDaliBlockerSettings::*)(bool )>(_a, &ArDaliBlockerSettings::popupBlockChanged, 5))
            return;
        if (QtMocHelpers::indexOfMethod<void (ArDaliBlockerSettings::*)()>(_a, &ArDaliBlockerSettings::customFiltersChanged, 6))
            return;
        if (QtMocHelpers::indexOfMethod<void (ArDaliBlockerSettings::*)()>(_a, &ArDaliBlockerSettings::sitePoliciesChanged, 7))
            return;
        if (QtMocHelpers::indexOfMethod<void (ArDaliBlockerSettings::*)()>(_a, &ArDaliBlockerSettings::rulesetsChanged, 8))
            return;
    }
}

const QMetaObject *ArDaliBlockerSettings::metaObject() const
{
    return QObject::d_ptr->metaObject ? QObject::d_ptr->dynamicMetaObject() : &staticMetaObject;
}

void *ArDaliBlockerSettings::qt_metacast(const char *_clname)
{
    if (!_clname) return nullptr;
    if (!strcmp(_clname, qt_staticMetaObjectStaticContent<qt_meta_tag_ZN21ArDaliBlockerSettingsE_t>.strings))
        return static_cast<void*>(this);
    return QObject::qt_metacast(_clname);
}

int ArDaliBlockerSettings::qt_metacall(QMetaObject::Call _c, int _id, void **_a)
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
void ArDaliBlockerSettings::settingsChanged()
{
    QMetaObject::activate(this, &staticMetaObject, 0, nullptr);
}

// SIGNAL 1
void ArDaliBlockerSettings::filteringPlanChanged()
{
    QMetaObject::activate(this, &staticMetaObject, 1, nullptr);
}

// SIGNAL 2
void ArDaliBlockerSettings::modeChanged(ArDaliBlockerMode _t1)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 2, nullptr, _t1);
}

// SIGNAL 3
void ArDaliBlockerSettings::protectionEnabledChanged(bool _t1)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 3, nullptr, _t1);
}

// SIGNAL 4
void ArDaliBlockerSettings::toolbarCountVisibilityChanged(bool _t1)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 4, nullptr, _t1);
}

// SIGNAL 5
void ArDaliBlockerSettings::popupBlockChanged(bool _t1)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 5, nullptr, _t1);
}

// SIGNAL 6
void ArDaliBlockerSettings::customFiltersChanged()
{
    QMetaObject::activate(this, &staticMetaObject, 6, nullptr);
}

// SIGNAL 7
void ArDaliBlockerSettings::sitePoliciesChanged()
{
    QMetaObject::activate(this, &staticMetaObject, 7, nullptr);
}

// SIGNAL 8
void ArDaliBlockerSettings::rulesetsChanged()
{
    QMetaObject::activate(this, &staticMetaObject, 8, nullptr);
}
QT_WARNING_POP
