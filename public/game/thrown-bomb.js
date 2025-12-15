// ThrownBomb class - represents a bomb that has been thrown
class ThrownBomb {
  // Static image cache for red and blue bombs
  static images = {
    red: null,
    blue: null
  };
  static imagesLoaded = {
    red: false,
    blue: false
  };
  static imagesLoading = {
    red: false,
    blue: false
  };
  static originalDimensions = {}; // Store original image dimensions for aspect ratio
  
  // White flash image for bomb flash effect
  static whiteFlashImage = null;
  static whiteFlashImageLoaded = false;
  static whiteFlashImageLoading = false;
  
  static loadImage(team) {
    if (ThrownBomb.imagesLoading[team] || ThrownBomb.imagesLoaded[team]) return;
    
    ThrownBomb.imagesLoading[team] = true;
    const img = new Image();
    img.onload = () => {
      ThrownBomb.imagesLoaded[team] = true;
      ThrownBomb.imagesLoading[team] = false;
      // Store original dimensions for aspect ratio
      if (!ThrownBomb.originalDimensions) {
        ThrownBomb.originalDimensions = {};
      }
      ThrownBomb.originalDimensions[team] = {
        width: img.width,
        height: img.height
      };
    };
    img.onerror = () => {
      console.error(`Failed to load ${team} bomb image: assets/bombs/${team}_bomb.png`);
      ThrownBomb.imagesLoading[team] = false;
    };
    img.src = `assets/bombs/${team}_bomb.png`;
    ThrownBomb.images[team] = img;
  }
  
  static loadWhiteFlashImage() {
    if (ThrownBomb.whiteFlashImageLoading || ThrownBomb.whiteFlashImageLoaded) return;
    
    ThrownBomb.whiteFlashImageLoading = true;
    const img = new Image();
    img.onload = () => {
      ThrownBomb.whiteFlashImageLoaded = true;
      ThrownBomb.whiteFlashImageLoading = false;
    };
    img.onerror = () => {
      console.error('Failed to load white flash image: assets/bombs/bomb_white_flash.png');
      ThrownBomb.whiteFlashImageLoading = false;
    };
    img.src = 'assets/bombs/bomb_white_flash.png';
    ThrownBomb.whiteFlashImage = img;
  }
  
  constructor(x, y, team, throwDirection) {
    this.x = x;
    this.y = y;
    this.team = team; // 'red' or 'blue'
    this.width = 0;
    this.height = 0;
    this.baseWidth = 0; // Store original width for scaling
    this.baseHeight = 0; // Store original height for scaling
    
    // Throwing physics - now time-based
    this.velocityX = throwDirection * 300; // Horizontal velocity (pixels per second) - converted from 5 pixels/frame
    this.velocityY = -480; // Initial upward velocity (pixels per second) - converted from -8 pixels/frame
    this.gravity = 1500; // Gravity (pixels per second squared) - increased to match character gravity
    
    // Rotation (natural, based on velocity)
    this.rotation = 0;
    this.angularVelocity = 0; // Angular velocity (radians per second)
    
    // Bounce properties
    this.bounceDamping = 0.5; // Velocity retained after bounce (0.5 = 50% of velocity)
    this.friction = 0.9; // Friction coefficient (per frame equivalent, will be converted to per-second)
    
    // Explosion timer - now time-based
    this.timer = 0; // timer in seconds
    this.explodeTime = 2; // 2 seconds
    this.flashDelay = 0.5; // 0.5 seconds delay before flash starts
    
    // Explosion state
    this.exploded = false;
    this.explosionRadius = 0;
    this.maxExplosionRadius = 120; // Maximum blast radius
    this.explosionSpeed = 300; // Pixels per second expansion - converted from 5 pixels/frame
    
    // Load images for this team
    ThrownBomb.loadImage(team);
    ThrownBomb.loadWhiteFlashImage();
  }
  
  setSize(size) {
    // Set bomb size based on character size, preserving aspect ratio
    if (ThrownBomb.originalDimensions && ThrownBomb.originalDimensions[this.team]) {
      const orig = ThrownBomb.originalDimensions[this.team];
      const aspectRatio = orig.width / orig.height;
      
      // Scale to match character size while preserving aspect ratio
      // Use character size as the base and scale proportionally
      this.baseWidth = size;
      this.baseHeight = size / aspectRatio;
      this.width = this.baseWidth;
      this.height = this.baseHeight;
    } else {
      // Fallback: use character size if dimensions not loaded yet
      this.baseWidth = size;
      this.baseHeight = size;
      this.width = this.baseWidth;
      this.height = this.baseHeight;
    }
  }
  
