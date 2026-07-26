'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const main = read('main.js');
const nativeVisualizer = read('visualizer/main_imgui.cpp');
const cmake = read('visualizer/CMakeLists.txt');

assert.match(main, /getLinuxMainWindowX11Id/);
assert.match(main, /getNativeWindowHandle/);
assert.match(main, /env\.ARDALI_VIS_PARENT_XID = parentXid/);
assert.match(main, /ARDALI_VIS_DESKTOP_ENTRY/);
assert.match(main, /proc\.stdin\?\.end/);
assert.match(main, /signalVisualizerProcess\(proc, 'SIGTERM'\)/);
assert.match(main, /signalVisualizerProcess\(proc, 'SIGKILL'\)/);
assert.match(main, /visualizerStopTimer/);
assert.match(main, /function stopVisualizerAndWait\(\)/);
assert.match(main, /stopVisualizer\(\{ keepFallbackReferenced: true \}\)/);
assert.match(main, /criticalQuitCleanupInProgress/);
assert.match(nativeVisualizer, /applyElectronOwnerWindow\(g\.window\)/);
assert.match(nativeVisualizer, /XSetTransientForHint\(display, child, parent\)/);
assert.match(nativeVisualizer, /SDL_VIDEO_WAYLAND_WMCLASS/);
assert.match(nativeVisualizer, /SDL_WINDOW_RESIZABLE/);
assert.match(nativeVisualizer, /SDL_SetWindowFullscreen/);
assert.match(cmake, /find_package\(X11 REQUIRED\)/);
assert.match(cmake, /ARDALI_HAVE_X11_OWNER=1/);

console.log('projectM window integration invariants: ok');
