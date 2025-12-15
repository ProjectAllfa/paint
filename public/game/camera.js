// Camera class - handles viewport following and zoom
class Camera {
  constructor(gameWidth, gameHeight) {
    // Camera position (center of viewport in game coordinates)
    this.x = gameWidth / 2;
    this.y = gameHeight / 2;
    
    // Target to follow (will be set to player position)
    this.targetX = gameWidth / 2;
    this.targetY = gameHeight / 2;
    
    // Zoom level (1.0 = no zoom, higher = zoomed in)
    this.zoom = 1.8; // Start zoomed in for better pixel clarity
    
    // Smooth following (lerp factor)
    this.followSpeed = 0.1; // Lower = smoother, higher = snappier
    
    // Viewport dimensions (game space)
    this.viewportWidth = gameWidth;
    this.viewportHeight = gameHeight;
    
    // Bounds (optional - can limit camera movement)
    this.bounds = null; // {minX, maxX, minY, maxY}
  }
  
  // Set the target to follow (usually player position)
  setTarget(x, y) {
    this.targetX = x;
    this.targetY = y;
  }
  
  // Update camera position (smoothly follow target)
  update() {
    // Smoothly interpolate towards target
    this.x += (this.targetX - this.x) * this.followSpeed;
    this.y += (this.targetY - this.y) * this.followSpeed;
    
    // Apply bounds if set
    if (this.bounds) {
      this.x = Math.max(this.bounds.minX, Math.min(this.bounds.maxX, this.x));
      this.y = Math.max(this.bounds.minY, Math.min(this.bounds.maxY, this.y));
    }
  }
  
  // Set camera bounds (optional - limits camera movement)
  setBounds(minX, maxX, minY, maxY) {
    this.bounds = { minX, maxX, minY, maxY };
  }
  
  // Clear bounds
  clearBounds() {
    this.bounds = null;
  }
  
  // Set zoom level
  setZoom(zoom) {
    this.zoom = Math.max(0.5, Math.min(5.0, zoom)); // Clamp between 0.5x and 5x
  }
  
  // Apply camera transform to canvas context
  applyTransform(ctx, canvasWidth, canvasHeight) {
    ctx.save();
    
    // Disable image smoothing for pixel-perfect rendering
    ctx.imageSmoothingEnabled = false;
    
    // Calculate viewport center in screen space
    const screenCenterX = canvasWidth / 2;
    const screenCenterY = canvasHeight / 2;
    
    // Translate to center, then scale (zoom), then translate to camera position
    ctx.translate(screenCenterX, screenCenterY);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.x, -this.y);
  }
  
  // Remove camera transform
  removeTransform(ctx) {
    ctx.restore();
  }
  
  // Convert screen coordinates to game world coordinates
  screenToWorld(screenX, screenY, canvasWidth, canvasHeight) {
    const screenCenterX = canvasWidth / 2;
    const screenCenterY = canvasHeight / 2;
    
    // Convert screen to game space
    const gameX = (screenX - screenCenterX) / this.zoom + this.x;
    const gameY = (screenY - screenCenterY) / this.zoom + this.y;
    
    return { x: gameX, y: gameY };
  }
  
  // Convert game world coordinates to screen coordinates
  worldToScreen(worldX, worldY, canvasWidth, canvasHeight) {
    const screenCenterX = canvasWidth / 2;
    const screenCenterY = canvasHeight / 2;
    
    // Convert game to screen space
    const screenX = (worldX - this.x) * this.zoom + screenCenterX;
    const screenY = (worldY - this.y) * this.zoom + screenCenterY;
    
    return { x: screenX, y: screenY };
  }
  
  // Get visible area in game coordinates
  getVisibleBounds(canvasWidth, canvasHeight) {
    const halfWidth = (canvasWidth / this.zoom) / 2;
    const halfHeight = (canvasHeight / this.zoom) / 2;
    
    return {
      left: this.x - halfWidth,
      right: this.x + halfWidth,
      top: this.y - halfHeight,
      bottom: this.y + halfHeight,
      width: canvasWidth / this.zoom,
      height: canvasHeight / this.zoom
    };
  }
}
