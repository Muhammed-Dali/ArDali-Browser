// ============================================
// AURIVO AUDIO ENGINE - Profesyonel BASS Ses
// Electron için Node.js Native Eklentisi
// Sürüm 2.0 - Clipping Yok, Derin Bass
// ============================================

#include <napi.h>
#include <string>
#include <cstring>
#include <cmath>
#include <mutex>
#include <vector>
#include <atomic>
#include <array>
#include <algorithm>
#include <chrono>

// BASS headers
#include "bass.h"
#include "bass_fx.h"

#include <thread>
#include <chrono>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

// Aurivo DSP C API (src/audio/aurivo_dsp.cpp)
extern "C" {
    void* create_dsp();
    void destroy_dsp(void* dsp);
    void process_dsp(void* dsp, float* buffer, int numFrames, int channels);
    void set_eq_band(void* dsp, int band, float gain);
    void set_eq_bands(void* dsp, const float* gains, int numBands);
    void set_tone_params(void* dsp, float bass, float mid, float treble);
    void set_stereo_width(void* dsp, float width);
    void set_dsp_enabled(void* dsp, int enabled);
    void set_sample_rate(void* dsp, float sample_rate);
    void set_compressor_params(void *dsp, int enabled, float thresh, float ratio, float att, float rel, float makeup);
    void set_gate_params(void *dsp, int enabled, float thresh, float att, float rel);
    void set_limiter_params(void *dsp, int enabled, float ceiling, float rel);
    void set_echo_params(void *dsp, int enabled, float delay, float feedback, float mix);
    void set_bass_boost(void *dsp, int enabled, float gain, float freq);
    void set_peq_band(void *dsp, int band, int enabled, float freq, float gain, float Q);
    void set_peq_filter_type(void *dsp, int band, int filterType);
    void get_peq_band(void *dsp, int band, float* freq, float* gain, float* Q, int* filterType);
    void set_crossfeed_params(void *dsp, int enabled, float level, float delay, float lowCut, float highCut);
    void set_bass_mono_params(void *dsp, int enabled, float cutoff, float slope, float width);
    void set_dynamic_eq_params(void *dsp, int enabled, float freq, float q, float thr, float gain, float rng, float atk, float rel);
}

// ============================================
// SABİTLER
// ============================================
static const int NUM_EQ_BANDS = 32;
static const int SAMPLE_RATE = 44100;
static const int FFT_SIZE = 2048;

// Logaritmik frekans dağılımı - 32 bant (20Hz - 20kHz)
static const std::array<float, NUM_EQ_BANDS> EQ_FREQUENCIES = {
    20.0f, 25.0f, 31.5f, 40.0f, 50.0f, 63.0f, 80.0f, 100.0f,
    125.0f, 160.0f, 200.0f, 250.0f, 315.0f, 400.0f, 500.0f, 630.0f,
    800.0f, 1000.0f, 1250.0f, 1600.0f, 2000.0f, 2500.0f, 3150.0f, 4000.0f,
    5000.0f, 6300.0f, 8000.0f, 10000.0f, 12500.0f, 16000.0f, 20000.0f, 20000.0f
};

// Bass boost için düşük frekans bantları (20Hz - 250Hz arası = ilk 12 bant)
static const int BASS_BOOST_BANDS = 12;

// ============================================
// YARDIMCI FONKSİYONLAR
// ============================================
static inline float clampf(float value, float minVal, float maxVal) {
    return std::max(minVal, std::min(value, maxVal));
}

static inline float dBToLinear(float dB) {
    return std::pow(10.0f, dB / 20.0f);
}

static inline float linearTodB(float linear) {
    if (linear <= 0.0f) return -96.0f;
    return 20.0f * std::log10(linear);
}

// ============================================
// KOMPRESÖR (BASS_FX)
// ============================================
static HFX fxCompressor = 0;

struct CompressorParams {
    float threshold = -20.0f;   // dB
    float ratio = 4.0f;         // 4:1
    float attack = 10.0f;       // ms
    float release = 100.0f;     // ms
    float makeupGain = 0.0f;    // dB
    float knee = 3.0f;          // dB
    bool enabled = false;
};

static CompressorParams g_compressor;

// ============================================
// LİMİTER PARAMETRELERİ
// ============================================
struct LimiterParams {
    float ceiling = -0.3f;      // dB (maksimum çıkış)
    float release = 50.0f;      // ms
    float lookahead = 5.0f;     // ms (öngörü)
    float inputGain = 0.0f;     // dB (giriş kazancı)
    bool enabled = false;
};

static LimiterParams g_limiter;

// ============================================
// BASS ENHANCER PARAMETRELERİ
// ============================================
struct BassEnhancerParams {
    float frequency = 80.0f;      // Hz (merkez frekans)
    float gain = 6.0f;            // dB (boost miktarı)
    float harmonics = 50.0f;      // % (harmonik zenginleştirme)
    float width = 1.5f;           // Etki genişliği (bandwidth multiplier)
    float dryWet = 50.0f;         // % (karışım oranı)
    bool enabled = false;
};

static BassEnhancerParams g_bassEnhancer;

// ============================================
// NOISE GATE PARAMETRELERİ
// ============================================
struct NoiseGateParams {
    float threshold = -40.0f;   // dB (eşik)
    float attack = 5.0f;        // ms (açılma hızı)
    float hold = 100.0f;        // ms (tutma süresi)
    float release = 150.0f;     // ms (kapanma hızı)
    float range = -80.0f;       // dB (azaltma miktarı)
    bool enabled = false;
};

static NoiseGateParams g_noiseGate;

// ============================================
// DE-ESSER PARAMETRELERİ
// ============================================
struct DeEsserParams {
    float frequency = 7000.0f;  // Hz (sibilant frekansı)
    float threshold = -30.0f;   // dB (eşik)
    float ratio = 4.0f;         // Sıkıştırma oranı
    float range = -12.0f;       // dB (maksimum azaltma)
    bool listenMode = false;    // Sadece etkilenen frekansları dinle
    bool enabled = false;
};

static DeEsserParams g_deEsser;

// ============================================
// EXCITER (HARMONIC ENHANCER) PARAMETRELERİ
// ============================================
struct ExciterParams {
    float amount = 50.0f;       // % (etki miktarı)
    float frequency = 5000.0f;  // Hz (başlangıç frekansı)
    float harmonics = 40.0f;    // % (harmonik zenginliği)
    float mix = 50.0f;          // % (dry/wet karışım)
    int type = 0;               // 0=Tube, 1=Tape, 2=Aural, 3=Warm
    bool enabled = false;
};

static ExciterParams g_exciter;

// ============================================
// STEREO WIDENER PARAMETRELERİ
// ============================================
struct StereoWidenerParams {
    float width = 100.0f;       // % (0=mono, 100=normal, 200=max)
    float bassFreq = 120.0f;    // Hz (mono bass cutoff)
    float delay = 0.0f;         // ms (Haas effect delay)
    float balance = 0.0f;       // -100 (sol) ile +100 (sağ)
    bool monoLow = true;        // Düşük frekansları mono yap
    bool enabled = false;
};

static StereoWidenerParams g_stereoWidener;

// ============================================
// ECHO PARAMETRELERİ
// ============================================
struct EchoParams {
    float delay = 250.0f;       // ms (gecikme süresi)
    float feedback = 30.0f;     // % (tekrar miktarı)
    float wetMix = 30.0f;       // % (yankı seviyesi)
    float dryMix = 100.0f;      // % (orijinal seviye)
    bool stereo = false;        // Ping-pong stereo mode
    float lowCut = 100.0f;      // Hz (low-pass filter)
    float highCut = 8000.0f;    // Hz (high-pass filter)
    bool enabled = false;
};

static EchoParams g_echo;

struct SoftEchoParams {
    float delay = 220.0f;       // ms
    float feedback = 22.0f;     // %
    float wetMix = 18.0f;       // %
    float dryMix = 100.0f;      // %
    bool stereo = false;        // ping-pong
    float highCut = 7000.0f;    // Hz (UI alignment/future use)
    bool enabled = false;
};

static SoftEchoParams g_softEcho;

// Convolution Reverb parametreleri
struct ConvolutionReverbParams {
    char irFilePath[512] = "";  // IR dosya yolu
    float wetMix = 30.0f;       // % (reverb seviyesi)
    float dryMix = 100.0f;      // % (orijinal seviye)
    float preDelay = 0.0f;      // ms (pre-delay)
    float roomSize = 50.0f;     // % (oda boyutu)
    float decay = 1.5f;         // saniye (decay time)
    float damping = 0.5f;       // 0-1 (yüksek frekans sönümleme)
    int roomType = 1;           // 0=Small, 1=Medium, 2=Large, 3=Hall, 4=Cathedral, 5=Plate, 6=Spring, 7=Chamber
    bool enabled = false;
};

static ConvolutionReverbParams g_convReverb;

// ============================================
// AUTO GAIN / NORMALIZE PARAMETRELERİ
// ============================================
struct AutoGainParams {
    float targetLevel = -14.0f;    // dBFS (hedef seviye, -30 ile -3 arası)
    float maxGain = 12.0f;         // dB (maksimum uygulanacak gain)
    float attackTime = 100.0f;     // ms (yükselme hızı)
    float releaseTime = 500.0f;    // ms (düşme hızı)
    int mode = 1;                  // 0=Peak, 1=RMS, 2=LUFS
    float currentGain = 0.0f;      // Gerçek zamanlı uygulanan gain
    float peakLevel = -96.0f;      // Mevcut peak seviye
    float rmsLevel = -96.0f;       // Mevcut RMS seviye
    bool enabled = false;
};

static AutoGainParams g_autoGain;

// ============================================
// TRUE PEAK LIMITER + METER PARAMETRELERİ
// ============================================
// Gereksiz değişkenler kaldırıldı

struct TruePeakLimiterParams {
    float ceiling = -0.1f;          // dBFS (maksimum çıkış)
    float release = 50.0f;          // ms (release time)
    float lookahead = 5.0f;         // ms (lookahead time)
    float inputGain = 0.0f;         // dB (limiter öncesi sürüş)
    int oversamplingRate = 4;       // 2x, 4x, 8x
    bool linkChannels = true;       // Stereo link
    bool enabled = false;
};

static TruePeakLimiterParams g_truePeakLimiter;

// True Peak Ölçümü
struct TruePeakMeter {
    float currentPeakL = -96.0f;    // dBFS (sol kanal) - limiter sonrası
    float currentPeakR = -96.0f;    // dBFS (sağ kanal) - limiter sonrası
    float truePeakL = -96.0f;       // dBTP (true peak left)
    float truePeakR = -96.0f;       // dBTP (true peak right)
    float peakHoldL = -96.0f;       // Peak hold left
    float peakHoldR = -96.0f;       // Peak hold right
    float inputPeakL = -96.0f;      // Input peak left (limiter öncesi)
    float inputPeakR = -96.0f;      // Input peak right (limiter öncesi)
    float gainReduction = 0.0f;     // Gain reduction dB (ne kadar kesiliyor)
    unsigned long peakHoldTimeL = 0;        // Hold timer
    unsigned long peakHoldTimeR = 0;        // Hold timer
    int clippingCount = 0;          // Clipping olayı sayısı (input ceiling'i aştı)
    unsigned long lastUpdate = 0;
};

static TruePeakMeter g_truePeakMeter;

// Convolution Reverb FX handle'ları
static HFX fxConvReverb = 0;
static HFX fxConvPreDelay = 0;

// IR presetleri (dahili simülasyonlar)
struct IRPreset {
    const char* name;
    float roomSize;
    float decay;
    float damping;
    float diffusion;
};

static const IRPreset IR_PRESETS[] = {
    {"Small Room",    20.0f, 0.8f,  0.7f, 0.5f},
    {"Medium Room",   50.0f, 1.5f,  0.6f, 0.6f},
    {"Large Room",    80.0f, 2.5f,  0.5f, 0.7f},
    {"Concert Hall", 100.0f, 3.5f,  0.4f, 0.8f},
    {"Cathedral",    150.0f, 5.0f,  0.3f, 0.9f},
    {"Plate",         60.0f, 2.0f,  0.8f, 0.4f},
    {"Spring",        40.0f, 1.2f,  0.9f, 0.3f},
    {"Chamber",       70.0f, 2.2f,  0.5f, 0.7f}
};

// ============================================
// CROSSFEED PARAMETERS (Headphone Enhancement)
// ============================================
// Crossfeed state removed, using MasterDSP integrated state

struct CrossfeedParams {
    float crossfeedLevel = 30.0f;   // % (karışım miktarı: 0-100%)
    float delay = 0.3f;             // ms (inter-aural delay: 0.1-1.5 ms)
    float lowCut = 700.0f;          // Hz (high-pass filter)
    float highCut = 4000.0f;        // Hz (low-pass filter)
    int preset = 0;                 // 0=Natural, 1=Mild, 2=Strong, 3=Wide, 4=Custom
    bool enabled = false;
};

static CrossfeedParams g_crossfeed;

// ============================================
// SURROUND VIRTUALIZER (Stereo tabanlı 5.1/7.1 simülasyon)
// ============================================
struct SurroundVirtualizerParams {
    float centerLevel = 0.0f;   // dB
    float sideLevel = 0.0f;     // dB
    float lfeLevel = 0.0f;      // dB
    float crossover = 110.0f;   // Hz
    float rearDelay = 8.0f;     // ms
    float mix = 75.0f;          // %
    bool enabled = false;
};

struct SurroundVirtualizerState {
    std::vector<float> sideDelayBuffer;
    size_t writePos = 0;
    float lfeLowpass = 0.0f;
};

static SurroundVirtualizerParams g_surround;
static SurroundVirtualizerState g_surroundState;

// ============================================
// BASS MONO PARAMETRELERİ
// ============================================
struct BassMonoParams {
    float cutoff = 120.0f;      // Hz
    float slope = 24.0f;        // dB/oct
    float stereoWidth = 100.0f; // %
    bool enabled = false;
};

static BassMonoParams g_bassMono;

// ============================================
// TAPE SATURATION PARAMETRELERİ
// ============================================
HDSP g_tapeSatDSP = 0;

struct TapeSatParams {
    float driveDb = 6.0f;     // 0..24 dB
    float mix = 50.0f;        // 0..100 %
    float tone = 50.0f;       // 0..100 (0 = koyu, 100 = parlak)
    float outputDb = -1.0f;   // -12..+12 dB
    int mode = 0;             // 0=Tape, 1=Warm, 2=Hot
    float hiss = 0.0f;        // 0..100 (opsiyonel)
    bool enabled = false;
} g_tapeSat;

struct TapeSatState {
    float sr = 48000.0f;
    float lpfL = 0.0f;
    float lpfR = 0.0f;
    uint32_t rng = 22222;
} g_tapeSatState;

static inline float fastTanh(float x) {
    const float x2 = x * x;
    return x * (27.0f + x2) / (27.0f + 9.0f * x2);
}

static inline float randFloatSigned(uint32_t& s) {
    s = 1664525u * s + 1013904223u;
    uint32_t v = (s >> 9) | 0x3F800000u;
    float f = (*(float*)&v) - 1.0f;
    return (f * 2.0f) - 1.0f;
}

static inline float onePoleAlphaTape(float cutoffHz, float sr) {
    float x = expf(-2.0f * 3.14159265f * cutoffHz / sr);
    return 1.0f - x;
}

// İLERİ BİLDİRİMLER
void CALLBACK TapeSat_DSP(HDSP handle, DWORD channel, void* buffer, DWORD length, void* user);
void CALLBACK BitDither_DSP(HDSP handle, DWORD channel, void* buffer, DWORD length, void* user);

// ============================================
// BIT-DEPTH / DITHER PARAMETRELERİ
// ============================================
HDSP g_bitDitherDSP = 0;

enum DitherType {
    DITHER_OFF = 0,
    DITHER_RPDF = 1,  // rectangular
    DITHER_TPDF = 2   // triangular
};

enum NoiseShape {
    SHAPE_OFF = 0,
    SHAPE_LIGHT = 1
};

struct BitDitherParams {
    int bitDepth = 16;         // 4..24
    DitherType dither = DITHER_TPDF;
    NoiseShape shaping = SHAPE_OFF;
    int downsampleFactor = 1;  // 1=off, 2/4/8/16 sample-hold
    float mix = 100.0f;        // % (lofi tamamen)
    float outputDb = 0.0f;     // dB
    bool enabled = false;
} g_bitDither;

struct BitDitherState {
    float sr = 48000.0f;

    // sample-hold için
    int holdCounter = 0;
    float holdL = 0.0f;
    float holdR = 0.0f;

    // noise shaping hata geri beslemesi
    float errL = 0.0f;
    float errR = 0.0f;

    // RNG
    uint32_t rng = 1234567;
} g_bitDitherState;

static inline float rand01(uint32_t& s) {
    s = 1664525u * s + 1013904223u;
    uint32_t v = (s >> 9) | 0x3F800000u;
    return (*(float*)&v) - 1.0f;
}

static inline float randSigned(uint32_t& s) {
    return rand01(s) * 2.0f - 1.0f;
}

static inline float quantize(float x, int bits) {
    const int levels = 1 << (bits - 1);
    if (levels <= 0) return x;
    return roundf(x * (float)levels) / (float)levels;
}

// ============================================
// DYNAMIC EQ İLERİ BİLDİRİMLER
void UpdateDynamicEQOnDSP();

// DYNAMIC EQ PARAMETRELERİ
// ============================================
struct DynamicEQParams {
    float frequency = 3500.0f;   // Hz
    float q = 2.0f;              // 0.1 - 10
    float threshold = -40.0f;    // dBFS
    float targetGain = -6.0f;    // dB
    float range = 12.0f;         // dB (max boost/cut amount)
    float attackMs = 5.0f;
    float releaseMs = 120.0f;
    bool enabled = false;
};

static DynamicEQParams g_dynamicEq;

// Crossfeed presetleri
struct CrossfeedPreset {
    const char* name;
    float level;
    float delay;
    float lowCut;
    float highCut;
};

static const CrossfeedPreset CROSSFEED_PRESETS[] = {
    {"Natural",    30.0f, 0.3f, 700.0f,  4000.0f},  // Doğal hoparlör
    {"Mild",       20.0f, 0.2f, 800.0f,  5000.0f},  // Hafif etki
    {"Strong",     50.0f, 0.5f, 600.0f,  3500.0f},  // Güçlü etki
    {"Wide",       60.0f, 0.7f, 500.0f,  3000.0f},  // Geniş sahne
    {"Custom",     40.0f, 0.3f, 700.0f,  4000.0f}   // Özel
};

// Soft clipping fonksiyonu - distortion önleme
static inline float softClip(float sample) {
    // Tanh tabanlı soft clipper - yumuşak geçiş
    if (sample > 1.0f) {
        return 1.0f - std::exp(-sample);
    } else if (sample < -1.0f) {
        return -1.0f + std::exp(sample);
    }
    return sample;
}

// Gereksiz callback kaldırıldı. Crossfeed artık aurivo_dsp.cpp içinde entegre

// ============================================
// AURIVO AUDIO ENGINE SINIFI
// ============================================
class AurivoAudioEngine {
private:
    // Stream handles
    HSTREAM m_stream;
    HSTREAM m_decodeStream;
    HSTREAM m_analysisStream;

    // Overlap crossfade (previous stream fades out while new stream fades in)
    HSTREAM m_prevStream;
    HSTREAM m_prevAnalysisStream;
    std::string m_currentFilePath;
    
    // Effect handles - SADECE 32 BANT EQ + PREAMP + REVERB
    HFX m_eqFx[NUM_EQ_BANDS];
    HFX m_preampFx;
    HFX m_reverbFx;  // Reverb effect handle

    // Prev stream effect handles
    HFX m_prevPreampFx;
    HFX m_prevReverbFx;

    // Aurivo DSP
    void* m_aurivoDSP;
    HDSP m_dspHandle;

    // Prev stream DSP
    void* m_prevAurivoDSP;
    HDSP m_prevDspHandle;

    struct TruePeakLimiterState {
        float gainL = 1.0f;
        float gainR = 1.0f;
        float peakL = 0.0f;
        float peakR = 0.0f;
    };

    TruePeakLimiterState m_limiterStateCurrent;
    TruePeakLimiterState m_limiterStatePrev;

    std::atomic<bool> m_overlapCrossfadeActive;
    std::atomic<uint64_t> m_crossfadeGeneration;
    
    // Ses parameters
    float m_masterVolume;      // 0-100
    float m_programVolumeMul;  // Master volume disindaki gain carpani
    float m_preampGain;        // -12dB to +12dB
    float m_eqGains[NUM_EQ_BANDS];  // -15dB to +15dB per band
    float m_bassBoost;         // 0-100
    float m_balance;           // -100 (left) to +100 (right)
    
    // Aurivo Module parameters - SADECE DEĞER SAKLA
    float m_bassGain;          // -15dB to +15dB (100Hz)
    float m_midGain;           // -15dB to +15dB (500Hz-2kHz)
    float m_trebleGain;        // -15dB to +15dB (10kHz)
    float m_stereoExpander;    // 0-200%
    
    // Reverb parameters
    bool m_reverbEnabled;
    float m_reverbRoomSize;    // 0-3000ms
    float m_reverbDamping;     // 0-1
    float m_reverbWetDry;      // -96 to 0 dB
    float m_reverbHFRatio;     // 0.001-0.999
    float m_reverbInputGain;   // -96 to +12 dB
    
    // DSP Master Etkinleştir
    bool m_dspEnabled;                       // Master DSP on/off switch
    
    // Durum
    bool m_initialized;
    std::mutex m_mutex;
    
    // FFT data
    float m_fftData[FFT_SIZE];
    std::atomic<bool> m_fftReady;
    
    // Singleton
    static AurivoAudioEngine* s_instance;

public:
    AurivoAudioEngine() 
        : m_stream(0)
        , m_decodeStream(0)
        , m_analysisStream(0)
        , m_prevStream(0)
        , m_prevAnalysisStream(0)
        , m_currentFilePath()
        , m_preampFx(0)
        , m_reverbFx(0)
        , m_prevPreampFx(0)
        , m_prevReverbFx(0)
        , m_aurivoDSP(nullptr)
        , m_dspHandle(0)
        , m_prevAurivoDSP(nullptr)
        , m_prevDspHandle(0)
        , m_masterVolume(100.0f)
        , m_programVolumeMul(1.0f)
        , m_preampGain(0.0f)
        , m_bassBoost(0.0f)
        , m_balance(0.0f)
        , m_bassGain(0.0f)
        , m_midGain(0.0f)
        , m_trebleGain(0.0f)
        , m_stereoExpander(100.0f)
        , m_reverbEnabled(false)
        , m_reverbRoomSize(1000.0f)
        , m_reverbDamping(0.5f)
        , m_reverbWetDry(-6.0f)
        , m_reverbHFRatio(0.5f)
        , m_reverbInputGain(0.0f)
        , m_dspEnabled(true)         // DSP varsayılan açık
        , m_initialized(false)
        , m_fftReady(false)
        , m_overlapCrossfadeActive(false)
        , m_crossfadeGeneration(0)
    {
        // EQ handles ve gains sıfırla
        for (int i = 0; i < NUM_EQ_BANDS; ++i) {
            m_eqFx[i] = 0;
            m_eqGains[i] = 0.0f;
        }

        // Aurivo DSP oluştur
        m_aurivoDSP = create_dsp();
        if (m_aurivoDSP) {
            set_sample_rate(m_aurivoDSP, SAMPLE_RATE);
            set_dsp_enabled(m_aurivoDSP, 1);
        }
        
        memset(m_fftData, 0, sizeof(m_fftData));
        s_instance = this;
    }
    
    ~AurivoAudioEngine() {
        cleanup();
        s_instance = nullptr;
    }
    
    // ============================================
    // INITIALIZATION
    // ============================================
    bool initialize(int deviceIndex = -1) {
        std::lock_guard<std::mutex> lock(m_mutex);
        
        if (m_initialized) return true;
        
        // BASS'ı başlat (44100 Hz, stereo)
        // deviceIndex: -1 = default device
        if (!BASS_Init(deviceIndex, SAMPLE_RATE, 0, nullptr, nullptr)) {
            int error = BASS_ErrorGetCode();
            if (error != BASS_ERROR_ALREADY) {
                return false;
            }
        }
        
        // BASS_FX version kontrolü
        DWORD fxVersion = BASS_FX_GetVersion();
        if (fxVersion == 0) {
            BASS_Free();
            return false;
        }
        
        // Format plugins'ini yükle
        // AAC/M4A support için bass_aac plugin
#if defined(_WIN32)
        const char *bassAacPlugin = "bass_aac.dll";
        const char *bassFlacPlugin = "bassflac.dll";
        const char *bassApePlugin = "bassape.dll";
        const char *bassWvPlugin = "basswv.dll";
#elif defined(__APPLE__)
        const char *bassAacPlugin = "libbass_aac.dylib";
        const char *bassFlacPlugin = "libbassflac.dylib";
        const char *bassApePlugin = "libbassape.dylib";
        const char *bassWvPlugin = "libbasswv.dylib";
#else
        const char *bassAacPlugin = "libbass_aac.so";
        const char *bassFlacPlugin = "libbassflac.so";
        const char *bassApePlugin = "libbassape.so";
        const char *bassWvPlugin = "libbasswv.so";
#endif

        HPLUGIN aacPlugin = BASS_PluginLoad(bassAacPlugin, 0);
        if (aacPlugin) {
            printf("✓ BASS AAC Plugin loaded (M4A/AAC support enabled)\n");
        } else {
            printf("⚠ BASS AAC Plugin failed to load (error: %d)\n", BASS_ErrorGetCode());
        }
        
        // FLAC support için bassflac plugin  
        HPLUGIN flacPlugin = BASS_PluginLoad(bassFlacPlugin, 0);
        if (flacPlugin) {
            printf("✓ BASS FLAC Plugin loaded\n");
        }
        
        // APE support için bassape plugin
        HPLUGIN apePlugin = BASS_PluginLoad(bassApePlugin, 0);
        if (apePlugin) {
            printf("✓ BASS APE Plugin loaded\n");
        }
        
        // WavePack support için basswv plugin
        HPLUGIN wvPlugin = BASS_PluginLoad(bassWvPlugin, 0);
        if (wvPlugin) {
            printf("✓ BASS WavePack Plugin loaded\n");
        }
        
        // Global BASS ayarları
        BASS_SetConfig(BASS_CONFIG_FLOATDSP, TRUE);  // Float DSP processing
        BASS_SetConfig(BASS_CONFIG_BUFFER, 500);      // 500ms buffer
        BASS_SetConfig(BASS_CONFIG_UPDATEPERIOD, 10); // 10ms update
        // Output device route değişimlerinde stream'in düşmesini azalt
        // (kulaklık tak/çıkar, varsayılan sink değişimi vb.)
#ifdef BASS_CONFIG_DEV_DEFAULT
        BASS_SetConfig(BASS_CONFIG_DEV_DEFAULT, TRUE);
#endif
#ifdef BASS_CONFIG_DEV_NONSTOP
        BASS_SetConfig(BASS_CONFIG_DEV_NONSTOP, TRUE);
#endif
        
        m_initialized = true;
        return true;
    }
    
    void cleanup() {
        std::lock_guard<std::mutex> lock(m_mutex);

        // Invalidate any pending crossfade cleanup threads
        m_crossfadeGeneration.fetch_add(1);
        
        if (m_stream) {
            BASS_ChannelStop(m_stream);
            clearAllFx();
            BASS_StreamFree(m_stream);
            m_stream = 0;
        }

        if (m_prevStream) {
            BASS_ChannelStop(m_prevStream);
            clearAllFxForStream(m_prevStream, m_prevDspHandle, m_prevPreampFx, m_prevReverbFx);
            BASS_StreamFree(m_prevStream);
            m_prevStream = 0;
        }

        if (m_analysisStream) {
            BASS_StreamFree(m_analysisStream);
            m_analysisStream = 0;
        }
        m_currentFilePath.clear();

        if (m_prevAnalysisStream) {
            BASS_StreamFree(m_prevAnalysisStream);
            m_prevAnalysisStream = 0;
        }
        
        if (m_initialized) {
            BASS_Free();
            m_initialized = false;
        }

        if (m_aurivoDSP) {
            destroy_dsp(m_aurivoDSP);
            m_aurivoDSP = nullptr;
        }

        if (m_prevAurivoDSP) {
            destroy_dsp(m_prevAurivoDSP);
            m_prevAurivoDSP = nullptr;
        }

        m_overlapCrossfadeActive = false;
    }
    
    // ============================================
    // GETTERS
    // ============================================
    HSTREAM getStream() const {
        return m_stream;
    }

    void* getAurivoDSP() const {
        return m_aurivoDSP;
    }
    
    // ============================================
    // FILE OPERATIONS
    // ============================================
    bool loadFile(const std::string& filePath) {
        std::lock_guard<std::mutex> lock(m_mutex);
        
        if (!m_initialized) return false;
        
        // Mevcut stream'i temizle
        if (m_stream) {
            BASS_ChannelStop(m_stream);
            clearAllFx();
            BASS_StreamFree(m_stream);
            m_stream = 0;
        }

        // Olası overlap crossfade prev stream'i temizle
        if (m_prevStream) {
            BASS_ChannelStop(m_prevStream);
            clearAllFxForStream(m_prevStream, m_prevDspHandle, m_prevPreampFx, m_prevReverbFx);
            BASS_StreamFree(m_prevStream);
            m_prevStream = 0;
        }

        if (m_prevAnalysisStream) {
            BASS_StreamFree(m_prevAnalysisStream);
            m_prevAnalysisStream = 0;
        }

        if (m_prevAurivoDSP) {
            destroy_dsp(m_prevAurivoDSP);
            m_prevAurivoDSP = nullptr;
        }

        m_overlapCrossfadeActive = false;

        if (m_analysisStream) {
            BASS_StreamFree(m_analysisStream);
            m_analysisStream = 0;
        }
        
        // Decode stream oluştur (BASS_FX için gerekli)
        HSTREAM decodeStream = BASS_StreamCreateFile(
            FALSE, 
            filePath.c_str(), 
            0, 0, 
            BASS_STREAM_DECODE | BASS_SAMPLE_FLOAT
        );
        
        if (!decodeStream) {
            int error = BASS_ErrorGetCode();
            printf("BASS_StreamCreateFile error: %d for file: %s\n", error, filePath.c_str());
            return false;
        }
        
        // Tempo stream oluştur (BASS_FX wrap)
        // Bu sayede tüm FX'ler düzgün çalışır
        m_stream = BASS_FX_TempoCreate(decodeStream, BASS_FX_FREESOURCE | BASS_SAMPLE_FLOAT);
        
        if (!m_stream) {
            BASS_StreamFree(decodeStream);
            return false;
        }
        
        // Stream bilgilerini al
        BASS_CHANNELINFO info;
        BASS_ChannelGetInfo(m_stream, &info);

        // Ham analiz için ayrı decode stream (efektlerden bağımsız)
        m_analysisStream = BASS_StreamCreateFile(
            FALSE,
            filePath.c_str(),
            0, 0,
            BASS_STREAM_DECODE | BASS_SAMPLE_FLOAT
        );
        if (m_analysisStream) {
            // Analiz akışı her zaman ham/pre-volume kalsın.
            BASS_ChannelSetAttribute(m_analysisStream, BASS_ATTRIB_VOL, 1.0f);
        }
        m_currentFilePath = filePath;
        
        // Tüm FX'leri kur
        setupAllFx();
        
        // Volume ayarla
        applyMasterVolume();
        
        // End sync ekle
        BASS_ChannelSetSync(m_stream, BASS_SYNC_END, 0, endCallback, this);
        
        return true;
    }

