/****************************************************************************
** Meta object code from reading C++ file 'song_finder_page.h'
**
** Created by: The Qt Meta Object Compiler version 69 (Qt 6.11.2)
**
** WARNING! All changes made in this file will be lost!
*****************************************************************************/

#include "../../../browser/native/pulse/song_finder_page.h"
#include <QtNetwork/QSslError>
#include <QtCore/qmetatype.h>
#include <QtCore/QList>

#include <QtCore/qtmochelpers.h>

#include <memory>


#include <QtCore/qxptype_traits.h>
#if !defined(Q_MOC_OUTPUT_REVISION)
#error "The header file 'song_finder_page.h' doesn't include <QObject>."
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
struct qt_meta_tag_ZN14SongFinderPageE_t {};
} // unnamed namespace

template <> constexpr inline auto SongFinderPage::qt_create_metaobjectdata<qt_meta_tag_ZN14SongFinderPageE_t>()
{
    namespace QMC = QtMocConstants;
    QtMocHelpers::StringRefStorage qt_stringData {
        "SongFinderPage",
        "openPreferencesRequested",
        "",
        "openUrlRequested",
        "QUrl",
        "url",
        "onBigListenButtonClicked",
        "onRefreshDevicesClicked",
        "onDeviceSelectionChanged",
        "index",
        "onServiceStateChanged",
        "SongRecognitionService::State",
        "state",
        "message",
        "onServiceVolumeChanged",
        "levelPercent",
        "bufferFillPercent",
        "activeSourceName",
        "onServiceSongFound",
        "SongResult",
        "result",
        "onServiceDevicesUpdated",
        "QList<AudioDeviceInfo>",
        "devices",
        "AutoRouteInfo",
        "route",
        "onAutoOpenRequested",
        "SongFinderSettings::OpenPlatform",
        "platform"
    };

    QtMocHelpers::UintData qt_methods {
        // Signal 'openPreferencesRequested'
        QtMocHelpers::SignalData<void()>(1, 2, QMC::AccessPublic, QMetaType::Void),
        // Signal 'openUrlRequested'
        QtMocHelpers::SignalData<void(const QUrl &)>(3, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 4, 5 },
        }}),
        // Slot 'onBigListenButtonClicked'
        QtMocHelpers::SlotData<void()>(6, 2, QMC::AccessPrivate, QMetaType::Void),
        // Slot 'onRefreshDevicesClicked'
        QtMocHelpers::SlotData<void()>(7, 2, QMC::AccessPrivate, QMetaType::Void),
        // Slot 'onDeviceSelectionChanged'
        QtMocHelpers::SlotData<void(int)>(8, 2, QMC::AccessPrivate, QMetaType::Void, {{
            { QMetaType::Int, 9 },
        }}),
        // Slot 'onServiceStateChanged'
        QtMocHelpers::SlotData<void(SongRecognitionService::State, const QString &)>(10, 2, QMC::AccessPrivate, QMetaType::Void, {{
            { 0x80000000 | 11, 12 }, { QMetaType::QString, 13 },
        }}),
        // Slot 'onServiceVolumeChanged'
        QtMocHelpers::SlotData<void(double, double, const QString &)>(14, 2, QMC::AccessPrivate, QMetaType::Void, {{
            { QMetaType::Double, 15 }, { QMetaType::Double, 16 }, { QMetaType::QString, 17 },
        }}),
        // Slot 'onServiceSongFound'
        QtMocHelpers::SlotData<void(const SongResult &)>(18, 2, QMC::AccessPrivate, QMetaType::Void, {{
            { 0x80000000 | 19, 20 },
        }}),
        // Slot 'onServiceDevicesUpdated'
        QtMocHelpers::SlotData<void(const QVector<AudioDeviceInfo> &, const AutoRouteInfo &)>(21, 2, QMC::AccessPrivate, QMetaType::Void, {{
            { 0x80000000 | 22, 23 }, { 0x80000000 | 24, 25 },
        }}),
        // Slot 'onAutoOpenRequested'
        QtMocHelpers::SlotData<void(const SongResult &, SongFinderSettings::OpenPlatform)>(26, 2, QMC::AccessPrivate, QMetaType::Void, {{
            { 0x80000000 | 19, 20 }, { 0x80000000 | 27, 28 },
        }}),
    };
    QtMocHelpers::UintData qt_properties {
    };
    QtMocHelpers::UintData qt_enums {
    };
    return QtMocHelpers::metaObjectData<SongFinderPage, qt_meta_tag_ZN14SongFinderPageE_t>(QMC::MetaObjectFlag{}, qt_stringData,
            qt_methods, qt_properties, qt_enums);
}
Q_CONSTINIT const QMetaObject SongFinderPage::staticMetaObject = { {
    QMetaObject::SuperData::link<QWidget::staticMetaObject>(),
    qt_staticMetaObjectStaticContent<qt_meta_tag_ZN14SongFinderPageE_t>.stringdata,
    qt_staticMetaObjectStaticContent<qt_meta_tag_ZN14SongFinderPageE_t>.data,
    qt_static_metacall,
    nullptr,
    qt_staticMetaObjectRelocatingContent<qt_meta_tag_ZN14SongFinderPageE_t>.metaTypes,
    nullptr
} };