  update(map, deltaTime = 1/60) {
    if (this.exploded) {
      // Explosion expanding - now time-based
      this.explosionRadius += this.explosionSpeed * deltaTime;
      
      // Color blocks within explosion radius
      this.colorBlocksInRadius(map);
      
      if (this.explosionRadius >= this.maxExplosionRadius) {
        // Explosion complete - mark for removal
        return false; // Return false to indicate should be removed
      }
      return true; // Still exploding
    }
    
    // Update rotation naturally based on velocity - now time-based
    // Rotation speed is proportional to horizontal velocity (0.03 radians per pixel per second = 0.03/60 per pixel per frame)
    this.angularVelocity = this.velocityX * 0.0005; // Natural rotation (radians per second) - converted from 0.03 per pixel per frame
    this.rotation += this.angularVelocity * deltaTime;
    // Keep rotation in range
    if (this.rotation >= Math.PI * 2) {
      this.rotation -= Math.PI * 2;
    } else if (this.rotation < 0) {
      this.rotation += Math.PI * 2;
    }
    
    // Update timer - now time-based
    this.timer += deltaTime;
    if (this.timer >= this.explodeTime) {
      // Time to explode
      this.exploded = true;
      this.explosionRadius = 0;
      return true;
    }
    
    // Apply gravity - now time-based
    this.velocityY += this.gravity * deltaTime;
    
    // Update position with collision detection - now time-based
    const newX = this.x + this.velocityX * deltaTime;
    const newY = this.y + this.velocityY * deltaTime;
    
    // Check collision with blocks separately for X and Y
    const collisionX = this.checkCollision(newX, this.y, map);
    const collisionY = this.checkCollision(this.x, newY, map);
    
    // Check if bomb is on a surface (touching ground)
    const isOnSurface = this.checkCollision(this.x, this.y + 1, map).collided; // Check 1 pixel below
    
    // Apply friction when on surface - now time-based
    if (isOnSurface) {
      // Convert frame-based friction (0.9 per frame) to time-based exponential decay
      // 0.9^60 ≈ 0.0018 after 1 second, so use exponential decay
      this.velocityX *= Math.pow(this.friction, 60 * deltaTime);
    }
    
    // Handle horizontal collision (bounce)
    if (collisionX.collided) {
      this.velocityX *= -this.bounceDamping; // Reverse and dampen horizontal velocity
      // Keep X position if hitting wall
    } else {
      this.x = newX;
    }
    
    // Handle vertical collision (bounce)
    if (collisionY.collided) {
      if (this.velocityY > 0) {
        // Hitting ground - bounce up
        this.velocityY *= -this.bounceDamping;
      } else {
        // Hitting ceiling - bounce down
        this.velocityY *= -this.bounceDamping;
      }
      // Keep Y position if hitting ground/ceiling
    } else {
      this.y = newY;
    }
    
    // Stop very small velocities to prevent jitter and sliding (0.3 pixels/frame = 18 pixels/second)
    if (Math.abs(this.velocityX) < 18) {
      this.velocityX = 0;
    }
    if (Math.abs(this.velocityY) < 18) {
      this.velocityY = 0;
    }
    
    return true; // Still active
  }
  
  checkCollision(x, y, map) {
    if (!map) return { collided: false };
    
    const bombLeft = x - this.width / 2;
    const bombRight = x + this.width / 2;
    const bombTop = y - this.height;
    const bombBottom = y;
    
    // Check collision with blocks
    for (let row = 0; row < map.rows; row++) {
      for (let col = 0; col < map.cols; col++) {
        const block = map.blocks[row][col];
        if (block !== null) {
          const blockWidth = block.imageIndex === Block.JUMP_PAD_INDEX ? block.width * 3 : block.width;
          const blockLeft = block.x;
          const blockRight = block.x + blockWidth;
          const blockTop = block.y;
          const blockBottom = block.y + block.height;
          
          if (bombLeft < blockRight && bombRight > blockLeft &&
              bombTop < blockBottom && bombBottom > blockTop) {
            return { collided: true };
          }
        }
      }
    }
    
    return { collided: false };
  }
  