    // ============================================
    // TRUE OVERLAP CROSSFADE
    // ============================================
    bool crossfadeToFile(const std::string& filePath, int durationMs) {
        std::lock_guard<std::mutex> lock(m_mutex);

        if (!m_initialized) return false;

        const int ms = std::max(0, durationMs);

        // Eğer hiç stream yoksa normal load ile ilerle
        if (!m_stream || ms <= 0) {
            return loadFile(filePath);
        }

        // Var olan prev stream varsa (üst üste crossfade), temizle
        if (m_prevStream) {
            BASS_ChannelStop(m_prevStream);
            clearAllFxForStream(m_prevStream, m_prevDspHandle, m_prevPreampFx, m_prevReverbFx);
            BASS_StreamFree(m_prevStream);
            m_prevStream = 0;
        }
        if (m_prevAnalysisStream) {
            BASS_StreamFree(m_prevAnalysisStream);
            m_prevAnalysisStream = 0;
        }
        if (m_prevAurivoDSP) {
            destroy_dsp(m_prevAurivoDSP);
            m_prevAurivoDSP = nullptr;
        }

        // Mevcut stream'i "prev" olarak sakla
        m_prevStream = m_stream;
        m_prevAnalysisStream = m_analysisStream;
        m_prevPreampFx = m_preampFx;
        m_prevReverbFx = m_reverbFx;
        m_prevAurivoDSP = m_aurivoDSP;
        m_prevDspHandle = m_dspHandle;

        // Yeni stream'i oluştur ve ana stream olarak ata
        m_stream = 0;
        m_analysisStream = 0;
        m_preampFx = 0;
        m_reverbFx = 0;
        m_aurivoDSP = nullptr;
        m_dspHandle = 0;

        HSTREAM newStream = 0;
        HSTREAM newAnalysis = 0;
        if (!createPlaybackStreams(filePath, newStream, newAnalysis)) {
            // Geri al
            m_stream = m_prevStream;
            m_analysisStream = m_prevAnalysisStream;
            m_preampFx = m_prevPreampFx;
            m_reverbFx = m_prevReverbFx;
            m_aurivoDSP = m_prevAurivoDSP;
            m_dspHandle = m_prevDspHandle;

            m_prevStream = 0;
            m_prevAnalysisStream = 0;
            m_prevPreampFx = 0;
            m_prevReverbFx = 0;
            m_prevAurivoDSP = nullptr;
            m_prevDspHandle = 0;
            return false;
        }

        m_stream = newStream;
        m_analysisStream = newAnalysis;
        m_currentFilePath = filePath;

        setupAllFx();

        // End sync yeni stream'e
        BASS_ChannelSetSync(m_stream, BASS_SYNC_END, 0, endCallback, this);

        const float baseVol = computeLinearMasterVolume();

        // Yeni stream 0 sesle başlasın
        BASS_ChannelSetAttribute(m_stream, BASS_ATTRIB_VOL, 0.0f);

        // Yeni stream'i başlat
        BASS_ChannelPlay(m_stream, FALSE);

        // Eski stream çalmıyorsa, direkt bırak (pause'dan geçiş gibi)
        const DWORD prevState = BASS_ChannelIsActive(m_prevStream);
        if (prevState != BASS_ACTIVE_PLAYING) {
            clearAllFxForStream(m_prevStream, m_prevDspHandle, m_prevPreampFx, m_prevReverbFx);
            BASS_StreamFree(m_prevStream);
            m_prevStream = 0;
            if (m_prevAnalysisStream) {
                BASS_StreamFree(m_prevAnalysisStream);
                m_prevAnalysisStream = 0;
            }
            if (m_prevAurivoDSP) {
                destroy_dsp(m_prevAurivoDSP);
                m_prevAurivoDSP = nullptr;
            }
            BASS_ChannelSetAttribute(m_stream, BASS_ATTRIB_VOL, baseVol);
            m_overlapCrossfadeActive = false;
            return true;
        }

        // Slide volume: prev -> 0, new -> baseVol
        BASS_ChannelSlideAttribute(m_prevStream, BASS_ATTRIB_VOL, 0.0f, ms);
        BASS_ChannelSlideAttribute(m_stream, BASS_ATTRIB_VOL, baseVol, ms);

        // Cleanup prev stream after fade completes (avoid doing heavy work in BASS callback threads)
        m_overlapCrossfadeActive = true;
        const uint64_t gen = m_crossfadeGeneration.fetch_add(1) + 1;
        std::thread([this, gen, ms]() {
            std::this_thread::sleep_for(std::chrono::milliseconds(ms + 150));
            std::lock_guard<std::mutex> lock(this->m_mutex);
            if (this->m_crossfadeGeneration.load() != gen) return;

            if (this->m_prevStream) {
                this->clearAllFxForStream(this->m_prevStream, this->m_prevDspHandle, this->m_prevPreampFx, this->m_prevReverbFx);
                BASS_ChannelStop(this->m_prevStream);
                BASS_StreamFree(this->m_prevStream);
                this->m_prevStream = 0;
            }

            if (this->m_prevAnalysisStream) {
                BASS_StreamFree(this->m_prevAnalysisStream);
                this->m_prevAnalysisStream = 0;
            }

            if (this->m_prevAurivoDSP) {
                destroy_dsp(this->m_prevAurivoDSP);
                this->m_prevAurivoDSP = nullptr;
            }

            this->m_overlapCrossfadeActive = false;
        }).detach();

        return true;
    }
    
    // ============================================
    // PLAYBACK CONTROL
    // ============================================
    void play() {
        std::lock_guard<std::mutex> lock(m_mutex);
        if (m_stream) {
            BASS_ChannelPlay(m_stream, FALSE);
        }
        if (m_prevStream) {
            BASS_ChannelPlay(m_prevStream, FALSE);
        }
    }
    
    void pause() {
        std::lock_guard<std::mutex> lock(m_mutex);
        if (m_stream) {
            BASS_ChannelPause(m_stream);
        }
        if (m_prevStream) {
            BASS_ChannelPause(m_prevStream);
        }
    }
    
    void stop() {
        std::lock_guard<std::mutex> lock(m_mutex);
        if (m_stream) {
            BASS_ChannelStop(m_stream);
            BASS_ChannelSetPosition(m_stream, 0, BASS_POS_BYTE);
        }

        if (m_prevStream) {
            BASS_ChannelStop(m_prevStream);
            BASS_ChannelSetPosition(m_prevStream, 0, BASS_POS_BYTE);
            clearAllFxForStream(m_prevStream, m_prevDspHandle, m_prevPreampFx, m_prevReverbFx);
            BASS_StreamFree(m_prevStream);
            m_prevStream = 0;
        }

        if (m_prevAnalysisStream) {
            BASS_StreamFree(m_prevAnalysisStream);
            m_prevAnalysisStream = 0;
        }

        if (m_prevAurivoDSP) {
            destroy_dsp(m_prevAurivoDSP);
            m_prevAurivoDSP = nullptr;
        }

        m_overlapCrossfadeActive = false;
    }
    
    void seek(double positionMs) {
        std::lock_guard<std::mutex> lock(m_mutex);
        if (m_stream) {
            QWORD bytes = BASS_ChannelSeconds2Bytes(m_stream, positionMs / 1000.0);
            BASS_ChannelSetPosition(m_stream, bytes, BASS_POS_BYTE);
        }
    }
    
    double getPosition() {
        std::lock_guard<std::mutex> lock(m_mutex);
        if (!m_stream) return 0;
        QWORD bytes = BASS_ChannelGetPosition(m_stream, BASS_POS_BYTE);
        return BASS_ChannelBytes2Seconds(m_stream, bytes) * 1000.0;
    }
    
    double getDuration() {
        std::lock_guard<std::mutex> lock(m_mutex);
        if (!m_stream) return 0;
        QWORD bytes = BASS_ChannelGetLength(m_stream, BASS_POS_BYTE);
        return BASS_ChannelBytes2Seconds(m_stream, bytes) * 1000.0;
    }
    
    bool isPlaying() {
        std::lock_guard<std::mutex> lock(m_mutex);
        if (!m_stream) return false;
        return BASS_ChannelIsActive(m_stream) == BASS_ACTIVE_PLAYING;
    }
    
    bool hasStream() const {
        return m_stream != 0;
    }
    
    // ============================================
    // MASTER VOLUME (0-100)
    // ============================================
    void setMasterVolume(float volume) {
        std::lock_guard<std::mutex> lock(m_mutex);
        m_masterVolume = clampf(volume, 0.0f, 100.0f);
        applyMasterVolume();
    }
    
    float getMasterVolume() const {
        return m_masterVolume;
    }
    
    // ============================================
    // PRE-AMP (-12dB to +12dB)
    // ============================================
    void setPreamp(float gainDB) {
        std::lock_guard<std::mutex> lock(m_mutex);
        m_preampGain = clampf(gainDB, -12.0f, 12.0f);
        updatePreampFx();
    }
    
    float getPreamp() const {
        return m_preampGain;
    }
    
    // ============================================
    // 32-BAND PARAMETRIC EQ
    // ============================================
    void setEQBand(int band, float gainDB) {
        if (band < 0 || band >= NUM_EQ_BANDS) return;
        
        std::lock_guard<std::mutex> lock(m_mutex);
        m_eqGains[band] = clampf(gainDB, -15.0f, 15.0f);
        updateEqBand(band);
    }
    
    float getEQBand(int band) const {
        if (band < 0 || band >= NUM_EQ_BANDS) return 0.0f;
        return m_eqGains[band];
    }
    
    void setEQBands(const float* gains, int numBands) {
        std::lock_guard<std::mutex> lock(m_mutex);
        int count = std::min(numBands, NUM_EQ_BANDS);
        for (int i = 0; i < count; ++i) {
            m_eqGains[i] = clampf(gains[i], -15.0f, 15.0f);
            updateEqBand(i);
        }
    }
    
    void resetEQ() {
        std::lock_guard<std::mutex> lock(m_mutex);
        // Sadece 32 bantlık EQ slider değerlerini sıfırla
        // Bass/Mid/Treble knob değerleri korunur
        for (int i = 0; i < NUM_EQ_BANDS; ++i) {
            m_eqGains[i] = 0.0f;
        }
        
        if (!m_dspEnabled || !m_aurivoDSP) return;
        for (int i = 0; i < NUM_EQ_BANDS; ++i) {
            updateEqBand(i);
        }
    }
    
    // ============================================
    // BASS BOOST (0-100)
    // ============================================
    void setBassBoost(float intensity) {
        std::lock_guard<std::mutex> lock(m_mutex);
        m_bassBoost = clampf(intensity, 0.0f, 100.0f);
        applyBassBoost();
    }
    
    float getBassBoost() const {
        return m_bassBoost;
    }
    
    // ============================================
    // AUTO GAIN / NORMALIZE - FULL IMPLEMENTATION
    // ============================================
    void setAutoGainEnabled(bool enabled) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_autoGain.enabled = enabled;
        
        if (!enabled) {
            // Devre dışı bırakıldığında gain'i sıfırla
            g_autoGain.currentGain = 0.0f;
            m_programVolumeMul = 1.0f;
            applyMasterVolume();
        }
        
        printf("[AUTO GAIN] %s\n", enabled ? "Etkinleştirildi" : "Devre dışı");
    }
    
    bool isAutoGainEnabled() const {
        return g_autoGain.enabled;
    }
    
    void setAutoGainTarget(float targetLevel) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_autoGain.targetLevel = clampf(targetLevel, -30.0f, -3.0f);
        printf("[AUTO GAIN] Target: %.1f dBFS\n", g_autoGain.targetLevel);
    }
    
    void setAutoGainMaxGain(float maxGain) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_autoGain.maxGain = clampf(maxGain, 0.0f, 24.0f);
        printf("[AUTO GAIN] Max Gain: %.1f dB\n", g_autoGain.maxGain);
    }
    
    void setAutoGainAttack(float attackMs) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_autoGain.attackTime = clampf(attackMs, 10.0f, 1000.0f);
        printf("[AUTO GAIN] Attack: %.0f ms\n", g_autoGain.attackTime);
    }
    
    void setAutoGainRelease(float releaseMs) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_autoGain.releaseTime = clampf(releaseMs, 50.0f, 3000.0f);
        printf("[AUTO GAIN] Release: %.0f ms\n", g_autoGain.releaseTime);
    }
    
    void setAutoGainMode(int mode) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_autoGain.mode = std::max(0, std::min(2, mode));
        const char* modeNames[] = {"Peak", "RMS", "LUFS"};
        printf("[AUTO GAIN] Mode: %s\n", modeNames[g_autoGain.mode]);
    }
    
    float getPeakLevel() {
        if (!m_stream) return -96.0f;
        
        // BASS'tan gerçek zamanlı level al
        DWORD level = BASS_ChannelGetLevel(m_stream);
        if (level == (DWORD)-1) return -96.0f;
        
        int left = LOWORD(level);
        int right = HIWORD(level);
        int peak = (left > right) ? left : right;
        
        float peakLinear = peak / 32768.0f;
        if (peakLinear > 0.0001f) {
            g_autoGain.peakLevel = 20.0f * std::log10(peakLinear);
        } else {
            g_autoGain.peakLevel = -96.0f;
        }
        
        return g_autoGain.peakLevel;
    }
    
    float getRmsLevel() {
        if (!m_stream) return -96.0f;
        
        // RMS = Peak * 0.707 (sinüs dalga yaklaşımı)
        float peakLinear = std::pow(10.0f, g_autoGain.peakLevel / 20.0f);
        float rmsLinear = peakLinear * 0.707f;
        
        if (rmsLinear > 0.0001f) {
            g_autoGain.rmsLevel = 20.0f * std::log10(rmsLinear);
        } else {
            g_autoGain.rmsLevel = -96.0f;
        }
        
        return g_autoGain.rmsLevel;
    }
    
    float getAutoGainReduction() const {
        return g_autoGain.currentGain;
    }
    
    float getMakeupGain() const {
        return std::pow(10.0f, g_autoGain.currentGain / 20.0f);
    }
    
    // Auto gain güncelleme (periyodik olarak çağrılmalı)
    void updateAutoGain() {
        if (!g_autoGain.enabled || !m_stream) return;
        
        // Mevcut level'ı al
        getPeakLevel();
        getRmsLevel();
        
        // Mode'a göre referans level seç
        float currentLevel;
        switch (g_autoGain.mode) {
            case 0: currentLevel = g_autoGain.peakLevel; break;
            case 1: currentLevel = g_autoGain.rmsLevel; break;
            case 2: currentLevel = g_autoGain.rmsLevel - 3.0f; break; // LUFS yaklaşımı
            default: currentLevel = g_autoGain.rmsLevel; break;
        }
        
        // Gerekli gain hesapla
        float neededGain = g_autoGain.targetLevel - currentLevel;
        
        // Max gain limiti
        neededGain = clampf(neededGain, -g_autoGain.maxGain, g_autoGain.maxGain);
        
        // Smooth gain adjustment
        float gainDelta = neededGain - g_autoGain.currentGain;
        float timeConstant = (gainDelta > 0) ? g_autoGain.attackTime : g_autoGain.releaseTime;
        float smoothFactor = 100.0f / timeConstant;  // 100ms güncelleme oranı
        
        g_autoGain.currentGain += gainDelta * smoothFactor * 0.1f;  // Smooth transition
        
        // Gain'i volume olarak uygula
        float volumeMultiplier = std::pow(10.0f, g_autoGain.currentGain / 20.0f);
        m_programVolumeMul = volumeMultiplier;
        applyMasterVolume();
        
        // Debug (her 10 çağrıda bir)
        static int updateCounter = 0;
        if (++updateCounter >= 10) {
            printf("[AUTO GAIN] Update: Level=%.1f dB, Target=%.1f dB, Gain=%.2f dB, Vol=%.3f\n",
                   currentLevel, g_autoGain.targetLevel, g_autoGain.currentGain, volumeMultiplier);
            updateCounter = 0;
        }
    }
    
    // Normalize et fonksiyonu (tek seferlik)
    float normalizeAudio(float targetDB) {
        if (!m_stream) return 0.0f;
        
        // Peak level al
        float peak = getPeakLevel();
        
        // Normalize et gain hesapla
        float normalizeGain = targetDB - peak;
        
        // Max gain limiti
        normalizeGain = clampf(normalizeGain, -24.0f, 24.0f);
        
        // Gain'i uygula
        float volumeMultiplier = std::pow(10.0f, normalizeGain / 20.0f);
        m_programVolumeMul = volumeMultiplier;
        applyMasterVolume();
        
        printf("[AUTO GAIN] Normalize: Peak %.1f dB → Target %.1f dB (Gain: %.1f dB)\n",
               peak, targetDB, normalizeGain);
        
        return normalizeGain;
    }
    
    void resetAutoGain() {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_autoGain.targetLevel = -14.0f;
        g_autoGain.maxGain = 12.0f;
        g_autoGain.attackTime = 100.0f;
        g_autoGain.releaseTime = 500.0f;
        g_autoGain.mode = 1;
        g_autoGain.currentGain = 0.0f;
        m_programVolumeMul = 1.0f;
        applyMasterVolume();
        
        printf("[AUTO GAIN] Reset to defaults\n");
    }

    // ============================================
    // TRUE PEAK LIMITER + METER - FULL IMPLEMENTATION
    // ============================================
    
    void applyTruePeakLimiterParams() {
        // DSP callback içinde parametreler doğrudan kullanılıyor
        // Bu fonksiyon sadece log için
        printf("[TRUE PEAK] Ayarlar güncellendi: Ceiling=%.2f dB, Release=%.0f ms, Lookahead=%.1f ms, Drive=%.1f dB\n",
               g_truePeakLimiter.ceiling, g_truePeakLimiter.release, g_truePeakLimiter.lookahead, g_truePeakLimiter.inputGain);
    }
    
    void setTruePeakEnabled(bool enabled) {
        std::lock_guard<std::mutex> lock(m_mutex);
        
        if (!m_stream) {
            printf("[TRUE PEAK] Stream yok\n");
            return;
        }
        
        g_truePeakLimiter.enabled = enabled;
        
        if (enabled) {
            // Meter değerlerini sıfırla
            g_truePeakMeter.currentPeakL = -96.0f;
            g_truePeakMeter.currentPeakR = -96.0f;
            g_truePeakMeter.truePeakL = -96.0f;
            g_truePeakMeter.truePeakR = -96.0f;
            g_truePeakMeter.peakHoldL = -96.0f;
            g_truePeakMeter.peakHoldR = -96.0f;
            
            printf("[TRUE PEAK] Etkinleştirildi (DSP-based limiter)\n");
        } else {
            printf("[TRUE PEAK] Devre dışı\n");
        }
    }
    
    bool isTruePeakEnabled() const {
        return g_truePeakLimiter.enabled;
    }
    
    void setTruePeakCeiling(float ceiling) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_truePeakLimiter.ceiling = clampf(ceiling, -12.0f, 0.0f);
        printf("[TRUE PEAK] Ceiling: %.2f dBFS\n", g_truePeakLimiter.ceiling);
    }
    
    void setTruePeakRelease(float release) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_truePeakLimiter.release = clampf(release, 10.0f, 500.0f);
        
        printf("[TRUE PEAK] Release: %.0f ms\n", g_truePeakLimiter.release);
    }
    
    void setTruePeakLookahead(float lookahead) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_truePeakLimiter.lookahead = clampf(lookahead, 0.0f, 20.0f);
        printf("[TRUE PEAK] Lookahead: %.1f ms\n", g_truePeakLimiter.lookahead);
    }

    void setTruePeakInputGain(float gain) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_truePeakLimiter.inputGain = clampf(gain, -24.0f, 24.0f);
        printf("[TRUE PEAK] Drive: %.1f dB\n", g_truePeakLimiter.inputGain);
    }
    
    void setTruePeakOversampling(int rate) {
        std::lock_guard<std::mutex> lock(m_mutex);
        
        if (rate == 2 || rate == 4 || rate == 8) {
            g_truePeakLimiter.oversamplingRate = rate;
        } else {
            g_truePeakLimiter.oversamplingRate = 4;  // Varsayılan
        }
        
        printf("[TRUE PEAK] Oversampling: %dx\n", g_truePeakLimiter.oversamplingRate);
    }
    
    void setTruePeakLinkChannels(bool link) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_truePeakLimiter.linkChannels = link;
        
        printf("[TRUE PEAK] Link channels: %s\n", link ? "ON" : "OFF");
    }
    
    // True Peak Metering güncelleme
    void updateTruePeakMeter() {
        if (!m_stream) return;
        
        // Throttle KALDIRILDI - her çağrıda güncelle (JS tarafı kontrol eder)
        auto now = std::chrono::steady_clock::now();
        static auto lastUpdate = now;
        auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(now - lastUpdate).count();
        lastUpdate = now;
        
        // Stereo level al
        DWORD level = BASS_ChannelGetLevel(m_stream);
        int left = LOWORD(level);
        int right = HIWORD(level);
        
        // Sample peak (normal peak)
        float leftLinear = left / 32768.0f;
        float rightLinear = right / 32768.0f;
        
        if (leftLinear > 0.00001f) {
            g_truePeakMeter.currentPeakL = 20.0f * std::log10(leftLinear);
        } else {
            g_truePeakMeter.currentPeakL = -96.0f;
        }
        
        if (rightLinear > 0.00001f) {
            g_truePeakMeter.currentPeakR = 20.0f * std::log10(rightLinear);
        } else {
            g_truePeakMeter.currentPeakR = -96.0f;
        }
        
        // TRUE PEAK HESAPLAMA (oversampling headroom ile)
        float oversamplingHeadroom = 0.0f;
        switch (g_truePeakLimiter.oversamplingRate) {
            case 2:  oversamplingHeadroom = 0.3f; break;
            case 4:  oversamplingHeadroom = 0.5f; break;
            case 8:  oversamplingHeadroom = 0.7f; break;
        }
        
        g_truePeakMeter.truePeakL = g_truePeakMeter.currentPeakL + oversamplingHeadroom;
        g_truePeakMeter.truePeakR = g_truePeakMeter.currentPeakR + oversamplingHeadroom;
        
        // PEAK HOLD (3 saniye)
        unsigned long nowMs = static_cast<unsigned long>(elapsed);
        static unsigned long holdTimerL = 0, holdTimerR = 0;
        holdTimerL += nowMs;
        holdTimerR += nowMs;
        
        if (g_truePeakMeter.truePeakL > g_truePeakMeter.peakHoldL) {
            g_truePeakMeter.peakHoldL = g_truePeakMeter.truePeakL;
            holdTimerL = 0;
        } else if (holdTimerL > 3000) {
            g_truePeakMeter.peakHoldL = g_truePeakMeter.truePeakL;
        }
        
        if (g_truePeakMeter.truePeakR > g_truePeakMeter.peakHoldR) {
            g_truePeakMeter.peakHoldR = g_truePeakMeter.truePeakR;
            holdTimerR = 0;
        } else if (holdTimerR > 3000) {
            g_truePeakMeter.peakHoldR = g_truePeakMeter.truePeakR;
        }
        
        // CLIPPING DETECTION
        if (g_truePeakLimiter.enabled) {
            if (g_truePeakMeter.truePeakL > g_truePeakLimiter.ceiling ||
                g_truePeakMeter.truePeakR > g_truePeakLimiter.ceiling) {
                g_truePeakMeter.clippingCount++;
            }
        }
    }
    
    // Meter data döndür
    struct TruePeakMeterData {
        float peakL;
        float peakR;
        float truePeakL;
        float truePeakR;
        float holdL;
        float holdR;
        float gainReduction;  // dB cinsinden gain reduction
        int clippingCount;
    };
    
    TruePeakMeterData getTruePeakMeterData() {
        updateTruePeakMeter();
        return {
            g_truePeakMeter.currentPeakL,
            g_truePeakMeter.currentPeakR,
            g_truePeakMeter.truePeakL,
            g_truePeakMeter.truePeakR,
            g_truePeakMeter.peakHoldL,
            g_truePeakMeter.peakHoldR,
            g_truePeakMeter.gainReduction,
            g_truePeakMeter.clippingCount
        };
    }
    
    void resetTruePeakClipping() {
        g_truePeakMeter.clippingCount = 0;
        printf("[TRUE PEAK] Clipping counter sıfırlandı\n");
    }
    
    void resetTruePeakLimiter() {
        std::lock_guard<std::mutex> lock(m_mutex);
        
        g_truePeakLimiter.ceiling = -0.1f;
        g_truePeakLimiter.release = 50.0f;
        g_truePeakLimiter.lookahead = 5.0f;
        g_truePeakLimiter.inputGain = 0.0f;
        g_truePeakLimiter.oversamplingRate = 4;
        g_truePeakLimiter.linkChannels = true;
        
        g_truePeakMeter.clippingCount = 0;
        g_truePeakMeter.peakHoldL = -96.0f;
        g_truePeakMeter.peakHoldR = -96.0f;
        
        printf("[TRUE PEAK] Varsayılan ayarlara döndürüldü\n");
    }

    bool isClipping() const {
        return g_autoGain.peakLevel > -0.1f;
    }
    
    int getClippingCount() const {
        return 0;
    }
    
    void resetClippingCount() {
        // No-op
    }
    
    void setAGCAttack(float attackMs) {
        setAutoGainAttack(attackMs);
    }
    
    void setAGCRelease(float releaseMs) {
        setAutoGainRelease(releaseMs);
    }
    
    void setLimiterThreshold(float /*threshold*/) {
        // No-op - handled by limiter effect
    }
    
    // Get comprehensive AGC status
    struct AGCStatus {
        float peakLevel;
        float rmsLevel;
        float gainReduction;
        float makeupGain;
        bool isClipping;
        int clippingCount;
        bool enabled;
    };
    
    AGCStatus getAGCStatus() const {
        return {0.0f, 0.0f, 1.0f, 1.0f, false, 0, false};
    }
    
    void applyEmergencyReduction() {
        // No-op
    }
    
    float suggestPreampIncrease() {
        return 0.0f;
    }
    
    // ============================================
    // FFT / SPECTRUM
    // ============================================
    std::vector<float> getFFTData() {
        std::lock_guard<std::mutex> lock(m_mutex);
        std::vector<float> data(FFT_SIZE / 2, 0.0f);
        if (!m_stream) return data;

        ensureAnalysisStreamUnlocked();
        float fft[FFT_SIZE];
        HSTREAM source = m_analysisStream ? m_analysisStream : m_stream;
        if (source == m_analysisStream) {
            syncAnalysisToPlaybackUnlocked();
        }
        if (BASS_ChannelGetData(source, fft, BASS_DATA_FFT2048) != (DWORD)-1) {
            for (int i = 0; i < FFT_SIZE / 2; ++i) {
                data[i] = fft[i];
            }
        }
        return data;
    }
    
    std::vector<float> getSpectrumBands(int numBands) {
        std::lock_guard<std::mutex> lock(m_mutex);
        std::vector<float> bands(numBands, 0.0f);
        if (!m_stream) return bands;

        ensureAnalysisStreamUnlocked();
        float fft[FFT_SIZE];
        HSTREAM source = m_analysisStream ? m_analysisStream : m_stream;
        if (source == m_analysisStream) {
            syncAnalysisToPlaybackUnlocked();
        }
        if (BASS_ChannelGetData(source, fft, BASS_DATA_FFT2048) == (DWORD)-1) {
            return bands;
        }
        
        // Logaritmik band dağılımı
        for (int i = 0; i < numBands; ++i) {
            float freqLow = 20.0f * std::pow(1000.0f, (float)i / numBands);
            float freqHigh = 20.0f * std::pow(1000.0f, (float)(i + 1) / numBands);
            
            int binLow = (int)(freqLow * FFT_SIZE / SAMPLE_RATE);
            int binHigh = (int)(freqHigh * FFT_SIZE / SAMPLE_RATE);
            
            binLow = std::max(0, std::min(binLow, FFT_SIZE / 2 - 1));
            binHigh = std::max(binLow + 1, std::min(binHigh, FFT_SIZE / 2));
            
            float sum = 0.0f;
            for (int j = binLow; j < binHigh; ++j) {
                sum += fft[j];
            }
            bands[i] = sum / (binHigh - binLow);
        }
        return bands;
    }

    // ============================================
    // PCM (VISUALIZER FEED)
    // ============================================
    std::vector<float> getPCMData(int framesPerChannel) {
        return getPCMData(framesPerChannel, nullptr);
    }

    std::vector<float> getPCMData(int framesPerChannel, int* outChannels) {
        std::lock_guard<std::mutex> lock(m_mutex);
        if (outChannels) *outChannels = 0;
        if (!m_stream || framesPerChannel <= 0) return {};

        ensureAnalysisStreamUnlocked();
        HSTREAM source = m_analysisStream ? m_analysisStream : m_stream;
        if (source == m_analysisStream) {
            syncAnalysisToPlaybackUnlocked();
        }

        BASS_CHANNELINFO info;
        if (!BASS_ChannelGetInfo(source, &info)) {
            return {};
        }

        const int channels = std::max(1, (int)info.chans);
        if (outChannels) *outChannels = channels;
        const int totalFloats = framesPerChannel * channels;
        std::vector<float> data((size_t)totalFloats);

        const DWORD bytesRequested = (DWORD)(totalFloats * (int)sizeof(float));
        const DWORD gotBytes = BASS_ChannelGetData(source, data.data(), bytesRequested | BASS_DATA_FLOAT);
        if (gotBytes == (DWORD)-1 || gotBytes == 0) {
            return {};
        }

        const size_t gotFloats = (size_t)gotBytes / sizeof(float);
        data.resize(gotFloats);
        return data;
    }
    
    // Peak level monitoring
    std::pair<float, float> getChannelLevels() {
        if (!m_stream) return {0.0f, 0.0f};
        
        DWORD level = BASS_ChannelGetLevel(m_stream);
        float left = (float)LOWORD(level) / 32768.0f;
        float right = (float)HIWORD(level) / 32768.0f;
        return {left, right};
    }

