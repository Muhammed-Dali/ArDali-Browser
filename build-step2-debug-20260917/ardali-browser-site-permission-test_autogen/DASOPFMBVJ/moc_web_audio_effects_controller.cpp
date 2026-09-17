/****************************************************************************
** Meta object code from reading C++ file 'web_audio_effects_controller.h'
**
** Created by: The Qt Meta Object Compiler version 69 (Qt 6.11.2)
**
** WARNING! All changes made in this file will be lost!
*****************************************************************************/

#include "../../../browser/native/audio/web_audio_effects_controller.h"
#include <QtCore/qmetatype.h>
#include <QtCore/QList>

#include <QtCore/qtmochelpers.h>

#include <memory>


#include <QtCore/qxptype_traits.h>
#if !defined(Q_MOC_OUTPUT_REVISION)
#error "The header file 'web_audio_effects_controller.h' doesn't include <QObject>."
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
struct qt_meta_tag_ZN25WebAudioEffectsControllerE_t {};
} // unnamed namespace

template <> constexpr inline auto WebAudioEffectsController::qt_create_metaobjectdata<qt_meta_tag_ZN25WebAudioEffectsControllerE_t>()
{
    namespace QMC = QtMocConstants;
    QtMocHelpers::StringRefStorage qt_stringData {
        "WebAudioEffectsController",
        "stateChanged",
        "",
        "statusChanged",
        "WebAudioEffectsController::Status",
        "status",
        "compressorGainReductionChanged",
        "reductionDb",
        "available",
        "limiterReductionChanged",
        "setEnabled",
        "enabled",
        "setPreampDb",
        "db",
        "resetOutput",
        "setEqualizerBand",
        "index",
        "previewEqualizerBands",
        "QList<double>",
        "bands",
        "commitEqualizerBands",
        "setBassDb",
        "setMidDb",
        "setTrebleDb",
        "setStereoExpanderPercent",
        "percent",
        "setBalance",
        "value",
        "setAcousticSpace",
        "space",
        "resetEqualizer",
        "resetEqualizerModule",
        "setModuleEnabled",
        "moduleId",
        "setReverbEnabled",
        "setReverbRoomSizeMs",
        "setReverbDamping",
        "setReverbWetDryDb",
        "setReverbHfRatio",
        "setReverbInputGainDb",
        "applyReverbPreset",
        "presetId",
        "resetReverb",
        "setCompressorEnabled",
        "setCompressorThresholdDb",
        "setCompressorRatio",
        "setCompressorAttackMs",
        "setCompressorReleaseMs",
        "setCompressorMakeupDb",
        "setCompressorKneeDb",
        "applyCompressorPreset",
        "resetCompressor",
        "requestCompressorGainReduction",
        "setLimiterEnabled",
        "setLimiterCeilingDb",
        "setLimiterReleaseMs",
        "setLimiterLookaheadMs",
        "setLimiterGainDb",
        "applyLimiterPreset",
        "resetLimiter",
        "requestLimiterReduction",
        "setBassEnhancerEnabled",
        "setBassEnhancerFrequencyHz",
        "setBassEnhancerGainDb",
        "setBassEnhancerHarmonicsPercent",
        "setBassEnhancerWidth",
        "setBassEnhancerMixPercent",
        "applyBassEnhancerDeep",
        "resetBassEnhancer",
        "setAutoGainEnabled",
        "setAutoGainTargetDbfs",
        "setAutoGainMaxGainDb",
        "applyAutoGainPreset",
        "resetAutoGain",
        "setPerformancePolicyMode",
        "ardali::PerformancePolicyMode",
        "mode",
        "setPanelVisible",
        "visible",
        "activeSubpanelId",
        "applyToAllWebViews",
        "injectionScript",
        "parameterUpdateScript",
        "equalizerBandUpdateScript"
    };

    QtMocHelpers::UintData qt_methods {
        // Signal 'stateChanged'
        QtMocHelpers::SignalData<void()>(1, 2, QMC::AccessPublic, QMetaType::Void),
        // Signal 'statusChanged'
        QtMocHelpers::SignalData<void(const WebAudioEffectsController::Status &)>(3, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 4, 5 },
        }}),
        // Signal 'compressorGainReductionChanged'
        QtMocHelpers::SignalData<void(double, bool)>(6, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::Double, 7 }, { QMetaType::Bool, 8 },
        }}),
        // Signal 'limiterReductionChanged'
        QtMocHelpers::SignalData<void(double, bool)>(9, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::Double, 7 }, { QMetaType::Bool, 8 },
        }}),
        // Slot 'setEnabled'
        QtMocHelpers::SlotData<void(bool)>(10, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::Bool, 11 },
        }}),
        // Slot 'setPreampDb'
        QtMocHelpers::SlotData<void(double)>(12, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::Double, 13 },
        }}),
        // Slot 'resetOutput'
        QtMocHelpers::SlotData<void()>(14, 2, QMC::AccessPublic, QMetaType::Void),
        // Slot 'setEqualizerBand'
        QtMocHelpers::SlotData<void(int, double)>(15, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::Int, 16 }, { QMetaType::Double, 13 },
        }}),
        // Slot 'previewEqualizerBands'
        QtMocHelpers::SlotData<void(const QVector<double> &)>(17, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 18, 19 },
        }}),
        // Slot 'commitEqualizerBands'
        QtMocHelpers::SlotData<void(const QVector<double> &)>(20, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 18, 19 },
        }}),
        // Slot 'setBassDb'
        QtMocHelpers::SlotData<void(double)>(21, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::Double, 13 },
        }}),
        // Slot 'setMidDb'
        QtMocHelpers::SlotData<void(double)>(22, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::Double, 13 },
        }}),
        // Slot 'setTrebleDb'
        QtMocHelpers::SlotData<void(double)>(23, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::Double, 13 },
        }}),
        // Slot 'setStereoExpanderPercent'
        QtMocHelpers::SlotData<void(double)>(24, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::Double, 25 },
        }}),
        // Slot 'setBalance'
        QtMocHelpers::SlotData<void(double)>(26, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::Double, 27 },
        }}),
        // Slot 'setAcousticSpace'
        QtMocHelpers::SlotData<void(const QString &)>(28, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::QString, 29 },
        }}),
        // Slot 'resetEqualizer'
        QtMocHelpers::SlotData<void()>(30, 2, QMC::AccessPublic, QMetaType::Void),
        // Slot 'resetEqualizerModule'
        QtMocHelpers::SlotData<void()>(31, 2, QMC::AccessPublic, QMetaType::Void),
        // Slot 'setModuleEnabled'
        QtMocHelpers::SlotData<void(const QString &, bool)>(32, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::QString, 33 }, { QMetaType::Bool, 11 },
        }}),
        // Slot 'setReverbEnabled'
        QtMocHelpers::SlotData<void(bool)>(34, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::Bool, 11 },
        }}),
        // Slot 'setReverbRoomSizeMs'
        QtMocHelpers::SlotData<void(double)>(35, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::Double, 27 },
        }}),
        // Slot 'setReverbDamping'
        QtMocHelpers::SlotData<void(double)>(36, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::Double, 27 },
        }}),
        // Slot 'setReverbWetDryDb'
        QtMocHelpers::SlotData<void(double)>(37, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::Double, 27 },
        }}),
        // Slot 'setReverbHfRatio'
        QtMocHelpers::SlotData<void(double)>(38, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::Double, 27 },
        }}),
        // Slot 'setReverbInputGainDb'
        QtMocHelpers::SlotData<void(double)>(39, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::Double, 27 },
        }}),
        // Slot 'applyReverbPreset'
        QtMocHelpers::SlotData<void(const QString &)>(40, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::QString, 41 },
        }}),
        // Slot 'resetReverb'
        QtMocHelpers::SlotData<void()>(42, 2, QMC::AccessPublic, QMetaType::Void),
        // Slot 'setCompressorEnabled'
        QtMocHelpers::SlotData<void(bool)>(43, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::Bool, 11 },
        }}),
        // Slot 'setCompressorThresholdDb'
        QtMocHelpers::SlotData<void(double)>(44, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::Double, 27 },
        }}),
        // Slot 'setCompressorRatio'
        QtMocHelpers::SlotData<void(double)>(45, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::Double, 27 },
        }}),
        // Slot 'setCompressorAttackMs'
        QtMocHelpers::SlotData<void(double)>(46, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::Double, 27 },
        }}),
        // Slot 'setCompressorReleaseMs'
        QtMocHelpers::SlotData<void(double)>(47, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::Double, 27 },
        }}),
        // Slot 'setCompressorMakeupDb'
        QtMocHelpers::SlotData<void(double)>(48, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::Double, 27 },
        }}),
        // Slot 'setCompressorKneeDb'
        QtMocHelpers::SlotData<void(double)>(49, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::Double, 27 },
        }}),
        // Slot 'applyCompressorPreset'
        QtMocHelpers::SlotData<void(const QString &)>(50, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::QString, 41 },
        }}),
        // Slot 'resetCompressor'
        QtMocHelpers::SlotData<void()>(51, 2, QMC::AccessPublic, QMetaType::Void),
        // Slot 'requestCompressorGainReduction'
        QtMocHelpers::SlotData<void()>(52, 2, QMC::AccessPublic, QMetaType::Void),
        // Slot 'setLimiterEnabled'
        QtMocHelpers::SlotData<void(bool)>(53, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::Bool, 11 },
        }}),
        // Slot 'setLimiterCeilingDb'
        QtMocHelpers::SlotData<void(double)>(54, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::Double, 27 },
        }}),
        // Slot 'setLimiterReleaseMs'
        QtMocHelpers::SlotData<void(double)>(55, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::Double, 27 },
        }}),
        // Slot 'setLimiterLookaheadMs'
        QtMocHelpers::SlotData<void(double)>(56, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::Double, 27 },
        }}),
        // Slot 'setLimiterGainDb'
        QtMocHelpers::SlotData<void(double)>(57, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::Double, 27 },
        }}),
        // Slot 'applyLimiterPreset'
        QtMocHelpers::SlotData<void(const QString &)>(58, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::QString, 41 },
        }}),
        // Slot 'resetLimiter'
        QtMocHelpers::SlotData<void()>(59, 2, QMC::AccessPublic, QMetaType::Void),
        // Slot 'requestLimiterReduction'
        QtMocHelpers::SlotData<void()>(60, 2, QMC::AccessPublic, QMetaType::Void),
        // Slot 'setBassEnhancerEnabled'
        QtMocHelpers::SlotData<void(bool)>(61, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::Bool, 11 },
        }}),
        // Slot 'setBassEnhancerFrequencyHz'
        QtMocHelpers::SlotData<void(double)>(62, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::Double, 27 },
        }}),
        // Slot 'setBassEnhancerGainDb'
        QtMocHelpers::SlotData<void(double)>(63, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::Double, 27 },
        }}),
        // Slot 'setBassEnhancerHarmonicsPercent'
        QtMocHelpers::SlotData<void(double)>(64, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::Double, 27 },
        }}),
        // Slot 'setBassEnhancerWidth'
        QtMocHelpers::SlotData<void(double)>(65, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::Double, 27 },
        }}),
        // Slot 'setBassEnhancerMixPercent'
        QtMocHelpers::SlotData<void(double)>(66, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::Double, 27 },
        }}),
        // Slot 'applyBassEnhancerDeep'
        QtMocHelpers::SlotData<void()>(67, 2, QMC::AccessPublic, QMetaType::Void),
        // Slot 'resetBassEnhancer'
        QtMocHelpers::SlotData<void()>(68, 2, QMC::AccessPublic, QMetaType::Void),
        // Slot 'setAutoGainEnabled'
        QtMocHelpers::SlotData<void(bool)>(69, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::Bool, 11 },
        }}),
        // Slot 'setAutoGainTargetDbfs'
        QtMocHelpers::SlotData<void(double)>(70, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::Double, 27 },
        }}),
        // Slot 'setAutoGainMaxGainDb'
        QtMocHelpers::SlotData<void(double)>(71, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::Double, 27 },
        }}),
        // Slot 'applyAutoGainPreset'
        QtMocHelpers::SlotData<void(const QString &)>(72, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::QString, 41 },
        }}),
        // Slot 'resetAutoGain'
        QtMocHelpers::SlotData<void()>(73, 2, QMC::AccessPublic, QMetaType::Void),
        // Slot 'setPerformancePolicyMode'
        QtMocHelpers::SlotData<void(ardali::PerformancePolicyMode)>(74, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 75, 76 },
        }}),
        // Slot 'setPanelVisible'
        QtMocHelpers::SlotData<void(bool, const QString &)>(77, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::Bool, 78 }, { QMetaType::QString, 79 },
        }}),
        // Slot 'setPanelVisible'
        QtMocHelpers::SlotData<void(bool)>(77, 2, QMC::AccessPublic | QMC::MethodCloned, QMetaType::Void, {{
            { QMetaType::Bool, 78 },
        }}),
        // Slot 'applyToAllWebViews'
        QtMocHelpers::SlotData<void()>(80, 2, QMC::AccessPublic, QMetaType::Void),
        // Slot 'injectionScript'
        QtMocHelpers::SlotData<QString() const>(81, 2, QMC::AccessPublic, QMetaType::QString),
        // Slot 'parameterUpdateScript'
        QtMocHelpers::SlotData<QString() const>(82, 2, QMC::AccessPublic, QMetaType::QString),
        // Slot 'equalizerBandUpdateScript'
        QtMocHelpers::SlotData<QString(int) const>(83, 2, QMC::AccessPublic, QMetaType::QString, {{
            { QMetaType::Int, 16 },
        }}),
    };
    QtMocHelpers::UintData qt_properties {
    };
    QtMocHelpers::UintData qt_enums {
    };
    return QtMocHelpers::metaObjectData<WebAudioEffectsController, qt_meta_tag_ZN25WebAudioEffectsControllerE_t>(QMC::MetaObjectFlag{}, qt_stringData,
            qt_methods, qt_properties, qt_enums);
}
Q_CONSTINIT const QMetaObject WebAudioEffectsController::staticMetaObject = { {
    QMetaObject::SuperData::link<QObject::staticMetaObject>(),
    qt_staticMetaObjectStaticContent<qt_meta_tag_ZN25WebAudioEffectsControllerE_t>.stringdata,
    qt_staticMetaObjectStaticContent<qt_meta_tag_ZN25WebAudioEffectsControllerE_t>.data,
    qt_static_metacall,
    nullptr,
    qt_staticMetaObjectRelocatingContent<qt_meta_tag_ZN25WebAudioEffectsControllerE_t>.metaTypes,
    nullptr
} };

