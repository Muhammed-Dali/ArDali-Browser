use crate::fingerprinting::signature_format::DecodedSignature;
#[cfg(feature = "gui")]
use crate::gui::preferences::Preferences;

use std::thread;

/// This module contains code used from message-based communication between threads.

pub fn spawn_big_thread<F, T>(argument: F) -> ()
where
    F: std::ops::FnOnce() -> T,
    F: std::marker::Send + 'static,
    T: std::marker::Send + 'static,
{
    thread::Builder::new()
        .stack_size(32 * 1024 * 1024)
        .spawn(argument)
        .unwrap();
}

#[derive(Debug)]
pub struct SongRecognizedMessage {
    pub artist_name: String,
    pub album_name: Option<String>,
    pub song_name: String,
    pub cover_image: Option<Vec<u8>>,
    pub recognition_engine: Option<String>,

    // Used only in the CSV export for now:
    pub track_key: String,
    pub release_year: Option<String>,
    pub genre: Option<String>,

    pub shazam_json: String,
}

#[derive(Clone, Debug, Default)]
pub struct RecognitionBenchmarkSnapshot {
    pub attempts_total: u64,
    pub success_total: u64,
    pub songrec_success: u64,
    pub acoustid_success: u64,
    pub avg_latency_ms: u64,
    pub last_latency_ms: u64,
    pub last_engine: String,
    pub last_outcome: String,
}

#[derive(Debug)]
pub struct DeviceListItem {
    pub inner_name: String,
    pub display_name: String,
    // The checkbox option on the UI should select the first monitor
    // device present in the combo box, when specified
    pub is_monitor: bool,
}

#[derive(Debug)]
pub enum GUIMessage {
    ErrorMessage(String),
    ShowWindow,
    QuitApplication,
    // A list of audio devices, received from the microphone thread
    // because CPAL can't be called from the same thread as the GUI
    // under Windows
    DevicesList(Box<Vec<DeviceListItem>>),
    #[cfg(feature = "gui")]
    UpdatePreference(Preferences),
    NetworkStatus(bool),  // Is the network reachable?
    RateLimitState(bool), // Are we rate-limited?
    #[cfg(feature = "gui")]
    WipeSongHistory,
    #[cfg(feature = "gui")]
    AppendToLog(String),
    RecognitionBenchmarkUpdate(RecognitionBenchmarkSnapshot),
    MicrophoneRecording,
    MicrophoneVolumePercent(f32),
    SongRecognized(Box<SongRecognizedMessage>),
}

pub enum MicrophoneMessage {
    MicrophoneRecordStart(String), // The argument is the audio device name
    RefreshDevices,
    MicrophoneRecordStop,
    ProcessingDone,
}

pub enum ProcessingMessage {
    ProcessAudioFile(String),
    ProcessAudioSampleBatch(Box<Vec<Vec<i16>>>),
}

pub enum HTTPMessage {
    RecognizeSignature {
        signature: Box<DecodedSignature>,
        stabilize: bool,
        source_file: Option<String>,
    },
    RecognizeSignatureBatch {
        signatures: Box<Vec<DecodedSignature>>,
        stabilize: bool,
        audio_batches: Option<Box<Vec<Vec<i16>>>>,
    },
    ResetBenchmark,
}
