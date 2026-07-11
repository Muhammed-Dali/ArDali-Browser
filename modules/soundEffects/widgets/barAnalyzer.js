
class BarAnalyzer {
    constructor(canvas, options = {}) {
        this.canvas = canvas;
        this.ctx = this.canvas.getContext('2d', { alpha: false });
        this.options = options || {};
        
        // Constants
        this.COLUMN_WIDTH = Number.isFinite(this.options.columnWidth) ? this.options.columnWidth : 4;
        this.SPACING = Number.isFinite(this.options.spacing) ? this.options.spacing : 1;
        this.ROOF_HOLD = Number.isFinite(this.options.roofHold) ? this.options.roofHold : 32;
        this.FALL_DIVISOR = Number.isFinite(this.options.fallDivisor) ? this.options.fallDivisor : 20;
        this.backgroundColor = String(this.options.backgroundColor || '#12121a');
        this.fixedBands = Number.isFinite(this.options.fixedBands)
            ? Math.max(8, Math.floor(this.options.fixedBands))
            : 0;
        
        // State
        this.bars = [];
        this.roofs = [];
        this.roofVelocities = [];
        this.bandCount = 0;
        
        // Colors
        this.baseColor = { r: 0, g: 217, b: 255 }; // Default accent
        this.psychedelic = false;
        
        this.resize();
        window.addEventListener('resize', () => this.resize());
    }
    
    resize() {
        const rect = this.canvas.parentElement.getBoundingClientRect();
        this.canvas.width = rect.width;
        this.canvas.height = rect.height;
        this.width = this.canvas.width;
        this.height = this.canvas.height;
        
        this.init();
    }
    
    init() {
        // Calculate number of bands that fit (or use fixed)
        if (this.fixedBands > 0) {
            this.bandCount = this.fixedBands;
        } else {
            this.bandCount = Math.floor(this.width / (this.COLUMN_WIDTH + this.SPACING));
            if (this.bandCount < 1) this.bandCount = 1;
        }
        
        // Reset state arrays
        this.bars = new Float32Array(this.bandCount).fill(0);
        this.roofs = new Float32Array(this.bandCount).fill(0);
        this.roofVelocities = new Uint32Array(this.bandCount).fill(this.ROOF_HOLD); // Initialize as holding
        
        this.createGradient();
    }
    
    createGradient() {
        this.gradient = this.ctx.createLinearGradient(0, this.height, 0, 0);
        // Bottom color (faded)
        this.gradient.addColorStop(0, `rgba(${this.baseColor.r}, ${this.baseColor.g}, ${this.baseColor.b}, 0.2)`);
        // Mid color
        this.gradient.addColorStop(0.6, `rgba(${this.baseColor.r}, ${this.baseColor.g}, ${this.baseColor.b}, 0.8)`);
        // Top color (bright)
        this.gradient.addColorStop(1, '#ffffff');
    }
    
    setColor(r, g, b) {
        this.baseColor = { r, g, b };
        this.createGradient();
    }

    isSfxLightsOff() {
        return this.getSfxLightMode() === 'off';
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

    getBandColor(index) {
        const mode = this.getSfxLightMode();
        if (mode === 'off') return '#22d3ee';
        const hue = this.getSfxLightHue(mode);
        return `hsl(${hue.toFixed(1)}, 92%, 56%)`;
    }
    
    /**
     * Draw the frame
     * @param {Uint8Array} frequencyData - Array of 0-255 values
     */
    draw(frequencyData) {
        // Clear background
        this.ctx.fillStyle = this.backgroundColor; // Match theme background
        this.ctx.fillRect(0, 0, this.width, this.height);
        
        if (!frequencyData) return;
        
        // Physics Loop
        const maxBarHeight = this.height - 2; // Leave room for roof
        const slot = this.width / this.bandCount;
        const barW = Math.max(2, Math.floor(slot - this.SPACING));
        const lightsOff = this.isSfxLightsOff();
        
        for (let i = 0; i < this.bandCount; i++) {
            // Ratio-based sampling: avoids right-side zeros when barCount > data length
            const from = Math.floor((i / this.bandCount) * frequencyData.length);
            const to = Math.max(from + 1, Math.floor(((i + 1) / this.bandCount) * frequencyData.length));
            let val = 0;
            for (let j = from; j < to; j++) {
                const sample = frequencyData[j] || 0;
                if (sample > val) val = sample;
            }
            
            // Map 0-255 to height
            const targetHeight = (val / 255) * maxBarHeight;
            
            // Smooth bars (optional, but good for FPS independence)
            // Just set directly for responsiveness as per original C++ code mostly doing direct mapping
            this.bars[i] = targetHeight;
            
            // Roof Physics
            if (this.bars[i] > this.roofs[i]) {
                this.roofs[i] = this.bars[i];
                this.roofVelocities[i] = 0; // Reset velocity (start hold)
            } else {
                // Falling logic
                if (this.roofVelocities[i] > this.ROOF_HOLD) {
                    // Fall
                    const velocity = (this.roofVelocities[i] - this.ROOF_HOLD);
                    const drop = velocity / this.FALL_DIVISOR; // Slow fall at first, accelerates
                    this.roofs[i] -= drop * 2; // Speed up a bit for high FPS
                    
                    if (this.roofs[i] < 0) this.roofs[i] = 0;
                }
                
                // Increment velocity counter
                this.roofVelocities[i]++;
            }
            
            // Drawing
            const x = Math.floor(i * slot);
            
            // Draw Bar
            if (this.bars[i] > 0) {
                this.ctx.fillStyle = this.getBandColor(i);
                this.ctx.fillRect(
                    x, 
                    this.height - this.bars[i], 
                    barW, 
                    this.bars[i]
                );
            }
            
            // Draw Roof
            if (this.roofs[i] > 0) {
                this.ctx.fillStyle = lightsOff ? '#7dd3fc' : this.getBandColor(i);
                // Roof is a single pixel line or small block
                this.ctx.fillRect(
                    x,
                    this.height - this.roofs[i] - 2,
                    barW,
                    1
                );
            }
        }
    }
}

// Export for usage
if (typeof module !== 'undefined') {
    module.exports = BarAnalyzer;
} else {
    window.BarAnalyzer = BarAnalyzer;
}