private:
    // ============================================
    // INTERNAL: FX SETUP - BASİTLEŞTİRİLMİŞ
    // ============================================
    void setupAllFx() {
        if (!m_stream) return;
        setupAllFxForStream(m_stream, m_aurivoDSP, m_dspHandle, m_preampFx, m_reverbFx);
    }
    
    void clearAllFx() {
        if (!m_stream) return;
        clearAllFxForStream(m_stream, m_dspHandle, m_preampFx, m_reverbFx);
        for (int i = 0; i < NUM_EQ_BANDS; ++i) {
            m_eqFx[i] = 0;
        }
    }

    float computeLinearMasterVolume() const {
        if (m_masterVolume <= 0.0f) return 0.0f;
        return std::pow(m_masterVolume / 100.0f, 2.0f);
    }

    float computeEffectiveVolume() const {
        return computeLinearMasterVolume() * std::max(0.0f, m_programVolumeMul);
    }

    void applyMasterVolumeToStream(HSTREAM stream) {
        if (!stream) return;
        BASS_ChannelSetAttribute(stream, BASS_ATTRIB_VOL, computeEffectiveVolume());
    }

    void updatePreampFxHandle(HFX fxHandle) {
        if (!fxHandle) return;
        BASS_BFX_VOLUME vol = {};
        vol.lChannel = BASS_BFX_CHANALL;
        vol.fVolume = dBToLinear(m_preampGain);
        BASS_FXSetParameters(fxHandle, &vol);
    }

    void applyBalanceToStream(HSTREAM stream) {
        if (!stream) return;
        float pan = clampf(m_balance / 100.0f, -1.0f, 1.0f);
        BASS_ChannelSetAttribute(stream, BASS_ATTRIB_PAN, pan);
    }

    void applyReverbToStream(HSTREAM stream, HFX& reverbFxHandle) {
        if (!stream) return;

        if (m_reverbEnabled) {
            if (!reverbFxHandle) {
                reverbFxHandle = BASS_ChannelSetFX(stream, BASS_FX_DX8_REVERB, 2);
            }
            if (reverbFxHandle) {
                BASS_DX8_REVERB reverb = {};
                reverb.fInGain = clampf(m_reverbInputGain, -96.0f, 0.0f);
                reverb.fReverbMix = clampf(m_reverbWetDry, -96.0f, 0.0f);
                reverb.fReverbTime = clampf(m_reverbRoomSize, 0.001f, 3000.0f);
                reverb.fHighFreqRTRatio = clampf(m_reverbHFRatio, 0.001f, 0.999f);
                BASS_FXSetParameters(reverbFxHandle, &reverb);
            }
        } else {
            if (reverbFxHandle) {
                BASS_ChannelRemoveFX(stream, reverbFxHandle);
                reverbFxHandle = 0;
            }
        }
    }

    void applyEqAndBassBoostToDsp(void* dsp) {
        if (!dsp || !m_dspEnabled) return;
        for (int band = 0; band < NUM_EQ_BANDS; ++band) {
            float totalGain = m_eqGains[band];
            if (band < BASS_BOOST_BANDS && m_bassBoost > 0.0f) {
                float boostFactor = 1.0f - ((float)band / BASS_BOOST_BANDS);
                float boostDB = (m_bassBoost / 100.0f) * 12.0f * boostFactor;
                totalGain += boostDB;
            }
            totalGain = clampf(totalGain, -15.0f, 15.0f);
            set_eq_band(dsp, band, totalGain);
        }
    }

    void setupAllFxForStream(HSTREAM stream, void*& dsp, HDSP& dspHandle, HFX& preampFxHandle, HFX& reverbFxHandle) {
        if (!stream) return;

        preampFxHandle = BASS_ChannelSetFX(stream, BASS_FX_BFX_VOLUME, 0);
        updatePreampFxHandle(preampFxHandle);

        if (!dsp) {
            dsp = create_dsp();
        }
        if (dsp) {
            BASS_CHANNELINFO info;
            if (BASS_ChannelGetInfo(stream, &info)) {
                set_sample_rate(dsp, static_cast<float>(info.freq));
            }
            set_dsp_enabled(dsp, m_dspEnabled ? 1 : 0);
            set_tone_params(dsp, m_bassGain, m_midGain, m_trebleGain);
            set_stereo_width(dsp, m_stereoExpander / 100.0f);
            set_eq_bands(dsp, m_eqGains, NUM_EQ_BANDS);
            applyEqAndBassBoostToDsp(dsp);

            set_crossfeed_params(dsp, g_crossfeed.enabled ? 1 : 0,
                                 g_crossfeed.crossfeedLevel,
                                 g_crossfeed.delay,
                                 g_crossfeed.lowCut,
                                 g_crossfeed.highCut);

            set_bass_mono_params(dsp, g_bassMono.enabled ? 1 : 0,
                                 g_bassMono.cutoff,
                                 g_bassMono.slope,
                                 g_bassMono.stereoWidth);

            if (g_compressor.enabled) {
                set_compressor_params(dsp, 1,
                                      g_compressor.threshold,
                                      g_compressor.ratio,
                                      g_compressor.attack,
                                      g_compressor.release,
                                      g_compressor.makeupGain);
            }
        }

        if (dspHandle) {
            BASS_ChannelRemoveDSP(stream, dspHandle);
            dspHandle = 0;
        }
        dspHandle = BASS_ChannelSetDSP(stream, dspCallback, this, 0);

        applyBalanceToStream(stream);
        applyReverbToStream(stream, reverbFxHandle);
    }

    void clearAllFxForStream(HSTREAM stream, HDSP& dspHandle, HFX& preampFxHandle, HFX& reverbFxHandle) {
        if (!stream) return;

        if (dspHandle) {
            BASS_ChannelRemoveDSP(stream, dspHandle);
            dspHandle = 0;
        }

        if (preampFxHandle) {
            BASS_ChannelRemoveFX(stream, preampFxHandle);
            preampFxHandle = 0;
        }

        if (reverbFxHandle) {
            BASS_ChannelRemoveFX(stream, reverbFxHandle);
            reverbFxHandle = 0;
        }

        if (fxCompressor) {
            BASS_ChannelRemoveFX(stream, fxCompressor);
            fxCompressor = 0;
        }
    }

    void ensureAnalysisStreamUnlocked() {
        if (m_analysisStream || m_currentFilePath.empty()) return;
        m_analysisStream = BASS_StreamCreateFile(
            FALSE,
            m_currentFilePath.c_str(),
            0, 0,
            BASS_STREAM_DECODE | BASS_SAMPLE_FLOAT
        );
        if (m_analysisStream) {
            BASS_ChannelSetAttribute(m_analysisStream, BASS_ATTRIB_VOL, 1.0f);
        }
    }

    void syncAnalysisToPlaybackUnlocked() {
        if (!m_stream || !m_analysisStream) return;

        const QWORD playPos = BASS_ChannelGetPosition(m_stream, BASS_POS_BYTE);
        if (playPos == (QWORD)-1) return;

        const double sec = BASS_ChannelBytes2Seconds(m_stream, playPos);
        if (!std::isfinite(sec) || sec < 0.0) return;

        const QWORD analysisPos = BASS_ChannelSeconds2Bytes(m_analysisStream, sec);
        if (analysisPos == (QWORD)-1) return;
        BASS_ChannelSetPosition(m_analysisStream, analysisPos, BASS_POS_BYTE);
    }

    bool createPlaybackStreams(const std::string& filePath, HSTREAM& outStream, HSTREAM& outAnalysisStream) {
        outStream = 0;
        outAnalysisStream = 0;

        HSTREAM decodeStream = BASS_StreamCreateFile(
            FALSE,
            filePath.c_str(),
            0, 0,
            BASS_STREAM_DECODE | BASS_SAMPLE_FLOAT
        );
        if (!decodeStream) return false;

        HSTREAM tempoStream = BASS_FX_TempoCreate(decodeStream, BASS_FX_FREESOURCE | BASS_SAMPLE_FLOAT);
        if (!tempoStream) {
            BASS_StreamFree(decodeStream);
            return false;
        }

        outAnalysisStream = BASS_StreamCreateFile(
            FALSE,
            filePath.c_str(),
            0, 0,
            BASS_STREAM_DECODE | BASS_SAMPLE_FLOAT
        );
        if (outAnalysisStream) {
            BASS_ChannelSetAttribute(outAnalysisStream, BASS_ATTRIB_VOL, 1.0f);
        }

        outStream = tempoStream;
        return true;
    }

    // NOTE: We intentionally avoid doing cleanup work in BASS sync callbacks to prevent deadlocks.
    
    void applyBalance() {
        if (!m_stream) return;
        applyBalanceToStream(m_stream);
    }
    
    void applyReverb() {
        if (!m_stream) return;
        applyReverbToStream(m_stream, m_reverbFx);
    }
    
