/****************************************************************************
** Meta object code from reading C++ file 'pulse_toolbar_button.h'
**
** Created by: The Qt Meta Object Compiler version 69 (Qt 6.11.2)
**
** WARNING! All changes made in this file will be lost!
*****************************************************************************/

#include "../../../browser/native/pulse/pulse_toolbar_button.h"
#include <QtNetwork/QSslError>
#include <QtCore/qmetatype.h>

#include <QtCore/qtmochelpers.h>

#include <memory>


#include <QtCore/qxptype_traits.h>
#if !defined(Q_MOC_OUTPUT_REVISION)
#error "The header file 'pulse_toolbar_button.h' doesn't include <QObject>."
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
struct qt_meta_tag_ZN15PulseResultCardE_t {};
} // unnamed namespace

template <> constexpr inline auto PulseResultCard::qt_create_metaobjectdata<qt_meta_tag_ZN15PulseResultCardE_t>()
{
    namespace QMC = QtMocConstants;
    QtMocHelpers::StringRefStorage qt_stringData {
        "PulseResultCard",
        "clicked",
        "",
        "SongResult",
        "result"
    };

    QtMocHelpers::UintData qt_methods {
        // Signal 'clicked'
        QtMocHelpers::SignalData<void(const SongResult &)>(1, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 3, 4 },
        }}),
    };
    QtMocHelpers::UintData qt_properties {
    };
    QtMocHelpers::UintData qt_enums {
    };
    return QtMocHelpers::metaObjectData<PulseResultCard, qt_meta_tag_ZN15PulseResultCardE_t>(QMC::MetaObjectFlag{}, qt_stringData,
            qt_methods, qt_properties, qt_enums);
}
Q_CONSTINIT const QMetaObject PulseResultCard::staticMetaObject = { {
    QMetaObject::SuperData::link<QFrame::staticMetaObject>(),
    qt_staticMetaObjectStaticContent<qt_meta_tag_ZN15PulseResultCardE_t>.stringdata,
    qt_staticMetaObjectStaticContent<qt_meta_tag_ZN15PulseResultCardE_t>.data,
    qt_static_metacall,
    nullptr,
    qt_staticMetaObjectRelocatingContent<qt_meta_tag_ZN15PulseResultCardE_t>.metaTypes,
    nullptr
} };

void PulseResultCard::qt_static_metacall(QObject *_o, QMetaObject::Call _c, int _id, void **_a)
{
    auto *_t = static_cast<PulseResultCard *>(_o);
    if (_c == QMetaObject::InvokeMetaMethod) {
        switch (_id) {
        case 0: _t->clicked((*reinterpret_cast<std::add_pointer_t<SongResult>>(_a[1]))); break;
        default: ;
        }
    }
    if (_c == QMetaObject::IndexOfMethod) {
        if (QtMocHelpers::indexOfMethod<void (PulseResultCard::*)(const SongResult & )>(_a, &PulseResultCard::clicked, 0))
            return;
    }
}

const QMetaObject *PulseResultCard::metaObject() const
{
    return QObject::d_ptr->metaObject ? QObject::d_ptr->dynamicMetaObject() : &staticMetaObject;
}

void *PulseResultCard::qt_metacast(const char *_clname)
{
    if (!_clname) return nullptr;
    if (!strcmp(_clname, qt_staticMetaObjectStaticContent<qt_meta_tag_ZN15PulseResultCardE_t>.strings))
        return static_cast<void*>(this);
    return QFrame::qt_metacast(_clname);
}

int PulseResultCard::qt_metacall(QMetaObject::Call _c, int _id, void **_a)
{
    _id = QFrame::qt_metacall(_c, _id, _a);
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

// SIGNAL 0
void PulseResultCard::clicked(const SongResult & _t1)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 0, nullptr, _t1);
}
namespace {
struct qt_meta_tag_ZN15PulseQuickPopupE_t {};
} // unnamed namespace

