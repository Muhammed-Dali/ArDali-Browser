use crate::core::thread_messages::{ProcessingMessage::*, *};

use crate::fingerprinting::algorithm::SignatureGenerator;
use crate::fingerprinting::signature_format::DecodedSignature;

pub fn processing_thread(
    processing_rx: async_channel::Receiver<ProcessingMessage>,
    http_tx: async_channel::Sender<HTTPMessage>,
    gui_tx: async_channel::Sender<GUIMessage>,
) {
    while let Ok(message) = processing_rx.recv_blocking() {
        match message {
            ProcessAudioFile(input_file_string) => match SignatureGenerator::make_signature_from_file(&input_file_string) {
                Ok(signature) => {
                    http_tx
                        .try_send(HTTPMessage::RecognizeSignature {
                            signature: Box::new(signature),
                            stabilize: false,
                            source_file: Some(input_file_string),
                        })
                        .unwrap();
                }
                Err(error) => {
                    gui_tx
                        .try_send(GUIMessage::ErrorMessage(error.to_string()))
                        .unwrap();
                }
            },
            ProcessAudioSampleBatch(audio_batches) => {
                let signatures: Vec<DecodedSignature> = audio_batches
                    .iter()
                    .map(|samples| SignatureGenerator::make_signature_from_buffer(samples))
                    .collect();
                http_tx
                    .try_send(HTTPMessage::RecognizeSignatureBatch {
                        signatures: Box::new(signatures),
                        stabilize: true,
                        audio_batches: Some(audio_batches),
                    })
                    .unwrap();
            }
        }
    }

    processing_rx.close();
}