public:
    void detachTapeSat() {
        if (m_stream && g_tapeSatDSP) {
            BASS_ChannelRemoveDSP(m_stream, g_tapeSatDSP);
            g_tapeSatDSP = 0;
            printf("[TAPE SAT] DSP detached\n");
        }
    }

    void attachTapeSatIfNeeded() {
        if (!m_stream) return;

        float sr = (float)SAMPLE_RATE;
        BASS_ChannelGetAttribute(m_stream, BASS_ATTRIB_FREQ, &sr);
        g_tapeSatState.sr = sr;

        if (g_tapeSat.enabled && !g_tapeSatDSP) {
            g_tapeSatDSP = BASS_ChannelSetDSP(m_stream, (DSPPROC*)TapeSat_DSP, nullptr, 12);
            printf("[TAPE SAT] DSP attached. handle=%u sr=%.0f\n", g_tapeSatDSP, sr);
        }
    }

    void detachBitDither() {
        if (m_stream && g_bitDitherDSP) {
            BASS_ChannelRemoveDSP(m_stream, g_bitDitherDSP);
            g_bitDitherDSP = 0;
            printf("[BIT/DITHER] DSP detached\n");
        }
    }

    void attachBitDitherIfNeeded() {
        if (!m_stream) return;

        float sr = (float)SAMPLE_RATE;
        BASS_ChannelGetAttribute(m_stream, BASS_ATTRIB_FREQ, &sr);
        g_bitDitherState.sr = sr;

        if (g_bitDither.enabled && !g_bitDitherDSP) {
            g_bitDitherDSP = BASS_ChannelSetDSP(m_stream, (DSPPROC*)BitDither_DSP, nullptr, 20);
            printf("[BIT/DITHER] DSP attached. handle=%u sr=%.0f\n", g_bitDitherDSP, sr);
        }
    }

    std::mutex& getMutex() { return m_mutex; }

    // ============================================
    // DSP MASTER ENABLE/DISABLE
    // ============================================
    void setDSPEnabled(bool enabled) {
        std::lock_guard<std::mutex> lock(m_mutex);
        m_dspEnabled = enabled;
        
        if (!m_stream) return;
        
        if (m_aurivoDSP) {
            set_dsp_enabled(m_aurivoDSP, enabled ? 1 : 0);
            if (enabled) {
                set_eq_bands(m_aurivoDSP, m_eqGains, NUM_EQ_BANDS);
                applyBassBoost();
                set_tone_params(m_aurivoDSP, m_bassGain, m_midGain, m_trebleGain);
                set_stereo_width(m_aurivoDSP, m_stereoExpander / 100.0f);
            }
        }

        applyBalance();
        applyReverb();
    }
    
    bool isDSPEnabled() const { return m_dspEnabled; }

    // ============================================
    // BALANCE CONTROL
    // ============================================
    void setBalance(float value) {
        std::lock_guard<std::mutex> lock(m_mutex);
        m_balance = clampf(value, -100.0f, 100.0f);
        if (m_dspEnabled) applyBalance();
    }
    
    float getBalance() {
        return m_balance;
    }
    
    // ============================================
    // AURIVO TONE: BASS
    // ============================================
    void setBass(float dB) {
        std::lock_guard<std::mutex> lock(m_mutex);
        m_bassGain = clampf(dB, -15.0f, 15.0f);
        
        if (!m_dspEnabled || !m_aurivoDSP) return;
        set_tone_params(m_aurivoDSP, m_bassGain, m_midGain, m_trebleGain);
    }
    
    float getBass() { return m_bassGain; }
    
    // ============================================
    // AURIVO TONE: MID
    // ============================================
    void setMid(float dB) {
        std::lock_guard<std::mutex> lock(m_mutex);
        m_midGain = clampf(dB, -15.0f, 15.0f);
        
        if (!m_dspEnabled || !m_aurivoDSP) return;
        set_tone_params(m_aurivoDSP, m_bassGain, m_midGain, m_trebleGain);
    }
    
    float getMid() { return m_midGain; }
    
    // ============================================
    // AURIVO TONE: TREBLE
    // ============================================
    void setTreble(float dB) {
        std::lock_guard<std::mutex> lock(m_mutex);
        m_trebleGain = clampf(dB, -15.0f, 15.0f);
        
        if (!m_dspEnabled || !m_aurivoDSP) return;
        set_tone_params(m_aurivoDSP, m_bassGain, m_midGain, m_trebleGain);
    }
    
    float getTreble() { return m_trebleGain; }
    
    // ============================================
    // STEREO EXPANDER - SADECE DEĞER SAKLA
    // ============================================
    void setStereoExpander(float percent) {
        std::lock_guard<std::mutex> lock(m_mutex);
        m_stereoExpander = clampf(percent, 0.0f, 200.0f);
        if (m_dspEnabled && m_aurivoDSP) {
            set_stereo_width(m_aurivoDSP, m_stereoExpander / 100.0f);
        }
    }
    
    float getStereoExpander() { return m_stereoExpander; }
    
    // ============================================
    // REVERB CONTROL
    // ============================================
    void setReverbEnabled(bool enabled) {
        std::lock_guard<std::mutex> lock(m_mutex);
        m_reverbEnabled = enabled;
        applyReverb();
    }
    
    bool getReverbEnabled() { return m_reverbEnabled; }
    
    void setReverbRoomSize(float ms) {
        std::lock_guard<std::mutex> lock(m_mutex);
        m_reverbRoomSize = clampf(ms, 0.001f, 3000.0f);
        applyReverb();
    }
    
    void setReverbDamping(float value) {
        std::lock_guard<std::mutex> lock(m_mutex);
        m_reverbDamping = clampf(value, 0.0f, 1.0f);
        // Not: DX8_REVERB'de doğrudan damping yok, HFRatio kullanılır
    }
    
    void setReverbWetDry(float dB) {
        std::lock_guard<std::mutex> lock(m_mutex);
        m_reverbWetDry = clampf(dB, -96.0f, 0.0f);
        applyReverb();
    }
    
    void setReverbHFRatio(float ratio) {
        std::lock_guard<std::mutex> lock(m_mutex);
        m_reverbHFRatio = clampf(ratio, 0.001f, 0.999f);
        applyReverb();
    }
    
    void setReverbInputGain(float dB) {
        std::lock_guard<std::mutex> lock(m_mutex);
        m_reverbInputGain = clampf(dB, -96.0f, 0.0f);
        applyReverb();
    }

    // ============================================
    // COMPRESSOR (Aurivo DSP)
    // ============================================
    bool enableCompressor(bool enabled) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_compressor.enabled = enabled;

        if (!m_aurivoDSP) {
            printf("[COMPRESSOR] No DSP processor available\n");
            return false;
        }

        // Use Aurivo DSP compressor (works on all platforms)
        set_compressor_params(m_aurivoDSP, enabled ? 1 : 0, 
                              g_compressor.threshold, 
                              g_compressor.ratio, 
                              g_compressor.attack, 
                              g_compressor.release, 
                              g_compressor.makeupGain);
        
        printf("[COMPRESSOR] %s (thresh=%.1f ratio=%.1f att=%.1f rel=%.1f gain=%.1f)\n",
               enabled ? "Enabled" : "Disabled",
               g_compressor.threshold, g_compressor.ratio, 
               g_compressor.attack, g_compressor.release, g_compressor.makeupGain);
        
        return true;
    }

    void applyCompressorToDSP() {
        if (!m_aurivoDSP || !g_compressor.enabled) return;
        set_compressor_params(m_aurivoDSP, 1, 
                              g_compressor.threshold, 
                              g_compressor.ratio, 
                              g_compressor.attack, 
                              g_compressor.release, 
                              g_compressor.makeupGain);
    }

    void setCompressorThreshold(float threshold) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_compressor.threshold = clampf(threshold, -60.0f, 0.0f);
        if (g_compressor.enabled) applyCompressorToDSP();
    }

    void setCompressorRatio(float ratio) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_compressor.ratio = clampf(ratio, 1.0f, 20.0f);
        if (g_compressor.enabled) applyCompressorToDSP();
    }

    void setCompressorAttack(float attack) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_compressor.attack = clampf(attack, 0.1f, 100.0f);
        if (g_compressor.enabled) applyCompressorToDSP();
    }

    void setCompressorRelease(float release) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_compressor.release = clampf(release, 10.0f, 1000.0f);
        if (g_compressor.enabled) applyCompressorToDSP();
    }

    void setCompressorMakeupGain(float gain) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_compressor.makeupGain = clampf(gain, -12.0f, 24.0f);
        if (g_compressor.enabled) applyCompressorToDSP();
    }

    void setCompressorKnee(float knee) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_compressor.knee = clampf(knee, 0.0f, 10.0f);
        // Knee DSP compressor'da yok, sadece sakla
    }

    float getCompressorGainReduction() {
        std::lock_guard<std::mutex> lock(m_mutex);
        if (!g_compressor.enabled || !m_stream) return 0.0f;

        // Basit gain reduction tahmini
        DWORD level = BASS_ChannelGetLevel(m_stream);
        int maxLevel = LOWORD(level) > HIWORD(level) ? LOWORD(level) : HIWORD(level);
        if (maxLevel <= 0) return 0.0f;
        
        float levelDB = 20.0f * log10f((float)maxLevel / 32768.0f);

        if (levelDB > g_compressor.threshold) {
            return (levelDB - g_compressor.threshold) * (1.0f - 1.0f / g_compressor.ratio);
        }

        return 0.0f;
    }

    void resetCompressor() {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_compressor.threshold = -20.0f;
        g_compressor.ratio = 4.0f;
        g_compressor.attack = 10.0f;
        g_compressor.release = 100.0f;
        g_compressor.makeupGain = 0.0f;
        g_compressor.knee = 3.0f;
        if (g_compressor.enabled) applyCompressorToDSP();
    }

    // ============================================
    // LIMITER (Aurivo DSP)
    // ============================================
    void applyLimiterToDSP() {
        if (!m_aurivoDSP) return;
        // DSP limiter sadece ceiling ve release destekliyor
        // inputGain'i ceiling'e ekleyerek simüle ediyoruz
        float effectiveCeiling = g_limiter.ceiling - g_limiter.inputGain;
        set_limiter_params(m_aurivoDSP, g_limiter.enabled ? 1 : 0, 
                          effectiveCeiling, g_limiter.release);
    }

    bool enableLimiter(bool enabled) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_limiter.enabled = enabled;

        if (!m_aurivoDSP) {
            printf("[LIMITER] No DSP processor available\n");
            return false;
        }

        applyLimiterToDSP();
        
        printf("[LIMITER] %s (ceil=%.1f rel=%.1f look=%.1f gain=%.1f)\n",
               enabled ? "Enabled" : "Disabled",
               g_limiter.ceiling, g_limiter.release, 
               g_limiter.lookahead, g_limiter.inputGain);
        
        return true;
    }

    void setLimiterCeiling(float ceiling) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_limiter.ceiling = clampf(ceiling, -12.0f, 0.0f);
        if (g_limiter.enabled) applyLimiterToDSP();
        printf("[LIMITER] Ceiling: %.1f dB\n", g_limiter.ceiling);
    }

    void setLimiterRelease(float release) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_limiter.release = clampf(release, 10.0f, 500.0f);
        if (g_limiter.enabled) applyLimiterToDSP();
        printf("[LIMITER] Release: %.1f ms\n", g_limiter.release);
    }

    void setLimiterLookahead(float lookahead) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_limiter.lookahead = clampf(lookahead, 0.0f, 20.0f);
        // DSP limiter lookahead desteklemiyor, sadece saklıyoruz
        printf("[LIMITER] Lookahead: %.1f ms\n", g_limiter.lookahead);
    }

    void setLimiterGain(float gain) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_limiter.inputGain = clampf(gain, -12.0f, 12.0f);
        if (g_limiter.enabled) applyLimiterToDSP();
        printf("[LIMITER] Gain: %.1f dB\n", g_limiter.inputGain);
    }

    float getLimiterReduction() {
        std::lock_guard<std::mutex> lock(m_mutex);
        if (!g_limiter.enabled || !m_stream) return 0.0f;

        DWORD level = BASS_ChannelGetLevel(m_stream);
        int maxLevel = LOWORD(level) > HIWORD(level) ? LOWORD(level) : HIWORD(level);
        if (maxLevel <= 0) return 0.0f;
        
        float levelDB = 20.0f * log10f((float)maxLevel / 32768.0f);
        float effectiveCeiling = g_limiter.ceiling - g_limiter.inputGain;

        if (levelDB > effectiveCeiling) {
            return levelDB - effectiveCeiling;
        }

        return 0.0f;
    }

    void resetLimiter() {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_limiter.ceiling = -0.3f;
        g_limiter.release = 50.0f;
        g_limiter.lookahead = 5.0f;
        g_limiter.inputGain = 0.0f;
        if (g_limiter.enabled) applyLimiterToDSP();
        printf("[LIMITER] Reset to defaults\n");
    }

    // ============================================
    // BASS ENHANCER (Aurivo DSP)
    // ============================================
    void applyBassEnhancerToDSP() {
        if (!m_aurivoDSP) return;
        
        // Bass Enhancer, DSP bass_boost fonksiyonunu kullanıyor
        // gain: dB, frequency: Hz (merkez frekans)
        // Dry/wet ve harmonics efektini gain üzerinden simüle ediyoruz
        float effectiveGain = g_bassEnhancer.gain * (g_bassEnhancer.dryWet / 100.0f);
        
        // Harmonics: hafif gain artışı ile simüle (harmonikler doğal olarak oluşur)
        effectiveGain += (g_bassEnhancer.harmonics / 100.0f) * 2.0f;
        
        // Width parametresi ile frekans range'i ayarlama
        // Width büyükse daha geniş bant etkilenir (daha düşük frekans kullan)
        float effectiveFreq = g_bassEnhancer.frequency / g_bassEnhancer.width;
        effectiveFreq = clampf(effectiveFreq, 20.0f, 200.0f);
        
        set_bass_boost(m_aurivoDSP, g_bassEnhancer.enabled ? 1 : 0, effectiveGain, effectiveFreq);
    }

    bool enableBassEnhancer(bool enabled) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_bassEnhancer.enabled = enabled;

        if (!m_aurivoDSP) {
            printf("[BASS ENHANCER] No DSP processor available\n");
            return false;
        }

        applyBassEnhancerToDSP();
        
        printf("[BASS ENHANCER] %s (freq=%.0f gain=%.1f harm=%.0f width=%.1f mix=%.0f)\n",
               enabled ? "Enabled" : "Disabled",
               g_bassEnhancer.frequency, g_bassEnhancer.gain, 
               g_bassEnhancer.harmonics, g_bassEnhancer.width, g_bassEnhancer.dryWet);
        
        return true;
    }

    void setBassEnhancerFrequency(float frequency) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_bassEnhancer.frequency = clampf(frequency, 20.0f, 200.0f);
        if (g_bassEnhancer.enabled) applyBassEnhancerToDSP();
        printf("[BASS ENHANCER] Frequency: %.0f Hz\n", g_bassEnhancer.frequency);
    }

    void setBassEnhancerGain(float gain) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_bassEnhancer.gain = clampf(gain, 0.0f, 18.0f);
        if (g_bassEnhancer.enabled) applyBassEnhancerToDSP();
        printf("[BASS ENHANCER] Gain: %.1f dB\n", g_bassEnhancer.gain);
    }

    void setBassEnhancerHarmonics(float harmonics) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_bassEnhancer.harmonics = clampf(harmonics, 0.0f, 100.0f);
        if (g_bassEnhancer.enabled) applyBassEnhancerToDSP();
        printf("[BASS ENHANCER] Harmonics: %.0f%%\n", g_bassEnhancer.harmonics);
    }

    void setBassEnhancerWidth(float width) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_bassEnhancer.width = clampf(width, 0.5f, 3.0f);
        if (g_bassEnhancer.enabled) applyBassEnhancerToDSP();
        printf("[BASS ENHANCER] Width: %.1f\n", g_bassEnhancer.width);
    }

    void setBassEnhancerMix(float mix) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_bassEnhancer.dryWet = clampf(mix, 0.0f, 100.0f);
        if (g_bassEnhancer.enabled) applyBassEnhancerToDSP();
        printf("[BASS ENHANCER] Dry/Wet: %.0f%%\n", g_bassEnhancer.dryWet);
    }

    void resetBassEnhancer() {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_bassEnhancer.frequency = 80.0f;
        g_bassEnhancer.gain = 6.0f;
        g_bassEnhancer.harmonics = 50.0f;
        g_bassEnhancer.width = 1.5f;
        g_bassEnhancer.dryWet = 50.0f;
        if (g_bassEnhancer.enabled) applyBassEnhancerToDSP();
        printf("[BASS ENHANCER] Reset to defaults\n");
    }

    // ============================================
    // NOISE GATE (Aurivo DSP)
    // ============================================
    void applyNoiseGateToDSP() {
        if (!m_aurivoDSP) return;
        
        // DSP gate fonksiyonu: threshold, attack, release
        // Hold parametresi DSP'de desteklenmiyor, release'e ekliyoruz
        float effectiveRelease = g_noiseGate.release + g_noiseGate.hold;
        
        set_gate_params(m_aurivoDSP, g_noiseGate.enabled ? 1 : 0, 
                       g_noiseGate.threshold, g_noiseGate.attack, effectiveRelease);
    }

    bool enableNoiseGate(bool enabled) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_noiseGate.enabled = enabled;

        if (!m_aurivoDSP) {
            printf("[NOISE GATE] No DSP processor available\n");
            return false;
        }

        applyNoiseGateToDSP();
        
        printf("[NOISE GATE] %s (thresh=%.1f att=%.1f hold=%.1f rel=%.1f range=%.1f)\n",
               enabled ? "Enabled" : "Disabled",
               g_noiseGate.threshold, g_noiseGate.attack, 
               g_noiseGate.hold, g_noiseGate.release, g_noiseGate.range);
        
        return true;
    }

    void setNoiseGateThreshold(float threshold) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_noiseGate.threshold = clampf(threshold, -96.0f, 0.0f);
        if (g_noiseGate.enabled) applyNoiseGateToDSP();
        printf("[NOISE GATE] Threshold: %.1f dB\n", g_noiseGate.threshold);
    }

    void setNoiseGateAttack(float attack) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_noiseGate.attack = clampf(attack, 0.1f, 50.0f);
        if (g_noiseGate.enabled) applyNoiseGateToDSP();
        printf("[NOISE GATE] Attack: %.1f ms\n", g_noiseGate.attack);
    }

    void setNoiseGateHold(float hold) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_noiseGate.hold = clampf(hold, 0.0f, 500.0f);
        if (g_noiseGate.enabled) applyNoiseGateToDSP();
        printf("[NOISE GATE] Hold: %.1f ms\n", g_noiseGate.hold);
    }

    void setNoiseGateRelease(float release) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_noiseGate.release = clampf(release, 10.0f, 2000.0f);
        if (g_noiseGate.enabled) applyNoiseGateToDSP();
        printf("[NOISE GATE] Release: %.1f ms\n", g_noiseGate.release);
    }

    void setNoiseGateRange(float range) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_noiseGate.range = clampf(range, -96.0f, 0.0f);
        // Range DSP'de doğrudan desteklenmiyor, sadece saklıyoruz
        printf("[NOISE GATE] Range: %.1f dB\n", g_noiseGate.range);
    }

    bool getNoiseGateStatus() {
        std::lock_guard<std::mutex> lock(m_mutex);
        
        if (!g_noiseGate.enabled || !m_stream) return false;

        // Mevcut ses seviyesini al
        DWORD level = BASS_ChannelGetLevel(m_stream);
        int maxLevel = LOWORD(level) > HIWORD(level) ? LOWORD(level) : HIWORD(level);
        if (maxLevel <= 0) return false;
        
        float levelDB = 20.0f * log10f((float)maxLevel / 32768.0f);
        
        // Threshold'u aşıyorsa gate açık
        return levelDB > g_noiseGate.threshold;
    }

    void resetNoiseGate() {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_noiseGate.threshold = -40.0f;
        g_noiseGate.attack = 5.0f;
        g_noiseGate.hold = 100.0f;
        g_noiseGate.release = 150.0f;
        g_noiseGate.range = -80.0f;
        if (g_noiseGate.enabled) applyNoiseGateToDSP();
        printf("[NOISE GATE] Reset to defaults\n");
    }

    // ============== DE-ESSER ==============
    void applyDeEsserToDSP() {
        if (!m_stream) return;
        
        // De-esser, yüksek frekanslarda (sibilance) sıkıştırma yapar
        // Aurivo DSP compressor'ı kullanarak belirli frekans bandında çalışır
        // Frequency: Hedef frekans (4-12 kHz arası sibilance bölgesi)
        // Threshold: Sıkıştırma başlangıç seviyesi
        // Ratio: Sıkıştırma oranı
        // Range: Maksimum azaltma miktarı
        
        if (g_deEsser.enabled && m_aurivoDSP) {
            // De-esser için compressor parametrelerini ayarla
            // Hızlı attack/release ile sibilance'ı yakala
            float attack = 0.5f;   // Çok hızlı attack (ms)
            float release = 20.0f; // Hızlı release (ms)
            float makeup = 0.0f;   // Makeup gain yok
            
            set_compressor_params(m_aurivoDSP, 1,
                g_deEsser.threshold,
                g_deEsser.ratio,
                attack,
                release,
                makeup);
            
            printf("[DE-ESSER] Applied - Freq: %.0f Hz, Threshold: %.1f dB, Ratio: %.1f:1, Range: %.1f dB\n",
                   g_deEsser.frequency, g_deEsser.threshold, g_deEsser.ratio, g_deEsser.range);
        }
    }

    void enableDeEsser(bool enable) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_deEsser.enabled = enable;
        
        if (enable) {
            applyDeEsserToDSP();
        } else {
            // Devre dışı bırakırken compressor'ı sıfırla
            if (m_aurivoDSP) {
                set_compressor_params(m_aurivoDSP, 0, 0.0f, 1.0f, 10.0f, 100.0f, 0.0f);
            }
        }
        
        printf("[DE-ESSER] %s\n", enable ? "Enabled" : "Disabled");
    }

    void setDeEsserFrequency(float frequency) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_deEsser.frequency = clampf(frequency, 4000.0f, 12000.0f);
        if (g_deEsser.enabled) applyDeEsserToDSP();
        printf("[DE-ESSER] Frequency: %.0f Hz\n", g_deEsser.frequency);
    }

    void setDeEsserThreshold(float threshold) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_deEsser.threshold = clampf(threshold, -60.0f, 0.0f);
        if (g_deEsser.enabled) applyDeEsserToDSP();
        printf("[DE-ESSER] Threshold: %.1f dB\n", g_deEsser.threshold);
    }

    void setDeEsserRatio(float ratio) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_deEsser.ratio = clampf(ratio, 1.0f, 10.0f);
        if (g_deEsser.enabled) applyDeEsserToDSP();
        printf("[DE-ESSER] Ratio: %.1f:1\n", g_deEsser.ratio);
    }

    void setDeEsserRange(float range) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_deEsser.range = clampf(range, -24.0f, 0.0f);
        if (g_deEsser.enabled) applyDeEsserToDSP();
        printf("[DE-ESSER] Range: %.1f dB\n", g_deEsser.range);
    }

    void setDeEsserListenMode(bool listen) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_deEsser.listenMode = listen;
        printf("[DE-ESSER] Listen Mode: %s\n", listen ? "ON" : "OFF");
    }

    float getDeEsserActivity() {
        std::lock_guard<std::mutex> lock(m_mutex);
        
        if (!g_deEsser.enabled || !m_stream) return 0.0f;
        
        // Mevcut ses seviyesini al
        DWORD level = BASS_ChannelGetLevel(m_stream);
        int maxLevel = LOWORD(level) > HIWORD(level) ? LOWORD(level) : HIWORD(level);
        if (maxLevel <= 0) return 0.0f;
        
        float levelDB = 20.0f * log10f((float)maxLevel / 32768.0f);
        
        // Threshold üstündeki miktar (gain reduction tahmini)
        if (levelDB > g_deEsser.threshold) {
            float overThreshold = levelDB - g_deEsser.threshold;
            float reduction = overThreshold * (1.0f - 1.0f/g_deEsser.ratio);
            return fminf(reduction, fabsf(g_deEsser.range));
        }
        
        return 0.0f;
    }

    void resetDeEsser() {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_deEsser.frequency = 7000.0f;
        g_deEsser.threshold = -30.0f;
        g_deEsser.ratio = 4.0f;
        g_deEsser.range = -12.0f;
        g_deEsser.listenMode = false;
        if (g_deEsser.enabled) applyDeEsserToDSP();
        printf("[DE-ESSER] Reset to defaults\n");
    }

    // ============== EXCITER (HARMONIC ENHANCER) ==============
    void applyExciterToDSP() {
        if (!m_stream || !m_aurivoDSP) return;
        
        // Exciter: Yüksek frekanslara boost + harmonik zenginleştirme
        // PEQ bantları ile high-shelf boost simüle ediyoruz
        
        if (g_exciter.enabled) {
            float intensity = g_exciter.amount / 100.0f;  // 0.0 - 1.0
            float mixFactor = g_exciter.mix / 100.0f;     // 0.0 - 1.0
            float harmFactor = g_exciter.harmonics / 100.0f;  // 0.0 - 1.0
            
            // Type'a göre farklı karakteristikler
            float boostGain = 0.0f;
            float airGain = 0.0f;
            float bandwidth = 2.0f;
            
            switch (g_exciter.type) {
                case 0:  // TUBE (Warm, soft)
                    boostGain = intensity * 8.0f * mixFactor;   // Max 8 dB
                    airGain = intensity * 3.0f * mixFactor;     // Max 3 dB air
                    bandwidth = 2.5f;
                    break;
                    
                case 1:  // TAPE (Saturation)
                    boostGain = intensity * 6.0f * mixFactor;   // Max 6 dB
                    airGain = intensity * 2.0f * mixFactor;     // Max 2 dB air
                    bandwidth = 3.0f;
                    break;
                    
                case 2:  // AURAL (Bright, crisp)
                    boostGain = intensity * 12.0f * mixFactor;  // Max 12 dB
                    airGain = intensity * 6.0f * mixFactor;     // Max 6 dB air
                    bandwidth = 1.5f;
                    break;
                    
                case 3:  // WARM (Smooth)
                    boostGain = intensity * 5.0f * mixFactor;   // Max 5 dB
                    airGain = intensity * 1.5f * mixFactor;     // Max 1.5 dB air
                    bandwidth = 3.5f;
                    break;
            }
            
            // Harmonik faktör ile boost'u artır
            boostGain *= (1.0f + harmFactor * 0.5f);
            
            // PEQ Band 0: Ana yüksek frekans boost (exciter frequency'den başlar)
            set_peq_band(m_aurivoDSP, 0, 1, g_exciter.frequency, boostGain, bandwidth);
            
            // PEQ Band 1: Air band (12-16 kHz arası "hava" hissi)
            set_peq_band(m_aurivoDSP, 1, 1, 14000.0f, airGain, 1.0f);
            
            printf("[EXCITER] Applied - Type: %d, Freq: %.0f Hz, Boost: %.1f dB, Air: %.1f dB\n",
                   g_exciter.type, g_exciter.frequency, boostGain, airGain);
        }
    }

    void enableExciter(bool enable) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_exciter.enabled = enable;
        
        if (enable) {
            applyExciterToDSP();
        } else {
            // PEQ bantlarını sıfırla
            if (m_aurivoDSP) {
                set_peq_band(m_aurivoDSP, 0, 0, 5000.0f, 0.0f, 1.0f);
                set_peq_band(m_aurivoDSP, 1, 0, 14000.0f, 0.0f, 1.0f);
            }
        }
        
        printf("[EXCITER] %s\n", enable ? "Enabled" : "Disabled");
    }

    void setExciterAmount(float amount) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_exciter.amount = clampf(amount, 0.0f, 100.0f);
        if (g_exciter.enabled) applyExciterToDSP();
        printf("[EXCITER] Amount: %.0f%%\n", g_exciter.amount);
    }

    void setExciterFrequency(float frequency) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_exciter.frequency = clampf(frequency, 2000.0f, 10000.0f);
        if (g_exciter.enabled) applyExciterToDSP();
        printf("[EXCITER] Frequency: %.0f Hz\n", g_exciter.frequency);
    }

    void setExciterHarmonics(float harmonics) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_exciter.harmonics = clampf(harmonics, 0.0f, 100.0f);
        if (g_exciter.enabled) applyExciterToDSP();
        printf("[EXCITER] Harmonics: %.0f%%\n", g_exciter.harmonics);
    }

    void setExciterMix(float mix) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_exciter.mix = clampf(mix, 0.0f, 100.0f);
        if (g_exciter.enabled) applyExciterToDSP();
        printf("[EXCITER] Mix: %.0f%%\n", g_exciter.mix);
    }

    void setExciterType(int type) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_exciter.type = (type < 0) ? 0 : ((type > 3) ? 3 : type);
        if (g_exciter.enabled) applyExciterToDSP();
        const char* typeNames[] = {"Tube", "Tape", "Aural", "Warm"};
        printf("[EXCITER] Type: %s\n", typeNames[g_exciter.type]);
    }

    void resetExciter() {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_exciter.amount = 50.0f;
        g_exciter.frequency = 5000.0f;
        g_exciter.harmonics = 40.0f;
        g_exciter.mix = 50.0f;
        g_exciter.type = 0;
        if (g_exciter.enabled) applyExciterToDSP();
        printf("[EXCITER] Reset to defaults\n");
    }

    // ============================================
    // STEREO WIDENER METHODS
    // ============================================
    
    void applyStereoWidenerToDSP() {
        if (!m_aurivoDSP) return;
        
        // Width: 0% = mono (0.0), 100% = normal (1.0), 200% = max (2.0)
        float stereoWidth = g_stereoWidener.width / 100.0f;
        
        // Aurivo DSP'nin set_stereo_width fonksiyonunu kullan
        set_stereo_width(m_aurivoDSP, stereoWidth);
        
        printf("[STEREO WIDENER] Applied - Width: %.0f%%, Bass: %.0f Hz, Delay: %.1f ms\n",
               g_stereoWidener.width, g_stereoWidener.bassFreq, g_stereoWidener.delay);
    }

    void enableStereoWidener(bool enable) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_stereoWidener.enabled = enable;
        
        if (enable) {
            applyStereoWidenerToDSP();
            printf("[STEREO WIDENER] Enabled\n");
        } else {
            // Sıfırla to normal stereo (100%)
            if (m_aurivoDSP) {
                set_stereo_width(m_aurivoDSP, 1.0f);  // Normal stereo
            }
            printf("[STEREO WIDENER] Disabled\n");
        }
    }

    void setStereoWidth(float width) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_stereoWidener.width = clampf(width, 0.0f, 200.0f);
        if (g_stereoWidener.enabled) applyStereoWidenerToDSP();
        printf("[STEREO WIDENER] Width: %.0f%%\n", g_stereoWidener.width);
    }

    void setStereoBassCutoff(float frequency) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_stereoWidener.bassFreq = clampf(frequency, 40.0f, 250.0f);
        if (g_stereoWidener.enabled) applyStereoWidenerToDSP();
        printf("[STEREO WIDENER] Bass cutoff: %.0f Hz\n", g_stereoWidener.bassFreq);
    }

    void setStereoDelay(float delay) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_stereoWidener.delay = clampf(delay, 0.0f, 30.0f);
        if (g_stereoWidener.enabled) applyStereoWidenerToDSP();
        printf("[STEREO WIDENER] Haas delay: %.1f ms\n", g_stereoWidener.delay);
    }

    void setStereoBalance(float balance) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_stereoWidener.balance = clampf(balance, -100.0f, 100.0f);
        
        // BASS pan attribute kullan
        if (m_stream) {
            float pan = g_stereoWidener.balance / 100.0f;  // -1.0 ile +1.0
            BASS_ChannelSetAttribute(m_stream, BASS_ATTRIB_PAN, pan);
        }
        
        printf("[STEREO WIDENER] Balance: %.0f\n", g_stereoWidener.balance);
    }

    void setStereoMonoLow(bool monoLow) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_stereoWidener.monoLow = monoLow;
        if (g_stereoWidener.enabled) applyStereoWidenerToDSP();
        printf("[STEREO WIDENER] Mono low: %s\n", monoLow ? "ON" : "OFF");
    }

    float getStereoPhase() {
        std::lock_guard<std::mutex> lock(m_mutex);
        float phase = 0.0f;
        
        if (m_stream) {
            // Sol ve sağ kanal seviyelerini al
            DWORD level = BASS_ChannelGetLevel(m_stream);
            int left = LOWORD(level);
            int right = HIWORD(level);
            
            // Basitleştirilmiş phase correlation
            if (left > 0 && right > 0) {
                float ratio = (float)left / (float)right;
                phase = 1.0f - fabs(1.0f - ratio);
                if (phase < -1.0f) phase = -1.0f;
                if (phase > 1.0f) phase = 1.0f;
            }
        }
        
        return phase;
    }

    void resetStereoWidener() {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_stereoWidener.width = 100.0f;
        g_stereoWidener.bassFreq = 120.0f;
        g_stereoWidener.delay = 0.0f;
        g_stereoWidener.balance = 0.0f;
        g_stereoWidener.monoLow = true;
        
        if (g_stereoWidener.enabled) {
            applyStereoWidenerToDSP();
            
            // Balance sıfırla
            if (m_stream) {
                BASS_ChannelSetAttribute(m_stream, BASS_ATTRIB_PAN, 0.0f);
            }
        }
        
        printf("[STEREO WIDENER] Reset to defaults\n");
    }

    // ============================================
    // ECHO (DELAY) METHODS
    // ============================================
    
    void applyEchoToDSP() {
        if (!m_aurivoDSP) return;
        
        // Aurivo DSP'nin set_echo_params fonksiyonunu kullan
        // delay (ms), feedback (0-1), mix (0-1)
        float feedbackNorm = g_echo.feedback / 100.0f;
        float mixNorm = g_echo.wetMix / 100.0f;
        
        set_echo_params(m_aurivoDSP, g_echo.enabled ? 1 : 0, 
                        g_echo.delay, feedbackNorm, mixNorm);
        
        printf("[ECHO] Applied - Delay: %.0f ms, Feedback: %.0f%%, Wet: %.0f%%, Dry: %.0f%%, Stereo: %s\n",
               g_echo.delay, g_echo.feedback, g_echo.wetMix, g_echo.dryMix,
               g_echo.stereo ? "Ping-Pong" : "Normal");
    }

    void applySoftEchoToDSP() {
        if (!m_aurivoDSP) return;

        // Daha "saf/yumuşak" karakter için geri-besleme ve wet oranını biraz yumuşat.
        float feedbackNorm = (g_softEcho.feedback / 100.0f) * 0.82f;
        float mixNorm = (g_softEcho.wetMix / 100.0f) * 0.92f;
        float delayMs = clampf(g_softEcho.delay, 40.0f, 900.0f);

        set_echo_params(m_aurivoDSP, g_softEcho.enabled ? 1 : 0,
                        delayMs, clampf(feedbackNorm, 0.0f, 0.95f), clampf(mixNorm, 0.0f, 1.0f));

        printf("[SOFT ECHO] Applied - Delay: %.0f ms, Feedback: %.0f%%, Wet: %.0f%%, Stereo: %s\n",
               g_softEcho.delay, g_softEcho.feedback, g_softEcho.wetMix,
               g_softEcho.stereo ? "Ping-Pong" : "Normal");
    }

    void enableEcho(bool enable) {
        std::lock_guard<std::mutex> lock(m_mutex);
        if (enable) g_softEcho.enabled = false;
        g_echo.enabled = enable;
        
        if (enable) {
            applyEchoToDSP();
            printf("[ECHO] Enabled\n");
        } else {
            // Devre dışı bırak echo in DSP
            if (m_aurivoDSP) {
                set_echo_params(m_aurivoDSP, 0, 0, 0, 0);
            }
            printf("[ECHO] Disabled\n");
        }
    }

    void enableSoftEcho(bool enable) {
        std::lock_guard<std::mutex> lock(m_mutex);
        if (enable) g_echo.enabled = false;
        g_softEcho.enabled = enable;
        if (enable) {
            applySoftEchoToDSP();
            printf("[SOFT ECHO] Enabled\n");
        } else {
            if (g_echo.enabled) applyEchoToDSP();
            else if (m_aurivoDSP) set_echo_params(m_aurivoDSP, 0, 0, 0, 0);
            printf("[SOFT ECHO] Disabled\n");
        }
    }

    void setEchoDelay(float delay) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_echo.delay = clampf(delay, 1.0f, 2000.0f);
        if (g_echo.enabled) applyEchoToDSP();
        printf("[ECHO] Delay: %.0f ms\n", g_echo.delay);
    }

    void setEchoFeedback(float feedback) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_echo.feedback = clampf(feedback, 0.0f, 95.0f);
        if (g_echo.enabled) applyEchoToDSP();
        printf("[ECHO] Feedback: %.0f%%\n", g_echo.feedback);
    }

    void setEchoWetMix(float wetMix) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_echo.wetMix = clampf(wetMix, 0.0f, 100.0f);
        if (g_echo.enabled) applyEchoToDSP();
        printf("[ECHO] Wet mix: %.0f%%\n", g_echo.wetMix);
    }

    void setEchoDryMix(float dryMix) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_echo.dryMix = clampf(dryMix, 0.0f, 100.0f);
        if (g_echo.enabled) applyEchoToDSP();
        printf("[ECHO] Dry mix: %.0f%%\n", g_echo.dryMix);
    }

    void setEchoStereoMode(bool stereo) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_echo.stereo = stereo;
        if (g_echo.enabled) applyEchoToDSP();
        printf("[ECHO] Stereo mode: %s\n", stereo ? "Ping-Pong" : "Normal");
    }

    void setEchoLowCut(float lowCut) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_echo.lowCut = clampf(lowCut, 20.0f, 500.0f);
        if (g_echo.enabled) applyEchoToDSP();
        printf("[ECHO] Low cut: %.0f Hz\n", g_echo.lowCut);
    }

    void setEchoHighCut(float highCut) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_echo.highCut = clampf(highCut, 2000.0f, 16000.0f);
        if (g_echo.enabled) applyEchoToDSP();
        printf("[ECHO] High cut: %.0f Hz\n", g_echo.highCut);
    }

    void setEchoTempo(float bpm, int division) {
        std::lock_guard<std::mutex> lock(m_mutex);
        
        // BPM'den delay hesapla
        float beatLength = 60000.0f / bpm;  // Bir beat'in ms süresi
        
        float delayMs = beatLength;
        switch (division) {
            case 0:  // 1/4 note (quarter)
                delayMs = beatLength;
                break;
            case 1:  // 1/8 note (eighth)
                delayMs = beatLength / 2.0f;
                break;
            case 2:  // 1/16 note (sixteenth)
                delayMs = beatLength / 4.0f;
                break;
            case 3:  // Dotted 1/4
                delayMs = beatLength * 1.5f;
                break;
            case 4:  // Triplet 1/8
                delayMs = beatLength / 3.0f;
                break;
            case 5:  // 1/2 note (half)
                delayMs = beatLength * 2.0f;
                break;
            default:
                delayMs = beatLength;
                break;
        }
        
        g_echo.delay = delayMs;
        
        if (g_echo.enabled) applyEchoToDSP();
        
        printf("[ECHO] Tempo sync: %.0f BPM, Division: %d -> %.0f ms\n", bpm, division, delayMs);
    }

    void resetEcho() {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_echo.delay = 250.0f;
        g_echo.feedback = 30.0f;
        g_echo.wetMix = 30.0f;
        g_echo.dryMix = 100.0f;
        g_echo.stereo = false;
        g_echo.lowCut = 100.0f;
        g_echo.highCut = 8000.0f;
        
        if (g_echo.enabled) applyEchoToDSP();
        
        printf("[ECHO] Reset to defaults\n");
    }

    void setSoftEchoDelay(float delay) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_softEcho.delay = clampf(delay, 40.0f, 900.0f);
        if (g_softEcho.enabled) applySoftEchoToDSP();
        printf("[SOFT ECHO] Delay: %.0f ms\n", g_softEcho.delay);
    }

    void setSoftEchoFeedback(float feedback) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_softEcho.feedback = clampf(feedback, 0.0f, 60.0f);
        if (g_softEcho.enabled) applySoftEchoToDSP();
        printf("[SOFT ECHO] Feedback: %.0f%%\n", g_softEcho.feedback);
    }

    void setSoftEchoWetMix(float wetMix) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_softEcho.wetMix = clampf(wetMix, 0.0f, 55.0f);
        if (g_softEcho.enabled) applySoftEchoToDSP();
        printf("[SOFT ECHO] Wet mix: %.0f%%\n", g_softEcho.wetMix);
    }

    void setSoftEchoDryMix(float dryMix) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_softEcho.dryMix = clampf(dryMix, 0.0f, 100.0f);
        if (g_softEcho.enabled) applySoftEchoToDSP();
        printf("[SOFT ECHO] Dry mix: %.0f%%\n", g_softEcho.dryMix);
    }

    void setSoftEchoStereoMode(bool stereo) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_softEcho.stereo = stereo;
        if (g_softEcho.enabled) applySoftEchoToDSP();
        printf("[SOFT ECHO] Stereo mode: %s\n", stereo ? "Ping-Pong" : "Normal");
    }

    void setSoftEchoHighCut(float highCut) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_softEcho.highCut = clampf(highCut, 2000.0f, 16000.0f);
        if (g_softEcho.enabled) applySoftEchoToDSP();
        printf("[SOFT ECHO] High cut: %.0f Hz\n", g_softEcho.highCut);
    }

    void resetSoftEcho() {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_softEcho.delay = 220.0f;
        g_softEcho.feedback = 22.0f;
        g_softEcho.wetMix = 18.0f;
        g_softEcho.dryMix = 100.0f;
        g_softEcho.stereo = false;
        g_softEcho.highCut = 7000.0f;
        if (g_softEcho.enabled) applySoftEchoToDSP();
        printf("[SOFT ECHO] Reset to defaults\n");
    }

    // ============== CONVOLUTION REVERB ==============
    
    void applyConvolutionReverbToDSP() {
        if (!m_stream) return;
        
        // DirectX Reverb parametreleri
        if (fxConvReverb) {
            BASS_DX8_REVERB reverb;
            
            // Input gain (0 dB = no change)
            reverb.fInGain = 0.0f;
            
            // Reverb mix: -96 dB (dry/silent) ile 0 dB (full wet)
            // Lineer yüzdeyi logaritmik dB'ye çevir
            // wetMix 0% = -96 dB (sessiz), 100% = 0 dB (full)
            // Daha etkili bir eğri kullanalım
            float wetPercent = g_convReverb.wetMix / 100.0f;
            float reverbMix;
            if (wetPercent <= 0.0f) {
                reverbMix = -96.0f;
            } else {
                // Logaritmik dönüşüm: 20 * log10(wetPercent)
                // Ama minimum -96 dB olmalı
                reverbMix = 20.0f * log10f(wetPercent);
                if (reverbMix < -96.0f) reverbMix = -96.0f;
            }
            reverb.fReverbMix = reverbMix;
            
            // Reverb time (decay) - DirectX: 0.001 ile 3000 ms arası
            float reverbTime = g_convReverb.decay * 1000.0f;
            if (reverbTime > 3000.0f) reverbTime = 3000.0f;
            if (reverbTime < 0.001f) reverbTime = 0.001f;
            reverb.fReverbTime = reverbTime;
            
            // High frequency RT ratio (damping) - 0.001 ile 0.999
            float hfRatio = 1.0f - g_convReverb.damping;
            if (hfRatio < 0.001f) hfRatio = 0.001f;
            if (hfRatio > 0.999f) hfRatio = 0.999f;
            reverb.fHighFreqRTRatio = hfRatio;
            
            BOOL success = BASS_FXSetParameters(fxConvReverb, &reverb);
            
            if (!success) {
                printf("[CONV REVERB] Parametre hatası: %d\n", BASS_ErrorGetCode());
            } else {
                printf("[CONV REVERB] Applied - Room: %.0f%%, Decay: %.1fs, Damp: %.2f, Wet: %.0f%% (%.1f dB)\n",
                       g_convReverb.roomSize, g_convReverb.decay, g_convReverb.damping, g_convReverb.wetMix, reverbMix);
            }
        }
        
        // Pre-delay (DirectX Echo ile)
        if (fxConvPreDelay && g_convReverb.preDelay > 0.0f) {
            BASS_DX8_ECHO preDelayFx;
            preDelayFx.fWetDryMix = 50.0f;  // Balanced mix
            preDelayFx.fFeedback = 0.0f;    // No repeat
            preDelayFx.fLeftDelay = g_convReverb.preDelay;   // ms
            preDelayFx.fRightDelay = g_convReverb.preDelay;  // ms
            preDelayFx.lPanDelay = FALSE;
            
            BASS_FXSetParameters(fxConvPreDelay, &preDelayFx);
        }
    }
    
    bool enableConvolutionReverb(bool enable) {
        std::lock_guard<std::mutex> lock(m_mutex);
        
        if (!m_stream) return false;
        
        if (enable) {
            // Ana reverb efekti ekle
            if (!fxConvReverb) {
                fxConvReverb = BASS_ChannelSetFX(m_stream, BASS_FX_DX8_REVERB, 1);
                if (!fxConvReverb) {
                    printf("[CONV REVERB] Reverb FX eklenemedi: %d\n", BASS_ErrorGetCode());
                    return false;
                }
            }
            
            // Pre-delay efekti ekle (DirectX Echo)
            if (!fxConvPreDelay) {
                fxConvPreDelay = BASS_ChannelSetFX(m_stream, BASS_FX_DX8_ECHO, 0);
                if (!fxConvPreDelay) {
                    printf("[CONV REVERB] Pre-delay FX eklenemedi: %d\n", BASS_ErrorGetCode());
                }
            }
            
            g_convReverb.enabled = true;
            applyConvolutionReverbToDSP();
            printf("[CONV REVERB] Enabled\n");
        } else {
            // FX'leri kaldır
            if (fxConvReverb) {
                BASS_ChannelRemoveFX(m_stream, fxConvReverb);
                fxConvReverb = 0;
            }
            if (fxConvPreDelay) {
                BASS_ChannelRemoveFX(m_stream, fxConvPreDelay);
                fxConvPreDelay = 0;
            }
            g_convReverb.enabled = false;
            printf("[CONV REVERB] Disabled\n");
        }
        
        return true;
    }
    
    bool loadIRFile(const char* filepath) {
        std::lock_guard<std::mutex> lock(m_mutex);
        
        // IR dosya yolunu sakla
        strncpy(g_convReverb.irFilePath, filepath, sizeof(g_convReverb.irFilePath) - 1);
        g_convReverb.irFilePath[sizeof(g_convReverb.irFilePath) - 1] = '\0';
        
        printf("[CONV REVERB] IR dosyası: %s\n", filepath);
        printf("[CONV REVERB] NOT: Gerçek konvolüsyon için custom DSP gerekli\n");
        printf("[CONV REVERB] Şimdilik algoritmik reverb kullanılıyor\n");
        
        if (g_convReverb.enabled) {
            applyConvolutionReverbToDSP();
        }
        
        return true;
    }
    
    void setConvReverbRoomSize(float roomSize) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_convReverb.roomSize = clampf(roomSize, 0.0f, 100.0f);
        if (g_convReverb.enabled) applyConvolutionReverbToDSP();
        printf("[CONV REVERB] Room size: %.0f%%\n", g_convReverb.roomSize);
    }
    
    void setConvReverbDecay(float decay) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_convReverb.decay = clampf(decay, 0.1f, 10.0f);
        if (g_convReverb.enabled) applyConvolutionReverbToDSP();
        printf("[CONV REVERB] Decay: %.1fs\n", g_convReverb.decay);
    }
    
    void setConvReverbDamping(float damping) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_convReverb.damping = clampf(damping, 0.0f, 1.0f);
        if (g_convReverb.enabled) applyConvolutionReverbToDSP();
        printf("[CONV REVERB] Damping: %.2f\n", g_convReverb.damping);
    }
    
    void setConvReverbWetMix(float wetMix) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_convReverb.wetMix = clampf(wetMix, 0.0f, 100.0f);
        if (g_convReverb.enabled) applyConvolutionReverbToDSP();
        printf("[CONV REVERB] Wet mix: %.0f%%\n", g_convReverb.wetMix);
    }
    
    void setConvReverbDryMix(float dryMix) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_convReverb.dryMix = clampf(dryMix, 0.0f, 100.0f);
        if (g_convReverb.enabled) applyConvolutionReverbToDSP();
        printf("[CONV REVERB] Dry mix: %.0f%%\n", g_convReverb.dryMix);
    }
    
    void setConvReverbPreDelay(float preDelay) {
        std::lock_guard<std::mutex> lock(m_mutex);
        g_convReverb.preDelay = clampf(preDelay, 0.0f, 200.0f);
        if (g_convReverb.enabled) applyConvolutionReverbToDSP();
        printf("[CONV REVERB] Pre-delay: %.0fms\n", g_convReverb.preDelay);
    }
    
    void setConvReverbRoomType(int roomType) {
        std::lock_guard<std::mutex> lock(m_mutex);
        
        // Limit: 0-7 (8 preset)
        g_convReverb.roomType = (roomType < 0) ? 0 : (roomType > 7 ? 7 : roomType);
        
        // Preset'ten parametreleri yükle
        const IRPreset& preset = IR_PRESETS[g_convReverb.roomType];
        g_convReverb.roomSize = preset.roomSize;
        g_convReverb.decay = preset.decay;
        g_convReverb.damping = preset.damping;
        
        if (g_convReverb.enabled) applyConvolutionReverbToDSP();
        
        printf("[CONV REVERB] Room type: %s (size: %.0f%%, decay: %.1fs, damp: %.2f)\n", 
               preset.name, preset.roomSize, preset.decay, preset.damping);
    }
    
    void resetConvolutionReverb() {
        std::lock_guard<std::mutex> lock(m_mutex);
        
        g_convReverb.wetMix = 30.0f;
        g_convReverb.dryMix = 100.0f;
        g_convReverb.preDelay = 0.0f;
        g_convReverb.roomSize = 50.0f;
        g_convReverb.decay = 1.5f;
        g_convReverb.damping = 0.5f;
        g_convReverb.roomType = 1;  // Medium Room
        
        if (g_convReverb.enabled) applyConvolutionReverbToDSP();
        
        printf("[CONV REVERB] Reset to defaults\n");
    }

