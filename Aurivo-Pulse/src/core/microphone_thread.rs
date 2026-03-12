use std::sync::{Arc, Mutex};

use crate::core::thread_messages::{MicrophoneMessage::*, *};
use crate::gui::preferences::PreferencesInterface;

use cpal::platform::Device;
use cpal::traits::{DeviceTrait, StreamTrait};
use cpal::FromSample;
use gettextrs::gettext;

use crate::audio_controllers::audio_backend::get_any_backend;

const MAX_BUFFER_SIZE: usize = 512;
const RECOGNITION_SLICE_SAMPLES: usize = 12 * 16000;
const RECOGNITION_SLICE_STEP_SAMPLES: usize = 2 * 16000;
const RECOGNITION_CANDIDATE_COUNT: usize = 3;
const RECOGNITION_CANDIDATE_MIN_GAP_SAMPLES: usize = 4 * 16000;
const MIN_SIGNAL_PEAK_FOR_RECOGNITION: i16 = 20;
const MIN_SIGNAL_AVG_FOR_RECOGNITION: f32 = 6.0;
const TARGET_RECOGNITION_PEAK: f32 = 14000.0;
const MAX_RECOGNITION_GAIN: f32 = 16.0;

#[derive(Clone, Copy)]
struct RecognitionTuning {
    candidate_count: usize,
    candidate_min_gap_samples: usize,
    slice_step_samples: usize,
}

fn current_recognition_tuning() -> RecognitionTuning {
    let profile = std::env::var("AURIVO_PULSE_BACKGROUND_PROFILE")
        .unwrap_or_default()
        .trim()
        .to_lowercase();
    let background_mode = std::env::var("AURIVO_PULSE_BACKGROUND_MODE")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);

    if profile == "max" {
        RecognitionTuning {
            candidate_count: 7,
            candidate_min_gap_samples: 16000,
            slice_step_samples: 16000 / 2,
        }
    } else if background_mode || profile == "background" {
        RecognitionTuning {
            candidate_count: 5,
            candidate_min_gap_samples: 2 * 16000,
            slice_step_samples: 16000,
        }
    } else {
        RecognitionTuning {
            candidate_count: RECOGNITION_CANDIDATE_COUNT,
            candidate_min_gap_samples: RECOGNITION_CANDIDATE_MIN_GAP_SAMPLES,
            slice_step_samples: RECOGNITION_SLICE_STEP_SAMPLES,
        }
    }
}

fn score_recognition_slice(input: &[i16]) -> (f32, i16) {
    let mut peak_abs: i16 = 0;
    let mut sum_abs = 0.0f32;
    for sample in input {
        let abs = i32::from(*sample).abs() as i16;
        peak_abs = peak_abs.max(abs);
        sum_abs += f32::from(abs);
    }
    let avg_abs = if input.is_empty() {
        0.0
    } else {
        sum_abs / input.len() as f32
    };
    // Ortalama enerji + tepe kombinasyonu, sabit fon müziği konuşma parçalarına göre öne çıkarır.
    (avg_abs + (f32::from(peak_abs) * 0.35), peak_abs)
}

fn normalize_recognition_slice(input: &[i16]) -> Option<Vec<i16>> {
    let peak_abs = input
        .iter()
        .map(|s| i32::from(*s).abs() as i16)
        .max()
        .unwrap_or(0);

    let avg_abs = if input.is_empty() {
        0.0
    } else {
        input
            .iter()
            .map(|sample| i32::from(*sample).abs() as f32)
            .sum::<f32>()
            / input.len() as f32
    };

    if peak_abs < MIN_SIGNAL_PEAK_FOR_RECOGNITION && avg_abs < MIN_SIGNAL_AVG_FOR_RECOGNITION {
        return None;
    }

    let gain = (TARGET_RECOGNITION_PEAK / f32::from(peak_abs)).clamp(1.0, MAX_RECOGNITION_GAIN);
    if gain <= 1.01 {
        return Some(input.to_vec());
    }

    let mut out = Vec::with_capacity(input.len());
    for sample in input {
        let boosted = (*sample as f32) * gain;
        let clamped = boosted.clamp(i16::MIN as f32, i16::MAX as f32).round() as i16;
        out.push(clamped);
    }
    Some(out)
}