template <> constexpr inline auto PulseQuickPopup::qt_create_metaobjectdata<qt_meta_tag_ZN15PulseQuickPopupE_t>()
{
    namespace QMC = QtMocConstants;
    QtMocHelpers::StringRefStorage qt_stringData {
        "PulseQuickPopup",
        "openUrlRequested",
        "",
        "QUrl",
        "url",
        "openFullPageRequested",
        "openSettingsRequested",
        "onListenButtonClicked",
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
        "onResultCardClicked"
    };

    QtMocHelpers::UintData qt_methods {
        // Signal 'openUrlRequested'
        QtMocHelpers::SignalData<void(const QUrl &)>(1, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 3, 4 },
        }}),
        // Signal 'openFullPageRequested'
        QtMocHelpers::SignalData<void()>(5, 2, QMC::AccessPublic, QMetaType::Void),
        // Signal 'openSettingsRequested'
        QtMocHelpers::SignalData<void()>(6, 2, QMC::AccessPublic, QMetaType::Void),
        // Slot 'onListenButtonClicked'
        QtMocHelpers::SlotData<void()>(7, 2, QMC::AccessPrivate, QMetaType::Void),
        // Slot 'onServiceStateChanged'
        QtMocHelpers::SlotData<void(SongRecognitionService::State, const QString &)>(8, 2, QMC::AccessPrivate, QMetaType::Void, {{
            { 0x80000000 | 9, 10 }, { QMetaType::QString, 11 },
        }}),
        // Slot 'onServiceVolumeChanged'
        QtMocHelpers::SlotData<void(double, double, const QString &)>(12, 2, QMC::AccessPrivate, QMetaType::Void, {{
            { QMetaType::Double, 13 }, { QMetaType::Double, 14 }, { QMetaType::QString, 15 },
        }}),
        // Slot 'onServiceSongFound'
        QtMocHelpers::SlotData<void(const SongResult &)>(16, 2, QMC::AccessPrivate, QMetaType::Void, {{
            { 0x80000000 | 17, 18 },
        }}),
        // Slot 'onResultCardClicked'
        QtMocHelpers::SlotData<void(const SongResult &)>(19, 2, QMC::AccessPrivate, QMetaType::Void, {{
            { 0x80000000 | 17, 18 },
        }}),
    };
    QtMocHelpers::UintData qt_properties {
    };
    QtMocHelpers::UintData qt_enums {
    };
    return QtMocHelpers::metaObjectData<PulseQuickPopup, qt_meta_tag_ZN15PulseQuickPopupE_t>(QMC::MetaObjectFlag{}, qt_stringData,
            qt_methods, qt_properties, qt_enums);
}
Q_CONSTINIT const QMetaObject PulseQuickPopup::staticMetaObject = { {
    QMetaObject::SuperData::link<QFrame::staticMetaObject>(),
    qt_staticMetaObjectStaticContent<qt_meta_tag_ZN15PulseQuickPopupE_t>.stringdata,
    qt_staticMetaObjectStaticContent<qt_meta_tag_ZN15PulseQuickPopupE_t>.data,
    qt_static_metacall,
    nullptr,
    qt_staticMetaObjectRelocatingContent<qt_meta_tag_ZN15PulseQuickPopupE_t>.metaTypes,
    nullptr
} };

void PulseQuickPopup::qt_static_metacall(QObject *_o, QMetaObject::Call _c, int _id, void **_a)
{
    auto *_t = static_cast<PulseQuickPopup *>(_o);
    if (_c == QMetaObject::InvokeMetaMethod) {
        switch (_id) {
        case 0: _t->openUrlRequested((*reinterpret_cast<std::add_pointer_t<QUrl>>(_a[1]))); break;
        case 1: _t->openFullPageRequested(); break;
        case 2: _t->openSettingsRequested(); break;
        case 3: _t->onListenButtonClicked(); break;
        case 4: _t->onServiceStateChanged((*reinterpret_cast<std::add_pointer_t<SongRecognitionService::State>>(_a[1])),(*reinterpret_cast<std::add_pointer_t<QString>>(_a[2]))); break;
        case 5: _t->onServiceVolumeChanged((*reinterpret_cast<std::add_pointer_t<double>>(_a[1])),(*reinterpret_cast<std::add_pointer_t<double>>(_a[2])),(*reinterpret_cast<std::add_pointer_t<QString>>(_a[3]))); break;
        case 6: _t->onServiceSongFound((*reinterpret_cast<std::add_pointer_t<SongResult>>(_a[1]))); break;
        case 7: _t->onResultCardClicked((*reinterpret_cast<std::add_pointer_t<SongResult>>(_a[1]))); break;
        default: ;
        }
    }
    if (_c == QMetaObject::IndexOfMethod) {
        if (QtMocHelpers::indexOfMethod<void (PulseQuickPopup::*)(const QUrl & )>(_a, &PulseQuickPopup::openUrlRequested, 0))
            return;
        if (QtMocHelpers::indexOfMethod<void (PulseQuickPopup::*)()>(_a, &PulseQuickPopup::openFullPageRequested, 1))
            return;
        if (QtMocHelpers::indexOfMethod<void (PulseQuickPopup::*)()>(_a, &PulseQuickPopup::openSettingsRequested, 2))
            return;
    }
}