private:
public:
    
    // New Effect Setters - Ayarlar stored regardless of m_dspEnabled
    void setCompressorForEngine(bool enabled, float thresh, float ratio, float att, float rel, float makeup) {
        std::lock_guard<std::mutex> lock(m_mutex);

        g_compressor.threshold = clampf(thresh, -60.0f, 0.0f);
        g_compressor.ratio = clampf(ratio, 1.0f, 20.0f);
        g_compressor.attack = clampf(att, 0.1f, 100.0f);
        g_compressor.release = clampf(rel, 10.0f, 1000.0f);
        g_compressor.makeupGain = clampf(makeup, -12.0f, 24.0f);
        g_compressor.enabled = enabled;

        // Use DSP compressor
        if (m_aurivoDSP) {
            set_compressor_params(m_aurivoDSP, enabled ? 1 : 0, 
                                  g_compressor.threshold, 
                                  g_compressor.ratio, 
                                  g_compressor.attack, 
                                  g_compressor.release, 
                                  g_compressor.makeupGain);
        }
    }
    
    void setGateForEngine(bool enabled, float thresh, float att, float rel) {
        std::lock_guard<std::mutex> lock(m_mutex);
        if (m_aurivoDSP) {
            set_gate_params(m_aurivoDSP, enabled ? 1 : 0, thresh, att, rel);
        }
    }

    void setLimiterForEngine(bool enabled, float ceiling, float rel) {
        std::lock_guard<std::mutex> lock(m_mutex);
        if (m_aurivoDSP) {
            set_limiter_params(m_aurivoDSP, enabled ? 1 : 0, ceiling, rel);
        }
    }

    void setEchoForEngine(bool enabled, float delay, float feedback, float mix) {
        std::lock_guard<std::mutex> lock(m_mutex);
        if (m_aurivoDSP) {
            set_echo_params(m_aurivoDSP, enabled ? 1 : 0, delay, feedback, mix);
        }
    }
    
    void setBassBoostDsp(bool enabled, float gain, float freq) {
        std::lock_guard<std::mutex> lock(m_mutex);
        if (m_aurivoDSP) {
            set_bass_boost(m_aurivoDSP, enabled ? 1 : 0, gain, freq);
        }
    }

    void setPEQ(int band, bool enabled, float freq, float gain, float Q) {
        std::lock_guard<std::mutex> lock(m_mutex);
        if (m_aurivoDSP) {
            set_peq_band(m_aurivoDSP, band, enabled ? 1 : 0, freq, gain, Q);
        }
    }
    
    bool setPEQFilterType(int band, int filterType) {
        std::lock_guard<std::mutex> lock(m_mutex);
        if (m_aurivoDSP && band >= 0 && band < 6 && filterType >= 0 && filterType <= 6) {
            set_peq_filter_type(m_aurivoDSP, band, filterType);
            const char* typeNames[] = {"Bell", "Low Shelf", "High Shelf", "Low Pass", "High Pass", "Notch", "Band Pass"};
            printf("[PEQ] Band %d Filter Type: %s\n", band + 1, typeNames[filterType]);
            return true;
        }
        return false;
    }
    
    bool getPEQBand(int band, float* freq, float* gain, float* Q, int* filterType) {
        std::lock_guard<std::mutex> lock(m_mutex);
        if (m_aurivoDSP && band >= 0 && band < 6) {
            get_peq_band(m_aurivoDSP, band, freq, gain, Q, filterType);
            return true;
        }
        return false;
    }

    void applyMasterVolume() {
        if (!m_stream) return;
        if (m_overlapCrossfadeActive) return; // slide volume'u bozma
        applyMasterVolumeToStream(m_stream);
    }
    
    void updatePreampFx() {
        updatePreampFxHandle(m_preampFx);
        updatePreampFxHandle(m_prevPreampFx);
    }
    
    void updateEqBand(int band) {
        if (!m_aurivoDSP || !m_dspEnabled) return;

        float totalGain = m_eqGains[band];
        if (band < BASS_BOOST_BANDS && m_bassBoost > 0.0f) {
            // Bass boost: düşük frekanslara kademeli ekleme
            // En düşük frekanslar en çok boost alır
            float boostFactor = 1.0f - ((float)band / BASS_BOOST_BANDS);
            float boostDB = (m_bassBoost / 100.0f) * 12.0f * boostFactor;  // Max 12dB boost
            totalGain += boostDB;
        }
        
        totalGain = clampf(totalGain, -15.0f, 15.0f);
        set_eq_band(m_aurivoDSP, band, totalGain);
    }

    void updateEqBandWithOffset(int band, float offsetDb) {
        if (!m_aurivoDSP || !m_dspEnabled) return;

        float totalGain = m_eqGains[band] + offsetDb;
        if (band < BASS_BOOST_BANDS && m_bassBoost > 0.0f) {
            float boostFactor = 1.0f - ((float)band / BASS_BOOST_BANDS);
            float boostDB = (m_bassBoost / 100.0f) * 12.0f * boostFactor;
            totalGain += boostDB;
        }
        totalGain = clampf(totalGain, -15.0f, 15.0f);
        set_eq_band(m_aurivoDSP, band, totalGain);
    }
    
    void applyBassBoost() {
        // Sadece düşük frekans bantlarını güncelle
        for (int i = 0; i < BASS_BOOST_BANDS; ++i) {
            updateEqBand(i);
        }
    }
    
    // ============================================
    // AURIVO DSP CALLBACK
    // ============================================
    static void CALLBACK dspCallback(HDSP handle, DWORD channel, void* buffer, DWORD length, void* user) {
        (void)handle;
        AurivoAudioEngine* engine = static_cast<AurivoAudioEngine*>(user);
        
        // Debug logger (once per sec)
        static int cbDebugCounter = 0;
        bool logNow = (++cbDebugCounter > 100); // 100 callbacks ~1 sec
        if (logNow) cbDebugCounter = 0;

        if (logNow) printf("[DSP CALLBACK] Alive. Length: %d\n", (int)length);

        float* samples = static_cast<float*>(buffer);
        int frameCount = static_cast<int>(length / (sizeof(float) * 2));
        if (frameCount <= 0) return;

        // Ana DSP işleme (eğer DSP etkinse)
        if (!engine) {
             if (logNow) printf("[DSP CALLBACK] Engine is NULL!\n");
             return;
        }

           void* dsp = nullptr;
           TruePeakLimiterState* limiterState = nullptr;
           const bool isPrimary = (engine->m_stream != 0 && channel == (DWORD)engine->m_stream);

           if (engine->m_prevStream != 0 && channel == (DWORD)engine->m_prevStream) {
              dsp = engine->m_prevAurivoDSP;
              limiterState = &engine->m_limiterStatePrev;
           } else {
              dsp = engine->m_aurivoDSP;
              limiterState = &engine->m_limiterStateCurrent;
           }

           if (!dsp) {
               if (logNow) printf("[DSP CALLBACK] DSP instance is NULL!\n");
             return;
        }
        if (!engine->m_dspEnabled) {
             if (logNow) printf("[DSP CALLBACK] DSP Disabled!\n");
             return;
        }

        if (logNow) printf("[DSP CALLBACK] Processing %d frames...\n", frameCount);
        process_dsp(dsp, samples, frameCount, 2);

        // Surround Virtualizer (stereo kaynakta center/surround/LFE sahne simülasyonu)
        if (g_surround.enabled) {
            const float sr = (float)SAMPLE_RATE;
            const float centerGain = dBToLinear(clampf(g_surround.centerLevel, -12.0f, 12.0f));
            const float sideGain = dBToLinear(clampf(g_surround.sideLevel, -12.0f, 12.0f));
            const float lfeGain = dBToLinear(clampf(g_surround.lfeLevel, -12.0f, 12.0f));
            const float mix = clampf(g_surround.mix, 0.0f, 100.0f) / 100.0f;
            const float delayMs = clampf(g_surround.rearDelay, 0.0f, 30.0f);
            const int delaySamples = std::max(1, (int)std::lround((delayMs * sr) / 1000.0f));
            const size_t neededSize = (size_t)std::max(delaySamples + 2, 64);

            if (g_surroundState.sideDelayBuffer.size() != neededSize) {
                g_surroundState.sideDelayBuffer.assign(neededSize, 0.0f);
                g_surroundState.writePos = 0;
            }

            const float crossoverHz = clampf(g_surround.crossover, 40.0f, 220.0f);
            const float rc = 1.0f / (2.0f * (float)M_PI * crossoverHz);
            const float dt = 1.0f / sr;
            const float alpha = clampf(dt / (rc + dt), 0.0001f, 0.99f);

            const size_t delaySize = g_surroundState.sideDelayBuffer.size();
            size_t writePos = g_surroundState.writePos;
            float lfeState = g_surroundState.lfeLowpass;

            for (int i = 0; i < frameCount; ++i) {
                const float dryL = samples[i * 2];
                const float dryR = samples[i * 2 + 1];

                const float mid = 0.5f * (dryL + dryR);
                const float side = 0.5f * (dryL - dryR);

                g_surroundState.sideDelayBuffer[writePos] = side;
                const size_t readPos = (writePos + delaySize - (size_t)delaySamples) % delaySize;
                const float delayedSide = g_surroundState.sideDelayBuffer[readPos];
                writePos = (writePos + 1) % delaySize;

                lfeState += alpha * (mid - lfeState);
                const float lfe = lfeState * lfeGain * 0.55f;
                const float center = mid * centerGain;
                const float surround = delayedSide * sideGain;

                const float wetL = center + surround + lfe;
                const float wetR = center - surround + lfe;

                float outL = dryL * (1.0f - mix) + wetL * mix;
                float outR = dryR * (1.0f - mix) + wetR * mix;
                samples[i * 2] = clampf(outL, -1.0f, 1.0f);
                samples[i * 2 + 1] = clampf(outR, -1.0f, 1.0f);
            }

            g_surroundState.writePos = writePos;
            g_surroundState.lfeLowpass = lfeState;
        }
        
        // True Peak Limiter (DSP zincirinin en sonunda)
        if (g_truePeakLimiter.enabled) {
            float ceiling = powf(10.0f, g_truePeakLimiter.ceiling / 20.0f);  // dB -> linear
            float driveLinear = powf(10.0f, g_truePeakLimiter.inputGain / 20.0f);
            
            // Per-stream smoothing state
            float& gainL = limiterState->gainL;
            float& gainR = limiterState->gainR;
            float& peakL = limiterState->peakL;
            float& peakR = limiterState->peakR;
            
            // Ham sinyal peak ölçümü (limiter öncesi)
            float rawPeakL = 0.0f;
            float rawPeakR = 0.0f;
            for (int i = 0; i < frameCount; i++) {
                float absL = fabsf(samples[i * 2] * driveLinear);
                float absR = fabsf(samples[i * 2 + 1] * driveLinear);
                if (absL > rawPeakL) rawPeakL = absL;
                if (absR > rawPeakR) rawPeakR = absR;
            }
            
            // Ham sinyal dB'ye çevir
            float rawPeakLdB = 20.0f * log10f(fmaxf(rawPeakL, 1e-10f));
            float rawPeakRdB = 20.0f * log10f(fmaxf(rawPeakR, 1e-10f));
            
            if (isPrimary) {
                // Input peak güncelle (limiter öncesi)
                g_truePeakMeter.inputPeakL = rawPeakLdB;
                g_truePeakMeter.inputPeakR = rawPeakRdB;
                
                // Clipping sayacı (input ceiling'i aşıyor mu?) - BURADA ÖLÇ!
                if (rawPeakLdB > g_truePeakLimiter.ceiling || rawPeakRdB > g_truePeakLimiter.ceiling) {
                    g_truePeakMeter.clippingCount++;
                }
            }
            
            float attackCoef = expf(-1.0f / (g_truePeakLimiter.lookahead * 44.1f));  // ~44.1kHz
            float releaseCoef = expf(-1.0f / (g_truePeakLimiter.release * 44.1f));
            
            for (int i = 0; i < frameCount; i++) {
                float sampleL = samples[i * 2] * driveLinear;
                float sampleR = samples[i * 2 + 1] * driveLinear;
                
                // Peak detection
                float absL = fabsf(sampleL);
                float absR = fabsf(sampleR);
                
                // Attack/release envelope
                if (absL > peakL) {
                    peakL = absL;
                } else {
                    peakL = peakL * releaseCoef + absL * (1.0f - releaseCoef);
                }
                
                if (absR > peakR) {
                    peakR = absR;
                } else {
                    peakR = peakR * releaseCoef + absR * (1.0f - releaseCoef);
                }
                
                // Gain hesaplama
                float targetGainL = (peakL > ceiling) ? (ceiling / peakL) : 1.0f;
                float targetGainR = (peakR > ceiling) ? (ceiling / peakR) : 1.0f;
                
                // Stereo link
                if (g_truePeakLimiter.linkChannels) {
                    float minGain = fminf(targetGainL, targetGainR);
                    targetGainL = targetGainR = minGain;
                }
                
                // Smooth gain değişimi
                if (targetGainL < gainL) {
                    gainL = targetGainL;  // Fast attack
                } else {
                    gainL = gainL * releaseCoef + targetGainL * (1.0f - releaseCoef);
                }
                
                if (targetGainR < gainR) {
                    gainR = targetGainR;
                } else {
                    gainR = gainR * releaseCoef + targetGainR * (1.0f - releaseCoef);
                }
                
                // Uygula limiting
                samples[i * 2] = sampleL * gainL;
                samples[i * 2 + 1] = sampleR * gainR;
                
                // Hard clip (güvenlik)
                if (samples[i * 2] > ceiling) samples[i * 2] = ceiling;
                if (samples[i * 2] < -ceiling) samples[i * 2] = -ceiling;
                if (samples[i * 2 + 1] > ceiling) samples[i * 2 + 1] = ceiling;
                if (samples[i * 2 + 1] < -ceiling) samples[i * 2 + 1] = -ceiling;
            }
            
            if (isPrimary) {
                // Gain reduction hesapla (en düşük gain)
                float minGain = fminf(gainL, gainR);
                g_truePeakMeter.gainReduction = (minGain < 1.0f) ? 20.0f * log10f(minGain) : 0.0f;
                
                // Metering güncelle
                g_truePeakMeter.currentPeakL = 20.0f * log10f(fmaxf(peakL, 1e-10f));
                g_truePeakMeter.currentPeakR = 20.0f * log10f(fmaxf(peakR, 1e-10f));
                
                // True peak (oversampling simulasyonu)
                float oversampleBoost = 0.0f;
                if (g_truePeakLimiter.oversamplingRate == 2) oversampleBoost = 0.3f;
                else if (g_truePeakLimiter.oversamplingRate == 4) oversampleBoost = 0.5f;
                else if (g_truePeakLimiter.oversamplingRate == 8) oversampleBoost = 0.7f;
                
                g_truePeakMeter.truePeakL = g_truePeakMeter.currentPeakL + oversampleBoost;
                g_truePeakMeter.truePeakR = g_truePeakMeter.currentPeakR + oversampleBoost;
                
                // Peak hold güncelle
                if (g_truePeakMeter.truePeakL > g_truePeakMeter.peakHoldL) {
                    g_truePeakMeter.peakHoldL = g_truePeakMeter.truePeakL;
                }
                if (g_truePeakMeter.truePeakR > g_truePeakMeter.peakHoldR) {
                    g_truePeakMeter.peakHoldR = g_truePeakMeter.truePeakR;
                }
            }
            
            // Clipping sayacı zaten yukarıda (input aşamasında) sayılıyor
        }
    }

    // ============================================
    // SIMPLIFIED CALLBACKS (No AGC processing)
    // ============================================
    
    // Hard limiter function (safety net)
    static inline float hardLimit(float sample, float threshold) {
        if (sample > threshold) return threshold;
        if (sample < -threshold) return -threshold;
        return sample;
    }
    
    // ============================================
    // END CALLBACK
    // ============================================
    static void CALLBACK endCallback(HSYNC handle, DWORD channel, DWORD data, void* user) {
        // Playback bittiğinde çağrılır
        // JS tarafına callback gönderilebilir
    }
};

AurivoAudioEngine* AurivoAudioEngine::s_instance = nullptr;

// ============================================
// N-API WRAPPER
// ============================================
static AurivoAudioEngine* g_engine = nullptr;

// Başlat
Napi::Value InitAudio(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (!g_engine) {
        g_engine = new AurivoAudioEngine();
    }
    
    int deviceIndex = -1;
    if (info.Length() > 0 && info[0].IsNumber()) {
        deviceIndex = info[0].As<Napi::Number>().Int32Value();
    }
    
    bool success = g_engine->initialize(deviceIndex);
    if (success) {
        UpdateDynamicEQOnDSP();
    }
    
    Napi::Object result = Napi::Object::New(env);
    result.Set("success", Napi::Boolean::New(env, success));
    result.Set("error", success ? env.Null() : Napi::String::New(env, "BASS initialization failed"));
    return result;
}

// Cleanup
Napi::Value Cleanup(const Napi::CallbackInfo& info) {
    if (g_engine) {
        delete g_engine;
        g_engine = nullptr;
    }
    return info.Env().Undefined();
}

// Yükle File
Napi::Value LoadFile(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    Napi::Object result = Napi::Object::New(env);
    
    if (!g_engine) {
        result.Set("success", Napi::Boolean::New(env, false));
        result.Set("error", Napi::String::New(env, "Engine not initialized"));
        return result;
    }
    
    if (info.Length() < 1 || !info[0].IsString()) {
        result.Set("success", Napi::Boolean::New(env, false));
        result.Set("error", Napi::String::New(env, "File path required"));
        return result;
    }
    
    std::string filePath = info[0].As<Napi::String>().Utf8Value();
    bool success = g_engine->loadFile(filePath);
    
    result.Set("success", Napi::Boolean::New(env, success));
    if (!success) {
        int bassError = BASS_ErrorGetCode();
        std::string errorMsg = "BASS Error: " + std::to_string(bassError);
        result.Set("error", Napi::String::New(env, errorMsg));
    } else {
        result.Set("error", env.Null());
    }
    if (success) {
        result.Set("duration", Napi::Number::New(env, g_engine->getDuration()));
    }
    return result;
}

// True overlap crossfade (prev track overlaps while fading out)
Napi::Value CrossfadeTo(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Object result = Napi::Object::New(env);

    if (!g_engine) {
        result.Set("success", Napi::Boolean::New(env, false));
        result.Set("error", Napi::String::New(env, "Engine not initialized"));
        return result;
    }

    if (info.Length() < 1 || !info[0].IsString()) {
        result.Set("success", Napi::Boolean::New(env, false));
        result.Set("error", Napi::String::New(env, "File path required"));
        return result;
    }

    int durationMs = 2000;
    if (info.Length() >= 2 && info[1].IsNumber()) {
        durationMs = info[1].As<Napi::Number>().Int32Value();
    }

    std::string filePath = info[0].As<Napi::String>().Utf8Value();
    const bool success = g_engine->crossfadeToFile(filePath, durationMs);

    result.Set("success", Napi::Boolean::New(env, success));
    result.Set("error", success ? env.Null() : Napi::String::New(env, "Failed to crossfade"));
    return result;
}

// Playback controls
Napi::Value Play(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine) g_engine->play();
    return Napi::Boolean::New(env, g_engine != nullptr);
}

Napi::Value Pause(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine) g_engine->pause();
    return Napi::Boolean::New(env, g_engine != nullptr);
}

Napi::Value Stop(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine) g_engine->stop();
    return Napi::Boolean::New(env, g_engine != nullptr);
}

Napi::Value Seek(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine && info.Length() > 0 && info[0].IsNumber()) {
        double posMs = info[0].As<Napi::Number>().DoubleValue();
        g_engine->seek(posMs);
        return Napi::Boolean::New(env, true);
    }
    return Napi::Boolean::New(env, false);
}

// Position / Duration
Napi::Value GetCurrentPosition(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    double pos = g_engine ? g_engine->getPosition() : 0;
    return Napi::Number::New(env, pos);
}

Napi::Value GetDuration(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    double dur = g_engine ? g_engine->getDuration() : 0;
    return Napi::Number::New(env, dur);
}

Napi::Value IsPlaying(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    bool playing = g_engine ? g_engine->isPlaying() : false;
    return Napi::Boolean::New(env, playing);
}

// Master Volume (0-100)
Napi::Value SetMasterVolume(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    Napi::Object result = Napi::Object::New(env);
    
    if (!g_engine) {
        result.Set("success", Napi::Boolean::New(env, false));
        result.Set("error", Napi::String::New(env, "Engine not initialized"));
        return result;
    }
    
    if (info.Length() < 1 || !info[0].IsNumber()) {
        result.Set("success", Napi::Boolean::New(env, false));
        result.Set("error", Napi::String::New(env, "Volume value required (0-100)"));
        return result;
    }
    
    float volume = info[0].As<Napi::Number>().FloatValue();
    g_engine->setMasterVolume(volume);
    
    result.Set("success", Napi::Boolean::New(env, true));
    result.Set("volume", Napi::Number::New(env, g_engine->getMasterVolume()));
    return result;
}

Napi::Value GetMasterVolume(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    float vol = g_engine ? g_engine->getMasterVolume() : 0;
    return Napi::Number::New(env, vol);
}

// Pre-amp (-12dB to +12dB)
Napi::Value SetPreAmp(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    Napi::Object result = Napi::Object::New(env);
    
    if (!g_engine) {
        result.Set("success", Napi::Boolean::New(env, false));
        result.Set("error", Napi::String::New(env, "Engine not initialized"));
        return result;
    }
    
    if (info.Length() < 1 || !info[0].IsNumber()) {
        result.Set("success", Napi::Boolean::New(env, false));
        result.Set("error", Napi::String::New(env, "Preamp gain required (-12 to +12 dB)"));
        return result;
    }
    
    float gainDB = info[0].As<Napi::Number>().FloatValue();
    
    if (gainDB < -12.0f || gainDB > 12.0f) {
        result.Set("success", Napi::Boolean::New(env, false));
        result.Set("error", Napi::String::New(env, "Preamp must be between -12 and +12 dB"));
        return result;
    }
    
    g_engine->setPreamp(gainDB);
    
    result.Set("success", Napi::Boolean::New(env, true));
    result.Set("preamp", Napi::Number::New(env, g_engine->getPreamp()));
    return result;
}

Napi::Value GetPreAmp(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    float preamp = g_engine ? g_engine->getPreamp() : 0;
    return Napi::Number::New(env, preamp);
}

// EQ Band
Napi::Value SetEQBand(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    Napi::Object result = Napi::Object::New(env);
    
    if (!g_engine) {
        result.Set("success", Napi::Boolean::New(env, false));
        result.Set("error", Napi::String::New(env, "Engine not initialized"));
        return result;
    }
    
    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsNumber()) {
        result.Set("success", Napi::Boolean::New(env, false));
        result.Set("error", Napi::String::New(env, "Band index and gain required"));
        return result;
    }
    
    int band = info[0].As<Napi::Number>().Int32Value();
    float gainDB = info[1].As<Napi::Number>().FloatValue();
    
    if (band < 0 || band >= NUM_EQ_BANDS) {
        result.Set("success", Napi::Boolean::New(env, false));
        result.Set("error", Napi::String::New(env, "Band index must be 0-31"));
        return result;
    }
    
    if (gainDB < -15.0f || gainDB > 15.0f) {
        result.Set("success", Napi::Boolean::New(env, false));
        result.Set("error", Napi::String::New(env, "Gain must be between -15 and +15 dB"));
        return result;
    }
    
    g_engine->setEQBand(band, gainDB);
    
    result.Set("success", Napi::Boolean::New(env, true));
    result.Set("band", Napi::Number::New(env, band));
    result.Set("gain", Napi::Number::New(env, g_engine->getEQBand(band)));
    result.Set("frequency", Napi::Number::New(env, EQ_FREQUENCIES[band]));
    return result;
}

Napi::Value GetEQBand(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (!g_engine || info.Length() < 1 || !info[0].IsNumber()) {
        return Napi::Number::New(env, 0);
    }
    
    int band = info[0].As<Napi::Number>().Int32Value();
    return Napi::Number::New(env, g_engine->getEQBand(band));
}

// Set all EQ bands at once
Napi::Value SetEQBands(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    Napi::Object result = Napi::Object::New(env);
    
    if (!g_engine) {
        result.Set("success", Napi::Boolean::New(env, false));
        result.Set("error", Napi::String::New(env, "Engine not initialized"));
        return result;
    }
    
    if (info.Length() < 1 || !info[0].IsArray()) {
        result.Set("success", Napi::Boolean::New(env, false));
        result.Set("error", Napi::String::New(env, "Array of 32 gain values required"));
        return result;
    }
    
    Napi::Array arr = info[0].As<Napi::Array>();
    std::vector<float> gains(NUM_EQ_BANDS, 0.0f);
    
    int count = std::min((int)arr.Length(), NUM_EQ_BANDS);
    for (int i = 0; i < count; ++i) {
        Napi::Value val = arr.Get(i);
        if (val.IsNumber()) {
            gains[i] = val.As<Napi::Number>().FloatValue();
        }
    }
    
    g_engine->setEQBands(gains.data(), count);
    
    result.Set("success", Napi::Boolean::New(env, true));
    result.Set("bandsSet", Napi::Number::New(env, count));
    return result;
}

// Sıfırla EQ
Napi::Value ResetEQ(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine) g_engine->resetEQ();
    return Napi::Boolean::New(env, g_engine != nullptr);
}

// Bass Boost (0-100)
Napi::Value SetBassBoost(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    Napi::Object result = Napi::Object::New(env);
    
    if (!g_engine) {
        result.Set("success", Napi::Boolean::New(env, false));
        result.Set("error", Napi::String::New(env, "Engine not initialized"));
        return result;
    }
    
    if (info.Length() < 1 || !info[0].IsNumber()) {
        result.Set("success", Napi::Boolean::New(env, false));
        result.Set("error", Napi::String::New(env, "Bass boost intensity required (0-100)"));
        return result;
    }
    
    float intensity = info[0].As<Napi::Number>().FloatValue();
    
    if (intensity < 0.0f || intensity > 100.0f) {
        result.Set("success", Napi::Boolean::New(env, false));
        result.Set("error", Napi::String::New(env, "Bass boost must be between 0 and 100"));
        return result;
    }
    
    g_engine->setBassBoost(intensity);
    
    result.Set("success", Napi::Boolean::New(env, true));
    result.Set("bassBoost", Napi::Number::New(env, g_engine->getBassBoost()));
    return result;
}

Napi::Value GetBassBoost(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    float bb = g_engine ? g_engine->getBassBoost() : 0;
    return Napi::Number::New(env, bb);
}

// Auto-gain control
Napi::Value SetAutoGainEnabled(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine && info.Length() > 0 && info[0].IsBoolean()) {
        g_engine->setAutoGainEnabled(info[0].As<Napi::Boolean>().Value());
        return Napi::Boolean::New(env, true);
    }
    return Napi::Boolean::New(env, false);
}

Napi::Value SetAutoGainTarget(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine && info.Length() > 0 && info[0].IsNumber()) {
        g_engine->setAutoGainTarget(info[0].As<Napi::Number>().FloatValue());
        return Napi::Boolean::New(env, true);
    }
    return Napi::Boolean::New(env, false);
}

Napi::Value SetAutoGainMaxGain(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine && info.Length() > 0 && info[0].IsNumber()) {
        g_engine->setAutoGainMaxGain(info[0].As<Napi::Number>().FloatValue());
        return Napi::Boolean::New(env, true);
    }
    return Napi::Boolean::New(env, false);
}

Napi::Value SetAutoGainAttack(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine && info.Length() > 0 && info[0].IsNumber()) {
        g_engine->setAutoGainAttack(info[0].As<Napi::Number>().FloatValue());
        return Napi::Boolean::New(env, true);
    }
    return Napi::Boolean::New(env, false);
}

Napi::Value SetAutoGainRelease(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine && info.Length() > 0 && info[0].IsNumber()) {
        g_engine->setAutoGainRelease(info[0].As<Napi::Number>().FloatValue());
        return Napi::Boolean::New(env, true);
    }
    return Napi::Boolean::New(env, false);
}

Napi::Value SetAutoGainMode(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine && info.Length() > 0 && info[0].IsNumber()) {
        g_engine->setAutoGainMode(info[0].As<Napi::Number>().Int32Value());
        return Napi::Boolean::New(env, true);
    }
    return Napi::Boolean::New(env, false);
}

Napi::Value NormalizeAudio(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine && info.Length() > 0 && info[0].IsNumber()) {
        float gain = g_engine->normalizeAudio(info[0].As<Napi::Number>().FloatValue());
        return Napi::Number::New(env, gain);
    }
    return Napi::Number::New(env, 0.0f);
}

Napi::Value UpdateAutoGain(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine) {
        g_engine->updateAutoGain();
        return Napi::Boolean::New(env, true);
    }
    return Napi::Boolean::New(env, false);
}

Napi::Value ResetAutoGain(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine) {
        g_engine->resetAutoGain();
        return Napi::Boolean::New(env, true);
    }
    return Napi::Boolean::New(env, false);
}

Napi::Value GetAutoGainStats(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Object stats = Napi::Object::New(env);
    
    if (g_engine) {
        stats.Set("enabled", Napi::Boolean::New(env, g_autoGain.enabled));
        stats.Set("peakLevel", Napi::Number::New(env, g_autoGain.peakLevel));
        stats.Set("rmsLevel", Napi::Number::New(env, g_autoGain.rmsLevel));
        stats.Set("currentGain", Napi::Number::New(env, g_autoGain.currentGain));
        stats.Set("targetLevel", Napi::Number::New(env, g_autoGain.targetLevel));
        stats.Set("maxGain", Napi::Number::New(env, g_autoGain.maxGain));
        stats.Set("mode", Napi::Number::New(env, g_autoGain.mode));
    } else {
        stats.Set("enabled", Napi::Boolean::New(env, false));
        stats.Set("peakLevel", Napi::Number::New(env, -96.0f));
        stats.Set("rmsLevel", Napi::Number::New(env, -96.0f));
        stats.Set("currentGain", Napi::Number::New(env, 0.0f));
    }
    
    return stats;
}

Napi::Value GetPeakLevel(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    float peak = g_engine ? g_engine->getPeakLevel() : -96.0f;
    return Napi::Number::New(env, peak);
}

Napi::Value GetRmsLevel(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    float rms = g_engine ? g_engine->getRmsLevel() : -96.0f;
    return Napi::Number::New(env, rms);
}

Napi::Value GetAutoGainReduction(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    float reduction = g_engine ? g_engine->getAutoGainReduction() : 0.0f;
    return Napi::Number::New(env, reduction);
}

Napi::Value IsClipping(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    bool clipping = g_engine ? g_engine->isClipping() : false;
    return Napi::Boolean::New(env, clipping);
}

Napi::Value GetClippingCount(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    int count = g_engine ? g_engine->getClippingCount() : 0;
    return Napi::Number::New(env, count);
}

Napi::Value ResetClippingCount(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine) g_engine->resetClippingCount();
    return env.Undefined();
}

