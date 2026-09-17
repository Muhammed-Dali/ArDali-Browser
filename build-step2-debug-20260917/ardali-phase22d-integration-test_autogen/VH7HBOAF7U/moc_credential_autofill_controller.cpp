/****************************************************************************
** Meta object code from reading C++ file 'credential_autofill_controller.h'
**
** Created by: The Qt Meta Object Compiler version 69 (Qt 6.11.2)
**
** WARNING! All changes made in this file will be lost!
*****************************************************************************/

#include "../../../browser/native/passwords/credential_autofill_controller.h"
#include <QtGui/qtextcursor.h>
#include <QtCore/qmetatype.h>

#include <QtCore/qtmochelpers.h>

#include <memory>


#include <QtCore/qxptype_traits.h>
#if !defined(Q_MOC_OUTPUT_REVISION)
#error "The header file 'credential_autofill_controller.h' doesn't include <QObject>."
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
struct qt_meta_tag_ZN28CredentialAutofillControllerE_t {};
} // unnamed namespace

template <> constexpr inline auto CredentialAutofillController::qt_create_metaobjectdata<qt_meta_tag_ZN28CredentialAutofillControllerE_t>()
{
    namespace QMC = QtMocConstants;
    QtMocHelpers::StringRefStorage qt_stringData {
        "CredentialAutofillController",
        "openPasswordManagerRequested",
        "",
        "saveBubbleShown",
        "origin",
        "username",
        "CredentialSaveMode",
        "mode",
        "saveBubbleDismissed",
        "credentialSaved",
        "credentialUpdated",
        "reauthenticationRequested",
        "credentialFillDispatched",
        "saveFlowStateChanged",
        "CredentialSaveFlowState",
        "state",
        "saveFlowEnded",
        "reasonCode"
    };

    QtMocHelpers::UintData qt_methods {
        // Signal 'openPasswordManagerRequested'
        QtMocHelpers::SignalData<void()>(1, 2, QMC::AccessPublic, QMetaType::Void),
        // Signal 'saveBubbleShown'
        QtMocHelpers::SignalData<void(const QString &, const QString &, CredentialSaveMode)>(3, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::QString, 4 }, { QMetaType::QString, 5 }, { 0x80000000 | 6, 7 },
        }}),
        // Signal 'saveBubbleDismissed'
        QtMocHelpers::SignalData<void()>(8, 2, QMC::AccessPublic, QMetaType::Void),
        // Signal 'credentialSaved'
        QtMocHelpers::SignalData<void(const QString &, const QString &)>(9, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::QString, 4 }, { QMetaType::QString, 5 },
        }}),
        // Signal 'credentialUpdated'
        QtMocHelpers::SignalData<void(const QString &, const QString &)>(10, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::QString, 4 }, { QMetaType::QString, 5 },
        }}),
        // Signal 'reauthenticationRequested'
        QtMocHelpers::SignalData<void(const QString &)>(11, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::QString, 4 },
        }}),
        // Signal 'credentialFillDispatched'
        QtMocHelpers::SignalData<void(const QString &, const QString &)>(12, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::QString, 4 }, { QMetaType::QString, 5 },
        }}),
        // Signal 'saveFlowStateChanged'
        QtMocHelpers::SignalData<void(const QString &, const QString &, CredentialSaveFlowState)>(13, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::QString, 4 }, { QMetaType::QString, 5 }, { 0x80000000 | 14, 15 },
        }}),
        // Signal 'saveFlowEnded'
        QtMocHelpers::SignalData<void(const QString &)>(16, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::QString, 17 },
        }}),
    };
    QtMocHelpers::UintData qt_properties {
    };
    QtMocHelpers::UintData qt_enums {
    };
    return QtMocHelpers::metaObjectData<CredentialAutofillController, qt_meta_tag_ZN28CredentialAutofillControllerE_t>(QMC::MetaObjectFlag{}, qt_stringData,
            qt_methods, qt_properties, qt_enums);
}
Q_CONSTINIT const QMetaObject CredentialAutofillController::staticMetaObject = { {
    QMetaObject::SuperData::link<QObject::staticMetaObject>(),
    qt_staticMetaObjectStaticContent<qt_meta_tag_ZN28CredentialAutofillControllerE_t>.stringdata,
    qt_staticMetaObjectStaticContent<qt_meta_tag_ZN28CredentialAutofillControllerE_t>.data,
    qt_static_metacall,
    nullptr,
    qt_staticMetaObjectRelocatingContent<qt_meta_tag_ZN28CredentialAutofillControllerE_t>.metaTypes,
    nullptr
} };

