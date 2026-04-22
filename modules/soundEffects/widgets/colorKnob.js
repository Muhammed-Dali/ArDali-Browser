class ColorKnob {
    constructor(canvas, config = {}) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', { alpha: true });
        
        // Configuration
        this.label = config.label || '';
        this.minValue = config.minValue !== undefined ? config.minValue : (config.min !== undefined ? config.min : -10);
        this.maxValue = config.maxValue !== undefined ? config.maxValue : (config.max !== undefined ? config.max : 10);
        this.value = config.value !== undefined ? config.value : 0;
        this.stepSize = config.stepSize !== undefined ? config.stepSize : 0.1;
        this.decimals = config.decimals !== undefined ? config.decimals : 1;
        this.suffix = config.suffix || ' dB'; // dB, %, etc.
        this.wheelStep = config.wheelStep || 0.5;
        this.wheelDebounceMs = Number.isFinite(config.wheelDebounceMs) ? Math.max(24, config.wheelDebounceMs) : 72;
        this.wheelLiveNotify = config.wheelLiveNotify === true;
        // Drag sensitivity: if set, dragging across this many pixels covers full range
        // (useful for large-range controls like PEQ frequency).
        this.dragRangePx = Number.isFinite(config.dragRangePx) ? config.dragRangePx : null;

        // State variables matching C++ implementation
        this.shift = 0;
        this.isDragging = false;
        this.isHovered = false;
        this.lastPos = { x: 0, y: 0 };
        this.targetValue = this.value; // For smooth animation
        
        // Callbacks
        this.listeners = [];
        this.lastNotifyTime = 0;
        this.lastInputMode = 'program';
        this._wheelIdleTimer = null;

        // Setup events
        this.setupEvents();
        
        // Start animation loop
        this.lastTime = performance.now();
        this._running = false;
        this.startAnimation();
    }
    
    static _runningInstances = new Set();
    static _sharedRafId = null;
    static _sharedTick = (timestamp) => {
        let hasRunning = false;
        ColorKnob._runningInstances.forEach((inst) => {
            if (!inst || !inst._running) return;
            hasRunning = true;
            inst.animate(timestamp);
        });

        if (hasRunning) {
            ColorKnob._sharedRafId = requestAnimationFrame(ColorKnob._sharedTick);
        } else {
            ColorKnob._sharedRafId = null;
        }
    };

    static _ensureSharedLoop() {
        if (ColorKnob._sharedRafId !== null) return;
        ColorKnob._sharedRafId = requestAnimationFrame(ColorKnob._sharedTick);
    }

    setRange(min, max) {
        this.minValue = min;
        this.maxValue = max;
    }

    setValue(val, instant = false, inputMode = 'program') {
        let clamped = Math.min(Math.max(val, this.minValue), this.maxValue);
        if (this.stepSize > 0) {
            clamped = Math.round(clamped / this.stepSize) * this.stepSize;
            clamped = Math.min(Math.max(clamped, this.minValue), this.maxValue);
        }
        this.lastInputMode = String(inputMode || 'program');
        
        this.targetValue = clamped;
        
        if (instant) {
            this.value = this.targetValue;
            this.notifyListeners();
        }
        
        // Instant set if large jump (fallback)
        if (!instant && Math.abs(this.value - this.targetValue) > (this.maxValue - this.minValue)) {
             this.value = this.targetValue;
        }
    }

    getValue() {
        return this.value;
    }

    onChange(callback) {
        this.listeners.push(callback);
    }

    notifyListeners() {
        this.listeners.forEach(cb => cb(this.value));
    }

    setupEvents() {
        // Mouse Down
        this.canvas.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return; // Only left click
            this.isDragging = true;
            const rect = this.canvas.getBoundingClientRect();
            this.lastPos = {
                x: e.clientX - rect.left,
                y: e.clientY - rect.top
            };
            this.canvas.focus();
            // Capture locking if needed, usually window events handle drag better
            window.addEventListener('mousemove', this.handleWindowMouseMove);
            window.addEventListener('mouseup', this.handleWindowMouseUp);
        });

        // Wheel
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY;
            if (delta === 0) return;
            
            const stepDirection = delta > 0 ? -1 : 1; // Wheel down (pos) decreases in standard UI usually, but verify C++ logic
            // C++: delta > 0 ? 1 : -1 -> Qt wheel delta is positive usually when scrolling away (up)
            // But DOM deltaY is positive when scrolling down. So invert.
            
            let step = this.wheelStep;
            if (e.shiftKey) step *= 0.25;
            
            const target = this.value + stepDirection * step;
            this.setValue(target);
        });

        // Hover effects
        this.canvas.addEventListener('mouseenter', () => { this.isHovered = true; });
        this.canvas.addEventListener('mouseleave', () => { this.isHovered = false; });
    }

    handleWindowMouseMove = (e) => {
        if (!this.isDragging) return;
        
        // Calculate delta based on screen movement
        // We need client coordinates since we attached to window
        // But we need to compare with last known relative or absolute position
        // Simplest is to just track movement.
        
        // Using movementX/Y is easier but let's stick to C++ logic logic manually
        // C++: deltaY = last.y - current.y
        // We need rect to get current local pos? No, just delta is enough.
        
        // Note: C++ uses widget-relative coordinates.
        // Let's use movement properties if available, or calc delta.
        
        // Simpler: Just use clientX/Y difference from previous frame
        // But since lastPos was relative to canvas, let's update it to be global for dragging or keep it relative?
        // Let's just use movement deltas.
        
        const deltaY = (this.lastDragY !== undefined ? this.lastDragY : e.clientY) - e.clientY; 
        const deltaX = e.clientX - (this.lastDragX !== undefined ? this.lastDragX : e.clientX);
        
        // Wait, better implementation:
        // On mousedown, store clientX/Y.
        // On mousemove, calc diff, then update stored clientX/Y.
        
        // Re-implementing correctly:
    }
    
    // Bind these bound functions in constructor or class properties
    handleWindowMouseMove = (e) => {
        if (!this.isDragging) return;
        
        // C++ Logic:
        // float deltaY = m_lastPos.y() - event->position().y();
        // float deltaX = event->position().x() - m_lastPos.x();
        // deltaY += deltaX * 0.35f;
        
        // Since we are listening on window, e.clientY is global.
        // We need to compare with previous global position.
        
        if (this.dragStartGlobal) {
            const dy = this.dragStartGlobal.y - e.clientY; // Up is positive in C++ logic for value inc?
            const dx = e.clientX - this.dragStartGlobal.x;
            
            // Sensitive usually means dragging UP increases value.
            // ClientY increases DOWN. So lastY - currY is correct for "Drag Up to Increase".
            
            let effectiveDelta = dy + dx * 0.35;

            // If dragRangePx is configured, map drag distance to full range.
            if (this.dragRangePx && this.dragRangePx > 0) {
                let dragRangePx = this.dragRangePx;
                if (e.shiftKey) dragRangePx *= 2.5;

                const range = this.maxValue - this.minValue;
                const valueDelta = (effectiveDelta / dragRangePx) * range;

                if (Math.abs(valueDelta) >= this.stepSize) {
                    const newValue = this.value + valueDelta;
                    this.setValue(newValue, true, 'drag');
                    this.dragStartGlobal = { x: e.clientX, y: e.clientY };
                }
                return;
            }

            // Default (legacy) drag behavior: pixels -> steps -> stepSize
            let pixelsPerStep = 3.0; // From C++
            if (e.shiftKey) pixelsPerStep *= 2.5;

            const steps = effectiveDelta / pixelsPerStep;

            if (Math.abs(steps) >= 1) {
                const newValue = this.value + steps * this.stepSize;
                this.setValue(newValue, true, 'drag');
                this.dragStartGlobal = { x: e.clientX, y: e.clientY };
            }
        }
    }
    
    handleWindowMouseUp = (e) => {
        this.isDragging = false;
        window.removeEventListener('mousemove', this.handleWindowMouseMove);
        window.removeEventListener('mouseup', this.handleWindowMouseUp);
        this.dragStartGlobal = null;
    }

    setupEvents() {
        this.canvas.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            this.isDragging = true;
            this.dragStartGlobal = { x: e.clientX, y: e.clientY };
            window.addEventListener('mousemove', this.handleWindowMouseMove);
            window.addEventListener('mouseup', this.handleWindowMouseUp);
        });

        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            // DOM: deltaY > 0 -> Scroll Down (User pulls wheel towards them) -> Usually Decrease
            // C++: delta > 0 -> Up -> stepDirection = 1 (Increase)
            // So DOM deltaY > 0 should be Decrease.
            
            const stepDirection = e.deltaY > 0 ? -1 : 1;
            let step = this.wheelStep;
            if (e.shiftKey) step *= 0.25;
            
            this.setValue(this.value + stepDirection * step, false, 'wheel');
            if (this._wheelIdleTimer) clearTimeout(this._wheelIdleTimer);
            this._wheelIdleTimer = setTimeout(() => {
                this._wheelIdleTimer = null;
                this.value = this.targetValue;
                this.notifyListeners();
                this.lastNotifyTime = (typeof performance !== 'undefined' && typeof performance.now === 'function')
                    ? performance.now()
                    : Date.now();
            }, this.wheelDebounceMs);
        });
        
        this.canvas.addEventListener('mouseenter', () => this.isHovered = true);
        this.canvas.addEventListener('mouseleave', () => this.isHovered = false);
    }
    
    startAnimation() {
        if (this._running) return;
        this._running = true;
        this.lastTime = performance.now();
        ColorKnob._runningInstances.add(this);
        ColorKnob._ensureSharedLoop();
    }

    stopAnimation() {
        this._running = false;
        ColorKnob._runningInstances.delete(this);
    }

    setActive(active) {
        if (active) this.startAnimation();
        else this.stopAnimation();
    }

    destroy() {
        this.stopAnimation();
        if (this._wheelIdleTimer) {
            clearTimeout(this._wheelIdleTimer);
            this._wheelIdleTimer = null;
        }
        window.removeEventListener('mousemove', this.handleWindowMouseMove);
        window.removeEventListener('mouseup', this.handleWindowMouseUp);
    }

    animate(timestamp) {
        if (!this._running) return;
        // Calculate delta time
        const dt = timestamp - this.lastTime;
        
        // 1. Color Shift Animation
        if (!this.isSfxLightsOff()) {
            this.shift += 0.0004 * dt;
            if (this.shift > 1.0) this.shift -= 1.0;
        }
        
        // 2. Value Smoothing (Inertia)
        const diff = this.targetValue - this.value;
        if (Math.abs(diff) > 0.001) {
            // Speed factor: Increased to 0.4 for faster wheel/ipc response
            const ease = 0.4; 
            this.value += diff * ease;
            
            // Notify listener (Throttled set to ~45fps = 22ms)
            const allowRealtimeNotify = this.lastInputMode !== 'wheel' || this.wheelLiveNotify;
            if (allowRealtimeNotify && (timestamp - this.lastNotifyTime > 22)) {
                this.notifyListeners();
                this.lastNotifyTime = timestamp;
            }
        } else if (Math.abs(diff) > 0) {
            this.value = this.targetValue;
            this.notifyListeners();
        }

        this.lastTime = timestamp;
        
        this.draw();
        
    }
    
    // Qt HSV to CSS RGB Helper
    // h: 0-360, s: 0-255, v: 0-255, a: 0-255
    hsvToRgb(h, s, v, a = 255) {
        s = s / 255;
        v = v / 255;
        const c = v * s;
        const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
        const m = v - c;
        
        let r = 0, g = 0, b = 0;
        
        if (0 <= h && h < 60) { r = c; g = x; b = 0; }
        else if (60 <= h && h < 120) { r = x; g = c; b = 0; }
        else if (120 <= h && h < 180) { r = 0; g = c; b = x; }
        else if (180 <= h && h < 240) { r = 0; g = x; b = c; }
        else if (240 <= h && h < 300) { r = x; g = 0; b = c; }
        else if (300 <= h && h < 360) { r = c; g = 0; b = x; }
        
        r = Math.round((r + m) * 255);
        g = Math.round((g + m) * 255);
        b = Math.round((b + m) * 255);
        
        return `rgba(${r}, ${g}, ${b}, ${a / 255})`;
    }
    
    rainbowColor(t, alpha, sat, val) {
        t = Math.max(0, Math.min(t, 1));
        if (this.isSfxLightsOff()) {
            return this.hsvToRgb(195, sat, val, alpha);
        }
        // float hue = fmod(m_shift * 360.0f + t * 300.0f, 360.0f);
        let hue = (this.shift * 360 + t * 300) % 360;
        return this.hsvToRgb(hue, sat, val, alpha);
    }

    isSfxLightsOff() {
        try {
            return document?.documentElement?.dataset?.sfxLights === 'off';
        } catch {
            return false;
        }
    }

    draw() {
        const ctx = this.ctx;
        const width = this.canvas.width;
        const height = this.canvas.height;
        
        // Clear background
        ctx.clearRect(0, 0, width, height);
        
        // C++: QRectF rect = this->rect().adjusted(6, 6, -6, -6);
        // C++: QRectF knobRect = rect.adjusted(0, 0, 0, -40);
        
        const padding = 6;
        const bottomPadding = 40;
        
        // Adjust for canvas size (assuming canvas matches widget size 130x170)
        // If canvas is different, we might need scaling. Let's assume 1:1 for now.
        
        const rectW = width - 12;
        const rectH = height - 12;
        
        const knobH = rectH - bottomPadding;
        
        const cx = 6 + rectW / 2;
        const cy = 6 + knobH / 2;
        // Adjusted radius: Slightly larger (-7 instead of -10) but manageable
        const radius = (Math.min(rectW, knobH) / 2) - 7;
        
        // Draw Outer Circle
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
        ctx.fillStyle = "#2a2a2a";
        ctx.fill();
        
        // Draw Inner Circle (Make the black ring thinner by increasing inner hole)
        // radius - 10 makes the ring 10px thick (was 16px)
        const innerRadius = radius - 10;
        ctx.beginPath();
        ctx.arc(cx, cy, innerRadius, 0, 2 * Math.PI);
        ctx.fillStyle = "#1f1f1f";
        ctx.fill();
        
        // Segments
        // C++: startAngle = 225 * 16 (Qt degrees * 16)
        // C++: totalSpan = -270 * 16
        // C++: drawArc uses 3 o'clock as 0, counter-clockwise positive.
        // 225 deg is South-West (7:30 o'clock)
        // -270 span means clockwise rotation to South-East (4:30 o'clock)
        
        // Canvas API: 0 is 3 o'clock, CLOCKWISE is positive.
        // We need to convert Qt angles to Canvas angles.
        // Qt 0 = Canvas 0 (3 o'clock)
        // Qt 90 = 12 o'clock, Canvas -90
        // Qt 180 = 9 o'clock, Canvas 180
        // Qt 225 = 7:30 o'clock. In Canvas this is 135 degrees (90+45) or (360-225 = 135).
        // Wait, Qt increases Counter-Clockwise. Canvas increases Clockwise.
        // Qt 225 = -225 in standard math? No Qt is standard math (CCW). Canvas is Clockwise (CW).
        // So Canvas Angle = - Qt Angle.
        // -225 = 135 deg.
        
        // Let's use Radiant logic directly based on visual.
        // Start: 135 degrees (South West) -> Math.PI * 0.75 ? No. 
        // 0 = East, 90 = South (Canvas).
        // 135 deg = South East.
        // We want South West.
        // South West is 135 degrees in Standard Math (CCW from East? No, 135 is NW).
        // Let's look at a clock.
        // 0deg = 3 o'clock.
        // 90deg = 6 o'clock (Canvas).
        // 135deg = 7:30 o'clock (South West). YES.
        
        // So Start Angle = 135 degrees (in Canvas radians).
        // Span = 270 degrees.
        // End Angle = 135 + 270 = 405 degrees (= 45 degrees = South East).
        
        const startAngleDeg = 135;
        const spanDeg = 270;
        const segs = 54;
        const segSpan = spanDeg / segs;
        
        // Ring Params
        // Adjust ring radius to be centered in the new thinner body
        // Body is 10px thick (radius to radius-10). Center is radius-5. Perfect.
        // But let's check dot placement to avoid clipping
        const arcRadius = radius - 5;
        
        const degToRad = (d) => d * (Math.PI / 180);
        
        ctx.lineWidth = 6; // Thinner rainbow track (was 8)
        ctx.lineCap = 'round';
        
        // Draw background segments (Full Range)
        for (let i = 0; i < segs; ++i) {
            const t = i / (segs - 1);
            ctx.beginPath();
            
            // Canvas Arc: start, end.
            const angleStart = startAngleDeg + (i * segSpan);
            const angleEnd = angleStart + segSpan - 1.5; // Little gap for segment effect
            // C++ uses segSpan exactly, but drawArc might handle it differently.
            // Let's try continuous first or with gaps.
            // C++ line width 8.
            
            ctx.arc(cx, cy, arcRadius, degToRad(angleStart), degToRad(angleEnd)); // Canvas is CW
            
            // Background is now dark solid, not rainbow
            ctx.strokeStyle = "rgba(40, 40, 40, 0.6)";
            ctx.stroke();
        }
        
        // Draw active segments
        const span = this.maxValue - this.minValue;
        const valNorm = (span === 0) ? 0 : Math.max(0, Math.min((this.value - this.minValue) / span, 1));
        
        const activeF = valNorm * segs;
        const activeFull = Math.floor(activeF);
        const activeRem = activeF - activeFull;
        
        for (let i = 0; i < Math.min(segs, activeFull); ++i) {
            const t = i / (segs - 1);
            ctx.beginPath();
            const angleStart = startAngleDeg + (i * segSpan);
            const angleEnd = angleStart + segSpan - 1; // Gap
            ctx.arc(cx, cy, arcRadius, degToRad(angleStart), degToRad(angleEnd));
            ctx.strokeStyle = this.rainbowColor(t, 235, 235, 255);
            ctx.stroke();
        }
        
        // Fractional Segment
        if (activeRem > 0 && activeFull < segs) {
            const t = activeFull / (segs - 1);
            ctx.beginPath();
            const angleStart = startAngleDeg + (activeFull * segSpan);
            const angleEnd = angleStart + (segSpan * activeRem) - 1; 
            
            // Handle very small segments
            if (angleEnd > angleStart) {
                ctx.arc(cx, cy, arcRadius, degToRad(angleStart), degToRad(angleEnd));
                ctx.strokeStyle = this.rainbowColor(t, 235, 235, 255);
                ctx.stroke();
            }
        }
        
        // Draw Indicator Dot
        // angle = 225 + (-270 * valNorm) (QT Degrees)
        // Convert to Rads for layout.
        // Qt 225 = Canvas 135 deg.
        // Qt -270 = Canvas +270 deg.
        // So Canvas Angle = 135 + (270 * valNorm).
        
        const dotAngleDeg = 135 + (270 * valNorm);
        const dotAngleRad = degToRad(dotAngleDeg);
        
        // x = cx + r * cos(a), y = cy + r * sin(a)
        // C++: dotY = cy - dotR * sin(a). Because Qt Y is down? 
        // Wait, C++ math: cos is x, -sin is y usually for CCW?
        // Let's stick to Canvas simple math: x = cx + r*cos, y = cy + r*sin (CW if Y is down).
        
        const dotR = radius - 5;
        const dotX = cx + dotR * Math.cos(dotAngleRad);
        const dotY = cy + dotR * Math.sin(dotAngleRad);
        
        let dotRadius = 6.6;
        if (this.isDragging) dotRadius += 1.1;
        else if (this.isHovered) dotRadius += 0.7;
        
        // Glow (Radial Gradient)
        // QRadialGradient glow(dotPos, dotRadius + 8)
        const glowR = dotRadius + 8;
        const grad = ctx.createRadialGradient(dotX, dotY, 0, dotX, dotY, glowR);
        const dotColorBase = this.rainbowColor(valNorm, 255, 235, 255); 
        // Need to parse RGB to add alpha for gradient
        // Assuming hsvToRgb returns rgba(r,g,b, a)
        
        // Let's modify rainbowColor to return object or helper
        // Quick dirty parsing or pass alpha to rainbowColor custom
        
        // dotColor with glow alpha
        let glowAlpha = this.isDragging ? 235 : (this.isHovered ? 205 : 170);
        const glowColorStr = this.rainbowColor(valNorm, glowAlpha, 235, 255);
        const glowColorEnd = this.rainbowColor(valNorm, 0, 235, 255);
        
        grad.addColorStop(0, glowColorStr);
        grad.addColorStop(1, glowColorEnd);
        
        ctx.beginPath();
        ctx.arc(dotX, dotY, glowR, 0, 2 * Math.PI);
        ctx.fillStyle = grad;
        ctx.fill();
        
        // Dot Ring
        const ringW = (this.isDragging || this.isHovered) ? 3 : 2;
        ctx.beginPath();
        ctx.arc(dotX, dotY, dotRadius, 0, 2 * Math.PI);
        ctx.lineWidth = ringW;
        ctx.strokeStyle = this.rainbowColor(valNorm, 255, 235, 255);
        ctx.fillStyle = "rgba(18, 18, 18, 0.92)"; // 235 alpha
        ctx.fill();
        ctx.stroke();
        
        // Dot Inner
        ctx.beginPath();
        ctx.arc(dotX, dotY, Math.max(1, dotRadius - 2.8), 0, 2 * Math.PI);
        ctx.fillStyle = "rgba(8, 8, 8, 1)";
        ctx.fill();
        
        // Shine/Highlight
        ctx.beginPath();
        ctx.arc(dotX - 1.4, dotY - 1.4, 1.8, 0, 2 * Math.PI);
        ctx.fillStyle = "rgba(255, 255, 255, 0.82)"; // 210 alpha
        ctx.fill();
        
        // Center decoration
        ctx.beginPath();
        ctx.arc(cx, cy, 6, 0, 2 * Math.PI);
        ctx.fillStyle = "#5a5a5a";
        ctx.fill();
        
        // Text rendering
        const knobBottom = (cy + radius) + 12; // Approximation from C++ rect
        // C++: QRect valueRect(0, knobBottom + 5, width, 26);
        
        // Value Text
        let valueText = "";
        if (this.label.toLowerCase().includes("stereo")) {
            valueText = `${Math.round(this.value)} %`;
        } else if (this.decimals > 0) {
            valueText = `${this.value.toFixed(this.decimals)}${this.suffix}`;
        } else {
            valueText = `${this.value.toFixed(1)} dB`;
        }
        
        ctx.font = "bold 14px Arial";
        ctx.fillStyle = "white";
        ctx.textAlign = "center";
        
        // In C++ knobBottom was relative to knob rect.
        // knobRect height was rect - 40.
        // So text is in that bottom 40px area.
        
        const textY = height - 30;
        ctx.fillText(valueText, width / 2, textY);
        
        // Label
        ctx.font = "9px Arial";
        ctx.fillStyle = "rgb(180, 180, 180)";
        ctx.fillText(this.label, width / 2, height - 10);
    }
}