fn prepare_recognition_candidates(input: &[i16]) -> Vec<Vec<i16>> {
    let tuning = current_recognition_tuning();
    if input.len() <= RECOGNITION_SLICE_SAMPLES {
        return normalize_recognition_slice(input).into_iter().collect();
    }

    let mut windows: Vec<(usize, f32)> = Vec::new();
    let mut cursor = 0usize;
    while cursor + RECOGNITION_SLICE_SAMPLES <= input.len() {
        let slice = &input[cursor..cursor + RECOGNITION_SLICE_SAMPLES];
        let (score, _) = score_recognition_slice(slice);
        windows.push((cursor, score));
        cursor += tuning.slice_step_samples;
    }
    windows.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    let mut starts: Vec<usize> = Vec::new();
    for (start, _) in windows {
        if starts.iter().any(|picked| picked.abs_diff(start) < tuning.candidate_min_gap_samples) {
            continue;
        }
        starts.push(start);
        if starts.len() >= tuning.candidate_count {
            break;
        }
    }
    if starts.is_empty() {
        starts.push(input.len() - RECOGNITION_SLICE_SAMPLES);
    }
    starts.sort_unstable();

    starts
        .into_iter()
        .filter_map(|start| normalize_recognition_slice(&input[start..start + RECOGNITION_SLICE_SAMPLES]))
        .collect()
}