// Comprehensive AGC Status
Napi::Value GetAGCStatus(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Object result = Napi::Object::New(env);
    
    if (!g_engine) {
        result.Set("enabled", Napi::Boolean::New(env, false));
        result.Set("peakLevel", Napi::Number::New(env, 0));
        result.Set("rmsLevel", Napi::Number::New(env, 0));
        result.Set("gainReduction", Napi::Number::New(env, 1.0f));
        result.Set("makeupGain", Napi::Number::New(env, 1.0f));
        result.Set("isClipping", Napi::Boolean::New(env, false));
        result.Set("clippingCount", Napi::Number::New(env, 0));
        return result;
    }
    
    auto status = g_engine->getAGCStatus();
    result.Set("enabled", Napi::Boolean::New(env, status.enabled));
    result.Set("peakLevel", Napi::Number::New(env, status.peakLevel));
    result.Set("rmsLevel", Napi::Number::New(env, status.rmsLevel));
    result.Set("gainReduction", Napi::Number::New(env, status.gainReduction));
    result.Set("makeupGain", Napi::Number::New(env, status.makeupGain));
    result.Set("isClipping", Napi::Boolean::New(env, status.isClipping));
    result.Set("clippingCount", Napi::Number::New(env, status.clippingCount));
    
    // Add dB values for display
    result.Set("peakLevelDB", Napi::Number::New(env, linearTodB(status.peakLevel)));
    result.Set("rmsLevelDB", Napi::Number::New(env, linearTodB(status.rmsLevel)));
    result.Set("gainReductionDB", Napi::Number::New(env, linearTodB(status.gainReduction)));
    
    return result;
}

// Uygula emergency gain reduction from JS
Napi::Value ApplyEmergencyReduction(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine) {
        g_engine->applyEmergencyReduction();
        return Napi::Boolean::New(env, true);
    }
    return Napi::Boolean::New(env, false);
}

// Get preamp increase suggestion
Napi::Value GetPreampSuggestion(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    float suggestion = g_engine ? g_engine->suggestPreampIncrease() : 0;
    return Napi::Number::New(env, suggestion);
}

// Set AGC parameters
Napi::Value SetAGCParameters(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (!g_engine || info.Length() < 1 || !info[0].IsObject()) {
        return Napi::Boolean::New(env, false);
    }
    
    Napi::Object params = info[0].As<Napi::Object>();
    
    if (params.Has("attackMs") && params.Get("attackMs").IsNumber()) {
        g_engine->setAGCAttack(params.Get("attackMs").As<Napi::Number>().FloatValue());
    }
    
    if (params.Has("releaseMs") && params.Get("releaseMs").IsNumber()) {
        g_engine->setAGCRelease(params.Get("releaseMs").As<Napi::Number>().FloatValue());
    }
    
    if (params.Has("threshold") && params.Get("threshold").IsNumber()) {
        g_engine->setLimiterThreshold(params.Get("threshold").As<Napi::Number>().FloatValue());
    }
    
    return Napi::Boolean::New(env, true);
}

// ============================================
// TRUE PEAK LIMITER N-API FUNCTIONS
// ============================================

Napi::Value SetTruePeakEnabled(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine && info.Length() > 0 && info[0].IsBoolean()) {
        g_engine->setTruePeakEnabled(info[0].As<Napi::Boolean>().Value());
        return Napi::Boolean::New(env, true);
    }
    return Napi::Boolean::New(env, false);
}

Napi::Value SetTruePeakCeiling(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine && info.Length() > 0 && info[0].IsNumber()) {
        g_engine->setTruePeakCeiling(info[0].As<Napi::Number>().FloatValue());
        return Napi::Boolean::New(env, true);
    }
    return Napi::Boolean::New(env, false);
}

Napi::Value SetTruePeakRelease(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine && info.Length() > 0 && info[0].IsNumber()) {
        g_engine->setTruePeakRelease(info[0].As<Napi::Number>().FloatValue());
        return Napi::Boolean::New(env, true);
    }
    return Napi::Boolean::New(env, false);
}

Napi::Value SetTruePeakLookahead(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine && info.Length() > 0 && info[0].IsNumber()) {
        g_engine->setTruePeakLookahead(info[0].As<Napi::Number>().FloatValue());
        return Napi::Boolean::New(env, true);
    }
    return Napi::Boolean::New(env, false);
}

Napi::Value SetTruePeakInputGain(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine && info.Length() > 0 && info[0].IsNumber()) {
        g_engine->setTruePeakInputGain(info[0].As<Napi::Number>().FloatValue());
        return Napi::Boolean::New(env, true);
    }
    return Napi::Boolean::New(env, false);
}

Napi::Value SetTruePeakOversampling(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine && info.Length() > 0 && info[0].IsNumber()) {
        g_engine->setTruePeakOversampling(info[0].As<Napi::Number>().Int32Value());
        return Napi::Boolean::New(env, true);
    }
    return Napi::Boolean::New(env, false);
}

Napi::Value SetTruePeakLinkChannels(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine && info.Length() > 0 && info[0].IsBoolean()) {
        g_engine->setTruePeakLinkChannels(info[0].As<Napi::Boolean>().Value());
        return Napi::Boolean::New(env, true);
    }
    return Napi::Boolean::New(env, false);
}

Napi::Value GetTruePeakMeter(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Object result = Napi::Object::New(env);
    
    if (g_engine) {
        auto meter = g_engine->getTruePeakMeterData();
        result.Set("peakL", Napi::Number::New(env, meter.peakL));
        result.Set("peakR", Napi::Number::New(env, meter.peakR));
        result.Set("truePeakL", Napi::Number::New(env, meter.truePeakL));
        result.Set("truePeakR", Napi::Number::New(env, meter.truePeakR));
        result.Set("holdL", Napi::Number::New(env, meter.holdL));
        result.Set("holdR", Napi::Number::New(env, meter.holdR));
        result.Set("gainReduction", Napi::Number::New(env, meter.gainReduction));
        result.Set("clippingCount", Napi::Number::New(env, meter.clippingCount));
    } else {
        result.Set("peakL", Napi::Number::New(env, -96.0f));
        result.Set("peakR", Napi::Number::New(env, -96.0f));
        result.Set("truePeakL", Napi::Number::New(env, -96.0f));
        result.Set("truePeakR", Napi::Number::New(env, -96.0f));
        result.Set("holdL", Napi::Number::New(env, -96.0f));
        result.Set("holdR", Napi::Number::New(env, -96.0f));
        result.Set("gainReduction", Napi::Number::New(env, 0.0f));
        result.Set("clippingCount", Napi::Number::New(env, 0));
    }
    
    return result;
}

Napi::Value ResetTruePeakClipping(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine) {
        g_engine->resetTruePeakClipping();
        return Napi::Boolean::New(env, true);
    }
    return Napi::Boolean::New(env, false);
}

Napi::Value ResetTruePeakLimiter(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine) {
        g_engine->resetTruePeakLimiter();
        return Napi::Boolean::New(env, true);
    }
    return Napi::Boolean::New(env, false);
}

Napi::Value IsTruePeakEnabled(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    bool enabled = g_engine ? g_engine->isTruePeakEnabled() : false;
    return Napi::Boolean::New(env, enabled);
}

// FFT / Spectrum
Napi::Value GetFFTData(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (!g_engine) {
        return Napi::Array::New(env, 0);
    }
    
    auto data = g_engine->getFFTData();
    Napi::Array result = Napi::Array::New(env, data.size());
    for (size_t i = 0; i < data.size(); ++i) {
        result.Set(i, Napi::Number::New(env, data[i]));
    }
    return result;
}

// PCM (Float32Array)
Napi::Value GetPCMData(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    int frames = 1024;
    if (info.Length() > 0 && info[0].IsNumber()) {
        frames = info[0].As<Napi::Number>().Int32Value();
    }
    if (frames < 64) frames = 64;
    if (frames > 8192) frames = 8192;

    Napi::Object result = Napi::Object::New(env);

    if (!g_engine) {
        result.Set("channels", Napi::Number::New(env, 0));
        result.Set("data", Napi::Float32Array::New(env, 0));
        return result;
    }

    int channels = 0;
    auto pcm = g_engine->getPCMData(frames, &channels);
    if (pcm.empty() || channels <= 0) {
        result.Set("channels", Napi::Number::New(env, 0));
        result.Set("data", Napi::Float32Array::New(env, 0));
        return result;
    }

    const size_t byteLen = pcm.size() * sizeof(float);
    Napi::ArrayBuffer buffer = Napi::ArrayBuffer::New(env, byteLen);
    std::memcpy(buffer.Data(), pcm.data(), byteLen);
    Napi::Float32Array arr = Napi::Float32Array::New(env, pcm.size(), buffer, 0);

    result.Set("channels", Napi::Number::New(env, channels));
    result.Set("data", arr);
    return result;
}

Napi::Value GetSpectrumBands(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    int numBands = 64;
    if (info.Length() > 0 && info[0].IsNumber()) {
        numBands = info[0].As<Napi::Number>().Int32Value();
    }
    
    if (!g_engine) {
        return Napi::Array::New(env, 0);
    }
    
    auto bands = g_engine->getSpectrumBands(numBands);
    Napi::Array result = Napi::Array::New(env, bands.size());
    for (size_t i = 0; i < bands.size(); ++i) {
        result.Set(i, Napi::Number::New(env, bands[i]));
    }
    return result;
}

// Channel levels (for VU meter)
Napi::Value GetChannelLevels(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    Napi::Object result = Napi::Object::New(env);
    
    if (!g_engine) {
        result.Set("left", Napi::Number::New(env, 0));
        result.Set("right", Napi::Number::New(env, 0));
        return result;
    }
    
    auto levels = g_engine->getChannelLevels();
    result.Set("left", Napi::Number::New(env, levels.first));
    result.Set("right", Napi::Number::New(env, levels.second));
    return result;
}

// ============================================
// DSP ENABLE/DISABLE NAPI WRAPPERS
// ============================================
Napi::Value SetDSPEnabled(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine && info.Length() > 0 && info[0].IsBoolean()) {
        bool enabled = info[0].As<Napi::Boolean>().Value();
        g_engine->setDSPEnabled(enabled);
    }
    return env.Undefined();
}

Napi::Value IsDSPEnabled(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    bool enabled = g_engine ? g_engine->isDSPEnabled() : true;
    return Napi::Boolean::New(env, enabled);
}

// ============================================
// BALANCE CONTROL NAPI WRAPPERS
// ============================================
Napi::Value SetBalance(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine && info.Length() > 0 && info[0].IsNumber()) {
        float value = info[0].As<Napi::Number>().FloatValue();
        g_engine->setBalance(value);
    }
    return env.Undefined();
}

Napi::Value GetBalance(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    float balance = g_engine ? g_engine->getBalance() : 0;
    return Napi::Number::New(env, balance);
}

// ============================================
// AURIVO MODULE NAPI WRAPPERS (Bass, Mid, Treble, Stereo)
// ============================================
Napi::Value SetBass(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine && info.Length() > 0 && info[0].IsNumber()) {
        float dB = info[0].As<Napi::Number>().FloatValue();
        g_engine->setBass(dB);
    }
    return env.Undefined();
}

Napi::Value GetBass(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    return Napi::Number::New(env, g_engine ? g_engine->getBass() : 0);
}

Napi::Value SetMid(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine && info.Length() > 0 && info[0].IsNumber()) {
        float dB = info[0].As<Napi::Number>().FloatValue();
        g_engine->setMid(dB);
    }
    return env.Undefined();
}

Napi::Value GetMid(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    return Napi::Number::New(env, g_engine ? g_engine->getMid() : 0);
}

Napi::Value SetTreble(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine && info.Length() > 0 && info[0].IsNumber()) {
        float dB = info[0].As<Napi::Number>().FloatValue();
        g_engine->setTreble(dB);
    }
    return env.Undefined();
}

Napi::Value GetTreble(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    return Napi::Number::New(env, g_engine ? g_engine->getTreble() : 0);
}

Napi::Value SetStereoExpander(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine && info.Length() > 0 && info[0].IsNumber()) {
        float percent = info[0].As<Napi::Number>().FloatValue();
        g_engine->setStereoExpander(percent);
    }
    return env.Undefined();
}

Napi::Value GetStereoExpander(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    return Napi::Number::New(env, g_engine ? g_engine->getStereoExpander() : 100);
}

// ============================================
// REVERB NAPI WRAPPERS
// ============================================
Napi::Value SetReverbEnabled(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine && info.Length() > 0 && info[0].IsBoolean()) {
        bool enabled = info[0].As<Napi::Boolean>().Value();
        g_engine->setReverbEnabled(enabled);
    }
    return env.Undefined();
}

Napi::Value GetReverbEnabled(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    return Napi::Boolean::New(env, g_engine ? g_engine->getReverbEnabled() : false);
}

Napi::Value SetReverbRoomSize(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine && info.Length() > 0 && info[0].IsNumber()) {
        float ms = info[0].As<Napi::Number>().FloatValue();
        g_engine->setReverbRoomSize(ms);
    }
    return env.Undefined();
}

Napi::Value SetReverbDamping(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine && info.Length() > 0 && info[0].IsNumber()) {
        float value = info[0].As<Napi::Number>().FloatValue();
        g_engine->setReverbDamping(value);
    }
    return env.Undefined();
}

Napi::Value SetReverbWetDry(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine && info.Length() > 0 && info[0].IsNumber()) {
        float dB = info[0].As<Napi::Number>().FloatValue();
        g_engine->setReverbWetDry(dB);
    }
    return env.Undefined();
}

Napi::Value SetReverbHFRatio(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine && info.Length() > 0 && info[0].IsNumber()) {
        float ratio = info[0].As<Napi::Number>().FloatValue();
        g_engine->setReverbHFRatio(ratio);
    }
    return env.Undefined();
}

Napi::Value SetReverbInputGain(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine && info.Length() > 0 && info[0].IsNumber()) {
        float dB = info[0].As<Napi::Number>().FloatValue();
        g_engine->setReverbInputGain(dB);
    }
    return env.Undefined();
}

// ============================================
// KOMPRESÖR (BASS_FX) - NAPI
// ============================================
Napi::Value EnableCompressor(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    bool enabled = false;
    if (info.Length() > 0 && info[0].IsBoolean()) {
        enabled = info[0].As<Napi::Boolean>().Value();
    }
    bool ok = g_engine ? g_engine->enableCompressor(enabled) : false;
    return Napi::Boolean::New(env, ok);
}

Napi::Value SetCompressorThreshold(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine && info.Length() > 0 && info[0].IsNumber()) {
        g_engine->setCompressorThreshold(info[0].As<Napi::Number>().FloatValue());
        return Napi::Boolean::New(env, true);
    }
    return Napi::Boolean::New(env, false);
}

Napi::Value SetCompressorRatio(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine && info.Length() > 0 && info[0].IsNumber()) {
        g_engine->setCompressorRatio(info[0].As<Napi::Number>().FloatValue());
        return Napi::Boolean::New(env, true);
    }
    return Napi::Boolean::New(env, false);
}

Napi::Value SetCompressorAttack(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine && info.Length() > 0 && info[0].IsNumber()) {
        g_engine->setCompressorAttack(info[0].As<Napi::Number>().FloatValue());
        return Napi::Boolean::New(env, true);
    }
    return Napi::Boolean::New(env, false);
}

Napi::Value SetCompressorRelease(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine && info.Length() > 0 && info[0].IsNumber()) {
        g_engine->setCompressorRelease(info[0].As<Napi::Number>().FloatValue());
        return Napi::Boolean::New(env, true);
    }
    return Napi::Boolean::New(env, false);
}

Napi::Value SetCompressorMakeupGain(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine && info.Length() > 0 && info[0].IsNumber()) {
        g_engine->setCompressorMakeupGain(info[0].As<Napi::Number>().FloatValue());
        return Napi::Boolean::New(env, true);
    }
    return Napi::Boolean::New(env, false);
}

Napi::Value SetCompressorKnee(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine && info.Length() > 0 && info[0].IsNumber()) {
        g_engine->setCompressorKnee(info[0].As<Napi::Number>().FloatValue());
        return Napi::Boolean::New(env, true);
    }
    return Napi::Boolean::New(env, false);
}

Napi::Value GetGainReduction(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    float reduction = g_engine ? g_engine->getCompressorGainReduction() : 0.0f;
    return Napi::Number::New(env, reduction);
}

Napi::Value ResetCompressor(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine) {
        g_engine->resetCompressor();
        return Napi::Boolean::New(env, true);
    }
    return Napi::Boolean::New(env, false);
}

// Get EQ frequency for band (read-only info)
Napi::Value GetEQFrequencies(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    Napi::Array result = Napi::Array::New(env, NUM_EQ_BANDS);
    for (int i = 0; i < NUM_EQ_BANDS; ++i) {
        result.Set(i, Napi::Number::New(env, EQ_FREQUENCIES[i]));
    }
    return result;
}

// Legacy compatibility wrappers
Napi::Value Initialize(const Napi::CallbackInfo& info) {
    return InitAudio(info);
}

Napi::Value SetVolume(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine && info.Length() > 0 && info[0].IsNumber()) {
        float vol = info[0].As<Napi::Number>().FloatValue();
        // Legacy: 0-1 -> 0-100
        g_engine->setMasterVolume(vol * 100.0f);
    }
    return env.Undefined();
}

Napi::Value GetVolume(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    float vol = g_engine ? g_engine->getMasterVolume() / 100.0f : 0;
    return Napi::Number::New(env, vol);
}

Napi::Value GetPosition(const Napi::CallbackInfo& info) {
    return GetCurrentPosition(info);
}

Napi::Value SetPreamp(const Napi::CallbackInfo& info) {
    return SetPreAmp(info);
}

// New DSP Effect Wrappers
Napi::Value SetCompressor(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine && info.Length() >= 6) {
        bool enabled = info[0].As<Napi::Boolean>().Value();
        float thresh = info[1].As<Napi::Number>().FloatValue();
        float ratio = info[2].As<Napi::Number>().FloatValue();
        float att = info[3].As<Napi::Number>().FloatValue();
        float rel = info[4].As<Napi::Number>().FloatValue();
        float makeup = info[5].As<Napi::Number>().FloatValue();
        g_engine->setCompressorForEngine(enabled, thresh, ratio, att, rel, makeup);
    }
    return env.Undefined();
}

Napi::Value SetGate(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine && info.Length() >= 4) {
        bool enabled = info[0].As<Napi::Boolean>().Value();
        float thresh = info[1].As<Napi::Number>().FloatValue();
        float att = info[2].As<Napi::Number>().FloatValue();
        float rel = info[3].As<Napi::Number>().FloatValue();
        g_engine->setGateForEngine(enabled, thresh, att, rel);
    }
    return env.Undefined();
}

Napi::Value SetLimiter(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine && info.Length() >= 3) {
        bool enabled = info[0].As<Napi::Boolean>().Value();
        float ceiling = info[1].As<Napi::Number>().FloatValue();
        float rel = info[2].As<Napi::Number>().FloatValue();
        g_engine->setLimiterForEngine(enabled, ceiling, rel);
    }
    return env.Undefined();
}

// New Limiter functions
Napi::Value EnableLimiter(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    bool ok = false;
    if (g_engine && info.Length() >= 1) {
        bool enabled = info[0].As<Napi::Boolean>().Value();
        ok = g_engine->enableLimiter(enabled);
    }
    return Napi::Boolean::New(env, ok);
}

Napi::Value SetLimiterCeiling(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine && info.Length() >= 1) {
        float ceiling = info[0].As<Napi::Number>().FloatValue();
        g_engine->setLimiterCeiling(ceiling);
    }
    return env.Undefined();
}

Napi::Value SetLimiterRelease(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine && info.Length() >= 1) {
        float release = info[0].As<Napi::Number>().FloatValue();
        g_engine->setLimiterRelease(release);
    }
    return env.Undefined();
}

Napi::Value SetLimiterLookahead(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine && info.Length() >= 1) {
        float lookahead = info[0].As<Napi::Number>().FloatValue();
        g_engine->setLimiterLookahead(lookahead);
    }
    return env.Undefined();
}

Napi::Value SetLimiterGain(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine && info.Length() >= 1) {
        float gain = info[0].As<Napi::Number>().FloatValue();
        g_engine->setLimiterGain(gain);
    }
    return env.Undefined();
}

Napi::Value GetLimiterReduction(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    float reduction = g_engine ? g_engine->getLimiterReduction() : 0.0f;
    return Napi::Number::New(env, reduction);
}

Napi::Value ResetLimiter(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine) {
        g_engine->resetLimiter();
    }
    return Napi::Boolean::New(env, true);
}

Napi::Value SetEcho(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine && info.Length() >= 4) {
        bool enabled = info[0].As<Napi::Boolean>().Value();
        float delay = info[1].As<Napi::Number>().FloatValue();
        float feedback = info[2].As<Napi::Number>().FloatValue();
        float mix = info[3].As<Napi::Number>().FloatValue();
        g_engine->setEchoForEngine(enabled, delay, feedback, mix);
    }
    return env.Undefined();
}

Napi::Value SetBassBoostDsp(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine && info.Length() >= 3) {
        bool enabled = info[0].As<Napi::Boolean>().Value();
        float gain = info[1].As<Napi::Number>().FloatValue();
        float freq = info[2].As<Napi::Number>().FloatValue();
        g_engine->setBassBoostDsp(enabled, gain, freq);
    }
    return env.Undefined();
}

Napi::Value SetPEQ(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine && info.Length() >= 5) {
        int band = info[0].As<Napi::Number>().Int32Value();
        bool enabled = info[1].As<Napi::Boolean>().Value();
        float freq = info[2].As<Napi::Number>().FloatValue();
        float gain = info[3].As<Napi::Number>().FloatValue();
        float Q = info[4].As<Napi::Number>().FloatValue();
        g_engine->setPEQ(band, enabled, freq, gain, Q);
    }
    return env.Undefined();
}

Napi::Value SetPEQFilterType(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine && info.Length() >= 2) {
        int band = info[0].As<Napi::Number>().Int32Value();
        int filterType = info[1].As<Napi::Number>().Int32Value();
        
        bool result = g_engine->setPEQFilterType(band, filterType);
        return Napi::Boolean::New(env, result);
    }
    return Napi::Boolean::New(env, false);
}

Napi::Value GetPEQBand(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Object result = Napi::Object::New(env);
    
    if (g_engine && info.Length() >= 1) {
        int band = info[0].As<Napi::Number>().Int32Value();
        
        float freq, gain, Q;
        int filterType;
        
        if (g_engine->getPEQBand(band, &freq, &gain, &Q, &filterType)) {
            result.Set("band", Napi::Number::New(env, band));
            result.Set("frequency", Napi::Number::New(env, freq));
            result.Set("gain", Napi::Number::New(env, gain));
            result.Set("Q", Napi::Number::New(env, Q));
            result.Set("filterType", Napi::Number::New(env, filterType));
        }
    }
    
    return result;
}

// ============================================
// BASS ENHANCER N-API FUNCTIONS
// ============================================
Napi::Value EnableBassEnhancer(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    bool ok = false;
    if (g_engine && info.Length() >= 1) {
        bool enabled = info[0].As<Napi::Boolean>().Value();
        ok = g_engine->enableBassEnhancer(enabled);
    }
    return Napi::Boolean::New(env, ok);
}

Napi::Value SetBassEnhancerFrequency(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine && info.Length() >= 1) {
        float frequency = info[0].As<Napi::Number>().FloatValue();
        g_engine->setBassEnhancerFrequency(frequency);
    }
    return env.Undefined();
}

Napi::Value SetBassEnhancerGain(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine && info.Length() >= 1) {
        float gain = info[0].As<Napi::Number>().FloatValue();
        g_engine->setBassEnhancerGain(gain);
    }
    return env.Undefined();
}

Napi::Value SetBassEnhancerHarmonics(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine && info.Length() >= 1) {
        float harmonics = info[0].As<Napi::Number>().FloatValue();
        g_engine->setBassEnhancerHarmonics(harmonics);
    }
    return env.Undefined();
}

Napi::Value SetBassEnhancerWidth(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine && info.Length() >= 1) {
        float width = info[0].As<Napi::Number>().FloatValue();
        g_engine->setBassEnhancerWidth(width);
    }
    return env.Undefined();
}

Napi::Value SetBassEnhancerMix(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine && info.Length() >= 1) {
        float mix = info[0].As<Napi::Number>().FloatValue();
        g_engine->setBassEnhancerMix(mix);
    }
    return env.Undefined();
}

Napi::Value ResetBassEnhancer(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine) {
        g_engine->resetBassEnhancer();
    }
    return Napi::Boolean::New(env, true);
}

// ============================================
// NOISE GATE N-API FUNCTIONS
// ============================================
Napi::Value EnableNoiseGate(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    bool ok = false;
    if (g_engine && info.Length() >= 1) {
        bool enabled = info[0].As<Napi::Boolean>().Value();
        ok = g_engine->enableNoiseGate(enabled);
    }
    return Napi::Boolean::New(env, ok);
}

Napi::Value SetNoiseGateThreshold(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine && info.Length() >= 1) {
        float threshold = info[0].As<Napi::Number>().FloatValue();
        g_engine->setNoiseGateThreshold(threshold);
    }
    return env.Undefined();
}

Napi::Value SetNoiseGateAttack(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine && info.Length() >= 1) {
        float attack = info[0].As<Napi::Number>().FloatValue();
        g_engine->setNoiseGateAttack(attack);
    }
    return env.Undefined();
}

Napi::Value SetNoiseGateHold(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine && info.Length() >= 1) {
        float hold = info[0].As<Napi::Number>().FloatValue();
        g_engine->setNoiseGateHold(hold);
    }
    return env.Undefined();
}

Napi::Value SetNoiseGateRelease(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine && info.Length() >= 1) {
        float release = info[0].As<Napi::Number>().FloatValue();
        g_engine->setNoiseGateRelease(release);
    }
    return env.Undefined();
}

Napi::Value SetNoiseGateRange(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine && info.Length() >= 1) {
        float range = info[0].As<Napi::Number>().FloatValue();
        g_engine->setNoiseGateRange(range);
    }
    return env.Undefined();
}

Napi::Value GetNoiseGateStatus(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    bool isOpen = g_engine ? g_engine->getNoiseGateStatus() : false;
    return Napi::Boolean::New(env, isOpen);
}

Napi::Value ResetNoiseGate(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine) {
        g_engine->resetNoiseGate();
    }
    return Napi::Boolean::New(env, true);
}

// ============== DE-ESSER N-API WRAPPERS ==============
Napi::Value EnableDeEsser(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsBoolean()) {
        Napi::TypeError::New(env, "Boolean expected").ThrowAsJavaScriptException();
        return env.Null();
    }
    bool enable = info[0].As<Napi::Boolean>().Value();
    if (g_engine) {
        g_engine->enableDeEsser(enable);
    }
    return Napi::Boolean::New(env, true);
}

Napi::Value SetDeEsserFrequency(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Number expected").ThrowAsJavaScriptException();
        return env.Null();
    }
    float frequency = info[0].As<Napi::Number>().FloatValue();
    if (g_engine) {
        g_engine->setDeEsserFrequency(frequency);
    }
    return Napi::Boolean::New(env, true);
}

Napi::Value SetDeEsserThreshold(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Number expected").ThrowAsJavaScriptException();
        return env.Null();
    }
    float threshold = info[0].As<Napi::Number>().FloatValue();
    if (g_engine) {
        g_engine->setDeEsserThreshold(threshold);
    }
    return Napi::Boolean::New(env, true);
}

Napi::Value SetDeEsserRatio(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Number expected").ThrowAsJavaScriptException();
        return env.Null();
    }
    float ratio = info[0].As<Napi::Number>().FloatValue();
    if (g_engine) {
        g_engine->setDeEsserRatio(ratio);
    }
    return Napi::Boolean::New(env, true);
}

Napi::Value SetDeEsserRange(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Number expected").ThrowAsJavaScriptException();
        return env.Null();
    }
    float range = info[0].As<Napi::Number>().FloatValue();
    if (g_engine) {
        g_engine->setDeEsserRange(range);
    }
    return Napi::Boolean::New(env, true);
}

Napi::Value SetDeEsserListenMode(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsBoolean()) {
        Napi::TypeError::New(env, "Boolean expected").ThrowAsJavaScriptException();
        return env.Null();
    }
    bool listen = info[0].As<Napi::Boolean>().Value();
    if (g_engine) {
        g_engine->setDeEsserListenMode(listen);
    }
    return Napi::Boolean::New(env, true);
}

Napi::Value GetDeEsserActivity(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    float activity = g_engine ? g_engine->getDeEsserActivity() : 0.0f;
    return Napi::Number::New(env, activity);
}

Napi::Value ResetDeEsser(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine) {
        g_engine->resetDeEsser();
    }
    return Napi::Boolean::New(env, true);
}

// ============== EXCITER N-API WRAPPERS ==============
Napi::Value EnableExciter(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsBoolean()) {
        Napi::TypeError::New(env, "Boolean expected").ThrowAsJavaScriptException();
        return env.Null();
    }
    bool enable = info[0].As<Napi::Boolean>().Value();
    if (g_engine) {
        g_engine->enableExciter(enable);
    }
    return Napi::Boolean::New(env, true);
}

Napi::Value SetExciterAmount(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Number expected").ThrowAsJavaScriptException();
        return env.Null();
    }
    float amount = info[0].As<Napi::Number>().FloatValue();
    if (g_engine) {
        g_engine->setExciterAmount(amount);
    }
    return Napi::Boolean::New(env, true);
}

Napi::Value SetExciterFrequency(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Number expected").ThrowAsJavaScriptException();
        return env.Null();
    }
    float frequency = info[0].As<Napi::Number>().FloatValue();
    if (g_engine) {
        g_engine->setExciterFrequency(frequency);
    }
    return Napi::Boolean::New(env, true);
}

Napi::Value SetExciterHarmonics(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Number expected").ThrowAsJavaScriptException();
        return env.Null();
    }
    float harmonics = info[0].As<Napi::Number>().FloatValue();
    if (g_engine) {
        g_engine->setExciterHarmonics(harmonics);
    }
    return Napi::Boolean::New(env, true);
}

Napi::Value SetExciterMix(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Number expected").ThrowAsJavaScriptException();
        return env.Null();
    }
    float mix = info[0].As<Napi::Number>().FloatValue();
    if (g_engine) {
        g_engine->setExciterMix(mix);
    }
    return Napi::Boolean::New(env, true);
}

