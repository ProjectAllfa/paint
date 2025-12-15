// Block class - represents a single block on the map
class Block {
  // Static image cache - shared across all block instances
  // images[color][imageIndex] for colored blocks
  // images['white'][0-8] for white0.png through white8.png
  // images['red'][0-8] for red0.png through red8.png
  // images['blue'][0-8] for blue0.png through blue8.png
  // images['white'][9] for white_jump_pad.png
  static images = {
    white: [],
    red: [],
    blue: []
  };
  static imagesLoaded = {
    white: [],
    red: [],
    blue: []
  };
  static imagesLoading = {
    white: [],
    red: [],
    blue: []
  };
  static JUMP_PAD_INDEX = 9; // Special index for jump pads

  constructor(x, y, width, height, imageIndex = 0) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
    this.color = 'white'; // Start as white, can be 'white', 'blue', or 'red'
    this.imageIndex = Math.max(0, Math.min(9, imageIndex)); // Clamp between 0 and 9 (9 = jump pad)
    
    // Animation state
    this.animating = false;
    this.animationProgress = 0; // 0 to 1
    this.animationDuration = 0.3; // seconds
    this.animationTime = 0; // current time in animation
    this.isJumpPad = this.imageIndex === Block.JUMP_PAD_INDEX;
    
    // Load white image by default
    if (!Block.imagesLoading.white[this.imageIndex] && !Block.imagesLoaded.white[this.imageIndex]) {
      Block.loadImage('white', this.imageIndex);
    }
    // Preload red and blue images (including jump pads)
    if (!Block.imagesLoading.red[this.imageIndex] && !Block.imagesLoaded.red[this.imageIndex]) {
      Block.loadImage('red', this.imageIndex);
    }
    if (!Block.imagesLoading.blue[this.imageIndex] && !Block.imagesLoaded.blue[this.imageIndex]) {
      Block.loadImage('blue', this.imageIndex);
    }
  }

  static loadImage(color, imageIndex) {
    if (Block.imagesLoading[color][imageIndex] || Block.imagesLoaded[color][imageIndex]) return;
    
    // Initialize arrays if needed
    if (!Block.images[color]) Block.images[color] = [];
    if (!Block.imagesLoaded[color]) Block.imagesLoaded[color] = [];
    if (!Block.imagesLoading[color]) Block.imagesLoading[color] = [];
    
    Block.imagesLoading[color][imageIndex] = true;
    const img = new Image();
    img.onload = () => {
      Block.imagesLoaded[color][imageIndex] = true;
      Block.imagesLoading[color][imageIndex] = false;
    };
    img.onerror = () => {
      if (imageIndex === Block.JUMP_PAD_INDEX) {
        if (color === 'red') {
          console.error('Failed to load jump pad image: assets/blocks/pads/red_jump_pad.png');
        } else if (color === 'blue') {
          console.error('Failed to load jump pad image: assets/blocks/pads/blue_jump_pad.png');
        } else {
          console.error('Failed to load jump pad image: assets/blocks/pads/white_jump_pad.png');
        }
      } else {
        if (color === 'red' || color === 'blue') {
          console.error(`Failed to load block image: assets/blocks/${color}/${color}${imageIndex}.png`);
        } else {
          console.error(`Failed to load block image: assets/blocks/white${imageIndex}.png`);
        }
      }
      Block.imagesLoading[color][imageIndex] = false;
    };
    
    // Jump pad images
    if (imageIndex === Block.JUMP_PAD_INDEX) {
      if (color === 'red') {
        img.src = 'assets/blocks/pads/red_jump_pad.png';
      } else if (color === 'blue') {
        img.src = 'assets/blocks/pads/blue_jump_pad.png';
      } else {
        img.src = 'assets/blocks/pads/white_jump_pad.png';
      }
    } else {
      // Regular block images - red and blue images are in color folders, white images are in root
      if (color === 'red' || color === 'blue') {
        img.src = `assets/blocks/${color}/${color}${imageIndex}.png`;
      } else {
        img.src = `assets/blocks/white${imageIndex}.png`;
      }
    }
    Block.images[color][imageIndex] = img;
  }

  setColor(color) {
    // Allow changing color for all blocks including jump pads
    if (color === 'white' || color === 'red' || color === 'blue') {
      // Always update the color (even if same) to ensure blocks can be colored
      // Only animate if color actually changes
      const colorChanged = this.color !== color;
      this.color = color;
      if (colorChanged) {
        // Start animation - reset all animation state
        this.animating = true;
        this.animationProgress = 0;
        this.animationTime = 0;
      }
      // Ensure the image for this color is loaded
      if (!Block.imagesLoading[color][this.imageIndex] && !Block.imagesLoaded[color][this.imageIndex]) {
        Block.loadImage(color, this.imageIndex);
      }
    }
  }
  
  update(deltaTime) {
    // Update animation if active
    if (this.animating) {
      // Ensure deltaTime is valid
      if (deltaTime && deltaTime > 0) {
        this.animationTime += deltaTime;
        this.animationProgress = this.animationTime / this.animationDuration;
        
        if (this.animationProgress >= 1) {
          // Animation complete - ensure we end at scale 1.0
          this.animationProgress = 1;
          this.animating = false;
          this.animationTime = 0; // Reset for next animation
        }
      }
    }
  }
  
  triggerAnimation() {
    // Start the bounce animation
    this.animating = true;
    this.animationTime = 0;
    this.animationProgress = 0;
  }
  
  getScale() {
    // Returns scale factor based on animation progress
    // Animation: start small (0.85) -> scale up -> overshoot (1.15) -> settle (1.0)
    if (!this.animating) return 1.0;
    
    const t = this.animationProgress;
    
    // Clamp t to [0, 1] to ensure we don't go beyond bounds
    const clampedT = Math.max(0, Math.min(1, t));
    
    // Easing function for bounce effect
    // Start at 0.85, quickly scale up, overshoot to 1.15, then settle at 1.0
    if (clampedT < 0.5) {
      // First half: scale from 0.85 to 1.15
      const t2 = clampedT * 2; // 0 to 1
      return 0.85 + (1.15 - 0.85) * (t2 * t2); // Ease out
    } else {
      // Second half: scale from 1.15 to 1.0
      const t2 = (clampedT - 0.5) * 2; // 0 to 1
      // Ease in with bounce
      const easeIn = 1 - (1 - t2) * (1 - t2);
      return 1.15 - (1.15 - 1.0) * easeIn;
    }
  }

  getColor() {
    return this.color;
  }

  // Check if a point (px, py) is inside this block
  contains(px, py) {
    const drawWidth = this.imageIndex === Block.JUMP_PAD_INDEX ? this.width * 3 : this.width;
    return px >= this.x && px <= this.x + drawWidth &&
           py >= this.y && py <= this.y + this.height;
  }

  draw(ctx) {
    // Draw image if loaded, otherwise fallback to solid color
    const img = Block.images[this.color] && Block.images[this.color][this.imageIndex];
    const isLoaded = Block.imagesLoaded[this.color] && Block.imagesLoaded[this.color][this.imageIndex];
    
    // Get animation scale
    const scale = this.getScale();
    
    // Jump pads are 3 blocks wide
    const baseWidth = this.imageIndex === Block.JUMP_PAD_INDEX ? this.width * 3 : this.width;
    const drawWidth = baseWidth * scale;
    const drawHeight = this.height * scale;
    
    // Calculate centered position for scaling
    const centerX = this.x + baseWidth / 2;
    const centerY = this.y + this.height / 2;
    const drawX = centerX - drawWidth / 2;
    const drawY = centerY - drawHeight / 2;
    
    if (isLoaded && img) {
      ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
    } else {
      // Fallback to solid color while image loads
      ctx.fillStyle = this.color;
      ctx.fillRect(drawX, drawY, drawWidth, drawHeight);
    }
  }
}