void WebAudioEffectsController::qt_static_metacall(QObject *_o, QMetaObject::Call _c, int _id, void **_a)
{
    auto *_t = static_cast<WebAudioEffectsController *>(_o);
    if (_c == QMetaObject::InvokeMetaMethod) {
        switch (_id) {
        case 0: _t->stateChanged(); break;
        case 1: _t->statusChanged((*reinterpret_cast<std::add_pointer_t<WebAudioEffectsController::Status>>(_a[1]))); break;
        case 2: _t->compressorGainReductionChanged((*reinterpret_cast<std::add_pointer_t<double>>(_a[1])),(*reinterpret_cast<std::add_pointer_t<bool>>(_a[2]))); break;
        case 3: _t->limiterReductionChanged((*reinterpret_cast<std::add_pointer_t<double>>(_a[1])),(*reinterpret_cast<std::add_pointer_t<bool>>(_a[2]))); break;
        case 4: _t->setEnabled((*reinterpret_cast<std::add_pointer_t<bool>>(_a[1]))); break;
        case 5: _t->setPreampDb((*reinterpret_cast<std::add_pointer_t<double>>(_a[1]))); break;
        case 6: _t->resetOutput(); break;
        case 7: _t->setEqualizerBand((*reinterpret_cast<std::add_pointer_t<int>>(_a[1])),(*reinterpret_cast<std::add_pointer_t<double>>(_a[2]))); break;
        case 8: _t->previewEqualizerBands((*reinterpret_cast<std::add_pointer_t<QList<double>>>(_a[1]))); break;
        case 9: _t->commitEqualizerBands((*reinterpret_cast<std::add_pointer_t<QList<double>>>(_a[1]))); break;
        case 10: _t->setBassDb((*reinterpret_cast<std::add_pointer_t<double>>(_a[1]))); break;
        case 11: _t->setMidDb((*reinterpret_cast<std::add_pointer_t<double>>(_a[1]))); break;
        case 12: _t->setTrebleDb((*reinterpret_cast<std::add_pointer_t<double>>(_a[1]))); break;
        case 13: _t->setStereoExpanderPercent((*reinterpret_cast<std::add_pointer_t<double>>(_a[1]))); break;
        case 14: _t->setBalance((*reinterpret_cast<std::add_pointer_t<double>>(_a[1]))); break;
        case 15: _t->setAcousticSpace((*reinterpret_cast<std::add_pointer_t<QString>>(_a[1]))); break;
        case 16: _t->resetEqualizer(); break;
        case 17: _t->resetEqualizerModule(); break;
        case 18: _t->setModuleEnabled((*reinterpret_cast<std::add_pointer_t<QString>>(_a[1])),(*reinterpret_cast<std::add_pointer_t<bool>>(_a[2]))); break;
        case 19: _t->setReverbEnabled((*reinterpret_cast<std::add_pointer_t<bool>>(_a[1]))); break;
        case 20: _t->setReverbRoomSizeMs((*reinterpret_cast<std::add_pointer_t<double>>(_a[1]))); break;
        case 21: _t->setReverbDamping((*reinterpret_cast<std::add_pointer_t<double>>(_a[1]))); break;
        case 22: _t->setReverbWetDryDb((*reinterpret_cast<std::add_pointer_t<double>>(_a[1]))); break;
        case 23: _t->setReverbHfRatio((*reinterpret_cast<std::add_pointer_t<double>>(_a[1]))); break;
        case 24: _t->setReverbInputGainDb((*reinterpret_cast<std::add_pointer_t<double>>(_a[1]))); break;
        case 25: _t->applyReverbPreset((*reinterpret_cast<std::add_pointer_t<QString>>(_a[1]))); break;
        case 26: _t->resetReverb(); break;
        case 27: _t->setCompressorEnabled((*reinterpret_cast<std::add_pointer_t<bool>>(_a[1]))); break;
        case 28: _t->setCompressorThresholdDb((*reinterpret_cast<std::add_pointer_t<double>>(_a[1]))); break;
        case 29: _t->setCompressorRatio((*reinterpret_cast<std::add_pointer_t<double>>(_a[1]))); break;
        case 30: _t->setCompressorAttackMs((*reinterpret_cast<std::add_pointer_t<double>>(_a[1]))); break;
        case 31: _t->setCompressorReleaseMs((*reinterpret_cast<std::add_pointer_t<double>>(_a[1]))); break;
        case 32: _t->setCompressorMakeupDb((*reinterpret_cast<std::add_pointer_t<double>>(_a[1]))); break;
        case 33: _t->setCompressorKneeDb((*reinterpret_cast<std::add_pointer_t<double>>(_a[1]))); break;
        case 34: _t->applyCompressorPreset((*reinterpret_cast<std::add_pointer_t<QString>>(_a[1]))); break;
        case 35: _t->resetCompressor(); break;
        case 36: _t->requestCompressorGainReduction(); break;
        case 37: _t->setLimiterEnabled((*reinterpret_cast<std::add_pointer_t<bool>>(_a[1]))); break;
        case 38: _t->setLimiterCeilingDb((*reinterpret_cast<std::add_pointer_t<double>>(_a[1]))); break;
        case 39: _t->setLimiterReleaseMs((*reinterpret_cast<std::add_pointer_t<double>>(_a[1]))); break;
        case 40: _t->setLimiterLookaheadMs((*reinterpret_cast<std::add_pointer_t<double>>(_a[1]))); break;
        case 41: _t->setLimiterGainDb((*reinterpret_cast<std::add_pointer_t<double>>(_a[1]))); break;
        case 42: _t->applyLimiterPreset((*reinterpret_cast<std::add_pointer_t<QString>>(_a[1]))); break;
        case 43: _t->resetLimiter(); break;
        case 44: _t->requestLimiterReduction(); break;
        case 45: _t->setBassEnhancerEnabled((*reinterpret_cast<std::add_pointer_t<bool>>(_a[1]))); break;
        case 46: _t->setBassEnhancerFrequencyHz((*reinterpret_cast<std::add_pointer_t<double>>(_a[1]))); break;
        case 47: _t->setBassEnhancerGainDb((*reinterpret_cast<std::add_pointer_t<double>>(_a[1]))); break;
        case 48: _t->setBassEnhancerHarmonicsPercent((*reinterpret_cast<std::add_pointer_t<double>>(_a[1]))); break;
        case 49: _t->setBassEnhancerWidth((*reinterpret_cast<std::add_pointer_t<double>>(_a[1]))); break;
        case 50: _t->setBassEnhancerMixPercent((*reinterpret_cast<std::add_pointer_t<double>>(_a[1]))); break;
        case 51: _t->applyBassEnhancerDeep(); break;
        case 52: _t->resetBassEnhancer(); break;
        case 53: _t->setAutoGainEnabled((*reinterpret_cast<std::add_pointer_t<bool>>(_a[1]))); break;
        case 54: _t->setAutoGainTargetDbfs((*reinterpret_cast<std::add_pointer_t<double>>(_a[1]))); break;
        case 55: _t->setAutoGainMaxGainDb((*reinterpret_cast<std::add_pointer_t<double>>(_a[1]))); break;
        case 56: _t->applyAutoGainPreset((*reinterpret_cast<std::add_pointer_t<QString>>(_a[1]))); break;
        case 57: _t->resetAutoGain(); break;
        case 58: _t->setPerformancePolicyMode((*reinterpret_cast<std::add_pointer_t<ardali::PerformancePolicyMode>>(_a[1]))); break;
        case 59: _t->setPanelVisible((*reinterpret_cast<std::add_pointer_t<bool>>(_a[1])),(*reinterpret_cast<std::add_pointer_t<QString>>(_a[2]))); break;
        case 60: _t->setPanelVisible((*reinterpret_cast<std::add_pointer_t<bool>>(_a[1]))); break;
        case 61: _t->applyToAllWebViews(); break;
        case 62: { QString _r = _t->injectionScript();
            if (_a[0]) *reinterpret_cast<QString*>(_a[0]) = std::move(_r); }  break;
        case 63: { QString _r = _t->parameterUpdateScript();
            if (_a[0]) *reinterpret_cast<QString*>(_a[0]) = std::move(_r); }  break;
        case 64: { QString _r = _t->equalizerBandUpdateScript((*reinterpret_cast<std::add_pointer_t<int>>(_a[1])));
            if (_a[0]) *reinterpret_cast<QString*>(_a[0]) = std::move(_r); }  break;
        default: ;
        }
    }
    if (_c == QMetaObject::RegisterMethodArgumentMetaType) {
        switch (_id) {
        default: *reinterpret_cast<QMetaType *>(_a[0]) = QMetaType(); break;
        case 1:
            switch (*reinterpret_cast<int*>(_a[1])) {
            default: *reinterpret_cast<QMetaType *>(_a[0]) = QMetaType(); break;
            case 0:
                *reinterpret_cast<QMetaType *>(_a[0]) = QMetaType::fromType< WebAudioEffectsController::Status >(); break;
            }
            break;
        case 8:
            switch (*reinterpret_cast<int*>(_a[1])) {
            default: *reinterpret_cast<QMetaType *>(_a[0]) = QMetaType(); break;
            case 0:
                *reinterpret_cast<QMetaType *>(_a[0]) = QMetaType::fromType< QList<double> >(); break;
            }
            break;
        case 9:
            switch (*reinterpret_cast<int*>(_a[1])) {
            default: *reinterpret_cast<QMetaType *>(_a[0]) = QMetaType(); break;
            case 0:
                *reinterpret_cast<QMetaType *>(_a[0]) = QMetaType::fromType< QList<double> >(); break;
            }
            break;
        }
    }
    if (_c == QMetaObject::IndexOfMethod) {
        if (QtMocHelpers::indexOfMethod<void (WebAudioEffectsController::*)()>(_a, &WebAudioEffectsController::stateChanged, 0))
            return;
        if (QtMocHelpers::indexOfMethod<void (WebAudioEffectsController::*)(const WebAudioEffectsController::Status & )>(_a, &WebAudioEffectsController::statusChanged, 1))
            return;
        if (QtMocHelpers::indexOfMethod<void (WebAudioEffectsController::*)(double , bool )>(_a, &WebAudioEffectsController::compressorGainReductionChanged, 2))
            return;
        if (QtMocHelpers::indexOfMethod<void (WebAudioEffectsController::*)(double , bool )>(_a, &WebAudioEffectsController::limiterReductionChanged, 3))
            return;
    }
}

