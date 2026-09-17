/****************************************************************************
** Meta object code from reading C++ file 'browser_profile_service.h'
**
** Created by: The Qt Meta Object Compiler version 69 (Qt 6.11.2)
**
** WARNING! All changes made in this file will be lost!
*****************************************************************************/

#include "../../../browser/native/core/browser_profile_service.h"
#include <QtCore/qmetatype.h>

#include <QtCore/qtmochelpers.h>

#include <memory>


#include <QtCore/qxptype_traits.h>
#if !defined(Q_MOC_OUTPUT_REVISION)
#error "The header file 'browser_profile_service.h' doesn't include <QObject>."
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
struct qt_meta_tag_ZN21BrowserProfileServiceE_t {};
} // unnamed namespace

template <> constexpr inline auto BrowserProfileService::qt_create_metaobjectdata<qt_meta_tag_ZN21BrowserProfileServiceE_t>()
{
    namespace QMC = QtMocConstants;
    QtMocHelpers::StringRefStorage qt_stringData {
        "BrowserProfileService",
        "downloadsChanged",
        "",
        "bookmarksChanged",
        "historyChanged",
        "trackingProtectionChanged",
        "contentSettingsChanged",
        "permissionsPolicyChanged",
        "searchSuggestionsChanged",
        "enabled",
        "searchEngineChanged",
        "engine",
        "closedTabsChanged",
        "secureDnsChanged"
    };

    QtMocHelpers::UintData qt_methods {
        // Signal 'downloadsChanged'
        QtMocHelpers::SignalData<void()>(1, 2, QMC::AccessPublic, QMetaType::Void),
        // Signal 'bookmarksChanged'
        QtMocHelpers::SignalData<void()>(3, 2, QMC::AccessPublic, QMetaType::Void),
        // Signal 'historyChanged'
        QtMocHelpers::SignalData<void()>(4, 2, QMC::AccessPublic, QMetaType::Void),
        // Signal 'trackingProtectionChanged'
        QtMocHelpers::SignalData<void()>(5, 2, QMC::AccessPublic, QMetaType::Void),
        // Signal 'contentSettingsChanged'
        QtMocHelpers::SignalData<void()>(6, 2, QMC::AccessPublic, QMetaType::Void),
        // Signal 'permissionsPolicyChanged'
        QtMocHelpers::SignalData<void()>(7, 2, QMC::AccessPublic, QMetaType::Void),
        // Signal 'searchSuggestionsChanged'
        QtMocHelpers::SignalData<void(bool)>(8, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::Bool, 9 },
        }}),
        // Signal 'searchEngineChanged'
        QtMocHelpers::SignalData<void(const QString &)>(10, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::QString, 11 },
        }}),
        // Signal 'closedTabsChanged'
        QtMocHelpers::SignalData<void()>(12, 2, QMC::AccessPublic, QMetaType::Void),
        // Signal 'secureDnsChanged'
        QtMocHelpers::SignalData<void()>(13, 2, QMC::AccessPublic, QMetaType::Void),
    };
    QtMocHelpers::UintData qt_properties {
    };
    QtMocHelpers::UintData qt_enums {
    };
    return QtMocHelpers::metaObjectData<BrowserProfileService, qt_meta_tag_ZN21BrowserProfileServiceE_t>(QMC::MetaObjectFlag{}, qt_stringData,
            qt_methods, qt_properties, qt_enums);
}
Q_CONSTINIT const QMetaObject BrowserProfileService::staticMetaObject = { {
    QMetaObject::SuperData::link<QObject::staticMetaObject>(),
    qt_staticMetaObjectStaticContent<qt_meta_tag_ZN21BrowserProfileServiceE_t>.stringdata,
    qt_staticMetaObjectStaticContent<qt_meta_tag_ZN21BrowserProfileServiceE_t>.data,
    qt_static_metacall,
    nullptr,
    qt_staticMetaObjectRelocatingContent<qt_meta_tag_ZN21BrowserProfileServiceE_t>.metaTypes,
    nullptr
} };

