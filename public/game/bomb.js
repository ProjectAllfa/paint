// Bomb class - represents a bomb item pickup
class Bomb {
  // Static image cache
  static image = null;
  static imageLoaded = false;
  static imageLoading = false;
  static originalWidth = 0;
  static originalHeight = 0;
  static instances = []; // Track all bomb instances to update when image loads
  
  // Background image cache
  static backgroundImage = null;
  static backgroundImageLoaded = false;
  static backgroundImageLoading = false;
  
  static loadImage() {
    if (Bomb.imageLoading || Bomb.imageLoaded) return;
    
    Bomb.imageLoading = true;
    const img = new Image();
    img.onload = () => {
      Bomb.imageLoaded = true;
      Bomb.imageLoading = false;
      // Store original dimensions
      Bomb.originalWidth = img.width;
      Bomb.originalHeight = img.height;
      // Update size for all existing bombs
      Bomb.instances.forEach(bomb => {
        bomb.updateSize();
      });
    };
    img.onerror = () => {
      console.error('Failed to load bomb image: assets/bombs/bomb_item.png');
      Bomb.imageLoading = false;
    };
    img.src = 'assets/bombs/bomb_item.png';
    Bomb.image = img;
  }
  
  static loadBackgroundImage() {
    if (Bomb.backgroundImageLoading || Bomb.backgroundImageLoaded) return;
    
    Bomb.backgroundImageLoading = true;
    const img = new Image();
    img.onload = () => {
      Bomb.backgroundImageLoaded = true;
      Bomb.backgroundImageLoading = false;
    };
    img.onerror = () => {
      console.error('Failed to load bomb background image: assets/bombs/bomb_item_background.png');
      Bomb.backgroundImageLoading = false;
    };
    img.src = 'assets/bombs/bomb_item_background.png';
    Bomb.backgroundImage = img;
  }
  
  constructor(x, y, spawnPoint) {
    this.x = x;
    this.y = y;
    this.spawnPoint = spawnPoint; // Reference to spawn point for respawning
    this.width = 0;
    this.height = 0;
    this.collected = false;
    this.respawnTimer = 0; // timer in seconds
    this.respawnDelay = 10; // 10 seconds
    
    // Rotation state for background
    this.rotation = 0;
    this.rotationSpeed = 1.2; // Rotation speed (radians per second) - converted from 0.02 radians/frame at 60fps
    
    // Floating effect state
    this.floatTimer = 0; // timer in radians
    this.floatSpeed = 3; // Speed of floating animation (radians per second) - converted from 0.05 per frame at 60fps
    this.floatAmount = 5; // Pixels to float up/down
    
    // Register this instance
    Bomb.instances.push(this);
    
    // Load images if not already loading/loaded
    Bomb.loadImage();
    Bomb.loadBackgroundImage();
    
    // Set size to 20% of original image size (if image already loaded)
    this.updateSize();
  }
  
  updateSize() {
    // Set bomb size to 25% of original image dimensions, maintaining aspect ratio
    if (Bomb.imageLoaded && Bomb.originalWidth > 0 && Bomb.originalHeight > 0) {
      this.width = Bomb.originalWidth * 0.2;
      this.height = Bomb.originalHeight * 0.2;
    } else if (Bomb.image && Bomb.image.complete) {
      // Fallback: use image dimensions if available
      this.width = Bomb.image.width * 0.2;
      this.height = Bomb.image.height * 0.2;
    }
  }
  
  setSize(size) {
    // Deprecated: kept for compatibility but no longer used
    // Size is now based on original image dimensions
    this.updateSize();
  }
  
  update(deltaTime = 1/60) {
    // Update floating effect (continuous loop) - now time-based
    if (!this.collected) {
      this.floatTimer += this.floatSpeed * deltaTime;
      // Keep timer in range to prevent overflow
      if (this.floatTimer >= Math.PI * 2) {
        this.floatTimer -= Math.PI * 2;
      }
    }
    
    // Update rotation for background (continuous loop) - now time-based
    if (!this.collected) {
      this.rotation += this.rotationSpeed * deltaTime;
      // Keep rotation in 0-2π range to prevent overflow
      if (this.rotation >= Math.PI * 2) {
        this.rotation -= Math.PI * 2;
      }
    }
    
    // Update respawn timer if collected - now time-based
    if (this.collected) {
      this.respawnTimer += deltaTime;
      if (this.respawnTimer >= this.respawnDelay) {
        // Respawn the bomb
        this.collected = false;
        this.respawnTimer = 0;
        // Reset rotation and float timer when respawning
        this.rotation = 0;
        this.floatTimer = 0;
      }
    }
  }
  
  checkCollision(character) {
    if (this.collected) return false;
    
    // Simple AABB collision detection
    const charLeft = character.x - character.width / 2;
    const charRight = character.x + character.width / 2;
    const charTop = character.y - character.height;
    const charBottom = character.y;
    
    const bombLeft = this.x - this.width / 2;
    const bombRight = this.x + this.width / 2;
    const bombTop = this.y - this.height;
    const bombBottom = this.y;
    
    return charLeft < bombRight && charRight > bombLeft &&
           charTop < bombBottom && charBottom > bombTop;
  }
  
  collect() {
    if (!this.collected) {
      this.collected = true;
      this.respawnTimer = 0;
      return true;
    }
    return false;
  }
  
  draw(ctx) {
    if (this.collected) return; // Don't draw if collected
    
    // Calculate floating offset using sine wave
    const floatOffset = Math.sin(this.floatTimer) * this.floatAmount;
    
    const centerX = this.x;
    const centerY = this.y - this.height / 2 + floatOffset; // Center of bomb with floating offset
    
    // Draw rotating background
    if (Bomb.backgroundImageLoaded && Bomb.backgroundImage) {
      ctx.save();
      // Set opacity to 0.4
      ctx.globalAlpha = 0.4;
      // Move to center of bomb (with floating offset)
      ctx.translate(centerX, centerY);
      // Rotate around center
      ctx.rotate(this.rotation);
      // Draw background image centered at origin
      const bgSize = Math.max(this.width, this.height) * 1.8; // Larger than bomb for better visibility
      ctx.drawImage(
        Bomb.backgroundImage,
        -bgSize / 2,
        -bgSize / 2,
        bgSize,
        bgSize
      );
      ctx.restore();
    }
    
    // Draw bomb image on top
    if (Bomb.imageLoaded && Bomb.image) {
      // Draw bomb image centered at position with floating offset
      const drawX = this.x - this.width / 2;
      const drawY = this.y - this.height + floatOffset;
      ctx.drawImage(Bomb.image, drawX, drawY, this.width, this.height);
    } else {
      // Fallback: draw a simple circle while image loads
      ctx.fillStyle = '#ffaa00';
      ctx.beginPath();
      ctx.arc(centerX, centerY, this.width / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ff6600';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
}