  draw(ctx) {
    if (this.exploded) {
      // Draw explosion effect
      this.drawExplosion(ctx);
    } else {
      // Draw thrown bomb with rotation
      const centerX = this.x;
      const centerY = this.y - this.height / 2;
      
      // Calculate flash effect - increases in rate as bomb nears explosion
      // Only start flashing after the delay period
      let flashState = false;
      
      if (this.timer >= this.flashDelay) {
        const timeRemaining = this.explodeTime - this.timer;
        const timeUntilExplosion = this.explodeTime - this.flashDelay; // Time available for flashing
        const timeProgress = 1 - (timeRemaining / timeUntilExplosion); // 0 to 1 as it nears explosion
        
        // Flash frequency increases from 0.5 Hz to 5 Hz as it nears explosion
        const minFlashRate = 0.5; // Flashes per second at start
        const maxFlashRate = 5; // Flashes per second near explosion
        const flashRate = minFlashRate + (timeProgress * (maxFlashRate - minFlashRate));
        
        // Calculate if bomb should be white (flashing) - now time-based
        // Use timer minus delay to calculate flash cycle
        const flashTimer = this.timer - this.flashDelay;
        // flashRate is in Hz (cycles per second), so total cycles = flashTimer * flashRate
        const totalCycles = flashTimer * flashRate;
        // Invert so it starts normal (not white), then flashes white
        flashState = Math.floor(totalCycles) % 2 === 1; // Flash on/off pattern (starts with 0 = normal, 1 = white)
      }
      
      // Calculate size scale - increases by 0.2 (20%) as bomb nears explosion
      const explosionProgress = this.timer / this.explodeTime; // 0 to 1 as it nears explosion
      const sizeScale = 1.0 + (explosionProgress * 0.8); // Scale from 1.0 to 1.5
      const scaledWidth = this.baseWidth * sizeScale;
      const scaledHeight = this.baseHeight * sizeScale;
      
      ctx.save();
      // Move to bomb center
      ctx.translate(centerX, centerY);
      // Rotate
      ctx.rotate(this.rotation);
      
      const drawX = -scaledWidth / 2;
      const drawY = -scaledHeight / 2;
      
      // Choose image based on flash state
      if (flashState && ThrownBomb.whiteFlashImageLoaded && ThrownBomb.whiteFlashImage) {
        // Draw white flash image
        ctx.drawImage(ThrownBomb.whiteFlashImage, drawX, drawY, scaledWidth, scaledHeight);
      } else if (ThrownBomb.imagesLoaded[this.team] && ThrownBomb.images[this.team]) {
        // Draw normal bomb image
        ctx.drawImage(ThrownBomb.images[this.team], drawX, drawY, scaledWidth, scaledHeight);
      } else {
        // Fallback: draw colored circle
        ctx.fillStyle = flashState ? '#ffffff' : (this.team === 'red' ? '#ff4444' : '#4444ff');
        ctx.beginPath();
        ctx.arc(0, 0, scaledWidth / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      
      ctx.restore();
    }
  }
  
  drawExplosion(ctx) {
    const color = this.team === 'red' ? '#ff4444' : '#4444ff';
    const centerX = this.x;
    const centerY = this.y - this.height / 2;
    
    // Calculate progress (0 to 1) of explosion
    const progress = this.explosionRadius / this.maxExplosionRadius;
    
    // Draw multiple expanding circles for modern cartoon explosion effect
    // Outer glow (largest, most transparent)
    ctx.save();
    ctx.globalAlpha = 0.2 * (1 - progress);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(centerX, centerY, this.explosionRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    
    // Main explosion circles (3 layers)
    const numLayers = 3;
    for (let i = 0; i < numLayers; i++) {
      const layerProgress = progress - (i * 0.15); // Stagger the layers
      if (layerProgress > 0) {
        const layerRadius = this.explosionRadius * (1 - i * 0.2);
        const layerOpacity = (1 - layerProgress) * (1 - i * 0.2);
        
        ctx.save();
        ctx.globalAlpha = Math.max(0, layerOpacity);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(centerX, centerY, layerRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
    
    // Inner bright core
    const coreRadius = this.explosionRadius * 0.3;
    if (coreRadius > 0) {
      ctx.save();
      ctx.globalAlpha = 0.8 * (1 - progress);
      ctx.fillStyle = '#ffffff'; // White core
      ctx.beginPath();
      ctx.arc(centerX, centerY, coreRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
  
  getExplosionBounds() {
    // Return explosion bounds for collision detection
    if (!this.exploded) return null;
    
    return {
      x: this.x,
      y: this.y - this.height / 2,
      radius: this.explosionRadius
    };
  }
  
  colorBlocksInRadius(map) {
    if (!map || !this.exploded) return;
    
    // Explosion center position
    const explosionX = this.x;
    const explosionY = this.y - this.height / 2;
    
    // Check all blocks in the map
    for (let row = 0; row < map.rows; row++) {
      for (let col = 0; col < map.cols; col++) {
        const block = map.blocks[row][col];
        if (block !== null) {
          // Jump pads are 3 blocks wide, regular blocks use normal width
          const blockWidth = block.imageIndex === Block.JUMP_PAD_INDEX ? block.width * 3 : block.width;
          
          // Calculate block center
          const blockCenterX = block.x + blockWidth / 2;
          const blockCenterY = block.y + block.height / 2;
          
          // Calculate distance from explosion center to block center
          const dx = blockCenterX - explosionX;
          const dy = blockCenterY - explosionY;
          const distance = Math.sqrt(dx * dx + dy * dy);
          
          // Calculate maximum distance from block center to any corner (half diagonal)
          const halfDiagonal = Math.sqrt(blockWidth * blockWidth + block.height * block.height) / 2;
          
          // If block is within explosion radius (accounting for block size)
          if (distance - halfDiagonal <= this.explosionRadius) {
            block.setColor(this.team);
          }
        }
      }
    }
  }
}