pub fn microphone_thread(
    microphone_rx: async_channel::Receiver<MicrophoneMessage>,
    processing_tx: async_channel::Sender<ProcessingMessage>,
    gui_tx: async_channel::Sender<GUIMessage>,
    preferences_interface: Arc<Mutex<PreferencesInterface>>,
) {
    // Use the default host for working with audio devices.

    let host = cpal::default_host();

    let mut backend = get_any_backend();

    // Run the input stream on a separate thread.

    let mut stream: Option<cpal::Stream> = None;

    let processing_already_ongoing: Arc<Mutex<bool>> = Arc::new(Mutex::new(false)); // Whether our data is already being processed in other threads (pointer to a bool shared between this thread and the CPAL thread, hence the Arc<Mutex>)

    // Send a list of the active microphone-alike devices to the GUI thread
    // (the combo box will be filed with device names when a "DevicesList"
    // inter-thread message will be received at the initialization of the
    // microphone thread, because CPAL which underlies Rodio can't be called
    // from the same thread as the microphone thread under Windows, see:
    //  - https://github.com/RustAudio/rodio/issues/270
    //  - https://github.com/RustAudio/rodio/issues/214 )

    let device_names: Vec<DeviceListItem> = backend.list_devices(&host);

    gui_tx
        .try_send(GUIMessage::DevicesList(Box::new(device_names)))
        .unwrap();

    // Process ingress inter-thread messages (stopping or starting
    // recording from the microphone, and knowing from which device
    // in particular)

    while let Ok(message) = microphone_rx.recv_blocking() {
        match message {
            MicrophoneRecordStart(device_name) => {
                let processing_tx_2 = processing_tx.clone();
                let gui_tx_2 = gui_tx.clone();
                let gui_tx_3 = gui_tx.clone();
                let gui_tx_4 = gui_tx.clone();

                let err_fn = move |error: Box<dyn std::error::Error>| {
                    gui_tx_2
                        .try_send(GUIMessage::ErrorMessage(format!(
                            "{} {}",
                            gettext("Audio error:"),
                            error
                        )))
                        .unwrap();
                };

                let err_fn_2 = err_fn.clone();
                let err_fn_3 = err_fn.clone();
                let err_fn_cb = move |error: cpal::StreamError| {
                    err_fn_2(Box::new(error));
                };

                let device: Device = backend.set_device(&host, &device_name);

                let config = match device.default_input_config() {
                    Ok(res) => res,
                    Err(err) => {
                        err_fn_3(Box::new(err));
                        return;
                    }
                };
                let channels = config.channels();
                let sample_rate = config.sample_rate();

                let mut twelve_seconds_buffer: Vec<i16> = vec![0i16; 16000 * MAX_BUFFER_SIZE];
                let mut number_unprocessed_samples: usize = 0; // Sample count for the interval of doing Shazam recognition (every 4 seconds)
                let mut number_unmeasured_samples: usize = 0; // Sample count for doing volume measurement (every 24th of second)

                let processing_already_ongoing_2 = processing_already_ongoing.clone();

                let preferences_interface = preferences_interface.clone();
                stream = Some(match config.sample_format() {
                    cpal::SampleFormat::F32 => match device.build_input_stream(
                        &config.into(),
                        move |data, _: &_| {
                            write_data::<f32, f32>(
                                data,
                                &processing_tx_2,
                                gui_tx_3.clone(),
                                channels,
                                sample_rate,
                                &mut twelve_seconds_buffer,
                                &mut number_unprocessed_samples,
                                &mut number_unmeasured_samples,
                                &processing_already_ongoing_2,
                                &preferences_interface,
                            )
                        },
                        err_fn_cb,
                        None,
                    ) {
                        Ok(res) => res,
                        Err(err) => {
                            err_fn_3(Box::new(err));
                            return;
                        }
                    },
                    cpal::SampleFormat::I16 => match device.build_input_stream(
                        &config.into(),
                        move |data, _: &_| {
                            write_data::<i16, i16>(
                                data,
                                &processing_tx_2,
                                gui_tx_3.clone(),
                                channels,
                                sample_rate,
                                &mut twelve_seconds_buffer,
                                &mut number_unprocessed_samples,
                                &mut number_unmeasured_samples,
                                &processing_already_ongoing_2,
                                &preferences_interface,
                            )
                        },
                        err_fn_cb,
                        None,
                    ) {
                        Ok(res) => res,
                        Err(err) => {
                            err_fn_3(Box::new(err));
                            return;
                        }
                    },
                    cpal::SampleFormat::U16 => match device.build_input_stream(
                        &config.into(),
                        move |data, _: &_| {
                            write_data::<u16, i16>(
                                data,
                                &processing_tx_2,
                                gui_tx_3.clone(),
                                channels,
                                sample_rate,
                                &mut twelve_seconds_buffer,
                                &mut number_unprocessed_samples,
                                &mut number_unmeasured_samples,
                                &processing_already_ongoing_2,
                                &preferences_interface,
                            )
                        },
                        err_fn_cb,
                        None,
                    ) {
                        Ok(res) => res,
                        Err(err) => {
                            err_fn_3(Box::new(err));
                            return;
                        }
                    },
                    _ => unreachable!(),
                });

                stream.as_ref().unwrap().play().unwrap();

                // Re-call the function in the case the backend is PulseBackend,
                // because we may have appeared in the list of PulseAudio's
                // source outputs now
                backend.set_device(&host, &device_name);

                gui_tx_4.try_send(GUIMessage::MicrophoneRecording).unwrap();
            }

            RefreshDevices => {
                let device_names: Vec<DeviceListItem> = backend.list_devices(&host);

                gui_tx
                    .try_send(GUIMessage::DevicesList(Box::new(device_names)))
                    .unwrap();
            }

            MicrophoneRecordStop => {
                if let Some(some_stream) = stream {
                    drop(some_stream);
                }

                stream = None;
            }

            ProcessingDone => {
                let mut processing_already_ongoing_borrow =
                    processing_already_ongoing.lock().unwrap();
                *processing_already_ongoing_borrow = false;
            }
        }
    }
}

