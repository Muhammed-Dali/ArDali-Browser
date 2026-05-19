/*
    BASS_FX 2.4 - C Header file
    Minimal header for ArDali Media Player
*/

#ifndef BASS_FX_H
#define BASS_FX_H

#include "bass.h"

#ifdef __cplusplus
extern "C" {
#endif

// BASS_FX Version
DWORD BASS_FX_GetVersion();

// Tempo/Pitch
#define BASS_FX_FREESOURCE 0x10000

HSTREAM BASS_FX_TempoCreate(HSTREAM chan, DWORD flags);
BOOL BASS_FX_TempoGetSource(HSTREAM chan);
float BASS_FX_TempoGetRateRatio(HSTREAM chan);

// Tempo attributes
#define BASS_ATTRIB_TEMPO       0x10000
#define BASS_ATTRIB_TEMPO_PITCH 0x10001
#define BASS_ATTRIB_TEMPO_FREQ  0x10002

// BPM
float BASS_FX_BPM_DecodeGet(HSTREAM chan, double startSec, double endSec, DWORD minMaxBPM, DWORD flags, void *proc);
BOOL BASS_FX_BPM_Free(HSTREAM chan);

// Reverse
#define BASS_FX_BPM_BKGRND  1
#define BASS_FX_BPM_MULT2   2

HSTREAM BASS_FX_ReverseCreate(HSTREAM chan, float dec_block, DWORD flags);
BOOL BASS_FX_ReverseGetSource(HSTREAM chan);

// ============================================
// BFX (DSP) effect types (needed by ArDali)
// ============================================
#define BASS_FX_BFX_ROTATE        0x10000
#define BASS_FX_BFX_ECHO          0x10001
#define BASS_FX_BFX_FLANGER       0x10002
#define BASS_FX_BFX_VOLUME        0x10003
#define BASS_FX_BFX_PEAKEQ        0x10004
#define BASS_FX_BFX_REVERB        0x10005
#define BASS_FX_BFX_LPF           0x10006
#define BASS_FX_BFX_MIX           0x10007
#define BASS_FX_BFX_DAMP          0x10008
#define BASS_FX_BFX_AUTOWAH       0x10009
#define BASS_FX_BFX_PHASER        0x1000A
#define BASS_FX_BFX_CHORUS        0x1000B
#define BASS_FX_BFX_DISTORTION    0x1000C
#define BASS_FX_BFX_COMPRESSOR    0x1000D
#define BASS_FX_BFX_BQF           0x1000E
#define BASS_FX_BFX_ECHO2         0x1000F
#define BASS_FX_BFX_PITCHSHIFT    0x10010
#define BASS_FX_BFX_FREEVERB      0x10011
#define BASS_FX_BFX_COMPRESSOR2   0x10012

// BFX channel flags
#define BASS_BFX_CHANALL          ((DWORD)-1)
#define BASS_BFX_CHANNONE         0

// BQF filter types
#define BASS_BFX_BQF_LOWPASS      0
#define BASS_BFX_BQF_HIGHPASS     1
#define BASS_BFX_BQF_BANDPASS     2
#define BASS_BFX_BQF_BANDPASS_Q   3
#define BASS_BFX_BQF_NOTCH        4
#define BASS_BFX_BQF_ALLPASS      5
#define BASS_BFX_BQF_PEAKING      6
#define BASS_BFX_BQF_LOWSHELF     7
#define BASS_BFX_BQF_HIGHSHELF    8

// ============================================
// BFX effect parameter structures
// ============================================

// Volume effect
typedef struct {
    DWORD lChannel;
    float fVolume;
} BASS_BFX_VOLUME;

// Peak EQ effect  
typedef struct {
    int   nBand;       // band number (0-based, -1 = all)
    float fBandwidth;  // bandwidth in octaves
    float fQ;          // Q factor
    float fCenter;     // center frequency in Hz
    float fGain;       // gain in dB (-15 to +15)
    DWORD lChannel;    // channel(s) to apply
} BASS_BFX_PEAKEQ;

// BiQuad filter
typedef struct {
    DWORD lChannel;
    DWORD lFilter;
    float fCenter;
    float fQ;
    float fGain;
    float fBandwidth;
    float fS;
} BASS_BFX_BQF;

// Rotate effect
typedef struct {
    DWORD lChannel;
    float fRate;
} BASS_BFX_ROTATE;

// Compressor effect (legacy - BASS_FX_BFX_COMPRESSOR)
typedef struct {
    float fThreshold;
    float fAttack;
    float fRelease;
    DWORD lChannel;
} BASS_BFX_COMPRESSOR;

// Compressor2 effect (modern - BASS_FX_BFX_COMPRESSOR2)
typedef struct {
    float fGain;       // output gain in dB
    float fThreshold;  // threshold in dB
    float fRatio;      // compression ratio
    float fAttack;     // attack time in ms
    float fRelease;    // release time in ms
    DWORD lChannel;
} BASS_BFX_COMPRESSOR2;

// Echo effect
typedef struct {
    float fLevel;      // echo level (0 to 1)
    int   lDelay;      // delay in ms
} BASS_BFX_ECHO;

// Echo2 effect (advanced)
typedef struct {
    float fDryMix;     // dry mix (-2 to +2)
    float fWetMix;     // wet mix (-2 to +2)
    float fFeedback;   // feedback (-1 to +1)
    float fDelay;      // delay in seconds
    BOOL  bStereo;     // stereo echo
    DWORD lChannel;
} BASS_BFX_ECHO2;

// Freeverb reverb effect
typedef struct {
    float fDryMix;     // dry mix (0 to 1)
    float fWetMix;     // wet mix (0 to 3)
    float fRoomSize;   // room size (0 to 1)
    float fDamp;       // damping (0 to 1)
    float fWidth;      // stereo width (0 to 1)
    DWORD lMode;       // mode (0=normal, 1=freeze)
    DWORD lChannel;
} BASS_BFX_FREEVERB;

#ifdef __cplusplus
}
#endif

#endif // BASS_FX_H
