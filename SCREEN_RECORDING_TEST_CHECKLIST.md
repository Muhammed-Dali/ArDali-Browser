# Screen Recording Test Checklist

## Core Recording
- [ ] Run preflight with the default screen source.
- [ ] Start a normal WebM recording for at least 10 seconds.
- [ ] Stop recording and confirm validation finishes.
- [ ] Play the saved file from the post-recording panel.
- [ ] Open the output folder from the post-recording panel.

## Audio
- [ ] Record silent mode.
- [ ] Record microphone only.
- [ ] Record desktop audio only.
- [ ] Record desktop + microphone mix.
- [ ] Enable separate audio tracks and save MKV output.
- [ ] Enable mic monitor with headphones and confirm volume control works.

## Studio Scene Flow
- [ ] Add a second scene and verify it has its own source list.
- [ ] Add text/camera/image/media source to one scene only.
- [ ] Switch scenes and confirm sources change.
- [ ] Lock a source and confirm it cannot be dragged.
- [ ] Trigger fade/slide transition while recording and confirm it appears in output.

## Output Formats And Encoders
- [ ] Record WebM.
- [ ] Record MKV.
- [ ] Record MP4.
- [ ] Select x264 CPU and confirm MP4 finalizes.
- [ ] Select unavailable hardware encoder and confirm preflight blocks recording.
- [ ] If available, test NVENC/VAAPI/QSV.

## Reliability
- [ ] Use the Test button and confirm a 5 second recording is validated.
- [ ] Trigger auto-stop with a short duration.
- [ ] Schedule a delayed recording.
- [ ] Start replay buffer, save replay, and validate output.
- [ ] Run manual Remux to MKV.
- [ ] Run manual Remux to MP4.
- [ ] Run manual Onar on the latest recording.
- [ ] Simulate a bad file and confirm auto repair attempts a repaired output.

## Advanced Outputs
- [ ] Prepare RTMP output with invalid settings and confirm errors are readable.
- [ ] Start/stop virtual camera panel flow.
- [ ] Confirm health panel updates CPU/RAM/FPS/write-rate while recording.

## Plugins
- [ ] Add a plugin manifest under `~/.config/aurivo/video-studio-plugins`.
- [ ] Click the plugin reload button.
- [ ] Confirm plugin templates appear in the template panel.
- [ ] Apply a plugin template and verify sources are sanitized and added.

## UI Polish
- [ ] Check studio layout at narrow window width.
- [ ] Confirm top recording buttons wrap instead of overflowing.
- [ ] Confirm quick action buttons do not overflow.
- [ ] Confirm long file names truncate in the post-recording panel.