fn write_data<T, U>(
    input_samples: &[T],
    processing_tx: &async_channel::Sender<ProcessingMessage>,
    gui_tx: async_channel::Sender<GUIMessage>,
    channels: u16,
    sample_rate: u32,
    twelve_seconds_buffer: &mut [i16],
    number_unprocessed_samples: &mut usize,
    number_unmeasured_samples: &mut usize,
    processing_already_ongoing: &Arc<Mutex<bool>>,
    preferences_interface: &Arc<Mutex<PreferencesInterface>>,
) where
    T: cpal::Sample + rodio::Sample,
    U: cpal::Sample,
    i16: FromSample<T>,
{
    // Reassemble data into a 12-second buffer, and do recognition
    // every 4 seconds if the queue to "processing_tx" is empty

    let input_buffer =
        rodio::buffer::SamplesBuffer::new::<&[T]>(channels, sample_rate, input_samples);

    let converted_file = rodio::source::UniformSourceIterator::new(input_buffer, 1, 16000);

    let raw_pcm_samples: Vec<i16> = converted_file.collect();

    let preferences = preferences_interface.lock().unwrap().preferences.clone();
    let buffer_size_secs = preferences.buffer_size_secs.unwrap() as usize;
    let request_interval_secs = preferences.request_interval_secs_v3.unwrap() as usize;

    let twelve_seconds_buffer = &mut twelve_seconds_buffer[..16000 * buffer_size_secs];

    // Update our buffer with data from CPAL

    if raw_pcm_samples.len() >= 16000 * buffer_size_secs {
        twelve_seconds_buffer
            .copy_from_slice(&raw_pcm_samples[raw_pcm_samples.len() - 16000 * buffer_size_secs..]);
    } else {
        let latter_data = twelve_seconds_buffer[raw_pcm_samples.len()..].to_vec();

        twelve_seconds_buffer[..16000 * buffer_size_secs - raw_pcm_samples.len()]
            .copy_from_slice(&latter_data);
        twelve_seconds_buffer[16000 * buffer_size_secs - raw_pcm_samples.len()..]
            .copy_from_slice(&raw_pcm_samples);
    }

    *number_unprocessed_samples += raw_pcm_samples.len();

    let mut processing_already_ongoing_borrow = processing_already_ongoing.lock().unwrap();

    if *number_unprocessed_samples >= 16000 * request_interval_secs
        && *processing_already_ongoing_borrow == false
    {
        if !twelve_seconds_buffer.iter().all(|x| *x == 0) {
            let recognition_candidates = prepare_recognition_candidates(twelve_seconds_buffer);
            if !recognition_candidates.is_empty() {
                processing_tx
                    .try_send(ProcessingMessage::ProcessAudioSampleBatch(Box::new(
                        recognition_candidates,
                    )))
                    .unwrap();

                *processing_already_ongoing_borrow = true;
            }
        }

        *number_unprocessed_samples = 0;
    }

    // Do microphone volume measurement every 24th of second (so that we can
    // update it at 24 FPS) and over the last two 100th of second (so that we
    // can be sure to measure volume for at most 100 Hz)

    *number_unmeasured_samples += raw_pcm_samples.len();

    if *number_unmeasured_samples >= 16000 / 24 {
        let mut max_s16le_amplitude: i16 = 1;

        for index in 16000 * buffer_size_secs - 16000 / 100 * 2..16000 * buffer_size_secs {
            let abs_amp = (i32::from(twelve_seconds_buffer[index]).abs() as i16).max(1);
            if abs_amp > max_s16le_amplitude {
                max_s16le_amplitude = abs_amp;
            }
        }

        let max_s16le_volume_fraction = max_s16le_amplitude as f32 / 32767.0; // 32767 is the maximum value for an i16 (2**15 - 1)

        gui_tx
            .try_send(GUIMessage::MicrophoneVolumePercent(
                max_s16le_volume_fraction * 100.0,
            ))
            .unwrap();

        *number_unmeasured_samples = 0;
    }
}