void SongFinderPage::qt_static_metacall(QObject *_o, QMetaObject::Call _c, int _id, void **_a)
{
    auto *_t = static_cast<SongFinderPage *>(_o);
    if (_c == QMetaObject::InvokeMetaMethod) {
        switch (_id) {
        case 0: _t->openPreferencesRequested(); break;
        case 1: _t->openUrlRequested((*reinterpret_cast<std::add_pointer_t<QUrl>>(_a[1]))); break;
        case 2: _t->onBigListenButtonClicked(); break;
        case 3: _t->onRefreshDevicesClicked(); break;
        case 4: _t->onDeviceSelectionChanged((*reinterpret_cast<std::add_pointer_t<int>>(_a[1]))); break;
        case 5: _t->onServiceStateChanged((*reinterpret_cast<std::add_pointer_t<SongRecognitionService::State>>(_a[1])),(*reinterpret_cast<std::add_pointer_t<QString>>(_a[2]))); break;
        case 6: _t->onServiceVolumeChanged((*reinterpret_cast<std::add_pointer_t<double>>(_a[1])),(*reinterpret_cast<std::add_pointer_t<double>>(_a[2])),(*reinterpret_cast<std::add_pointer_t<QString>>(_a[3]))); break;
        case 7: _t->onServiceSongFound((*reinterpret_cast<std::add_pointer_t<SongResult>>(_a[1]))); break;
        case 8: _t->onServiceDevicesUpdated((*reinterpret_cast<std::add_pointer_t<QList<AudioDeviceInfo>>>(_a[1])),(*reinterpret_cast<std::add_pointer_t<AutoRouteInfo>>(_a[2]))); break;
        case 9: _t->onAutoOpenRequested((*reinterpret_cast<std::add_pointer_t<SongResult>>(_a[1])),(*reinterpret_cast<std::add_pointer_t<SongFinderSettings::OpenPlatform>>(_a[2]))); break;
        default: ;
        }
    }
    if (_c == QMetaObject::IndexOfMethod) {
        if (QtMocHelpers::indexOfMethod<void (SongFinderPage::*)()>(_a, &SongFinderPage::openPreferencesRequested, 0))
            return;
        if (QtMocHelpers::indexOfMethod<void (SongFinderPage::*)(const QUrl & )>(_a, &SongFinderPage::openUrlRequested, 1))
            return;
    }
}

const QMetaObject *SongFinderPage::metaObject() const
{
    return QObject::d_ptr->metaObject ? QObject::d_ptr->dynamicMetaObject() : &staticMetaObject;
}

void *SongFinderPage::qt_metacast(const char *_clname)
{
    if (!_clname) return nullptr;
    if (!strcmp(_clname, qt_staticMetaObjectStaticContent<qt_meta_tag_ZN14SongFinderPageE_t>.strings))
        return static_cast<void*>(this);
    return QWidget::qt_metacast(_clname);
}

int SongFinderPage::qt_metacall(QMetaObject::Call _c, int _id, void **_a)
{
    _id = QWidget::qt_metacall(_c, _id, _a);
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
void SongFinderPage::openPreferencesRequested()
{
    QMetaObject::activate(this, &staticMetaObject, 0, nullptr);
}

// SIGNAL 1
void SongFinderPage::openUrlRequested(const QUrl & _t1)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 1, nullptr, _t1);
}
QT_WARNING_POP
