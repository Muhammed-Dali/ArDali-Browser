
class EQResponse {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = this.canvas.getContext('2d');
        
        this.bandValues = new Array(32).fill(0);
        this.bandPositions = []; // X coordinates of slider centers
        
        this.shift = 0;
        this.animationId = null;
        
        this.resize();
        window.addEventListener('resize', () => this.resize());
        
        this.startAnimation();
    }
    
    resize() {
        const rect = this.canvas.parentElement.getBoundingClientRect();
        this.canvas.width = rect.width;
        this.canvas.height = rect.height;
        this.width = this.canvas.width;
        this.height = this.canvas.height;
        // Positions need re-calculation by parent/renderer
    }
    
    setBandPositions(positions) {
        this.bandPositions = positions;
    }
    
    setBandValues(values) {
        this.bandValues = values;
        // We don't force redraw here, animation loop handles it
    }
    
    startAnimation() {
        if (this.animationId) return;
        const animate = () => {
            if (!this.animationId) return;
            this.shift += 0.005; // Slightly slower than 0.015/50ms maybe? 60fps is faster
            if (this.shift > 1.0) this.shift -= 1.0;
            
            this.draw();
            this.animationId = requestAnimationFrame(animate);
        };
        this.animationId = requestAnimationFrame(animate);
    }

    stopAnimation() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }

    setActive(active) {
        if (active) this.startAnimation();
        else this.stopAnimation();
    }
    
    hsvToRgb(h, s, v) {
        let r, g, b;
        let i = Math.floor(h * 6);
        let f = h * 6 - i;
        let p = v * (1 - s);
        let q = v * (1 - f * s);
        let t = v * (1 - (1 - f) * s);
        switch (i % 6) {
            case 0: r = v; g = t; b = p; break;
            case 1: r = q; g = v; b = p; break;
            case 2: r = p; g = v; b = t; break;
            case 3: r = p; g = q; b = v; break;
            case 4: r = t; g = p; b = v; break;
            case 5: r = v; g = p; b = q; break;
        }
        return `rgba(${Math.floor(r * 255)}, ${Math.floor(g * 255)}, ${Math.floor(b * 255)}`;
    }
    
    draw() {
        this.ctx.clearRect(0, 0, this.width, this.height);
        
        if (!this.bandPositions.length || this.bandPositions.length !== this.bandValues.length) return;
        
        const h = this.height;
        const trackTop = 10;
        const trackBottom = h - 10;
        const trackHeight = trackBottom - trackTop;
        
        const points = [];
        
        for (let i = 0; i < this.bandValues.length; i++) {
            // Map -12..12 DB to 0..1
            // C++: (val + 12) / 24.  Range is usually -12 to 12.
            let normalized = (this.bandValues[i] + 12) / 24;
            if (normalized < 0) normalized = 0;
            if (normalized > 1) normalized = 1;
            
            const x = this.bandPositions[i];
            const y = trackBottom - (normalized * trackHeight);
            points.push({x, y});
        }
        
        if (points.length < 2) return;
        
        // Create Gradient
        const gradient = this.ctx.createLinearGradient(0, trackTop, 0, trackBottom);
        const hueBase = this.shift; // 0..1
        
        // Helper to get color string
        const getColor = (offsetHue, alpha) => {
            let hue = (hueBase + offsetHue) % 1.0;
            return this.hsvToRgb(hue, 0.78, 1.0) + `, ${alpha})`;
        };
        
        gradient.addColorStop(0.0, getColor(0.75, 0.24)); // +270 deg
        gradient.addColorStop(0.3, getColor(0.5, 0.2));   // +180 deg
        gradient.addColorStop(0.6, getColor(0.25, 0.18)); // +90 deg
        gradient.addColorStop(1.0, getColor(0.0, 0.16));  // +0 deg
        
        // Draw Fill Path
        this.ctx.beginPath();
        this.ctx.moveTo(points[0].x, trackBottom);
        
        // Draw curve for fill
        this.drawCurve(this.ctx, points);
        
        this.ctx.lineTo(points[points.length-1].x, trackBottom);
        this.ctx.closePath();
        
        this.ctx.fillStyle = gradient;
        this.ctx.fill();
        
        // Draw Stroke Line
        this.ctx.beginPath();
        this.drawCurve(this.ctx, points);
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
        this.ctx.lineWidth = 2;
        this.ctx.stroke();
    }
    
    drawCurve(ctx, points) {
        ctx.lineTo(points[0].x, points[0].y);
        
        const tension = 0.3;
        
        for (let i = 0; i < points.length - 1; i++) {
            const p0 = points[i];
            const p1 = points[i + 1];
            
            // Basic cubic bezier control points for smooth monotonicity
            // C++: ctrl1 = p0 + (p1.x - p0.x)*tension
            const cp1x = p0.x + (p1.x - p0.x) * tension;
            const cp1y = p0.y;
            
            const cp2x = p1.x - (p1.x - p0.x) * tension;
            const cp2y = p1.y;
            
            ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p1.x, p1.y);
        }
    }
}

if (typeof module !== 'undefined') {
    module.exports = EQResponse;
} else {
    window.EQResponse = EQResponse;
}
