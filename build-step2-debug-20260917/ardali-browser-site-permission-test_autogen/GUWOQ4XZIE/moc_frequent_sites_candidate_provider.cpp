/****************************************************************************
** Meta object code from reading C++ file 'frequent_sites_candidate_provider.h'
**
** Created by: The Qt Meta Object Compiler version 69 (Qt 6.11.2)
**
** WARNING! All changes made in this file will be lost!
*****************************************************************************/

#include "../../../browser/native/core/frequent_sites_candidate_provider.h"
#include <QtCore/qmetatype.h>

#include <QtCore/qtmochelpers.h>

#include <memory>


#include <QtCore/qxptype_traits.h>
#if !defined(Q_MOC_OUTPUT_REVISION)
#error "The header file 'frequent_sites_candidate_provider.h' doesn't include <QObject>."
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
struct qt_meta_tag_ZN6ardali4core30FrequentSitesCandidateProviderE_t {};
} // unnamed namespace

template <> constexpr inline auto ardali::core::FrequentSitesCandidateProvider::qt_create_metaobjectdata<qt_meta_tag_ZN6ardali4core30FrequentSitesCandidateProviderE_t>()
{
    namespace QMC = QtMocConstants;
    QtMocHelpers::StringRefStorage qt_stringData {
        "ardali::core::FrequentSitesCandidateProvider",
        "markDirty",
        ""
    };

    QtMocHelpers::UintData qt_methods {
        // Slot 'markDirty'
        QtMocHelpers::SlotData<void()>(1, 2, QMC::AccessPublic, QMetaType::Void),
    };
    QtMocHelpers::UintData qt_properties {
    };
    QtMocHelpers::UintData qt_enums {
    };
    return QtMocHelpers::metaObjectData<FrequentSitesCandidateProvider, qt_meta_tag_ZN6ardali4core30FrequentSitesCandidateProviderE_t>(QMC::MetaObjectFlag{}, qt_stringData,
            qt_methods, qt_properties, qt_enums);
}
Q_CONSTINIT const QMetaObject ardali::core::FrequentSitesCandidateProvider::staticMetaObject = { {
    QMetaObject::SuperData::link<QObject::staticMetaObject>(),
    qt_staticMetaObjectStaticContent<qt_meta_tag_ZN6ardali4core30FrequentSitesCandidateProviderE_t>.stringdata,
    qt_staticMetaObjectStaticContent<qt_meta_tag_ZN6ardali4core30FrequentSitesCandidateProviderE_t>.data,
    qt_static_metacall,
    nullptr,
    qt_staticMetaObjectRelocatingContent<qt_meta_tag_ZN6ardali4core30FrequentSitesCandidateProviderE_t>.metaTypes,
    nullptr
} };

void ardali::core::FrequentSitesCandidateProvider::qt_static_metacall(QObject *_o, QMetaObject::Call _c, int _id, void **_a)
{
    auto *_t = static_cast<FrequentSitesCandidateProvider *>(_o);
    if (_c == QMetaObject::InvokeMetaMethod) {
        switch (_id) {
        case 0: _t->markDirty(); break;
        default: ;
        }
    }
    (void)_a;
}

const QMetaObject *ardali::core::FrequentSitesCandidateProvider::metaObject() const
{
    return QObject::d_ptr->metaObject ? QObject::d_ptr->dynamicMetaObject() : &staticMetaObject;
}

void *ardali::core::FrequentSitesCandidateProvider::qt_metacast(const char *_clname)
{
    if (!_clname) return nullptr;
    if (!strcmp(_clname, qt_staticMetaObjectStaticContent<qt_meta_tag_ZN6ardali4core30FrequentSitesCandidateProviderE_t>.strings))
        return static_cast<void*>(this);
    if (!strcmp(_clname, "INavigationCandidateProvider"))
        return static_cast< INavigationCandidateProvider*>(this);
    return QObject::qt_metacast(_clname);
}

int ardali::core::FrequentSitesCandidateProvider::qt_metacall(QMetaObject::Call _c, int _id, void **_a)
{
    _id = QObject::qt_metacall(_c, _id, _a);
    if (_id < 0)
        return _id;
    if (_c == QMetaObject::InvokeMetaMethod) {
        if (_id < 1)
            qt_static_metacall(this, _c, _id, _a);
        _id -= 1;
    }
    if (_c == QMetaObject::RegisterMethodArgumentMetaType) {
        if (_id < 1)
            *reinterpret_cast<QMetaType *>(_a[0]) = QMetaType();
        _id -= 1;
    }
    return _id;
}
QT_WARNING_POP
