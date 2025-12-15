// Canvas utility functions
class CanvasManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    
    // Fixed game resolution - consistent across all devices
    this.GAME_WIDTH = 1920;
    this.GAME_HEIGHT = 1080;
    
    // Viewport settings (actual canvas size and offset for letterboxing/pillarboxing)
    this.viewportWidth = 0;
    this.viewportHeight = 0;
    this.viewportOffsetX = 0;
    this.viewportOffsetY = 0;
    this.scale = 1;
    
    this.resizeCanvas();
    
    // Handle window resize
    window.addEventListener('resize', () => this.resizeCanvas());
  }

  resizeCanvas() {
    // Set canvas to full window size
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    
    // Calculate scale to fit game resolution while maintaining aspect ratio
    const scaleX = window.innerWidth / this.GAME_WIDTH;
    const scaleY = window.innerHeight / this.GAME_HEIGHT;
    this.scale = Math.min(scaleX, scaleY); // Use smaller scale to fit both dimensions
    
    // Calculate viewport size (scaled game dimensions)
    this.viewportWidth = this.GAME_WIDTH * this.scale;
    this.viewportHeight = this.GAME_HEIGHT * this.scale;
    
    // Calculate offset for centering (letterboxing/pillarboxing)
    this.viewportOffsetX = (window.innerWidth - this.viewportWidth) / 2;
    this.viewportOffsetY = (window.innerHeight - this.viewportHeight) / 2;
  }

  clear() {
    // Clear entire canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  // Begin rendering in game coordinate space
  beginGameRender() {
    this.ctx.save();
    
    // Disable image smoothing for pixel-perfect rendering
    this.ctx.imageSmoothingEnabled = false;
    
    // Apply viewport transform (offset + scale)
    // Round offsets to prevent sub-pixel translation issues
    // This ensures pixel-perfect alignment when scaled
    this.ctx.translate(Math.round(this.viewportOffsetX), Math.round(this.viewportOffsetY));
    this.ctx.scale(this.scale, this.scale);
  }
  
  // End rendering in game coordinate space
  endGameRender() {
    this.ctx.restore();
  }

  getContext() {
    return this.ctx;
  }

  getWidth() {
    return this.GAME_WIDTH; // Always return fixed game width
  }

  getHeight() {
    return this.GAME_HEIGHT; // Always return fixed game height
  }
  
  // Convert screen coordinates to game coordinates (useful for mouse input)
  screenToGame(screenX, screenY) {
    return {
      x: (screenX - this.viewportOffsetX) / this.scale,
      y: (screenY - this.viewportOffsetY) / this.scale
    };
  }
}