const QMetaObject *PulseQuickPopup::metaObject() const
{
    return QObject::d_ptr->metaObject ? QObject::d_ptr->dynamicMetaObject() : &staticMetaObject;
}

void *PulseQuickPopup::qt_metacast(const char *_clname)
{
    if (!_clname) return nullptr;
    if (!strcmp(_clname, qt_staticMetaObjectStaticContent<qt_meta_tag_ZN15PulseQuickPopupE_t>.strings))
        return static_cast<void*>(this);
    return QFrame::qt_metacast(_clname);
}

int PulseQuickPopup::qt_metacall(QMetaObject::Call _c, int _id, void **_a)
{
    _id = QFrame::qt_metacall(_c, _id, _a);
    if (_id < 0)
        return _id;
    if (_c == QMetaObject::InvokeMetaMethod) {
        if (_id < 8)
            qt_static_metacall(this, _c, _id, _a);
        _id -= 8;
    }
    if (_c == QMetaObject::RegisterMethodArgumentMetaType) {
        if (_id < 8)
            *reinterpret_cast<QMetaType *>(_a[0]) = QMetaType();
        _id -= 8;
    }
    return _id;
}

// SIGNAL 0
void PulseQuickPopup::openUrlRequested(const QUrl & _t1)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 0, nullptr, _t1);
}

// SIGNAL 1
void PulseQuickPopup::openFullPageRequested()
{
    QMetaObject::activate(this, &staticMetaObject, 1, nullptr);
}

// SIGNAL 2
void PulseQuickPopup::openSettingsRequested()
{
    QMetaObject::activate(this, &staticMetaObject, 2, nullptr);
}
namespace {
struct qt_meta_tag_ZN18PulseToolbarButtonE_t {};
} // unnamed namespace

template <> constexpr inline auto PulseToolbarButton::qt_create_metaobjectdata<qt_meta_tag_ZN18PulseToolbarButtonE_t>()
{
    namespace QMC = QtMocConstants;
    QtMocHelpers::StringRefStorage qt_stringData {
        "PulseToolbarButton",
        "openUrlRequested",
        "",
        "QUrl",
        "url",
        "openFullPageRequested",
        "openSettingsRequested",
        "toggleQuickPopup",
        "onServiceStateChanged",
        "SongRecognitionService::State",
        "state",
        "message",
        "onAnimTick"
    };

    QtMocHelpers::UintData qt_methods {
        // Signal 'openUrlRequested'
        QtMocHelpers::SignalData<void(const QUrl &)>(1, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 3, 4 },
        }}),
        // Signal 'openFullPageRequested'
        QtMocHelpers::SignalData<void()>(5, 2, QMC::AccessPublic, QMetaType::Void),
        // Signal 'openSettingsRequested'
        QtMocHelpers::SignalData<void()>(6, 2, QMC::AccessPublic, QMetaType::Void),
        // Slot 'toggleQuickPopup'
        QtMocHelpers::SlotData<void()>(7, 2, QMC::AccessPrivate, QMetaType::Void),
        // Slot 'onServiceStateChanged'
        QtMocHelpers::SlotData<void(SongRecognitionService::State, const QString &)>(8, 2, QMC::AccessPrivate, QMetaType::Void, {{
            { 0x80000000 | 9, 10 }, { QMetaType::QString, 11 },
        }}),
        // Slot 'onAnimTick'
        QtMocHelpers::SlotData<void()>(12, 2, QMC::AccessPrivate, QMetaType::Void),
    };
    QtMocHelpers::UintData qt_properties {
    };
    QtMocHelpers::UintData qt_enums {
    };
    return QtMocHelpers::metaObjectData<PulseToolbarButton, qt_meta_tag_ZN18PulseToolbarButtonE_t>(QMC::MetaObjectFlag{}, qt_stringData,
            qt_methods, qt_properties, qt_enums);
}
Q_CONSTINIT const QMetaObject PulseToolbarButton::staticMetaObject = { {
    QMetaObject::SuperData::link<QToolButton::staticMetaObject>(),
    qt_staticMetaObjectStaticContent<qt_meta_tag_ZN18PulseToolbarButtonE_t>.stringdata,
    qt_staticMetaObjectStaticContent<qt_meta_tag_ZN18PulseToolbarButtonE_t>.data,
    qt_static_metacall,
    nullptr,
    qt_staticMetaObjectRelocatingContent<qt_meta_tag_ZN18PulseToolbarButtonE_t>.metaTypes,
    nullptr
} };