void BrowserProfileService::qt_static_metacall(QObject *_o, QMetaObject::Call _c, int _id, void **_a)
{
    auto *_t = static_cast<BrowserProfileService *>(_o);
    if (_c == QMetaObject::InvokeMetaMethod) {
        switch (_id) {
        case 0: _t->downloadsChanged(); break;
        case 1: _t->bookmarksChanged(); break;
        case 2: _t->historyChanged(); break;
        case 3: _t->trackingProtectionChanged(); break;
        case 4: _t->contentSettingsChanged(); break;
        case 5: _t->permissionsPolicyChanged(); break;
        case 6: _t->searchSuggestionsChanged((*reinterpret_cast<std::add_pointer_t<bool>>(_a[1]))); break;
        case 7: _t->searchEngineChanged((*reinterpret_cast<std::add_pointer_t<QString>>(_a[1]))); break;
        case 8: _t->closedTabsChanged(); break;
        case 9: _t->secureDnsChanged(); break;
        default: ;
        }
    }
    if (_c == QMetaObject::IndexOfMethod) {
        if (QtMocHelpers::indexOfMethod<void (BrowserProfileService::*)()>(_a, &BrowserProfileService::downloadsChanged, 0))
            return;
        if (QtMocHelpers::indexOfMethod<void (BrowserProfileService::*)()>(_a, &BrowserProfileService::bookmarksChanged, 1))
            return;
        if (QtMocHelpers::indexOfMethod<void (BrowserProfileService::*)()>(_a, &BrowserProfileService::historyChanged, 2))
            return;
        if (QtMocHelpers::indexOfMethod<void (BrowserProfileService::*)()>(_a, &BrowserProfileService::trackingProtectionChanged, 3))
            return;
        if (QtMocHelpers::indexOfMethod<void (BrowserProfileService::*)()>(_a, &BrowserProfileService::contentSettingsChanged, 4))
            return;
        if (QtMocHelpers::indexOfMethod<void (BrowserProfileService::*)()>(_a, &BrowserProfileService::permissionsPolicyChanged, 5))
            return;
        if (QtMocHelpers::indexOfMethod<void (BrowserProfileService::*)(bool )>(_a, &BrowserProfileService::searchSuggestionsChanged, 6))
            return;
        if (QtMocHelpers::indexOfMethod<void (BrowserProfileService::*)(const QString & )>(_a, &BrowserProfileService::searchEngineChanged, 7))
            return;
        if (QtMocHelpers::indexOfMethod<void (BrowserProfileService::*)()>(_a, &BrowserProfileService::closedTabsChanged, 8))
            return;
        if (QtMocHelpers::indexOfMethod<void (BrowserProfileService::*)()>(_a, &BrowserProfileService::secureDnsChanged, 9))
            return;
    }
}

const QMetaObject *BrowserProfileService::metaObject() const
{
    return QObject::d_ptr->metaObject ? QObject::d_ptr->dynamicMetaObject() : &staticMetaObject;
}

void *BrowserProfileService::qt_metacast(const char *_clname)
{
    if (!_clname) return nullptr;
    if (!strcmp(_clname, qt_staticMetaObjectStaticContent<qt_meta_tag_ZN21BrowserProfileServiceE_t>.strings))
        return static_cast<void*>(this);
    if (!strcmp(_clname, "ardali::core::IBrowserProfileDataProvider"))
        return static_cast< ardali::core::IBrowserProfileDataProvider*>(this);
    return QObject::qt_metacast(_clname);
}

int BrowserProfileService::qt_metacall(QMetaObject::Call _c, int _id, void **_a)
{
    _id = QObject::qt_metacall(_c, _id, _a);
    if (_id < 0)
        return _id;
    if (_c == QMetaObject::InvokeMetaMethod) {
        if (_id < 10)
            qt_static_metacall(this, _c, _id, _a);
        _id -= 10;
    }
    if (_c == QMetaObject::RegisterMethodArgumentMetaType) {
        if (_id < 10)
            *reinterpret_cast<QMetaType *>(_a[0]) = QMetaType();
        _id -= 10;
    }
    return _id;
}

// SIGNAL 0
void BrowserProfileService::downloadsChanged()
{
    QMetaObject::activate(this, &staticMetaObject, 0, nullptr);
}

// SIGNAL 1
void BrowserProfileService::bookmarksChanged()
{
    QMetaObject::activate(this, &staticMetaObject, 1, nullptr);
}

// SIGNAL 2
void BrowserProfileService::historyChanged()
{
    QMetaObject::activate(this, &staticMetaObject, 2, nullptr);
}

// SIGNAL 3
void BrowserProfileService::trackingProtectionChanged()
{
    QMetaObject::activate(this, &staticMetaObject, 3, nullptr);
}

// SIGNAL 4
void BrowserProfileService::contentSettingsChanged()
{
    QMetaObject::activate(this, &staticMetaObject, 4, nullptr);
}

// SIGNAL 5
void BrowserProfileService::permissionsPolicyChanged()
{
    QMetaObject::activate(this, &staticMetaObject, 5, nullptr);
}

// SIGNAL 6
void BrowserProfileService::searchSuggestionsChanged(bool _t1)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 6, nullptr, _t1);
}

// SIGNAL 7
void BrowserProfileService::searchEngineChanged(const QString & _t1)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 7, nullptr, _t1);
}

// SIGNAL 8
void BrowserProfileService::closedTabsChanged()
{
    QMetaObject::activate(this, &staticMetaObject, 8, nullptr);
}

// SIGNAL 9
void BrowserProfileService::secureDnsChanged()
{
    QMetaObject::activate(this, &staticMetaObject, 9, nullptr);
}
QT_WARNING_POP