Napi::Value SetExciterType(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Number expected").ThrowAsJavaScriptException();
        return env.Null();
    }
    int type = info[0].As<Napi::Number>().Int32Value();
    if (g_engine) {
        g_engine->setExciterType(type);
    }
    return Napi::Boolean::New(env, true);
}

Napi::Value ResetExciter(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine) {
        g_engine->resetExciter();
    }
    return Napi::Boolean::New(env, true);
}

// ============================================
// STEREO WIDENER N-API WRAPPERS
// ============================================

Napi::Value EnableStereoWidener(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsBoolean()) {
        Napi::TypeError::New(env, "Boolean expected").ThrowAsJavaScriptException();
        return env.Null();
    }
    bool enabled = info[0].As<Napi::Boolean>().Value();
    if (g_engine) {
        g_engine->enableStereoWidener(enabled);
    }
    return Napi::Boolean::New(env, true);
}

Napi::Value SetStereoWidth(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Number expected").ThrowAsJavaScriptException();
        return env.Null();
    }
    float width = info[0].As<Napi::Number>().FloatValue();
    if (g_engine) {
        g_engine->setStereoWidth(width);
    }
    return Napi::Boolean::New(env, true);
}

Napi::Value SetStereoBassCutoff(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Number expected").ThrowAsJavaScriptException();
        return env.Null();
    }
    float frequency = info[0].As<Napi::Number>().FloatValue();
    if (g_engine) {
        g_engine->setStereoBassCutoff(frequency);
    }
    return Napi::Boolean::New(env, true);
}

Napi::Value SetStereoDelay(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Number expected").ThrowAsJavaScriptException();
        return env.Null();
    }
    float delay = info[0].As<Napi::Number>().FloatValue();
    if (g_engine) {
        g_engine->setStereoDelay(delay);
    }
    return Napi::Boolean::New(env, true);
}

Napi::Value SetStereoBalance(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Number expected").ThrowAsJavaScriptException();
        return env.Null();
    }
    float balance = info[0].As<Napi::Number>().FloatValue();
    if (g_engine) {
        g_engine->setStereoBalance(balance);
    }
    return Napi::Boolean::New(env, true);
}

Napi::Value SetStereoMonoLow(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsBoolean()) {
        Napi::TypeError::New(env, "Boolean expected").ThrowAsJavaScriptException();
        return env.Null();
    }
    bool monoLow = info[0].As<Napi::Boolean>().Value();
    if (g_engine) {
        g_engine->setStereoMonoLow(monoLow);
    }
    return Napi::Boolean::New(env, true);
}

Napi::Value GetStereoPhase(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    float phase = 0.0f;
    if (g_engine) {
        phase = g_engine->getStereoPhase();
    }
    return Napi::Number::New(env, phase);
}

Napi::Value ResetStereoWidener(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine) {
        g_engine->resetStereoWidener();
    }
    return Napi::Boolean::New(env, true);
}

// ============================================
// ECHO N-API WRAPPERS
// ============================================

Napi::Value EnableEchoEffect(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsBoolean()) {
        Napi::TypeError::New(env, "Boolean expected").ThrowAsJavaScriptException();
        return env.Null();
    }
    bool enabled = info[0].As<Napi::Boolean>().Value();
    if (g_engine) {
        g_engine->enableEcho(enabled);
    }
    return Napi::Boolean::New(env, true);
}

Napi::Value SetEchoDelayTime(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Number expected").ThrowAsJavaScriptException();
        return env.Null();
    }
    float delay = info[0].As<Napi::Number>().FloatValue();
    if (g_engine) {
        g_engine->setEchoDelay(delay);
    }
    return Napi::Boolean::New(env, true);
}

Napi::Value SetEchoFeedback(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Number expected").ThrowAsJavaScriptException();
        return env.Null();
    }
    float feedback = info[0].As<Napi::Number>().FloatValue();
    if (g_engine) {
        g_engine->setEchoFeedback(feedback);
    }
    return Napi::Boolean::New(env, true);
}

Napi::Value SetEchoWetMix(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Number expected").ThrowAsJavaScriptException();
        return env.Null();
    }
    float wetMix = info[0].As<Napi::Number>().FloatValue();
    if (g_engine) {
        g_engine->setEchoWetMix(wetMix);
    }
    return Napi::Boolean::New(env, true);
}

Napi::Value SetEchoDryMix(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Number expected").ThrowAsJavaScriptException();
        return env.Null();
    }
    float dryMix = info[0].As<Napi::Number>().FloatValue();
    if (g_engine) {
        g_engine->setEchoDryMix(dryMix);
    }
    return Napi::Boolean::New(env, true);
}

Napi::Value SetEchoStereoMode(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsBoolean()) {
        Napi::TypeError::New(env, "Boolean expected").ThrowAsJavaScriptException();
        return env.Null();
    }
    bool stereo = info[0].As<Napi::Boolean>().Value();
    if (g_engine) {
        g_engine->setEchoStereoMode(stereo);
    }
    return Napi::Boolean::New(env, true);
}

Napi::Value SetEchoLowCut(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Number expected").ThrowAsJavaScriptException();
        return env.Null();
    }
    float lowCut = info[0].As<Napi::Number>().FloatValue();
    if (g_engine) {
        g_engine->setEchoLowCut(lowCut);
    }
    return Napi::Boolean::New(env, true);
}

Napi::Value SetEchoHighCut(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Number expected").ThrowAsJavaScriptException();
        return env.Null();
    }
    float highCut = info[0].As<Napi::Number>().FloatValue();
    if (g_engine) {
        g_engine->setEchoHighCut(highCut);
    }
    return Napi::Boolean::New(env, true);
}

Napi::Value SetEchoTempo(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsNumber()) {
        Napi::TypeError::New(env, "Two numbers expected (bpm, division)").ThrowAsJavaScriptException();
        return env.Null();
    }
    float bpm = info[0].As<Napi::Number>().FloatValue();
    int division = info[1].As<Napi::Number>().Int32Value();
    if (g_engine) {
        g_engine->setEchoTempo(bpm, division);
    }
    return Napi::Boolean::New(env, true);
}

Napi::Value ResetEchoEffect(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine) {
        g_engine->resetEcho();
    }
    return Napi::Boolean::New(env, true);
}

// ============================================
// SOFT ECHO N-API WRAPPERS
// ============================================
Napi::Value EnableSoftEchoEffect(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsBoolean()) {
        Napi::TypeError::New(env, "Boolean expected").ThrowAsJavaScriptException();
        return env.Null();
    }
    bool enabled = info[0].As<Napi::Boolean>().Value();
    if (g_engine) g_engine->enableSoftEcho(enabled);
    return Napi::Boolean::New(env, true);
}

Napi::Value SetSoftEchoDelayTime(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Number expected").ThrowAsJavaScriptException();
        return env.Null();
    }
    if (g_engine) g_engine->setSoftEchoDelay(info[0].As<Napi::Number>().FloatValue());
    return Napi::Boolean::New(env, true);
}

Napi::Value SetSoftEchoFeedback(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Number expected").ThrowAsJavaScriptException();
        return env.Null();
    }
    if (g_engine) g_engine->setSoftEchoFeedback(info[0].As<Napi::Number>().FloatValue());
    return Napi::Boolean::New(env, true);
}

Napi::Value SetSoftEchoWetMix(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Number expected").ThrowAsJavaScriptException();
        return env.Null();
    }
    if (g_engine) g_engine->setSoftEchoWetMix(info[0].As<Napi::Number>().FloatValue());
    return Napi::Boolean::New(env, true);
}

Napi::Value SetSoftEchoDryMix(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Number expected").ThrowAsJavaScriptException();
        return env.Null();
    }
    if (g_engine) g_engine->setSoftEchoDryMix(info[0].As<Napi::Number>().FloatValue());
    return Napi::Boolean::New(env, true);
}

Napi::Value SetSoftEchoStereoMode(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsBoolean()) {
        Napi::TypeError::New(env, "Boolean expected").ThrowAsJavaScriptException();
        return env.Null();
    }
    if (g_engine) g_engine->setSoftEchoStereoMode(info[0].As<Napi::Boolean>().Value());
    return Napi::Boolean::New(env, true);
}

Napi::Value SetSoftEchoHighCut(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Number expected").ThrowAsJavaScriptException();
        return env.Null();
    }
    if (g_engine) g_engine->setSoftEchoHighCut(info[0].As<Napi::Number>().FloatValue());
    return Napi::Boolean::New(env, true);
}

Napi::Value ResetSoftEchoEffect(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine) g_engine->resetSoftEcho();
    return Napi::Boolean::New(env, true);
}

// ============== CONVOLUTION REVERB N-API WRAPPERS ==============

Napi::Value EnableConvolutionReverb(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsBoolean()) {
        return Napi::Boolean::New(env, false);
    }
    bool enabled = info[0].As<Napi::Boolean>().Value();
    if (g_engine) {
        return Napi::Boolean::New(env, g_engine->enableConvolutionReverb(enabled));
    }
    return Napi::Boolean::New(env, false);
}

Napi::Value LoadIRFile(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsString()) {
        return Napi::Boolean::New(env, false);
    }
    std::string filepath = info[0].As<Napi::String>().Utf8Value();
    if (g_engine) {
        return Napi::Boolean::New(env, g_engine->loadIRFile(filepath.c_str()));
    }
    return Napi::Boolean::New(env, false);
}

Napi::Value SetConvReverbRoomSize(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) {
        return Napi::Boolean::New(env, false);
    }
    float roomSize = info[0].As<Napi::Number>().FloatValue();
    if (g_engine) {
        g_engine->setConvReverbRoomSize(roomSize);
    }
    return Napi::Boolean::New(env, true);
}

Napi::Value SetConvReverbDecay(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) {
        return Napi::Boolean::New(env, false);
    }
    float decay = info[0].As<Napi::Number>().FloatValue();
    if (g_engine) {
        g_engine->setConvReverbDecay(decay);
    }
    return Napi::Boolean::New(env, true);
}

Napi::Value SetConvReverbDamping(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) {
        return Napi::Boolean::New(env, false);
    }
    float damping = info[0].As<Napi::Number>().FloatValue();
    if (g_engine) {
        g_engine->setConvReverbDamping(damping);
    }
    return Napi::Boolean::New(env, true);
}

Napi::Value SetConvReverbWetMix(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) {
        return Napi::Boolean::New(env, false);
    }
    float wetMix = info[0].As<Napi::Number>().FloatValue();
    if (g_engine) {
        g_engine->setConvReverbWetMix(wetMix);
    }
    return Napi::Boolean::New(env, true);
}

Napi::Value SetConvReverbDryMix(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) {
        return Napi::Boolean::New(env, false);
    }
    float dryMix = info[0].As<Napi::Number>().FloatValue();
    if (g_engine) {
        g_engine->setConvReverbDryMix(dryMix);
    }
    return Napi::Boolean::New(env, true);
}

Napi::Value SetConvReverbPreDelay(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) {
        return Napi::Boolean::New(env, false);
    }
    float preDelay = info[0].As<Napi::Number>().FloatValue();
    if (g_engine) {
        g_engine->setConvReverbPreDelay(preDelay);
    }
    return Napi::Boolean::New(env, true);
}

Napi::Value SetConvReverbRoomType(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) {
        return Napi::Boolean::New(env, false);
    }
    int roomType = info[0].As<Napi::Number>().Int32Value();
    if (g_engine) {
        g_engine->setConvReverbRoomType(roomType);
    }
    return Napi::Boolean::New(env, true);
}

Napi::Value GetIRPresets(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Array presetArray = Napi::Array::New(env, 8);
    
    for (int i = 0; i < 8; i++) {
        Napi::Object presetObj = Napi::Object::New(env);
        presetObj.Set("name", Napi::String::New(env, IR_PRESETS[i].name));
        presetObj.Set("roomSize", Napi::Number::New(env, IR_PRESETS[i].roomSize));
        presetObj.Set("decay", Napi::Number::New(env, IR_PRESETS[i].decay));
        presetObj.Set("damping", Napi::Number::New(env, IR_PRESETS[i].damping));
        presetObj.Set("diffusion", Napi::Number::New(env, IR_PRESETS[i].diffusion));
        presetArray[i] = presetObj;
    }
    
    return presetArray;
}

Napi::Value ResetConvolutionReverb(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine) {
        g_engine->resetConvolutionReverb();
    }
    return Napi::Boolean::New(env, true);
}

// ============================================
// CROSSFEED FUNCTIONS (Headphone Enhancement)
// ============================================

// Crossfeed artık DSP callback'te işleniyor, FX kullanmıyoruz
// Bu fonksiyon sadece debug log için kalıyor
void ApplyCrossfeedParams() {
    printf("[CROSSFEED] Parametreler güncellendi:\n");
    printf("  Level: %.0f%%\n", g_crossfeed.crossfeedLevel);
    printf("  Delay: %.2f ms\n", g_crossfeed.delay);
    printf("  LowCut: %.0f Hz\n", g_crossfeed.lowCut);
    printf("  HighCut: %.0f Hz\n", g_crossfeed.highCut);
    printf("  Enabled: %s\n", g_crossfeed.enabled ? "true" : "false");
}

Napi::Value EnableCrossfeed(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 1 || !info[0].IsBoolean()) {
        return Napi::Boolean::New(env, false);
    }
    
    bool enable = info[0].As<Napi::Boolean>().Value();
    
    g_crossfeed.enabled = enable;
    
    if (g_engine && g_engine->getAurivoDSP()) {
        void* dsp = g_engine->getAurivoDSP();
        set_crossfeed_params(dsp, enable ? 1 : 0, 
                            g_crossfeed.crossfeedLevel, 
                            g_crossfeed.delay, 
                             g_crossfeed.lowCut, 
                            g_crossfeed.highCut);
        printf("[CROSSFEED] %s (integrated DSP)\n", enable ? "Etkinleştirildi" : "Devre dışı");
    }
    
    return Napi::Boolean::New(env, true);
}

Napi::Value SetCrossfeedLevel(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 1 || !info[0].IsNumber()) {
        return Napi::Boolean::New(env, false);
    }
    
    float level = info[0].As<Napi::Number>().FloatValue();
    g_crossfeed.crossfeedLevel = clampf(level, 0.0f, 100.0f);
    
    if (g_engine && g_engine->getAurivoDSP()) {
        void* dsp = g_engine->getAurivoDSP();
        set_crossfeed_params(dsp, g_crossfeed.enabled ? 1 : 0, 
                            g_crossfeed.crossfeedLevel, 
                            g_crossfeed.delay, 
                            g_crossfeed.lowCut, 
                            g_crossfeed.highCut);
    }
    
    printf("[CROSSFEED] Level: %.0f%%\n", g_crossfeed.crossfeedLevel);
    
    return Napi::Boolean::New(env, true);
}

Napi::Value SetCrossfeedDelay(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 1 || !info[0].IsNumber()) {
        return Napi::Boolean::New(env, false);
    }
    
    float delay = info[0].As<Napi::Number>().FloatValue();
    g_crossfeed.delay = clampf(delay, 0.1f, 1.5f);
    
    if (g_engine && g_engine->getAurivoDSP()) {
        void* dsp = g_engine->getAurivoDSP();
        set_crossfeed_params(dsp, g_crossfeed.enabled ? 1 : 0, 
                            g_crossfeed.crossfeedLevel, 
                            g_crossfeed.delay, 
                            g_crossfeed.lowCut, 
                            g_crossfeed.highCut);
    }
    
    printf("[CROSSFEED] Delay: %.2f ms\n", g_crossfeed.delay);
    
    return Napi::Boolean::New(env, true);
}

Napi::Value SetCrossfeedLowCut(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 1 || !info[0].IsNumber()) {
        return Napi::Boolean::New(env, false);
    }
    
    float lowCut = info[0].As<Napi::Number>().FloatValue();
    g_crossfeed.lowCut = clampf(lowCut, 200.0f, 2000.0f);
    
    if (g_engine && g_engine->getAurivoDSP()) {
        void* dsp = g_engine->getAurivoDSP();
        set_crossfeed_params(dsp, g_crossfeed.enabled ? 1 : 0, 
                            g_crossfeed.crossfeedLevel, 
                            g_crossfeed.delay, 
                            g_crossfeed.lowCut, 
                            g_crossfeed.highCut);
    }
    
    printf("[CROSSFEED] Low cut: %.0f Hz\n", g_crossfeed.lowCut);
    
    return Napi::Boolean::New(env, true);
}

Napi::Value SetCrossfeedHighCut(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 1 || !info[0].IsNumber()) {
        return Napi::Boolean::New(env, false);
    }
    
    float highCut = info[0].As<Napi::Number>().FloatValue();
    
    // Limit: 2 kHz ile 18 kHz
    g_crossfeed.highCut = clampf(highCut, 2000.0f, 18000.0f);
    
    if (g_engine && g_engine->getAurivoDSP()) {
        void* dsp = g_engine->getAurivoDSP();
        set_crossfeed_params(dsp, g_crossfeed.enabled ? 1 : 0, 
                            g_crossfeed.crossfeedLevel, 
                            g_crossfeed.delay, 
                            g_crossfeed.lowCut, 
                            g_crossfeed.highCut);
    }
    
    printf("[CROSSFEED] High cut: %.0f Hz\n", g_crossfeed.highCut);
    
    return Napi::Boolean::New(env, true);
}

Napi::Value SetCrossfeedPreset(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 1 || !info[0].IsNumber()) {
        return Napi::Boolean::New(env, false);
    }
    
    int preset = info[0].As<Napi::Number>().Int32Value();
    
    // Limit: 0-4 (5 preset)
    preset = std::max(0, std::min(preset, 4));
    g_crossfeed.preset = preset;
    
    // Preset'ten parametreleri yükle
    const CrossfeedPreset& p = CROSSFEED_PRESETS[preset];
    g_crossfeed.crossfeedLevel = p.level;
    g_crossfeed.delay = p.delay;
    g_crossfeed.lowCut = p.lowCut;
    g_crossfeed.highCut = p.highCut;
    
    if (g_engine && g_engine->getAurivoDSP()) {
        void* dsp = g_engine->getAurivoDSP();
        set_crossfeed_params(dsp, g_crossfeed.enabled ? 1 : 0, 
                            g_crossfeed.crossfeedLevel, 
                            g_crossfeed.delay, 
                            g_crossfeed.lowCut, 
                            g_crossfeed.highCut);
    }
    
    printf("[CROSSFEED] Preset: %s\n", p.name);
    
    return Napi::Boolean::New(env, true);
}

Napi::Value GetCrossfeedParams(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    Napi::Object result = Napi::Object::New(env);
    result.Set("enabled", Napi::Boolean::New(env, g_crossfeed.enabled));
    result.Set("level", Napi::Number::New(env, g_crossfeed.crossfeedLevel));
    result.Set("delay", Napi::Number::New(env, g_crossfeed.delay));
    result.Set("lowCut", Napi::Number::New(env, g_crossfeed.lowCut));
    result.Set("highCut", Napi::Number::New(env, g_crossfeed.highCut));
    result.Set("preset", Napi::Number::New(env, g_crossfeed.preset));
    result.Set("dspAttached", Napi::Boolean::New(env, true)); // Integrated DSP is always "attached"
    
    return result;
}

Napi::Value ResetCrossfeed(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    // Varsayılan değerler (Natural preset)
    g_crossfeed.crossfeedLevel = 30.0f;
    g_crossfeed.delay = 0.3f;
    g_crossfeed.lowCut = 700.0f;
    g_crossfeed.highCut = 4000.0f;
    g_crossfeed.preset = 0;
    
    if (g_crossfeed.enabled) {
        ApplyCrossfeedParams();
    }
    
    printf("[CROSSFEED] Varsayılan ayarlara döndürüldü\n");
    
    return Napi::Boolean::New(env, true);
}

// ============================================
// SURROUND VIRTUALIZER FUNCTIONS
// ============================================
Napi::Value EnableSurroundVirtualizer(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsBoolean()) return Napi::Boolean::New(env, false);
    g_surround.enabled = info[0].As<Napi::Boolean>().Value();
    printf("[SURROUND] %s\n", g_surround.enabled ? "Etkin" : "Devre dışı");
    return Napi::Boolean::New(env, true);
}

Napi::Value SetSurroundCenterLevel(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) return Napi::Boolean::New(env, false);
    g_surround.centerLevel = clampf(info[0].As<Napi::Number>().FloatValue(), -12.0f, 12.0f);
    return Napi::Boolean::New(env, true);
}

Napi::Value SetSurroundSideLevel(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) return Napi::Boolean::New(env, false);
    g_surround.sideLevel = clampf(info[0].As<Napi::Number>().FloatValue(), -12.0f, 12.0f);
    return Napi::Boolean::New(env, true);
}

Napi::Value SetSurroundLfeLevel(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) return Napi::Boolean::New(env, false);
    g_surround.lfeLevel = clampf(info[0].As<Napi::Number>().FloatValue(), -12.0f, 12.0f);
    return Napi::Boolean::New(env, true);
}

Napi::Value SetSurroundCrossover(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) return Napi::Boolean::New(env, false);
    g_surround.crossover = clampf(info[0].As<Napi::Number>().FloatValue(), 40.0f, 220.0f);
    return Napi::Boolean::New(env, true);
}

Napi::Value SetSurroundRearDelay(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) return Napi::Boolean::New(env, false);
    g_surround.rearDelay = clampf(info[0].As<Napi::Number>().FloatValue(), 0.0f, 30.0f);
    return Napi::Boolean::New(env, true);
}

Napi::Value SetSurroundMix(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) return Napi::Boolean::New(env, false);
    g_surround.mix = clampf(info[0].As<Napi::Number>().FloatValue(), 0.0f, 100.0f);
    return Napi::Boolean::New(env, true);
}

Napi::Value ResetSurroundVirtualizer(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    g_surround.centerLevel = 0.0f;
    g_surround.sideLevel = 0.0f;
    g_surround.lfeLevel = 0.0f;
    g_surround.crossover = 110.0f;
    g_surround.rearDelay = 8.0f;
    g_surround.mix = 75.0f;
    g_surround.enabled = false;
    g_surroundState.sideDelayBuffer.clear();
    g_surroundState.writePos = 0;
    g_surroundState.lfeLowpass = 0.0f;
    return Napi::Boolean::New(env, true);
}

// ============================================
// BASS MONO FUNCTIONS
// ============================================

Napi::Value EnableBassMono(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsBoolean()) return Napi::Boolean::New(env, false);
    
    bool enable = info[0].As<Napi::Boolean>().Value();
    g_bassMono.enabled = enable;
    
    if (g_engine && g_engine->getAurivoDSP()) {
        set_bass_mono_params(g_engine->getAurivoDSP(), enable ? 1 : 0,
                             g_bassMono.cutoff, g_bassMono.slope, g_bassMono.stereoWidth);
        printf("[BASS MONO] %s\n", enable ? "Etkin" : "Devre dışı");
    }
    return Napi::Boolean::New(env, true);
}

Napi::Value SetBassMonoCutoff(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) return Napi::Boolean::New(env, false);
    
    float val = info[0].As<Napi::Number>().FloatValue();
    g_bassMono.cutoff = clampf(val, 20.0f, 500.0f);
    
    if (g_engine && g_engine->getAurivoDSP()) {
        set_bass_mono_params(g_engine->getAurivoDSP(), g_bassMono.enabled ? 1 : 0,
                             g_bassMono.cutoff, g_bassMono.slope, g_bassMono.stereoWidth);
    }
    return Napi::Boolean::New(env, true);
}

Napi::Value SetBassMonoSlope(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) return Napi::Boolean::New(env, false);
    
    float val = info[0].As<Napi::Number>().FloatValue();
    // Snap to 12, 24, 48
    if (val <= 18.0f) g_bassMono.slope = 12.0f;
    else if (val <= 36.0f) g_bassMono.slope = 24.0f;
    else g_bassMono.slope = 48.0f;
    
    if (g_engine && g_engine->getAurivoDSP()) {
        set_bass_mono_params(g_engine->getAurivoDSP(), g_bassMono.enabled ? 1 : 0,
                             g_bassMono.cutoff, g_bassMono.slope, g_bassMono.stereoWidth);
    }
    return Napi::Boolean::New(env, true);
}

Napi::Value SetBassMonoStereoWidth(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) return Napi::Boolean::New(env, false);
    
    float val = info[0].As<Napi::Number>().FloatValue();
    g_bassMono.stereoWidth = clampf(val, 0.0f, 200.0f);
    
    if (g_engine && g_engine->getAurivoDSP()) {
        set_bass_mono_params(g_engine->getAurivoDSP(), g_bassMono.enabled ? 1 : 0,
                             g_bassMono.cutoff, g_bassMono.slope, g_bassMono.stereoWidth);
    }
    return Napi::Boolean::New(env, true);
}

Napi::Value ResetBassMono(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    g_bassMono.cutoff = 120.0f;
    g_bassMono.slope = 24.0f;
    g_bassMono.stereoWidth = 100.0f;
    
    if (g_engine && g_engine->getAurivoDSP()) {
        set_bass_mono_params(g_engine->getAurivoDSP(), g_bassMono.enabled ? 1 : 0,
                             g_bassMono.cutoff, g_bassMono.slope, g_bassMono.stereoWidth);
    }
    printf("[BASS MONO] Sıfırlandı\n");
    return Napi::Boolean::New(env, true);
}

// ============================================
// DYNAMIC EQ FUNCTIONS
// ============================================

// TAPE SATURATION DSP CALLBACK
// ============================================
void CALLBACK TapeSat_DSP(HDSP handle, DWORD channel, void* buffer, DWORD length, void* user) {
    float* s = (float*)buffer;
    int n = (int)(length / sizeof(float));

    float sr = g_tapeSatState.sr;

    // Parametreler
    float drive = dBToLinear(clampf(g_tapeSat.driveDb, 0.0f, 24.0f));
    float mix = clampf(g_tapeSat.mix, 0.0f, 100.0f) / 100.0f;
    float out = dBToLinear(clampf(g_tapeSat.outputDb, -12.0f, 12.0f));

    // Tone: tape HF roll-off (6kHz to 16kHz)
    float toneVal = clampf(g_tapeSat.tone, 0.0f, 100.0f);
    float cutoff = 6000.0f + (toneVal / 100.0f) * (16000.0f - 6000.0f);
    float a = onePoleAlphaTape(cutoff, sr);

    // Mode character
    float modeSoftness = 1.0f;
    float evenHarm = 0.15f;
    if (g_tapeSat.mode == 0) {        // Tape
        modeSoftness = 1.0f;
        evenHarm = 0.12f;
    } else if (g_tapeSat.mode == 1) { // Warm
        modeSoftness = 0.9f;
        evenHarm = 0.18f;
    } else {                           // Hot
        modeSoftness = 0.75f;
        evenHarm = 0.22f;
    }

    // Hiss
    float hissAmt = clampf(g_tapeSat.hiss, 0.0f, 100.0f) / 100.0f;
    float hissGain = hissAmt * 0.0008f; 

    for (int i = 0; i < n; i += 2) {
        float inL = s[i];
        float inR = s[i + 1];

        float dryL = inL;
        float dryR = inR;

        // Drive
        float xL = inL * drive;
        float xR = inR * drive;

        // Soft saturation
        float satL = fastTanh(xL * modeSoftness);
        float satR = fastTanh(xR * modeSoftness);

        // Even harmonics
        satL += evenHarm * (xL * xL) * (xL >= 0 ? 1.0f : -1.0f) * 0.02f;
        satR += evenHarm * (xR * xR) * (xR >= 0 ? 1.0f : -1.0f) * 0.02f;

        // HF roll-off
        g_tapeSatState.lpfL = g_tapeSatState.lpfL + a * (satL - g_tapeSatState.lpfL);
        g_tapeSatState.lpfR = g_tapeSatState.lpfR + a * (satR - g_tapeSatState.lpfR);

        float wetL = g_tapeSatState.lpfL;
        float wetR = g_tapeSatState.lpfR;

        if (hissGain > 0.0f) {
            wetL += randFloatSigned(g_tapeSatState.rng) * hissGain;
            wetR += randFloatSigned(g_tapeSatState.rng) * hissGain;
        }

        // Mix
        float yL = dryL * (1.0f - mix) + wetL * mix;
        float yR = dryR * (1.0f - mix) + wetR * mix;

        // Output trim
        yL *= out;
        yR *= out;

        if (yL > 1.0f) yL = 1.0f; else if (yL < -1.0f) yL = -1.0f;
        if (yR > 1.0f) yR = 1.0f; else if (yR < -1.0f) yR = -1.0f;

        s[i] = yL;
        s[i + 1] = yR;
    }
}

Napi::Value EnableTapeSaturation(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsBoolean()) return Napi::Boolean::New(env, false);
    
    bool enable = info[0].As<Napi::Boolean>().Value();
    
    if (g_engine) {
        std::lock_guard<std::mutex> lock(g_engine->getMutex());
        g_tapeSat.enabled = enable;
        if (enable) g_engine->attachTapeSatIfNeeded();
        else g_engine->detachTapeSat();
    }

    return Napi::Boolean::New(env, true);
}