const QMetaObject *WebAudioEffectsController::metaObject() const
{
    return QObject::d_ptr->metaObject ? QObject::d_ptr->dynamicMetaObject() : &staticMetaObject;
}

void *WebAudioEffectsController::qt_metacast(const char *_clname)
{
    if (!_clname) return nullptr;
    if (!strcmp(_clname, qt_staticMetaObjectStaticContent<qt_meta_tag_ZN25WebAudioEffectsControllerE_t>.strings))
        return static_cast<void*>(this);
    return QObject::qt_metacast(_clname);
}

int WebAudioEffectsController::qt_metacall(QMetaObject::Call _c, int _id, void **_a)
{
    _id = QObject::qt_metacall(_c, _id, _a);
    if (_id < 0)
        return _id;
    if (_c == QMetaObject::InvokeMetaMethod) {
        if (_id < 65)
            qt_static_metacall(this, _c, _id, _a);
        _id -= 65;
    }
    if (_c == QMetaObject::RegisterMethodArgumentMetaType) {
        if (_id < 65)
            qt_static_metacall(this, _c, _id, _a);
        _id -= 65;
    }
    return _id;
}

// SIGNAL 0
void WebAudioEffectsController::stateChanged()
{
    QMetaObject::activate(this, &staticMetaObject, 0, nullptr);
}

// SIGNAL 1
void WebAudioEffectsController::statusChanged(const WebAudioEffectsController::Status & _t1)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 1, nullptr, _t1);
}

// SIGNAL 2
void WebAudioEffectsController::compressorGainReductionChanged(double _t1, bool _t2)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 2, nullptr, _t1, _t2);
}

// SIGNAL 3
void WebAudioEffectsController::limiterReductionChanged(double _t1, bool _t2)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 3, nullptr, _t1, _t2);
}
QT_WARNING_POP
