class RainbowSlider {
    constructor(canvas, config = {}) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', { alpha: true });
        
        // Configuration
        this.minValue = config.minValue !== undefined ? config.minValue : -12;
        this.maxValue = config.maxValue !== undefined ? config.maxValue : 12;
        this.value = config.value !== undefined ? config.value : 0;
        this.stepSize = config.stepSize !== undefined ? config.stepSize : 0.1;
        this.wheelStep = config.wheelStep || 0.5;
        this.frequency = config.frequency;
        const perf = (typeof window !== 'undefined' && window.__ARDALI_SFX_PERF__) || {};
        this.animatedHue = config.animatedHue === true && perf.lowPower !== true;
        this.frameMs = Number(config.frameMs || perf.widgetFrameMs || 33) || 33;
        this.lastDrawTime = 0;

        // State variables matching C++ implementation
        this.shift = 0;
        this.isDragging = false;
        this.isHovered = false;
        this.lastPos = { x: 0, y: 0 };
        this.targetValue = this.value; // For smooth animation
        this.lastNotifyTime = 0;
        
        // Callbacks
        this.listeners = [];

        // Setup
        this.setupEvents();
        
        // Start animation loop
        this.lastTime = performance.now();
        this._running = false;
        if (this.animatedHue) this.startAnimation();
        else this.draw();
    }

    static _runningInstances = new Set();
    static _sharedRafId = null;
    static _sharedTick = (timestamp) => {
        let hasRunning = false;
        RainbowSlider._runningInstances.forEach((inst) => {
            if (!inst || !inst._running) return;
            hasRunning = true;
            inst.animate(timestamp);
        });
        if (hasRunning) {
            RainbowSlider._sharedRafId = requestAnimationFrame(RainbowSlider._sharedTick);
        } else {
            RainbowSlider._sharedRafId = null;
        }
    };

    static _ensureSharedLoop() {
        if (RainbowSlider._sharedRafId !== null) return;
        RainbowSlider._sharedRafId = requestAnimationFrame(RainbowSlider._sharedTick);
    }

    setRange(min, max) {
        this.minValue = min;
        this.maxValue = max;
        // Keep current relative position or clamp?
        this.setValue(this.targetValue); 
    }

    setValue(val, opts = {}) {
        let clamped = Math.min(Math.max(val, this.minValue), this.maxValue);
        if (this.stepSize > 0) {
            clamped = Math.round(clamped / this.stepSize) * this.stepSize;
            clamped = Math.min(Math.max(clamped, this.minValue), this.maxValue);
        }
        
        this.targetValue = clamped;

        const shouldNotify = opts?.notify !== false;

        // Programmatic updates (UI hydration, preset apply) should not trigger onChange
        // via the animation loop. "immediate" snaps value to target and avoids notify.
        if (opts && opts.immediate) {
            this.value = this.targetValue;
            this.draw();
            return;
        }

        if (!this.animatedHue) {
            this.value = this.targetValue;
            this.draw();
            if (shouldNotify) this.notifyListeners();
            return;
        }
        
        // Instant update if uninitialized
        if (Math.abs(this.value - this.targetValue) > (this.maxValue - this.minValue)) {
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
        this.canvas.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            this.isDragging = true;
            this.handleInput(e.clientY);
            
            // Capture events outside canvas
            window.addEventListener('mousemove', this.handleWindowMouseMove);
            window.addEventListener('mouseup', this.handleWindowMouseUp);
        });

        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY;
            if (delta === 0) return;
            
            // C++: delta > 0 is UP (away user) -> +1
            // DOM: deltaY < 0 is UP (scroll up)
            // So if deltaY < 0 -> Increase
            
            const stepDirection = e.deltaY < 0 ? 1 : -1;
            let step = this.wheelStep;
            if (e.shiftKey) step *= 0.25;
            
            this.setValue(this.value + stepDirection * step, { notify: true });
        });

        this.canvas.addEventListener('mouseenter', () => {
            this.isHovered = true;
            if (!this.animatedHue) this.draw();
        });
        this.canvas.addEventListener('mouseleave', () => {
            this.isHovered = false;
            if (!this.animatedHue) this.draw();
        });
    }
    
    handleWindowMouseMove = (e) => {
        if (!this.isDragging) return;
        
        // We need clientY relative to canvas rect
        const rect = this.canvas.getBoundingClientRect();
        // Since event is global, e.clientY is relative to viewport.
        // But handleInput expects relative Y? Or global Y?
        
        // Wait, handleInput implementation below should handle relative calc logic
        // Let's pass ClientY and let handleInput do math against Rect.
        
        this.handleInput(e.clientY);
    }
    
    handleWindowMouseUp = (e) => {
        this.isDragging = false;
        window.removeEventListener('mousemove', this.handleWindowMouseMove);
        window.removeEventListener('mouseup', this.handleWindowMouseUp);
    }
    
    handleInput(clientY) {
        const rect = this.canvas.getBoundingClientRect();
        const y = clientY - rect.top;
        
        const h = this.canvas.height; 
        
        // Check if canvas is scaled (DPI). Usually event is in CSS pixels.
        // rect.height is CSS pixels.
        // y is CSS pixels.
        // So we can compute ratio 0..1
        
        const top = 8;
        const bottom = rect.height - 8;
        const trackHeight = bottom - top;
        
        if (trackHeight <= 0) return;
        
        const pos = Math.max(top, Math.min(y, bottom));
        
        // 0 is Top (Max), Height is Bottom (Min) in typical sliders?
        // C++: top=8, bottom=h-8.
        // t = 1.0 - (pos-top)/trackHeight.
        // If pos = top (8), t=1.0.
        // If pos = bottom, t=0.0.
        // Value = min + t * (max - min).
        // So Top is MAX value. Bottom is MIN value.
        
        const t = 1.0 - (pos - top) / trackHeight;
        
        /* 
         Note: In browser, events are CSS pixels. 
         drawing is Canvas pixels. 
         If logic uses ratio 0..1, straightforward mapping works.
        */
        
        let target = this.minValue + t * (this.maxValue - this.minValue);
        this.setValue(target, { notify: true });
    }
    
    startAnimation() {
        if (!this.animatedHue) return;
        if (this._running) return;
        this._running = true;
        this.lastTime = performance.now();
        RainbowSlider._runningInstances.add(this);
        RainbowSlider._ensureSharedLoop();
        this.draw();
    }

    stopAnimation() {
        this._running = false;
        RainbowSlider._runningInstances.delete(this);
    }

    restartAnimation() {
        if (!this.animatedHue) {
            this.draw();
            return;
        }
        this.stopAnimation();
        this.lastTime = performance.now();
        this.startAnimation();
    }

    setActive(active) {
        if (!this.animatedHue) return;
        if (active) this.startAnimation();
        else this.stopAnimation();
    }

    destroy() {
        this.stopAnimation();
        window.removeEventListener('mousemove', this.handleWindowMouseMove);
        window.removeEventListener('mouseup', this.handleWindowMouseUp);
    }

    animate(timestamp) {
        if (!this._running) return;
        const dt = timestamp - this.lastTime;
        const diff = this.targetValue - this.value;
        const lightsOff = this.isSfxLightsOff();
        const hasMotion = Math.abs(diff) > 0.001 || this.isDragging || this.isHovered;
        if ((timestamp - this.lastDrawTime) < this.frameMs && !hasMotion) {
            this.lastTime = timestamp;
            return;
        }
        
        // C++: Every 50ms, shift += 0.02.
        // Rate: 0.02 / 50ms = 0.0004 per ms.
        if (!lightsOff) {
            this.shift += 0.0004 * dt;
            if (this.shift > 1.0) this.shift -= 1.0;
        }
        
        // Value Smoothing (Inertia)
        if (Math.abs(diff) > 0.001) {
            const ease = 0.25; 
            this.value += diff * ease;
            
            // Notify listener (Throttled)
            if (timestamp - this.lastNotifyTime > 32) {
                this.notifyListeners();
                this.lastNotifyTime = timestamp;
            }
        } else if (Math.abs(diff) > 0) {
            this.value = this.targetValue;
            this.notifyListeners();
        }

        this.lastTime = timestamp;
        this.lastDrawTime = timestamp;
        this.draw();
        
    }
    
    hsvToRgb(h, s, v, a = 255) {
        // Simple HSV to RGB conversion
        // input: h [0, 360], s [0, 255], v [0, 255]
        // output: rgba string
        
        let fC = v * s / (255 * 255); // s, v are 0-255 in C++ code provided (e.g. 210, 255)
        // Adjust for standard 0-1 range for s involved in math?
        // Wait, C++ QColor::fromHsv(h, s, v). s, v are 0-255.
        // Standard formula uses 0-1.
        
        let s_norm = s / 255.0;
        let v_norm = v / 255.0;
        
        let C = v_norm * s_norm;
        let H_prime = h / 60.0;
        let X = C * (1 - Math.abs((H_prime % 2) - 1));
        let m = v_norm - C;
        
        let r, g, b;
        if (H_prime < 1) { r = C; g = X; b = 0; }
        else if (H_prime < 2) { r = X; g = C; b = 0; }
        else if (H_prime < 3) { r = 0; g = C; b = X; }
        else if (H_prime < 4) { r = 0; g = X; b = C; }
        else if (H_prime < 5) { r = X; g = 0; b = C; }
        else { r = C; g = 0; b = X; }
        
        r = Math.round((r + m) * 255);
        g = Math.round((g + m) * 255);
        b = Math.round((b + m) * 255);
        
        return `rgba(${r}, ${g}, ${b}, ${a / 255})`;
    }

    ratio() {
        if (this.maxValue === this.minValue) return 0;
        return Math.max(0, Math.min((this.value - this.minValue) / (this.maxValue - this.minValue), 1));
    }
    
    colorAtRatio(r, alpha = 255, s = 220, v = 255) {
        const mode = this.getSfxLightMode();
        return this.hsvToRgb(this.getSfxLightHue(mode), s, v, alpha);
    }

    getSfxLightMode() {
        try {
            const mode = String(document?.documentElement?.dataset?.sfxLights || 'cyan').toLowerCase();
            if (mode === 'off') return 'off';
        } catch {
            // ignore
        }
        return 'cyan';
    }

    getSfxLightHue(mode) {
        return 195;
    }

    isSfxLightsOff() {
        return this.getSfxLightMode() === 'off';
    }

    draw() {
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;
        
        // DPI Handling usually done outside, but let's assume canvas coordinate space matches pixel size for now.
        // C++: default width 26, height 150.
        
        ctx.clearRect(0, 0, w, h);
        
        const cx = w / 2;
        
        // Track Rect: (center.x - 4, top + 8, width 8, height - 16)
        const trackX = cx - 4;
        const trackY = 8;
        const trackW = 8;
        const trackH = h - 16;
        
        // Draw track base with a fixed cyan accent.
        // Gradient: BottomLeft to TopLeft
        const grad = ctx.createLinearGradient(trackX, trackY + trackH, trackX, trackY);
        const lightMode = this.getSfxLightMode();
        const baseHue = this.getSfxLightHue(lightMode);
        const baseAlpha = lightMode === 'off' ? 92 : 76;
        grad.addColorStop(0, this.hsvToRgb(baseHue, 170, 165, baseAlpha));
        grad.addColorStop(0.55, this.hsvToRgb(baseHue, 210, 225, lightMode === 'off' ? 104 : 100));
        grad.addColorStop(1, this.hsvToRgb(baseHue, 235, 255, lightMode === 'off' ? 122 : 132));
        
        ctx.fillStyle = grad;
        
        // Rounded Rect for Track
        ctx.beginPath();
        ctx.roundRect(trackX, trackY, trackW, trackH, 4);
        ctx.fill();
        ctx.strokeStyle = "rgba(40, 40, 40, 0.63)"; // 160/255
        ctx.lineWidth = 1;
        ctx.stroke();
        
        // Filled Portion
        // Bottom up. 
        // Handle Y = trackRect.bottom - trackHeight * r
        const r = this.ratio();
        const handleY = (trackY + trackH) - (trackH * r);
        
        // Filled rect
        const filledY = handleY;
        const filledH = (trackY + trackH) - handleY;
        
        if (filledH > 0.5) {
             const brightGrad = ctx.createLinearGradient(trackX, trackY + trackH, trackX, trackY);
             brightGrad.addColorStop(0, this.hsvToRgb(baseHue, 205, 225, lightMode === 'off' ? 170 : 180));
             brightGrad.addColorStop(0.55, this.hsvToRgb(baseHue, 230, 255, lightMode === 'off' ? 200 : 215));
             brightGrad.addColorStop(1, this.hsvToRgb(baseHue, 245, 255, lightMode === 'off' ? 220 : 240));
             
             ctx.save();
             // Clip to filled area
             // QPainter::setClipRect(filledRect) -> Intersection with track rounded rect?
             // C++ draws rounded rect again with bright gradient but clipped to filledRect area.
             
             ctx.beginPath();
             ctx.rect(trackX, filledY, trackW, filledH);
             ctx.clip();
             
             ctx.beginPath();
             ctx.roundRect(trackX, trackY, trackW, trackH, 4);
             ctx.fillStyle = brightGrad;
             ctx.fill();
             
             ctx.restore();
        }
        
        // Handle
        const handleX = cx; // center
        
        let radius = 7.0;
        if (this.isDragging) radius = 10.0;
        else if (this.isHovered) radius = 9.0;
        
        // Glow
        const glowR = radius + 3;
        const glowGrad = ctx.createRadialGradient(handleX, handleY, 0, handleX, handleY, glowR);
        
        // Fixed cyan handle color.
        const handleColorRgb = this.colorAtRatio(r, 255, 220, 255); 
        
        // Parse handleColorRgb to inject alpha
        // A bit wasteful re-parsing, but simpler than refactoring hsvToRgb to return object
        const rgbMatch = handleColorRgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        const R = rgbMatch[1], G = rgbMatch[2], B = rgbMatch[3];
        
        let glowAlpha = this.isDragging ? 0.92 : (this.isHovered ? 0.8 : 0.63); // 235, 205, 160
        
        glowGrad.addColorStop(0, `rgba(${R}, ${G}, ${B}, ${glowAlpha})`);
        glowGrad.addColorStop(1, `rgba(${R}, ${G}, ${B}, 0)`);
        
        ctx.fillStyle = glowGrad;
        ctx.beginPath();
        ctx.arc(handleX, handleY, glowR, 0, 2 * Math.PI);
        ctx.fill();
        
        // Handle Ring
        let ringWidth = (this.isDragging || this.isHovered) ? 3 : 2;
        ctx.lineWidth = ringWidth;
        ctx.strokeStyle = handleColorRgb; // handle color
        ctx.fillStyle = "rgba(18, 18, 18, 0.92)"; // 235
        
        ctx.beginPath();
        ctx.arc(handleX, handleY, radius, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
        
        // Inner Hole
        ctx.fillStyle = "rgba(8, 8, 8, 1)";
        ctx.beginPath();
        ctx.arc(handleX, handleY, Math.max(1.0, radius - 2.8), 0, 2 * Math.PI);
        ctx.fill();
        
        // Tiny Highlight
        ctx.fillStyle = "rgba(255, 255, 255, 0.82)"; // 210
        ctx.beginPath();
        ctx.arc(handleX - 1.4, handleY - 1.4, 1.8, 0, 2 * Math.PI);
        ctx.fill();
    }
}