// BIT-DEPTH / DITHER DSP CALLBACK
// ============================================
void CALLBACK BitDither_DSP(HDSP handle, DWORD channel, void* buffer, DWORD length, void* user) {
    float* s = (float*)buffer;
    int n = (int)(length / sizeof(float));

    int bits = g_bitDither.bitDepth;
    if (bits < 4) bits = 4;
    if (bits > 24) bits = 24;

    float mix = clampf(g_bitDither.mix, 0.0f, 100.0f) / 100.0f;
    float out = dBToLinear(clampf(g_bitDither.outputDb, -12.0f, 12.0f));

    int ds = g_bitDither.downsampleFactor;
    if (ds != 1 && ds != 2 && ds != 4 && ds != 8 && ds != 16) ds = 1;

    const int levels = 1 << (bits - 1);
    float lsb = 1.0f / (float)levels;

    for (int i = 0; i < n; i += 2) {
        float inL = s[i];
        float inR = s[i + 1];

        // Downsample
        float xL = inL;
        float xR = inR;
        if (ds > 1) {
            if (g_bitDitherState.holdCounter <= 0) {
                g_bitDitherState.holdCounter = ds;
                g_bitDitherState.holdL = inL;
                g_bitDitherState.holdR = inR;
            }
            g_bitDitherState.holdCounter--;
            xL = g_bitDitherState.holdL;
            xR = g_bitDitherState.holdR;
        }

        // Noise shaping
        if (g_bitDither.shaping == SHAPE_LIGHT) {
            xL = xL + 0.5f * g_bitDitherState.errL;
            xR = xR + 0.5f * g_bitDitherState.errR;
        }

        // Dither
        float dL = 0.0f, dR = 0.0f;
        if (g_bitDither.dither == DITHER_RPDF) {
            dL = randSigned(g_bitDitherState.rng) * 0.5f * lsb;
            dR = randSigned(g_bitDitherState.rng) * 0.5f * lsb;
        } else if (g_bitDither.dither == DITHER_TPDF) {
            dL = (rand01(g_bitDitherState.rng) - rand01(g_bitDitherState.rng)) * lsb;
            dR = (rand01(g_bitDitherState.rng) - rand01(g_bitDitherState.rng)) * lsb;
        }

        float yL = xL + dL;
        float yR = xR + dR;

        // Quantize
        float qL = quantize(yL, bits);
        float qR = quantize(yR, bits);

        g_bitDitherState.errL = yL - qL;
        g_bitDitherState.errR = yR - qR;

        // Mix
        float outL = inL * (1.0f - mix) + qL * mix;
        float outR = inR * (1.0f - mix) + qR * mix;

        // Trim & Clamp
        outL *= out;
        outR *= out;

        if (outL > 1.0f) outL = 1.0f; else if (outL < -1.0f) outL = -1.0f;
        if (outR > 1.0f) outR = 1.0f; else if (outR < -1.0f) outR = -1.0f;

        s[i] = outL;
        s[i + 1] = outR;
    }
}
// ============================================
Napi::Value SetTapeDrive(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) return Napi::Boolean::New(env, false);
    g_tapeSat.driveDb = clampf(info[0].As<Napi::Number>().FloatValue(), 0.0f, 24.0f);
    return Napi::Boolean::New(env, true);
}

Napi::Value SetTapeMix(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) return Napi::Boolean::New(env, false);
    g_tapeSat.mix = clampf(info[0].As<Napi::Number>().FloatValue(), 0.0f, 100.0f);
    return Napi::Boolean::New(env, true);
}

Napi::Value SetTapeTone(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) return Napi::Boolean::New(env, false);
    g_tapeSat.tone = clampf(info[0].As<Napi::Number>().FloatValue(), 0.0f, 100.0f);
    return Napi::Boolean::New(env, true);
}

Napi::Value SetTapeOutput(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) return Napi::Boolean::New(env, false);
    g_tapeSat.outputDb = clampf(info[0].As<Napi::Number>().FloatValue(), -12.0f, 12.0f);
    return Napi::Boolean::New(env, true);
}

Napi::Value SetTapeMode(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) return Napi::Boolean::New(env, false);
    g_tapeSat.mode = (int)clampf(info[0].As<Napi::Number>().FloatValue(), 0, 2);
    return Napi::Boolean::New(env, true);
}

Napi::Value SetTapeHiss(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) return Napi::Boolean::New(env, false);
    g_tapeSat.hiss = clampf(info[0].As<Napi::Number>().FloatValue(), 0.0f, 100.0f);
    return Napi::Boolean::New(env, true);
}

// TAPE SATURATION SETTERS
// ============================================
Napi::Value EnableBitDepthDither(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsBoolean()) return Napi::Boolean::New(env, false);
    bool enable = info[0].As<Napi::Boolean>().Value();
    if (g_engine) {
        std::lock_guard<std::mutex> lock(g_engine->getMutex());
        g_bitDither.enabled = enable;
        if (enable) g_engine->attachBitDitherIfNeeded();
        else g_engine->detachBitDither();
    }
    return Napi::Boolean::New(env, true);
}

Napi::Value SetBitDepth(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) return Napi::Boolean::New(env, false);
    g_bitDither.bitDepth = (int)clampf(info[0].As<Napi::Number>().FloatValue(), 4, 24);
    return Napi::Boolean::New(env, true);
}

Napi::Value SetDitherType(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) return Napi::Boolean::New(env, false);
    g_bitDither.dither = (DitherType)(int)clampf(info[0].As<Napi::Number>().FloatValue(), 0, 2);
    return Napi::Boolean::New(env, true);
}

Napi::Value SetNoiseShaping(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) return Napi::Boolean::New(env, false);
    g_bitDither.shaping = (NoiseShape)(int)clampf(info[0].As<Napi::Number>().FloatValue(), 0, 1);
    return Napi::Boolean::New(env, true);
}

Napi::Value SetDownsampleFactor(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) return Napi::Boolean::New(env, false);
    g_bitDither.downsampleFactor = (int)info[0].As<Napi::Number>().FloatValue();
    return Napi::Boolean::New(env, true);
}

Napi::Value SetBitDitherMix(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) return Napi::Boolean::New(env, false);
    g_bitDither.mix = clampf(info[0].As<Napi::Number>().FloatValue(), 0.0f, 100.0f);
    return Napi::Boolean::New(env, true);
}

Napi::Value SetBitDitherOutput(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) return Napi::Boolean::New(env, false);
    g_bitDither.outputDb = clampf(info[0].As<Napi::Number>().FloatValue(), -12.0f, 12.0f);
    return Napi::Boolean::New(env, true);
}

Napi::Value ResetBitDepthDither(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_engine) {
        std::lock_guard<std::mutex> lock(g_engine->getMutex());
        g_bitDither.bitDepth = 16;
        g_bitDither.dither = DITHER_TPDF;
        g_bitDither.shaping = SHAPE_OFF;
        g_bitDither.downsampleFactor = 1;
        g_bitDither.mix = 100.0f;
        g_bitDither.outputDb = 0.0f;
        g_bitDitherState.holdCounter = 0;
        g_bitDitherState.holdL = g_bitDitherState.holdR = 0.0f;
        g_bitDitherState.errL = g_bitDitherState.errR = 0.0f;
    }
    return Napi::Boolean::New(env, true);
}

void UpdateDynamicEQOnDSP() {
    if (g_engine && g_engine->getAurivoDSP()) {
        printf("[AUDIO] UpdateDynamicEQ: en=%d, f=%.1f, q=%.1f, thr=%.1f, g=%.1f\n",
               g_dynamicEq.enabled, g_dynamicEq.frequency, g_dynamicEq.q, g_dynamicEq.threshold, g_dynamicEq.targetGain);
        set_dynamic_eq_params(g_engine->getAurivoDSP(), 
                              g_dynamicEq.enabled ? 1 : 0,
                              g_dynamicEq.frequency, 
                              g_dynamicEq.q, 
                              g_dynamicEq.threshold, 
                              g_dynamicEq.targetGain, 
                              g_dynamicEq.range, 
                              g_dynamicEq.attackMs, 
                              g_dynamicEq.releaseMs);
    }
}

Napi::Value EnableDynamicEQ(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsBoolean()) return Napi::Boolean::New(env, false);
    g_dynamicEq.enabled = info[0].As<Napi::Boolean>().Value();
    UpdateDynamicEQOnDSP();
    printf("[DYNAMIC EQ] %s\n", g_dynamicEq.enabled ? "Etkin" : "Devre dışı");
    return Napi::Boolean::New(env, true);
}

Napi::Value SetDynamicEQFrequency(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) return Napi::Boolean::New(env, false);
    g_dynamicEq.frequency = clampf(info[0].As<Napi::Number>().FloatValue(), 20.0f, 20000.0f);
    UpdateDynamicEQOnDSP();
    return Napi::Boolean::New(env, true);
}

Napi::Value SetDynamicEQGain(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) return Napi::Boolean::New(env, false);
    float val = info[0].As<Napi::Number>().FloatValue();
    printf("[NAPI] SetGain: %.1f\n", val);
    g_dynamicEq.targetGain = clampf(val, -24.0f, 24.0f);
    UpdateDynamicEQOnDSP();
    return Napi::Boolean::New(env, true);
}

Napi::Value SetDynamicEQQ(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) return Napi::Boolean::New(env, false);
    g_dynamicEq.q = clampf(info[0].As<Napi::Number>().FloatValue(), 0.1f, 10.0f);
    UpdateDynamicEQOnDSP();
    return Napi::Boolean::New(env, true);
}

Napi::Value SetDynamicEQThreshold(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) return Napi::Boolean::New(env, false);
    float val = info[0].As<Napi::Number>().FloatValue();
    printf("[NAPI] SetThreshold: %.1f\n", val);
    g_dynamicEq.threshold = clampf(val, -80.0f, 0.0f);
    UpdateDynamicEQOnDSP();
    return Napi::Boolean::New(env, true);
}

Napi::Value SetDynamicEQAttack(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) return Napi::Boolean::New(env, false);
    g_dynamicEq.attackMs = clampf(info[0].As<Napi::Number>().FloatValue(), 1.0f, 2000.0f);
    UpdateDynamicEQOnDSP();
    return Napi::Boolean::New(env, true);
}

Napi::Value SetDynamicEQRelease(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) return Napi::Boolean::New(env, false);
    g_dynamicEq.releaseMs = clampf(info[0].As<Napi::Number>().FloatValue(), 5.0f, 5000.0f);
    UpdateDynamicEQOnDSP();
    return Napi::Boolean::New(env, true);
}

Napi::Value SetDynamicEQRange(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) return Napi::Boolean::New(env, false);
    g_dynamicEq.range = clampf(info[0].As<Napi::Number>().FloatValue(), 0.0f, 24.0f);
    UpdateDynamicEQOnDSP();
    return Napi::Boolean::New(env, true);
}

// ============================================
// MODULE INITIALIZATION
// ============================================
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    // Core functions
    exports.Set("initAudio", Napi::Function::New(env, InitAudio));
    exports.Set("initialize", Napi::Function::New(env, Initialize));  // Legacy
    exports.Set("cleanup", Napi::Function::New(env, Cleanup));
    exports.Set("loadFile", Napi::Function::New(env, LoadFile));
    exports.Set("crossfadeTo", Napi::Function::New(env, CrossfadeTo));
    
    // Playback
    exports.Set("play", Napi::Function::New(env, Play));
    exports.Set("pause", Napi::Function::New(env, Pause));
    exports.Set("stop", Napi::Function::New(env, Stop));
    exports.Set("seek", Napi::Function::New(env, Seek));
    
    // Position / Status
    exports.Set("getCurrentPosition", Napi::Function::New(env, GetCurrentPosition));
    exports.Set("getPosition", Napi::Function::New(env, GetPosition));  // Legacy
    exports.Set("getDuration", Napi::Function::New(env, GetDuration));
    exports.Set("isPlaying", Napi::Function::New(env, IsPlaying));
    
    // Volume
    exports.Set("setMasterVolume", Napi::Function::New(env, SetMasterVolume));
    exports.Set("getMasterVolume", Napi::Function::New(env, GetMasterVolume));
    exports.Set("setVolume", Napi::Function::New(env, SetVolume));  // Legacy
    exports.Set("getVolume", Napi::Function::New(env, GetVolume));  // Legacy
    
    // Pre-amp
    exports.Set("setPreAmp", Napi::Function::New(env, SetPreAmp));
    exports.Set("setPreamp", Napi::Function::New(env, SetPreamp));  // Legacy
    exports.Set("getPreAmp", Napi::Function::New(env, GetPreAmp));
    
    // EQ
    exports.Set("setEQBand", Napi::Function::New(env, SetEQBand));
    exports.Set("getEQBand", Napi::Function::New(env, GetEQBand));
    exports.Set("setEQBands", Napi::Function::New(env, SetEQBands));
    exports.Set("resetEQ", Napi::Function::New(env, ResetEQ));
    exports.Set("getEQFrequencies", Napi::Function::New(env, GetEQFrequencies));
    
    // Bass Boost
    exports.Set("setBassBoost", Napi::Function::New(env, SetBassBoost));
    exports.Set("getBassBoost", Napi::Function::New(env, GetBassBoost));
    
    // Auto-gain / Normalization / AGC
    exports.Set("setAutoGainEnabled", Napi::Function::New(env, SetAutoGainEnabled));
    exports.Set("setAutoGainTarget", Napi::Function::New(env, SetAutoGainTarget));
    exports.Set("setAutoGainMaxGain", Napi::Function::New(env, SetAutoGainMaxGain));
    exports.Set("setAutoGainAttack", Napi::Function::New(env, SetAutoGainAttack));
    exports.Set("setAutoGainRelease", Napi::Function::New(env, SetAutoGainRelease));
    exports.Set("setAutoGainMode", Napi::Function::New(env, SetAutoGainMode));
    exports.Set("updateAutoGain", Napi::Function::New(env, UpdateAutoGain));
    exports.Set("normalizeAudio", Napi::Function::New(env, NormalizeAudio));
    exports.Set("resetAutoGain", Napi::Function::New(env, ResetAutoGain));
    exports.Set("getAutoGainStats", Napi::Function::New(env, GetAutoGainStats));
    exports.Set("getPeakLevel", Napi::Function::New(env, GetPeakLevel));
    exports.Set("getRmsLevel", Napi::Function::New(env, GetRmsLevel));
    exports.Set("getAutoGainReduction", Napi::Function::New(env, GetAutoGainReduction));
    exports.Set("isClipping", Napi::Function::New(env, IsClipping));
    exports.Set("getClippingCount", Napi::Function::New(env, GetClippingCount));
    exports.Set("resetClippingCount", Napi::Function::New(env, ResetClippingCount));
    exports.Set("getAGCStatus", Napi::Function::New(env, GetAGCStatus));
    exports.Set("applyEmergencyReduction", Napi::Function::New(env, ApplyEmergencyReduction));
    exports.Set("getPreampSuggestion", Napi::Function::New(env, GetPreampSuggestion));
    exports.Set("setAGCParameters", Napi::Function::New(env, SetAGCParameters));
    
    // True Peak Limiter + Meter
    exports.Set("setTruePeakEnabled", Napi::Function::New(env, SetTruePeakEnabled));
    exports.Set("setTruePeakCeiling", Napi::Function::New(env, SetTruePeakCeiling));
    exports.Set("setTruePeakRelease", Napi::Function::New(env, SetTruePeakRelease));
    exports.Set("setTruePeakLookahead", Napi::Function::New(env, SetTruePeakLookahead));
    exports.Set("setTruePeakInputGain", Napi::Function::New(env, SetTruePeakInputGain));
    exports.Set("setTruePeakOversampling", Napi::Function::New(env, SetTruePeakOversampling));
    exports.Set("setTruePeakLinkChannels", Napi::Function::New(env, SetTruePeakLinkChannels));
    exports.Set("getTruePeakMeter", Napi::Function::New(env, GetTruePeakMeter));
    exports.Set("resetTruePeakClipping", Napi::Function::New(env, ResetTruePeakClipping));
    exports.Set("resetTruePeakLimiter", Napi::Function::New(env, ResetTruePeakLimiter));
    exports.Set("isTruePeakEnabled", Napi::Function::New(env, IsTruePeakEnabled));
    
    // Spectrum / FFT
    exports.Set("getFFTData", Napi::Function::New(env, GetFFTData));
    exports.Set("getPCMData", Napi::Function::New(env, GetPCMData));
    exports.Set("getSpectrumBands", Napi::Function::New(env, GetSpectrumBands));
    exports.Set("getChannelLevels", Napi::Function::New(env, GetChannelLevels));
    
    // Balance Control
    exports.Set("setBalance", Napi::Function::New(env, SetBalance));
    exports.Set("getBalance", Napi::Function::New(env, GetBalance));
    
    // DSP Etkinleştir/Devre dışı bırak
    exports.Set("setDSPEnabled", Napi::Function::New(env, SetDSPEnabled));
    exports.Set("isDSPEnabled", Napi::Function::New(env, IsDSPEnabled));
    
    // Aurivo Module (Bass, Mid, Treble, Stereo Expander)
    exports.Set("setBass", Napi::Function::New(env, SetBass));
    exports.Set("getBass", Napi::Function::New(env, GetBass));
    exports.Set("setMid", Napi::Function::New(env, SetMid));
    exports.Set("getMid", Napi::Function::New(env, GetMid));
    exports.Set("setTreble", Napi::Function::New(env, SetTreble));
    exports.Set("getTreble", Napi::Function::New(env, GetTreble));
    exports.Set("setStereoExpander", Napi::Function::New(env, SetStereoExpander));
    exports.Set("getStereoExpander", Napi::Function::New(env, GetStereoExpander));
    
    // Reverb Control
    exports.Set("setReverbEnabled", Napi::Function::New(env, SetReverbEnabled));
    exports.Set("getReverbEnabled", Napi::Function::New(env, GetReverbEnabled));
    exports.Set("setReverbRoomSize", Napi::Function::New(env, SetReverbRoomSize));
    exports.Set("setReverbDamping", Napi::Function::New(env, SetReverbDamping));
    exports.Set("setReverbWetDry", Napi::Function::New(env, SetReverbWetDry));
    exports.Set("setReverbHFRatio", Napi::Function::New(env, SetReverbHFRatio));
    exports.Set("setReverbInputGain", Napi::Function::New(env, SetReverbInputGain));

    // Compressor (BASS_FX)
    exports.Set("EnableCompressor", Napi::Function::New(env, EnableCompressor));
    exports.Set("SetCompressorThreshold", Napi::Function::New(env, SetCompressorThreshold));
    exports.Set("SetCompressorRatio", Napi::Function::New(env, SetCompressorRatio));
    exports.Set("SetCompressorAttack", Napi::Function::New(env, SetCompressorAttack));
    exports.Set("SetCompressorRelease", Napi::Function::New(env, SetCompressorRelease));
    exports.Set("SetCompressorMakeupGain", Napi::Function::New(env, SetCompressorMakeupGain));
    exports.Set("SetCompressorKnee", Napi::Function::New(env, SetCompressorKnee));
    exports.Set("GetGainReduction", Napi::Function::New(env, GetGainReduction));
    // Tape Saturation
    exports.Set("enableTapeSaturation", Napi::Function::New(env, EnableTapeSaturation));
    exports.Set("setTapeDrive", Napi::Function::New(env, SetTapeDrive));
    exports.Set("setTapeMix", Napi::Function::New(env, SetTapeMix));
    exports.Set("setTapeTone", Napi::Function::New(env, SetTapeTone));
    exports.Set("setTapeOutput", Napi::Function::New(env, SetTapeOutput));
    exports.Set("setTapeMode", Napi::Function::New(env, SetTapeMode));
    exports.Set("setTapeHiss", Napi::Function::New(env, SetTapeHiss));
    
    // Bit Depth / Dither
    exports.Set("enableBitDepthDither", Napi::Function::New(env, EnableBitDepthDither));
    exports.Set("setBitDepth", Napi::Function::New(env, SetBitDepth));
    exports.Set("setDitherType", Napi::Function::New(env, SetDitherType));
    exports.Set("setNoiseShaping", Napi::Function::New(env, SetNoiseShaping));
    exports.Set("setDownsampleFactor", Napi::Function::New(env, SetDownsampleFactor));
    exports.Set("setBitDitherMix", Napi::Function::New(env, SetBitDitherMix));
    exports.Set("setBitDitherOutput", Napi::Function::New(env, SetBitDitherOutput));
    exports.Set("resetBitDepthDither", Napi::Function::New(env, ResetBitDepthDither));

    exports.Set("ResetCompressor", Napi::Function::New(env, ResetCompressor));
    
    // DSP Effects
    exports.Set("setCompressor", Napi::Function::New(env, SetCompressor));
    exports.Set("setGate", Napi::Function::New(env, SetGate));
    exports.Set("setLimiter", Napi::Function::New(env, SetLimiter));
    exports.Set("setEcho", Napi::Function::New(env, SetEcho));
    exports.Set("setBassBoostDsp", Napi::Function::New(env, SetBassBoostDsp));
    exports.Set("setPEQ", Napi::Function::New(env, SetPEQ));
    exports.Set("setPEQFilterType", Napi::Function::New(env, SetPEQFilterType));
    exports.Set("getPEQBand", Napi::Function::New(env, GetPEQBand));
    
    // Limiter individual controls
    exports.Set("EnableLimiter", Napi::Function::New(env, EnableLimiter));
    exports.Set("SetLimiterCeiling", Napi::Function::New(env, SetLimiterCeiling));
    exports.Set("SetLimiterRelease", Napi::Function::New(env, SetLimiterRelease));
    exports.Set("SetLimiterLookahead", Napi::Function::New(env, SetLimiterLookahead));
    exports.Set("SetLimiterGain", Napi::Function::New(env, SetLimiterGain));
    exports.Set("GetLimiterReduction", Napi::Function::New(env, GetLimiterReduction));
    exports.Set("ResetLimiter", Napi::Function::New(env, ResetLimiter));

    // Bass Enhancer individual controls
    exports.Set("EnableBassEnhancer", Napi::Function::New(env, EnableBassEnhancer));
    exports.Set("SetBassEnhancerFrequency", Napi::Function::New(env, SetBassEnhancerFrequency));
    exports.Set("SetBassEnhancerGain", Napi::Function::New(env, SetBassEnhancerGain));
    exports.Set("SetBassEnhancerHarmonics", Napi::Function::New(env, SetBassEnhancerHarmonics));
    exports.Set("SetBassEnhancerWidth", Napi::Function::New(env, SetBassEnhancerWidth));
    exports.Set("SetBassEnhancerMix", Napi::Function::New(env, SetBassEnhancerMix));
    exports.Set("ResetBassEnhancer", Napi::Function::New(env, ResetBassEnhancer));

    // Noise Gate individual controls
    exports.Set("EnableNoiseGate", Napi::Function::New(env, EnableNoiseGate));
    exports.Set("SetNoiseGateThreshold", Napi::Function::New(env, SetNoiseGateThreshold));
    exports.Set("SetNoiseGateAttack", Napi::Function::New(env, SetNoiseGateAttack));
    exports.Set("SetNoiseGateHold", Napi::Function::New(env, SetNoiseGateHold));
    exports.Set("SetNoiseGateRelease", Napi::Function::New(env, SetNoiseGateRelease));
    exports.Set("SetNoiseGateRange", Napi::Function::New(env, SetNoiseGateRange));
    exports.Set("GetNoiseGateStatus", Napi::Function::New(env, GetNoiseGateStatus));
    exports.Set("ResetNoiseGate", Napi::Function::New(env, ResetNoiseGate));

    // De-esser individual controls
    exports.Set("EnableDeEsser", Napi::Function::New(env, EnableDeEsser));
    exports.Set("SetDeEsserFrequency", Napi::Function::New(env, SetDeEsserFrequency));
    exports.Set("SetDeEsserThreshold", Napi::Function::New(env, SetDeEsserThreshold));
    exports.Set("SetDeEsserRatio", Napi::Function::New(env, SetDeEsserRatio));
    exports.Set("SetDeEsserRange", Napi::Function::New(env, SetDeEsserRange));
    exports.Set("SetDeEsserListenMode", Napi::Function::New(env, SetDeEsserListenMode));
    exports.Set("GetDeEsserActivity", Napi::Function::New(env, GetDeEsserActivity));
    exports.Set("ResetDeEsser", Napi::Function::New(env, ResetDeEsser));

    // Exciter individual controls
    exports.Set("EnableExciter", Napi::Function::New(env, EnableExciter));
    exports.Set("SetExciterAmount", Napi::Function::New(env, SetExciterAmount));
    exports.Set("SetExciterFrequency", Napi::Function::New(env, SetExciterFrequency));
    exports.Set("SetExciterHarmonics", Napi::Function::New(env, SetExciterHarmonics));
    exports.Set("SetExciterMix", Napi::Function::New(env, SetExciterMix));
    exports.Set("SetExciterType", Napi::Function::New(env, SetExciterType));
    exports.Set("ResetExciter", Napi::Function::New(env, ResetExciter));

    // Stereo Widener individual controls
    exports.Set("EnableStereoWidener", Napi::Function::New(env, EnableStereoWidener));
    exports.Set("SetStereoWidth", Napi::Function::New(env, SetStereoWidth));
    exports.Set("SetStereoBassCutoff", Napi::Function::New(env, SetStereoBassCutoff));
    exports.Set("SetStereoDelay", Napi::Function::New(env, SetStereoDelay));
    exports.Set("SetStereoBalance", Napi::Function::New(env, SetStereoBalance));
    exports.Set("SetStereoMonoLow", Napi::Function::New(env, SetStereoMonoLow));
    exports.Set("GetStereoPhase", Napi::Function::New(env, GetStereoPhase));
    exports.Set("ResetStereoWidener", Napi::Function::New(env, ResetStereoWidener));

    // Echo individual controls
    exports.Set("EnableEchoEffect", Napi::Function::New(env, EnableEchoEffect));
    exports.Set("SetEchoDelayTime", Napi::Function::New(env, SetEchoDelayTime));
    exports.Set("SetEchoFeedback", Napi::Function::New(env, SetEchoFeedback));
    exports.Set("SetEchoWetMix", Napi::Function::New(env, SetEchoWetMix));
    exports.Set("SetEchoDryMix", Napi::Function::New(env, SetEchoDryMix));
    exports.Set("SetEchoStereoMode", Napi::Function::New(env, SetEchoStereoMode));
    exports.Set("SetEchoLowCut", Napi::Function::New(env, SetEchoLowCut));
    exports.Set("SetEchoHighCut", Napi::Function::New(env, SetEchoHighCut));
    exports.Set("SetEchoTempo", Napi::Function::New(env, SetEchoTempo));
    exports.Set("ResetEchoEffect", Napi::Function::New(env, ResetEchoEffect));
    exports.Set("EnableSoftEchoEffect", Napi::Function::New(env, EnableSoftEchoEffect));
    exports.Set("SetSoftEchoDelayTime", Napi::Function::New(env, SetSoftEchoDelayTime));
    exports.Set("SetSoftEchoFeedback", Napi::Function::New(env, SetSoftEchoFeedback));
    exports.Set("SetSoftEchoWetMix", Napi::Function::New(env, SetSoftEchoWetMix));
    exports.Set("SetSoftEchoDryMix", Napi::Function::New(env, SetSoftEchoDryMix));
    exports.Set("SetSoftEchoStereoMode", Napi::Function::New(env, SetSoftEchoStereoMode));
    exports.Set("SetSoftEchoHighCut", Napi::Function::New(env, SetSoftEchoHighCut));
    exports.Set("ResetSoftEchoEffect", Napi::Function::New(env, ResetSoftEchoEffect));

    // Convolution Reverb
    exports.Set("EnableConvolutionReverb", Napi::Function::New(env, EnableConvolutionReverb));
    exports.Set("LoadIRFile", Napi::Function::New(env, LoadIRFile));
    exports.Set("SetConvReverbRoomSize", Napi::Function::New(env, SetConvReverbRoomSize));
    exports.Set("SetConvReverbDecay", Napi::Function::New(env, SetConvReverbDecay));
    exports.Set("SetConvReverbDamping", Napi::Function::New(env, SetConvReverbDamping));
    exports.Set("SetConvReverbWetMix", Napi::Function::New(env, SetConvReverbWetMix));
    exports.Set("SetConvReverbDryMix", Napi::Function::New(env, SetConvReverbDryMix));
    exports.Set("SetConvReverbPreDelay", Napi::Function::New(env, SetConvReverbPreDelay));
    exports.Set("SetConvReverbRoomType", Napi::Function::New(env, SetConvReverbRoomType));
    exports.Set("GetIRPresets", Napi::Function::New(env, GetIRPresets));
    exports.Set("ResetConvolutionReverb", Napi::Function::New(env, ResetConvolutionReverb));

    // Crossfeed (Headphone Enhancement)
    exports.Set("EnableCrossfeed", Napi::Function::New(env, EnableCrossfeed));
    exports.Set("SetCrossfeedLevel", Napi::Function::New(env, SetCrossfeedLevel));
    exports.Set("SetCrossfeedDelay", Napi::Function::New(env, SetCrossfeedDelay));
    exports.Set("SetCrossfeedLowCut", Napi::Function::New(env, SetCrossfeedLowCut));
    exports.Set("SetCrossfeedHighCut", Napi::Function::New(env, SetCrossfeedHighCut));
    exports.Set("SetCrossfeedPreset", Napi::Function::New(env, SetCrossfeedPreset));
    exports.Set("GetCrossfeedParams", Napi::Function::New(env, GetCrossfeedParams));
    exports.Set("ResetCrossfeed", Napi::Function::New(env, ResetCrossfeed));

    // Surround Virtualizer
    exports.Set("EnableSurroundVirtualizer", Napi::Function::New(env, EnableSurroundVirtualizer));
    exports.Set("SetSurroundCenterLevel", Napi::Function::New(env, SetSurroundCenterLevel));
    exports.Set("SetSurroundSideLevel", Napi::Function::New(env, SetSurroundSideLevel));
    exports.Set("SetSurroundLfeLevel", Napi::Function::New(env, SetSurroundLfeLevel));
    exports.Set("SetSurroundCrossover", Napi::Function::New(env, SetSurroundCrossover));
    exports.Set("SetSurroundRearDelay", Napi::Function::New(env, SetSurroundRearDelay));
    exports.Set("SetSurroundMix", Napi::Function::New(env, SetSurroundMix));
    exports.Set("ResetSurroundVirtualizer", Napi::Function::New(env, ResetSurroundVirtualizer));

    // Bass Mono
    exports.Set("EnableBassMono", Napi::Function::New(env, EnableBassMono));
    exports.Set("SetBassMonoCutoff", Napi::Function::New(env, SetBassMonoCutoff));
    exports.Set("SetBassMonoSlope", Napi::Function::New(env, SetBassMonoSlope));
    exports.Set("SetBassMonoStereoWidth", Napi::Function::New(env, SetBassMonoStereoWidth));
    exports.Set("ResetBassMono", Napi::Function::New(env, ResetBassMono));

    // Dynamic EQ
    exports.Set("EnableDynamicEQ", Napi::Function::New(env, EnableDynamicEQ));
    exports.Set("SetDynamicEQFrequency", Napi::Function::New(env, SetDynamicEQFrequency));
    exports.Set("SetDynamicEQGain", Napi::Function::New(env, SetDynamicEQGain));
    exports.Set("SetDynamicEQQ", Napi::Function::New(env, SetDynamicEQQ));
    exports.Set("SetDynamicEQThreshold", Napi::Function::New(env, SetDynamicEQThreshold));
    exports.Set("SetDynamicEQAttack", Napi::Function::New(env, SetDynamicEQAttack));
    exports.Set("SetDynamicEQRelease", Napi::Function::New(env, SetDynamicEQRelease));
    exports.Set("SetDynamicEQRange", Napi::Function::New(env, SetDynamicEQRange));

    return exports;
}

NODE_API_MODULE(aurivo_audio, Init)