void PulseToolbarButton::qt_static_metacall(QObject *_o, QMetaObject::Call _c, int _id, void **_a)
{
    auto *_t = static_cast<PulseToolbarButton *>(_o);
    if (_c == QMetaObject::InvokeMetaMethod) {
        switch (_id) {
        case 0: _t->openUrlRequested((*reinterpret_cast<std::add_pointer_t<QUrl>>(_a[1]))); break;
        case 1: _t->openFullPageRequested(); break;
        case 2: _t->openSettingsRequested(); break;
        case 3: _t->toggleQuickPopup(); break;
        case 4: _t->onServiceStateChanged((*reinterpret_cast<std::add_pointer_t<SongRecognitionService::State>>(_a[1])),(*reinterpret_cast<std::add_pointer_t<QString>>(_a[2]))); break;
        case 5: _t->onAnimTick(); break;
        default: ;
        }
    }
    if (_c == QMetaObject::IndexOfMethod) {
        if (QtMocHelpers::indexOfMethod<void (PulseToolbarButton::*)(const QUrl & )>(_a, &PulseToolbarButton::openUrlRequested, 0))
            return;
        if (QtMocHelpers::indexOfMethod<void (PulseToolbarButton::*)()>(_a, &PulseToolbarButton::openFullPageRequested, 1))
            return;
        if (QtMocHelpers::indexOfMethod<void (PulseToolbarButton::*)()>(_a, &PulseToolbarButton::openSettingsRequested, 2))
            return;
    }
}

const QMetaObject *PulseToolbarButton::metaObject() const
{
    return QObject::d_ptr->metaObject ? QObject::d_ptr->dynamicMetaObject() : &staticMetaObject;
}

void *PulseToolbarButton::qt_metacast(const char *_clname)
{
    if (!_clname) return nullptr;
    if (!strcmp(_clname, qt_staticMetaObjectStaticContent<qt_meta_tag_ZN18PulseToolbarButtonE_t>.strings))
        return static_cast<void*>(this);
    return QToolButton::qt_metacast(_clname);
}

int PulseToolbarButton::qt_metacall(QMetaObject::Call _c, int _id, void **_a)
{
    _id = QToolButton::qt_metacall(_c, _id, _a);
    if (_id < 0)
        return _id;
    if (_c == QMetaObject::InvokeMetaMethod) {
        if (_id < 6)
            qt_static_metacall(this, _c, _id, _a);
        _id -= 6;
    }
    if (_c == QMetaObject::RegisterMethodArgumentMetaType) {
        if (_id < 6)
            *reinterpret_cast<QMetaType *>(_a[0]) = QMetaType();
        _id -= 6;
    }
    return _id;
}

// SIGNAL 0
void PulseToolbarButton::openUrlRequested(const QUrl & _t1)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 0, nullptr, _t1);
}

// SIGNAL 1
void PulseToolbarButton::openFullPageRequested()
{
    QMetaObject::activate(this, &staticMetaObject, 1, nullptr);
}

// SIGNAL 2
void PulseToolbarButton::openSettingsRequested()
{
    QMetaObject::activate(this, &staticMetaObject, 2, nullptr);
}
QT_WARNING_POP