void CredentialAutofillController::qt_static_metacall(QObject *_o, QMetaObject::Call _c, int _id, void **_a)
{
    auto *_t = static_cast<CredentialAutofillController *>(_o);
    if (_c == QMetaObject::InvokeMetaMethod) {
        switch (_id) {
        case 0: _t->openPasswordManagerRequested(); break;
        case 1: _t->saveBubbleShown((*reinterpret_cast<std::add_pointer_t<QString>>(_a[1])),(*reinterpret_cast<std::add_pointer_t<QString>>(_a[2])),(*reinterpret_cast<std::add_pointer_t<CredentialSaveMode>>(_a[3]))); break;
        case 2: _t->saveBubbleDismissed(); break;
        case 3: _t->credentialSaved((*reinterpret_cast<std::add_pointer_t<QString>>(_a[1])),(*reinterpret_cast<std::add_pointer_t<QString>>(_a[2]))); break;
        case 4: _t->credentialUpdated((*reinterpret_cast<std::add_pointer_t<QString>>(_a[1])),(*reinterpret_cast<std::add_pointer_t<QString>>(_a[2]))); break;
        case 5: _t->reauthenticationRequested((*reinterpret_cast<std::add_pointer_t<QString>>(_a[1]))); break;
        case 6: _t->credentialFillDispatched((*reinterpret_cast<std::add_pointer_t<QString>>(_a[1])),(*reinterpret_cast<std::add_pointer_t<QString>>(_a[2]))); break;
        case 7: _t->saveFlowStateChanged((*reinterpret_cast<std::add_pointer_t<QString>>(_a[1])),(*reinterpret_cast<std::add_pointer_t<QString>>(_a[2])),(*reinterpret_cast<std::add_pointer_t<CredentialSaveFlowState>>(_a[3]))); break;
        case 8: _t->saveFlowEnded((*reinterpret_cast<std::add_pointer_t<QString>>(_a[1]))); break;
        default: ;
        }
    }
    if (_c == QMetaObject::IndexOfMethod) {
        if (QtMocHelpers::indexOfMethod<void (CredentialAutofillController::*)()>(_a, &CredentialAutofillController::openPasswordManagerRequested, 0))
            return;
        if (QtMocHelpers::indexOfMethod<void (CredentialAutofillController::*)(const QString & , const QString & , CredentialSaveMode )>(_a, &CredentialAutofillController::saveBubbleShown, 1))
            return;
        if (QtMocHelpers::indexOfMethod<void (CredentialAutofillController::*)()>(_a, &CredentialAutofillController::saveBubbleDismissed, 2))
            return;
        if (QtMocHelpers::indexOfMethod<void (CredentialAutofillController::*)(const QString & , const QString & )>(_a, &CredentialAutofillController::credentialSaved, 3))
            return;
        if (QtMocHelpers::indexOfMethod<void (CredentialAutofillController::*)(const QString & , const QString & )>(_a, &CredentialAutofillController::credentialUpdated, 4))
            return;
        if (QtMocHelpers::indexOfMethod<void (CredentialAutofillController::*)(const QString & )>(_a, &CredentialAutofillController::reauthenticationRequested, 5))
            return;
        if (QtMocHelpers::indexOfMethod<void (CredentialAutofillController::*)(const QString & , const QString & )>(_a, &CredentialAutofillController::credentialFillDispatched, 6))
            return;
        if (QtMocHelpers::indexOfMethod<void (CredentialAutofillController::*)(const QString & , const QString & , CredentialSaveFlowState )>(_a, &CredentialAutofillController::saveFlowStateChanged, 7))
            return;
        if (QtMocHelpers::indexOfMethod<void (CredentialAutofillController::*)(const QString & )>(_a, &CredentialAutofillController::saveFlowEnded, 8))
            return;
    }
}

const QMetaObject *CredentialAutofillController::metaObject() const
{
    return QObject::d_ptr->metaObject ? QObject::d_ptr->dynamicMetaObject() : &staticMetaObject;
}

void *CredentialAutofillController::qt_metacast(const char *_clname)
{
    if (!_clname) return nullptr;
    if (!strcmp(_clname, qt_staticMetaObjectStaticContent<qt_meta_tag_ZN28CredentialAutofillControllerE_t>.strings))
        return static_cast<void*>(this);
    return QObject::qt_metacast(_clname);
}

int CredentialAutofillController::qt_metacall(QMetaObject::Call _c, int _id, void **_a)
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
void CredentialAutofillController::openPasswordManagerRequested()
{
    QMetaObject::activate(this, &staticMetaObject, 0, nullptr);
}

// SIGNAL 1
void CredentialAutofillController::saveBubbleShown(const QString & _t1, const QString & _t2, CredentialSaveMode _t3)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 1, nullptr, _t1, _t2, _t3);
}

// SIGNAL 2
void CredentialAutofillController::saveBubbleDismissed()
{
    QMetaObject::activate(this, &staticMetaObject, 2, nullptr);
}

// SIGNAL 3
void CredentialAutofillController::credentialSaved(const QString & _t1, const QString & _t2)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 3, nullptr, _t1, _t2);
}

// SIGNAL 4
void CredentialAutofillController::credentialUpdated(const QString & _t1, const QString & _t2)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 4, nullptr, _t1, _t2);
}

// SIGNAL 5
void CredentialAutofillController::reauthenticationRequested(const QString & _t1)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 5, nullptr, _t1);
}

// SIGNAL 6
void CredentialAutofillController::credentialFillDispatched(const QString & _t1, const QString & _t2)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 6, nullptr, _t1, _t2);
}

// SIGNAL 7
void CredentialAutofillController::saveFlowStateChanged(const QString & _t1, const QString & _t2, CredentialSaveFlowState _t3)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 7, nullptr, _t1, _t2, _t3);
}

// SIGNAL 8
void CredentialAutofillController::saveFlowEnded(const QString & _t1)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 8, nullptr, _t1);
}
QT_WARNING_POP
