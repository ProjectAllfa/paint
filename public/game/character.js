// Character class - represents a player character
class Character {
  // Static image cache
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
  
  // Jump effect spritesheet
  static jumpEffectImage = null;
  static jumpEffectLoaded = false;
  static jumpEffectLoading = false;
  static jumpEffectFrames = 4; // Number of frames in the spritesheet (adjust if needed)
  static jumpEffectFrameWidth = 0; // Will be calculated when image loads
  static jumpEffectFrameHeight = 0; // Will be calculated when image loads

  constructor(x, y, team = 'red', playerId = null) {
    this.x = x;
    this.y = y;
    this.team = team; // 'red' or 'blue'
    this.playerId = playerId; // Unique player ID for multiplayer (null = local player)
    this.width = 0;
    this.height = 0;
    this.speed = 180; // pixels per second (horizontal movement) - converted from 3 pixels/frame at 60fps
    this.velocityY = 0; // vertical velocity for jumping/falling (pixels per second)
    this.gravity = 1500; // gravity acceleration (pixels per second squared) - increased for snappier feel
    this.jumpPower = -600; // jump velocity (pixels per second) - converted from -10 pixels/frame at 60fps
    this.jumpPadBounce = -900; // jump pad bounce velocity (pixels per second) - converted from -15 pixels/frame at 60fps
    this.onGround = false;
    this.jumpsUsed = 0; // track jumps for double jump
    this.maxJumps = 2; // allow double jump
    this.wasPressingW = false; // track previous frame's W key state
    this.wasInJumpPad = false; // track if we were in a jump pad last frame
    
    // Bomb inventory
    this.hasBomb = false;
    // Bomb position with lag (for drag effect)
    this.bombX = x;
    this.bombY = y;
    // Bomb display size (preserves aspect ratio)
    this.bombDisplayWidth = 0;
    this.bombDisplayHeight = 0;
    
    // Throwing state
    this.wasPressingS = false; // Track previous frame's S key state
    
    // Squish/squash animation state
    this.squishScaleX = 1.0; // horizontal scale (stretch when moving)
    this.squishScaleY = 1.0; // vertical scale (squish when moving)
    this.animationTime = 0; // time accumulator for looping animation (radians)
    this.animationSpeed = 15; // how fast the animation cycles (radians per second) - converted from 0.25 radians/frame at 60fps
    this.squishAmount = 0.08; // how much to stretch/squish (8%)
    
    // Paint particle system
    this.particles = []; // array of paint particles
    this.particleSpawnTimer = 0; // timer to control particle spawn rate (seconds)
    this.particleSpawnInterval = 0.0667; // spawn a particle every N seconds (4 frames at 60fps = 0.0667s)
    
    // Jump effect animation state
    this.jumpEffectActive = false;
    this.jumpEffectFrame = 0;
    this.jumpEffectFrameTimer = 0; // timer in seconds
    this.jumpEffectFrameDuration = 0.05; // seconds per animation frame (3 frames at 60fps = 0.05s)
    this.wasOnGround = true; // track previous frame's ground state
    this.jumpEffectSpawnX = 0; // X position where jump effect spawns
    this.jumpEffectSpawnY = 0; // Y position where jump effect spawns
    
    // Air trail effect (white fading tail when mid-air)
    this.trail = []; // array of trail points {x, y, opacity}
    this.trailMaxLength = 15; // maximum number of trail points
    this.trailSpawnTimer = 0; // timer in seconds
    this.trailSpawnInterval = 0.0333; // add trail point every N seconds (2 frames at 60fps = 0.0333s)
    
    // Load image if not already loading/loaded
    if (!Character.imagesLoading[team] && !Character.imagesLoaded[team]) {
      Character.loadImage(team);
    }
    
    // Load jump effect spritesheet if not already loading/loaded
    if (!Character.jumpEffectLoading && !Character.jumpEffectLoaded) {
      Character.loadJumpEffectImage();
    }
  }

  static loadImage(team) {
    if (Character.imagesLoading[team] || Character.imagesLoaded[team]) return;
    
    Character.imagesLoading[team] = true;
    const img = new Image();
    img.onload = () => {
      Character.imagesLoaded[team] = true;
      Character.imagesLoading[team] = false;
    };
    img.onerror = () => {
      console.error(`Failed to load character image: assets/characters/${team}/${team === 'red' ? 'r1' : 'b1'}.png`);
      Character.imagesLoading[team] = false;
    };
    img.src = `assets/characters/${team}/${team === 'red' ? 'r1' : 'b1'}.png`;
    Character.images[team] = img;
  }
  
  static loadJumpEffectImage() {
    if (Character.jumpEffectLoading || Character.jumpEffectLoaded) return;
    
    Character.jumpEffectLoading = true;
    const img = new Image();
    img.onload = () => {
      Character.jumpEffectLoaded = true;
      Character.jumpEffectLoading = false;
      // Calculate frame dimensions (assuming horizontal spritesheet)
      Character.jumpEffectFrameWidth = img.width / Character.jumpEffectFrames;
      Character.jumpEffectFrameHeight = img.height;
    };
    img.onerror = () => {
      console.error('Failed to load jump effect spritesheet: assets/sprites/jump_effect_spritesheet.png');
      Character.jumpEffectLoading = false;
    };
    img.src = 'assets/sprites/jump_effect_spritesheet.png';
    Character.jumpEffectImage = img;
  }

  setSize(width, height) {
    this.width = width;
    this.height = height;
    
    // Update bomb display size if carrying one (preserve aspect ratio)
    if (this.hasBomb && typeof ThrownBomb !== 'undefined') {
      // Ensure image is loaded
      ThrownBomb.loadImage(this.team);
      
      if (ThrownBomb.originalDimensions && ThrownBomb.originalDimensions[this.team]) {
        const orig = ThrownBomb.originalDimensions[this.team];
        const aspectRatio = orig.width / orig.height;
        this.bombDisplayWidth = width;
        this.bombDisplayHeight = width / aspectRatio;
      } else {
        // Fallback: use character size (will be updated when image loads)
        this.bombDisplayWidth = width;
        this.bombDisplayHeight = height;
      }
    }
  }

  update(keys, map, deltaTime = 1/60) {
    if (!map) return null;
    
    // Ensure deltaTime is reasonable (prevent huge jumps)
    deltaTime = Math.min(deltaTime, 1/30); // Cap at 30fps minimum
    
    let thrownBomb = null; // Return thrown bomb if one is thrown this frame
    
    // Check if standing on ground BEFORE processing input
    // This ensures onGround is set correctly before jump check
    const groundY = this.getGroundY(this.x, map);
    // Threshold: 2 pixels = 2 pixels, 0.6 pixels/frame at 60fps = 36 pixels/second
    if (groundY !== null && Math.abs(this.y - groundY) < 2 && Math.abs(this.velocityY) < 36) {
      this.y = groundY;
      this.velocityY = 0;
      this.onGround = true;
      this.jumpsUsed = 0; // Reset jumps when landing
    } else {
      this.onGround = false;
    }
    
    // Track ground state for other logic
    this.wasOnGround = this.onGround;
    
    // Check if touching/near any block - only reset jumps when actually using wall jump
    // Don't reset jumps just for being near a block mid-air - that allows extra jumps
    // The reset will happen in the jump logic when actually performing a wall jump
    // This matches the original design: jump once from ground, then jump once mid-air
    // Block coloring is now server-authoritative - removed client-side coloring
    const isTouchingBlock = this.isTouchingBlock(map);
    
    // Horizontal movement (A/D) - now time-based
    let dx = 0;
    if (keys['a'] || keys['A']) dx -= this.speed * deltaTime;
    if (keys['d'] || keys['D']) dx += this.speed * deltaTime;
    
    // Update squish animation based on movement - now time-based
    if (dx !== 0) {
      // Moving - continuously loop the animation
      this.animationTime += this.animationSpeed * deltaTime;
      
      // Use sine wave to create oscillating stretch/squish effect
      // When sin is positive: stretch horizontally, squish vertically
      // When sin is negative: squish horizontally, stretch vertically
      const sinValue = Math.sin(this.animationTime);
      
      // Oscillate between stretched and squished
      this.squishScaleX = 1.0 + (sinValue * this.squishAmount);
      this.squishScaleY = 1.0 - (sinValue * this.squishAmount);
      
      // Spawn paint particles only when walking on ground - now time-based
      if (this.onGround) {
        this.particleSpawnTimer += deltaTime;
        if (this.particleSpawnTimer >= this.particleSpawnInterval) {
          this.spawnPaintParticle();
          this.particleSpawnTimer = 0;
        }
      } else {
        this.particleSpawnTimer = 0;
      }
    } else {
      // Not moving - return to normal smoothly
      this.animationTime = 0;
      this.squishScaleX += (1.0 - this.squishScaleX) * 0.2;
      this.squishScaleY += (1.0 - this.squishScaleY) * 0.2;
      this.particleSpawnTimer = 0;
    }
    
    // Update paint particles (pass map and deltaTime for collision detection)
    this.updateParticles(map, deltaTime);
    
    // Update bomb position with lag (drag effect)
    if (this.hasBomb) {
      // Use lerp (linear interpolation) for smooth following with lag
      const lagFactor = 0.15; // Lower = more lag (0.1 = very laggy, 0.3 = less laggy)
      this.bombX += (this.x - this.bombX) * lagFactor;
      this.bombY += (this.y - this.bombY) * lagFactor;
    }
    
    // Check if W was just pressed (not held)
    const isPressingW = keys['w'] || keys['W'];
    const justPressedW = isPressingW && !this.wasPressingW;
    this.wasPressingW = isPressingW;
    
    // Check if S was just pressed (not held) - throw bomb
    const isPressingS = keys['s'] || keys['S'];
    const justPressedS = isPressingS && !this.wasPressingS;
    this.wasPressingS = isPressingS;
    
    // Check if we're on a jump pad - disable manual jumping on jump pads
    const currentGroundY = this.getGroundY(this.x, map);
    const isOnJumpPad = currentGroundY !== null ? this.getJumpPadAt(this.x, currentGroundY, map) !== null : false;
    const isInsideJumpPad = this.checkJumpPadCollision(this.x, this.y, map);
    
    // Throw bomb (S) - throw bomb if carrying one
    if (justPressedS && this.hasBomb) {
      // Determine throw direction based on last movement direction
      const throwDirection = dx !== 0 ? (dx > 0 ? 1 : -1) : 1; // Default to right if not moving
      
      // Create thrown bomb at character position
      thrownBomb = new ThrownBomb(this.x, this.y, this.team, throwDirection);
      thrownBomb.setSize(this.width);
      
      // Remove bomb from inventory
      this.hasBomb = false;
    }
    
    // Jump (W) - allow jump when on ground, double jump, or when touching blocks (but not on jump pads)
    if (justPressedW) {
      // Don't allow manual jumping when on or inside a jump pad - only bounce works
      if (isOnJumpPad || isInsideJumpPad) {
        // Ignore jump input - jump pads only bounce when falling onto them
      } else if (this.onGround) {
        // Jump from ground
        this.velocityY = this.jumpPower;
        this.jumpsUsed = 1;
        this.onGround = false;
        // Trigger jump effect animation at character center position
        this.jumpEffectActive = true;
        this.jumpEffectFrame = 0;
        this.jumpEffectFrameTimer = 0;
        this.jumpEffectSpawnX = this.x;
        this.jumpEffectSpawnY = this.y - this.height / 2; // Center of character (this.y is bottom)
      } else if (isTouchingBlock) {
        // Jump when touching a block (wall jump) - can jump multiple times by pressing W repeatedly
        this.velocityY = this.jumpPower;
        this.jumpsUsed = 0; // Reset since we're touching
        // Trigger jump effect animation at character center position
        this.jumpEffectActive = true;
        this.jumpEffectFrame = 0;
        this.jumpEffectFrameTimer = 0;
        this.jumpEffectSpawnX = this.x;
        this.jumpEffectSpawnY = this.y - this.height / 2; // Center of character (this.y is bottom)
      } else if (this.jumpsUsed < this.maxJumps && this.velocityY > 0) {
        // Double jump only if falling
        this.velocityY = this.jumpPower;
        this.jumpsUsed++;
        // Trigger jump effect animation at character center position
        this.jumpEffectActive = true;
        this.jumpEffectFrame = 0;
        this.jumpEffectFrameTimer = 0;
        this.jumpEffectSpawnX = this.x;
        this.jumpEffectSpawnY = this.y - this.height / 2; // Center of character (this.y is bottom)
      }
    }
    
    // Apply gravity - now time-based
    this.velocityY += this.gravity * deltaTime;
    
    // Limit fall speed (increased to match higher gravity)
    const maxFallSpeed = 1200; // pixels per second
    if (this.velocityY > maxFallSpeed) {
      this.velocityY = maxFallSpeed;
    }
    
    // Try horizontal movement first
    if (dx !== 0) {
      const newX = this.x + dx;
      
      // Check map boundaries - but don't clamp yet, let collision detection handle it
      // We'll only use boundaries as a final fallback
      const mapLeft = map.startX + this.width / 2;
      const mapRight = map.startX + (map.cols * map.blockWidth) - this.width / 2;
      
      // Don't clamp yet - check collision first, then apply boundary if needed
      let boundedX = newX;
      
      // Check if we're already touching a block in the direction we're trying to move
      // This prevents getting stuck when already at an edge
      const currentCharLeft = this.x - this.width / 2;
      const currentCharRight = this.x + this.width / 2;
      let alreadyTouching = false;
      const touchThreshold = 2; // Increased threshold for better detection
      
      for (let row = 0; row < map.rows; row++) {
        for (let col = 0; col < map.cols; col++) {
          const block = map.blocks[row][col];
          if (block !== null) {
            const blockWidth = block.imageIndex === Block.JUMP_PAD_INDEX ? block.width * 3 : block.width;
            const blockLeft = block.x;
            const blockRight = block.x + blockWidth;
            const blockTop = block.y;
            const blockBottom = block.y + block.height;
            
            // Check if we're vertically overlapping
            const charTop = this.y - this.height;
            const charBottom = this.y;
            if (charTop < blockBottom && charBottom > blockTop) {
              // Check if we're already touching or very close to the edge
              if (dx > 0 && currentCharRight >= blockLeft - touchThreshold && currentCharRight <= blockLeft + touchThreshold) {
                // Moving right and already touching left edge of block
                alreadyTouching = true;
                break;
              } else if (dx < 0 && currentCharLeft <= blockRight + touchThreshold && currentCharLeft >= blockRight - touchThreshold) {
                // Moving left and already touching right edge of block
                alreadyTouching = true;
                break;
              }
            }
          }
        }
        if (alreadyTouching) break;
      }
      
      // If already touching, don't try to move
      if (alreadyTouching) {
        // Don't move - we're already at the edge
      } else {
        // Check collision with the actual new position (not clamped)
        const collision = this.checkCollision(newX, this.y, map);
        if (!collision.collided) {
          // No collision - apply movement, but respect boundaries
          this.x = Math.max(mapLeft, Math.min(mapRight, newX));
        } else {
          // Collision detected - find the exact block and position character precisely at its edge
          const charLeft = newX - this.width / 2;
          const charRight = newX + this.width / 2;
          let newPosition = null;
          let collidingBlock = null;
          
          // Find which block we're colliding with
          outer: for (let row = 0; row < map.rows; row++) {
            for (let col = 0; col < map.cols; col++) {
              const block = map.blocks[row][col];
              if (block !== null) {
                const blockWidth = block.imageIndex === Block.JUMP_PAD_INDEX ? block.width * 3 : block.width;
                const blockLeft = block.x;
                const blockRight = block.x + blockWidth;
                const blockTop = block.y;
                const blockBottom = block.y + block.height;
                
                // Check if character would overlap with this block horizontally
                if (charLeft < blockRight && charRight > blockLeft) {
                  // Check if character is vertically overlapping (collision)
                  const charTop = this.y - this.height;
                  const charBottom = this.y;
                  if (charTop < blockBottom && charBottom > blockTop) {
                    collidingBlock = block;
                    // Calculate exact position at block edge - NO GAP for pixel-perfect alignment
                    if (dx > 0) {
                      // Moving right - position exactly at left edge of block
                      newPosition = blockLeft - this.width / 2;
                    } else {
                      // Moving left - position exactly at right edge of block
                      newPosition = blockRight + this.width / 2;
                    }
                    break outer; // Found the block, no need to check others
                  }
                }
              }
            }
          }
          
          // Only update position if we found a collision and it's different from current
          if (newPosition !== null) {
            // Check if we're already at this position (within a tiny threshold to account for floating point)
            const positionDiff = Math.abs(this.x - newPosition);
            if (positionDiff > 0.001) {
              // Apply the new position, ensuring it's within map boundaries
              this.x = Math.max(mapLeft, Math.min(mapRight, newPosition));
            }
            // If positionDiff is very small, we're already correctly positioned - don't change it
          }
        }
      }
      
      // Final boundary check - ensure we never go outside map bounds
      // This is a safety net in case collision detection missed something
      this.x = Math.max(mapLeft, Math.min(mapRight, this.x));
    }
    
    // Try vertical movement (gravity/jump) - now time-based
    const newY = this.y + this.velocityY * deltaTime;
    const prevY = this.y; // Store previous Y for collision detection
    
    // Check if we're entering a jump pad (weren't in one before, but will be now)
    const currentlyInJumpPad = this.checkJumpPadCollision(this.x, this.y, map);
    const willBeInJumpPad = this.checkJumpPadCollision(this.x, newY, map);
    const enteringJumpPad = !this.wasInJumpPad && willBeInJumpPad;
    
    // Check if we're falling or landing on a jump pad (before collision check)
    const newGroundY = this.getGroundY(this.x, map);
    const jumpPad = newGroundY !== null ? this.getJumpPadAt(this.x, newGroundY, map) : null;
    
    if (this.velocityY > 0) {
      // Falling
      if (newGroundY !== null && this.y + this.velocityY * deltaTime >= newGroundY) {
        if (jumpPad) {
          // Bounce on jump pad - position on top
          this.y = newGroundY;
          this.velocityY = this.jumpPadBounce; // Moderate upward bounce
          this.onGround = false;
          this.jumpsUsed = 0; // Reset jumps
          this.wasInJumpPad = true; // Mark that we're in jump pad
          // Trigger jump pad animation
          jumpPad.triggerAnimation();
          // Skip collision check for this frame since we handled the bounce
        } else {
          // Normal ground - check collision normally
          const collision = this.checkCollision(this.x, newY, map, prevY);
          if (!collision.collided) {
            this.y = newY;
            this.onGround = false;
          } else {
            this.y = newGroundY;
            this.velocityY = 0;
            this.onGround = true;
            this.jumpsUsed = 0;
          }
        }
      } else {
        // Not landing on ground - check collision normally
        // Check if entering jump pad while falling
        if (enteringJumpPad) {
          // Entering jump pad from side while falling - bounce upward
          // Find the jump pad block and trigger its animation
          const touchedJumpPad = this.findJumpPadAt(this.x, newY, map);
          if (touchedJumpPad) {
            touchedJumpPad.triggerAnimation();
          }
          this.velocityY = this.jumpPadBounce;
          this.jumpsUsed = 0;
          this.y = newY;
          this.onGround = false;
          this.wasInJumpPad = true;
        } else {
          const collision = this.checkCollision(this.x, newY, map, prevY);
          if (!collision.collided) {
            this.y = newY;
            this.onGround = false;
            this.wasInJumpPad = willBeInJumpPad;
          } else {
            this.velocityY = 0;
            this.onGround = false;
            this.wasInJumpPad = false;
          }
        }
      }
    } else {
      // Moving up or stationary
      // Check if we're entering a jump pad from the side or bottom
      if (enteringJumpPad) {
        // Entering jump pad - apply bounce based on direction
        // Find the jump pad block and trigger its animation
        const touchedJumpPad = this.findJumpPadAt(this.x, newY, map);
        if (touchedJumpPad) {
          touchedJumpPad.triggerAnimation();
        }
        if (this.velocityY < 0) {
          // Moving up - bounce upward (stronger)
          this.velocityY = this.jumpPadBounce;
        } else if (this.velocityY === 0) {
          // Stationary or very slow - bounce upward
          this.velocityY = this.jumpPadBounce;
        }
        this.jumpsUsed = 0; // Reset jumps
        this.y = newY; // Allow movement through
        this.onGround = false;
        this.wasInJumpPad = true; // Mark that we're in jump pad
      } else {
        // Always check collision first - don't skip collision detection even if on jump pad
        // This ensures ceiling collisions are detected even when jump pads are vertically aligned below
        const collision = this.checkCollision(this.x, newY, map, prevY);
        if (!collision.collided) {
          // No collision - check if we're on a jump pad and update state accordingly
          const currentlyOnJumpPad = this.checkJumpPadCollision(this.x, newY, map);
          this.y = newY;
          this.onGround = false;
          this.wasInJumpPad = currentlyOnJumpPad;
        } else {
          // Hitting something - check if it's a jump pad (should pass through when moving up)
          const hitJumpPad = this.checkJumpPadCollision(this.x, newY, map);
          if (hitJumpPad && this.velocityY < 0) {
            // Moving up and hit jump pad - allow passing through
            this.y = newY;
            this.onGround = false;
            this.wasInJumpPad = true;
          } else {
            // Hitting ceiling (or other block) - position character correctly and reset jumps
            if (this.velocityY < 0 && collision.blockBottom !== null) {
              // Moving upward and hit ceiling - position top of character at bottom of block
              this.y = collision.blockBottom + this.height;
            }
            this.velocityY = 0;
            this.onGround = false;
            this.jumpsUsed = 0; // Reset jumps when hitting ceiling
            this.wasInJumpPad = false;
          }
        }
      }
    }
    
    // Update jump pad state for next frame (if we didn't already set it)
    if (!willBeInJumpPad) {
      this.wasInJumpPad = false;
    } else {
      this.wasInJumpPad = true;
    }
    
    // Final ground check after movement (ALWAYS check to ensure onGround is correct)
    // This is critical for particles and trail visibility
    // IMPORTANT: Only run this check if we didn't just bounce on a jump pad
    // This prevents the final ground check from interfering with jump pad bounces
    const justBouncedOnJumpPad = this.velocityY < -400 && this.wasInJumpPad;
    
    if (!justBouncedOnJumpPad) {
      const finalGroundY = this.getGroundY(this.x, map);
      // Threshold: 3 pixels = 3 pixels, 0.6 pixels/frame at 60fps = 36 pixels/second
      if (finalGroundY !== null && Math.abs(this.y - finalGroundY) < 3 && Math.abs(this.velocityY) < 36) {
        // Check if standing on a jump pad
        const jumpPad = this.getJumpPadAt(this.x, finalGroundY, map);
        if (jumpPad) {
          // On jump pad - position naturally on top
          this.y = finalGroundY;
          this.onGround = false; // Not "on ground" in the normal sense, but can bounce
        } else {
          // Normal ground - ensure onGround is true
          this.y = finalGroundY;
          this.velocityY = 0; // Stop any small vertical movement
          this.onGround = true;
          this.jumpsUsed = 0; // Reset jumps when on ground
        }
      } else if (this.velocityY > 0.1) {
        // Falling with significant velocity - definitely not on ground
        this.onGround = false;
      }
    }
    
    // Update jump effect animation - now time-based
    if (this.jumpEffectActive) {
      this.jumpEffectFrameTimer += deltaTime;
      if (this.jumpEffectFrameTimer >= this.jumpEffectFrameDuration) {
        this.jumpEffectFrameTimer = 0;
        this.jumpEffectFrame++;
        if (this.jumpEffectFrame >= Character.jumpEffectFrames) {
          // Animation complete
          this.jumpEffectActive = false;
          this.jumpEffectFrame = 0;
        }
      }
    }
    
    // Update air trail effect (only when mid-air, not on ground)
    if (!this.onGround) {
      // Add trail points when in air
      this.trailSpawnTimer++;
      if (this.trailSpawnTimer >= this.trailSpawnInterval) {
        // Add new trail point at character center
        const trailPoint = {
          x: this.x,
          y: this.y - this.height / 2, // Character center
          opacity: 1.0
        };
        this.trail.push(trailPoint);
        
        // Limit trail length
        if (this.trail.length > this.trailMaxLength) {
          this.trail.shift(); // Remove oldest point
        }
        
        this.trailSpawnTimer = 0;
      }
      
      // Fade out trail points based on age (creates smooth gradient)
      // Newest points (near character) have full opacity, oldest fade out
      for (let i = 0; i < this.trail.length; i++) {
        // Newest points (at end of array) have high opacity, oldest (at start) fade
        const normalizedAge = this.trail.length > 1 ? i / (this.trail.length - 1) : 0;
        this.trail[i].opacity = normalizedAge * 0.9; // Fade from 0 (oldest) to 0.9 (newest)
      }
    } else {
      // On ground - don't add new points, but let existing trail fade out naturally
      // Fade out all trail points over time
      for (let i = this.trail.length - 1; i >= 0; i--) {
        this.trail[i].opacity -= 0.05;
        if (this.trail[i].opacity <= 0) {
          this.trail.splice(i, 1); // Remove fully faded points
        }
      }
      this.trailSpawnTimer = 0;
    }
    
    // Return thrown bomb if one was thrown this frame
    return thrownBomb;
  }

  isTouchingBlock(map) {
    // Check if character is touching or very close to any block
    const charLeft = this.x - this.width / 2;
    const charRight = this.x + this.width / 2;
    const charTop = this.y - this.height;
    const charBottom = this.y;
    // Scale touch distance with block size to maintain consistent detection across screen sizes
    const baseTouchDistance = 5;
    const baseBlockSize = 20; // Reference block size
    const touchDistance = Math.max(3, (baseTouchDistance / baseBlockSize) * map.blockWidth);
    const ceilingTouchDistance = Math.max(5, (8 / baseBlockSize) * map.blockWidth); // larger distance for ceiling (when moving upward)
    
    // Check all blocks
    for (let row = 0; row < map.rows; row++) {
      for (let col = 0; col < map.cols; col++) {
        const block = map.blocks[row][col];
        if (block !== null) {
          // Jump pads are 3 blocks wide
          const blockWidth = block.imageIndex === Block.JUMP_PAD_INDEX ? block.width * 3 : block.width;
          const blockLeft = block.x;
          const blockRight = block.x + blockWidth;
          const blockTop = block.y;
          const blockBottom = block.y + block.height;
          
          // Check if character is within touchDistance of any side of the block
          // Left side of block
          if (charRight >= blockLeft - touchDistance && charRight <= blockLeft + touchDistance &&
              charTop < blockBottom && charBottom > blockTop) {
            return true;
          }
          // Right side of block
          if (charLeft <= blockRight + touchDistance && charLeft >= blockRight - touchDistance &&
              charTop < blockBottom && charBottom > blockTop) {
            return true;
          }
          // Top of block (ground)
          if (charBottom >= blockTop - touchDistance && charBottom <= blockTop + touchDistance &&
              charLeft < blockRight && charRight > blockLeft) {
            return true;
          }
          // Bottom of block (ceiling) - use larger distance, especially when moving upward
          const ceilingDistance = this.velocityY < 0 ? ceilingTouchDistance : touchDistance;
          if (charTop <= blockBottom + ceilingDistance && charTop >= blockBottom - ceilingDistance &&
              charLeft < blockRight && charRight > blockLeft) {
            return true;
          }
        }
      }
    }
    
    return false;
  }

  checkCollision(x, y, map, prevY = null) {
    // Check if character would collide with any block
    // Returns: {collided: bool, blockBottom: number|null} for proper positioning
    // Character collision box
    const charLeft = x - this.width / 2;
    const charRight = x + this.width / 2;
    const charTop = y - this.height;
    const charBottom = y;
    const prevCharTop = prevY !== null ? prevY - this.height : charTop;
    
    // Small epsilon for floating point precision
    const epsilon = 0.5;
    
    // Check collision with all blocks
    for (let row = 0; row < map.rows; row++) {
      for (let col = 0; col < map.cols; col++) {
        const block = map.blocks[row][col];
        if (block !== null) {
          // Jump pads are 3 blocks wide
          const blockWidth = block.imageIndex === Block.JUMP_PAD_INDEX ? block.width * 3 : block.width;
          const blockLeft = block.x;
          const blockRight = block.x + blockWidth;
          const blockTop = block.y;
          const blockBottom = block.y + block.height;
          
          // AABB collision detection with direction-aware precision
          // Use epsilon only for vertical collisions to prevent floating, not horizontal (to avoid invisible walls)
          const horizontalEpsilon = 0; // No epsilon for horizontal - allow touching edges
          const verticalEpsilon = epsilon; // Use epsilon for vertical to prevent floating
          if (charLeft < blockRight - horizontalEpsilon && charRight > blockLeft + horizontalEpsilon &&
              charTop < blockBottom - verticalEpsilon && charBottom > blockTop + verticalEpsilon) {
            // Jump pads: special handling for one-way collision
            if (block.imageIndex === Block.JUMP_PAD_INDEX) {
              // Always allow passing through when moving up (regardless of position)
              if (this.velocityY < 0) {
                continue; // Moving upward - can always pass through jump pad
              }
              // When falling or stationary, check if character is on top of or inside the pad
              const charBottomY = y; // y is the bottom of the character
              const charTopY = y - this.height; // Top of the character
              const distanceFromTop = charBottomY - blockTop;
              
              // If character's bottom is at or near the pad's top, they're on top (not inside)
              if (distanceFromTop <= 5) {
                continue; // Character is on top - allow passing through
              }
              // If character is inside the pad (bottom is within pad bounds), always allow passing through
              // Also check if character's top is within pad bounds (completely inside)
              // This handles cases where character is deep inside stacked jump pads
              if (distanceFromTop > 5 && distanceFromTop <= block.height + 10) {
                continue; // Character is inside or overlapping - allow passing through
              }
              // Also allow if character's top is within the pad (completely inside)
              if (charTopY >= blockTop && charTopY < blockBottom) {
                continue; // Character's top is inside pad - allow passing through
              }
            }
            
            // For upward movement, check if character is overlapping with block
            if (this.velocityY < 0) {
              // Moving upward - check if character is horizontally aligned with block
              if (charLeft < blockRight && charRight > blockLeft) {
                // Character is horizontally aligned - check vertical collision
                // In screen coordinates: y increases downward
                // blockBottom = block.y + block.height (bottom of block)
                // charTop = y - height (top of character)
                // When character is below block: charTop > blockBottom
                // When moving up, charTop decreases
                // Collision occurs when charTop reaches or passes blockBottom
                
                // Check if character's top is at or past the block's bottom
                if (charTop <= blockBottom) {
                  // Use previous position to avoid premature collision when still clearly below
                  if (prevY !== null) {
                    const wasBelow = prevCharTop > blockBottom;
                    // If we were below and now we're at/past, we just crossed - collide
                    // If we weren't below, we're already at/past - still collide to prevent passing through
                    // This handles cases where character might have passed through due to frame skip or fast movement
                    return { collided: true, blockBottom: blockBottom };
                  } else {
                    // No previous position - if top is at or past bottom, collide
                    return { collided: true, blockBottom: blockBottom };
                  }
                }
                // Character is still below the block, no collision yet
                continue;
              }
              // Character is not horizontally aligned, no collision
              continue;
            }
            
            // For downward or horizontal movement, use normal collision
            return { collided: true, blockBottom: null }; // Collision detected
          }
        }
      }
    }
    
    return { collided: false, blockBottom: null }; // No collision
  }

  checkJumpPadCollision(x, y, map) {
    // Check if character would collide with a jump pad at given position
    const charLeft = x - this.width / 2;
    const charRight = x + this.width / 2;
    const charTop = y - this.height;
    const charBottom = y;
    
    for (let row = 0; row < map.rows; row++) {
      for (let col = 0; col < map.cols; col++) {
        const block = map.blocks[row][col];
        if (block !== null && block.imageIndex === Block.JUMP_PAD_INDEX) {
          const blockWidth = block.width * 3;
          const blockLeft = block.x;
          const blockRight = block.x + blockWidth;
          const blockTop = block.y;
          const blockBottom = block.y + block.height;
          
          if (charLeft < blockRight && charRight > blockLeft &&
              charTop < blockBottom && charBottom > blockTop) {
            return true;
          }
        }
      }
    }
    return false;
  }

  findJumpPadAt(x, y, map) {
    // Find jump pad block at given position (for triggering animation)
    const charLeft = x - this.width / 2;
    const charRight = x + this.width / 2;
    const charTop = y - this.height;
    const charBottom = y;
    
    for (let row = 0; row < map.rows; row++) {
      for (let col = 0; col < map.cols; col++) {
        const block = map.blocks[row][col];
        if (block !== null && block.imageIndex === Block.JUMP_PAD_INDEX) {
          const blockWidth = block.width * 3; // Jump pads are 3 blocks wide
          const blockLeft = block.x;
          const blockRight = block.x + blockWidth;
          const blockTop = block.y;
          const blockBottom = block.y + block.height;
          
          // Check if character is overlapping with this jump pad
          if (charLeft < blockRight && charRight > blockLeft &&
              charTop < blockBottom && charBottom > blockTop) {
            return block;
          }
        }
      }
    }
    
    return null;
  }

  getJumpPadAt(x, groundY, map) {
    // Check if there's a jump pad at the given ground position
    const charLeft = x - this.width / 2;
    const charRight = x + this.width / 2;
    
    for (let row = 0; row < map.rows; row++) {
      for (let col = 0; col < map.cols; col++) {
        const block = map.blocks[row][col];
        if (block !== null && block.imageIndex === Block.JUMP_PAD_INDEX) {
          const blockWidth = block.width * 3; // Jump pads are 3 blocks wide
          const blockLeft = block.x;
          const blockRight = block.x + blockWidth;
          const blockTop = block.y;
          
          // Check if character is horizontally over this jump pad and at the ground level
          if (charLeft < blockRight && charRight > blockLeft && 
              Math.abs(groundY - blockTop) < 2) {
            return block;
          }
        }
      }
    }
    
    return null;
  }

  getGroundY(x, map) {
    // Find the top of the block directly below the character's x position
    const charLeft = x - this.width / 2;
    const charRight = x + this.width / 2;
    let closestGround = null;
    
    // Maximum distance to consider for ground detection (prevents finding blocks far below)
    // This prevents jump pads far below from being detected as ground when at ceiling
    const maxGroundDistance = 50; // Only consider blocks within 50 pixels below character
    
    // Check all blocks to find the closest ground under the character
    for (let row = 0; row < map.rows; row++) {
      for (let col = 0; col < map.cols; col++) {
        const block = map.blocks[row][col];
        if (block !== null) {
          // Jump pads are 3 blocks wide
          const blockWidth = block.imageIndex === Block.JUMP_PAD_INDEX ? block.width * 3 : block.width;
          const blockLeft = block.x;
          const blockRight = block.x + blockWidth;
          const blockTop = block.y;
          
          // Check if character is horizontally over this block (allow touching edges - no epsilon)
          if (charLeft < blockRight && charRight > blockLeft) {
            // Only consider blocks that are at or below the character (blockTop >= this.y - 3)
            // AND within the maximum distance (blockTop - this.y <= maxGroundDistance)
            // This prevents finding blocks that are far below (like jump pads when at ceiling)
            const distanceBelow = blockTop - this.y;
            if (distanceBelow >= -3 && distanceBelow <= maxGroundDistance) {
              // This block is under or very close to the character - find the closest one
              if (closestGround === null || blockTop < closestGround) {
                closestGround = blockTop;
              }
            }
          }
        }
      }
    }
    
    return closestGround;
  }

  colorTouchedBlocks(map) {
    // Color blocks that the character is touching/near
    const charLeft = this.x - this.width / 2;
    const charRight = this.x + this.width / 2;
    const charTop = this.y - this.height;
    const charBottom = this.y;
    // Scale touch distance with block size to maintain consistent detection across screen sizes
    const baseTouchDistance = 5;
    const baseBlockSize = 20; // Reference block size
    const touchDistance = Math.max(3, (baseTouchDistance / baseBlockSize) * map.blockWidth);
    
    // Check all blocks
    for (let row = 0; row < map.rows; row++) {
      for (let col = 0; col < map.cols; col++) {
        const block = map.blocks[row][col];
        if (block !== null) {
          // Jump pads are 3 blocks wide, regular blocks use normal width
          const blockWidth = block.imageIndex === Block.JUMP_PAD_INDEX ? block.width * 3 : block.width;
          const blockLeft = block.x;
          const blockRight = block.x + blockWidth;
          const blockTop = block.y;
          const blockBottom = block.y + block.height;
          
          // Check if character is within touchDistance of any side of the block
          // Left side
          if (charRight >= blockLeft - touchDistance && charRight <= blockLeft + touchDistance &&
              charTop < blockBottom && charBottom > blockTop) {
            block.setColor(this.team);
            continue;
          }
          // Right side
          if (charLeft <= blockRight + touchDistance && charLeft >= blockRight - touchDistance &&
              charTop < blockBottom && charBottom > blockTop) {
            block.setColor(this.team);
            continue;
          }
          // Top
          if (charBottom >= blockTop - touchDistance && charBottom <= blockTop + touchDistance &&
              charLeft < blockRight && charRight > blockLeft) {
            block.setColor(this.team);
            continue;
          }
          // Bottom
          if (charTop <= blockBottom + touchDistance && charTop >= blockBottom - touchDistance &&
              charLeft < blockRight && charRight > blockLeft) {
            block.setColor(this.team);
            continue;
          }
        }
      }
    }
  }

  spawnPaintParticle() {
    // Spawn a paint particle behind the character
    const baseColor = this.team === 'red' ? '#ff6897' : '#2196F3';
    
    // Generate random blob shape (irregular polygon)
    const blobPoints = 6;
    const radii = [];
    for (let i = 0; i < blobPoints; i++) {
      radii.push(0.7 + Math.random() * 0.4);
    }
    
    const particle = {
      x: this.x + (Math.random() - 0.5) * this.width * 0.5, // Random position behind character
      y: this.y - this.height * 0.3 + (Math.random() - 0.5) * this.height * 0.3,
      vx: ((Math.random() - 0.5) * 2 - 1) * 60, // Random horizontal velocity (pixels per second) - converted from -1 to 1 pixels/frame
      vy: (-Math.random() * 0.5 + 0.3) * 60, // Slightly upward velocity (pixels per second) - converted from 0.3-0.8 pixels/frame
      size: 5 + Math.random() * 6, // Random size between 5-11 (bigger)
      life: 1.0, // Lifetime (0 to 1)
      decay: (0.015 + Math.random() * 0.015) * 60, // Random decay rate (per second) - converted from 0.015-0.03 per frame
      color: baseColor,
      baseColor: baseColor,
      radii: radii, // Store blob shape
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.1,
      bounces: 0, // Track bounces
      maxBounces: 1 // Stick after 1 bounce
    };
    this.particles.push(particle);
  }
  
  updateParticles(map, deltaTime = 1/60) {
    if (!map) return;
    
    // Update all particles - now time-based
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      
      // Skip if already stuck
      if (p.stuck) {
        p.life -= p.decay * deltaTime; // decay is now per second
        if (p.life <= 0) {
          this.particles.splice(i, 1);
        }
        continue;
      }
      
      // Store previous position for collision detection
      const prevX = p.x;
      const prevY = p.y;
      
      // Update position - now time-based
      p.x += p.vx * deltaTime;
      p.y += p.vy * deltaTime;
      
      // Apply gravity to particles (increased to match character gravity)
      p.vy += 1500 * deltaTime;
      
      // Apply friction to horizontal velocity (per second: 0.95^60 ≈ 0.046 remaining after 1 second)
      // Convert to per-second: 0.95^60 ≈ 0.046, so friction factor per second ≈ 0.95^60
      // For frame-based: 0.95 per frame, for time-based: 0.95^(1/deltaTime) per second
      // Simplified: use exponential decay: v *= Math.pow(0.95, 60 * deltaTime)
      p.vx *= Math.pow(0.95, 60 * deltaTime);
      
      // Check collision with blocks
      const collision = this.checkParticleCollision(p, prevX, prevY, map);
      if (collision) {
        // Bounce off block
        if (collision.side === 'top' || collision.side === 'bottom') {
          p.vy *= -0.3; // Bounce with energy loss
          p.y = collision.newY;
        } else if (collision.side === 'left' || collision.side === 'right') {
          p.vx *= -0.3; // Bounce with energy loss
          p.x = collision.newX;
        }
        
        p.bounces++;
        // If bounced, stick to the block (threshold: 0.1 pixels/frame = 6 pixels/second)
        if (p.bounces >= p.maxBounces || Math.abs(p.vx) < 6 && Math.abs(p.vy) < 6) {
          p.stuck = true;
          p.vx = 0;
          p.vy = 0;
        }
      }
      
      // Decay particle (already handled above in stuck check, but also decay when not stuck)
      if (!p.stuck) {
        p.life -= p.decay * deltaTime;
      }
      
      // Remove dead particles
      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }
  }
  
  checkParticleCollision(particle, prevX, prevY, map) {
    // Check if particle collides with any block
    const radius = particle.size;
    const particleLeft = particle.x - radius;
    const particleRight = particle.x + radius;
    const particleTop = particle.y - radius;
    const particleBottom = particle.y + radius;
    
    for (let row = 0; row < map.rows; row++) {
      for (let col = 0; col < map.cols; col++) {
        const block = map.blocks[row][col];
        if (block !== null) {
          // Skip jump pads for particle collision (particles pass through)
          if (block.imageIndex === Block.JUMP_PAD_INDEX) continue;
          
          const blockWidth = block.width;
          const blockLeft = block.x;
          const blockRight = block.x + blockWidth;
          const blockTop = block.y;
          const blockBottom = block.y + block.height;
          
          // AABB collision detection
          if (particleLeft < blockRight && particleRight > blockLeft &&
              particleTop < blockBottom && particleBottom > blockTop) {
            
            // Determine which side was hit based on previous position
            const centerX = (blockLeft + blockRight) / 2;
            const centerY = (blockTop + blockBottom) / 2;
            const dx = prevX - centerX;
            const dy = prevY - centerY;
            
            let side, newX, newY;
            if (Math.abs(dx) > Math.abs(dy)) {
              // Horizontal collision
              side = dx > 0 ? 'right' : 'left';
              newX = dx > 0 ? blockRight + radius : blockLeft - radius;
              newY = particle.y;
            } else {
              // Vertical collision
              side = dy > 0 ? 'bottom' : 'top';
              newX = particle.x;
              newY = dy > 0 ? blockBottom + radius : blockTop - radius;
            }
            
            return { side, newX, newY };
          }
        }
      }
    }
    
    return null;
  }
  
  draw(ctx) {
    // Draw paint particles first (behind character)
    this.drawParticles(ctx);
    
    // Draw air trail effect (behind character, only when mid-air)
    this.drawTrail(ctx);
    
    // Draw jump effect animation below character (if active)
    if (this.jumpEffectActive && Character.jumpEffectLoaded && Character.jumpEffectImage && this.width > 0 && this.height > 0) {
      // Calculate scale to match character width while maintaining aspect ratio
      const scale = this.width / Character.jumpEffectFrameWidth;
      const effectWidth = Character.jumpEffectFrameWidth * scale;
      const effectHeight = Character.jumpEffectFrameHeight * scale;
      
      // Position at spawn location (character center when jump started)
      const effectX = this.jumpEffectSpawnX - effectWidth / 2; // Center horizontally
      const effectY = this.jumpEffectSpawnY - effectHeight / 2; // Center vertically at character center
      
      // Draw current frame from spritesheet
      ctx.drawImage(
        Character.jumpEffectImage,
        this.jumpEffectFrame * Character.jumpEffectFrameWidth, // Source X (frame position in spritesheet)
        0, // Source Y (top of spritesheet)
        Character.jumpEffectFrameWidth, // Source width
        Character.jumpEffectFrameHeight, // Source height
        effectX, // Destination X (at spawn position)
        effectY, // Destination Y (at spawn position)
        effectWidth, // Destination width (scaled maintaining aspect ratio)
        effectHeight // Destination height (scaled maintaining aspect ratio)
      );
    }
    
    const img = Character.images[this.team];
    if (Character.imagesLoaded[this.team] && img && this.width > 0 && this.height > 0) {
      // Apply squish/squash transformation
      const drawWidth = this.width * this.squishScaleX;
      const drawHeight = this.height * this.squishScaleY;
      
      // Calculate position to keep bottom center fixed (y is the bottom of the character)
      const drawX = this.x - drawWidth / 2;
      const drawY = this.y - drawHeight; // Bottom stays at this.y
      
      // Draw character with squish/squash effect
      ctx.drawImage(
        img,
        drawX,
        drawY,
        drawWidth,
        drawHeight
      );
    } else {
      // Fallback: draw a colored rectangle with squish/squash
      ctx.fillStyle = this.team === 'red' ? '#ff6897' : '#2196F3';
      const drawWidth = this.width * this.squishScaleX;
      const drawHeight = this.height * this.squishScaleY;
      const drawX = this.x - drawWidth / 2;
      const drawY = this.y - drawHeight;
      ctx.fillRect(
        drawX,
        drawY,
        drawWidth,
        drawHeight
      );
    }
    
    // Draw bomb on character if carrying one (with lag/drag effect)
    if (this.hasBomb && typeof ThrownBomb !== 'undefined') {
      // Ensure image is loading/loaded
      ThrownBomb.loadImage(this.team);
      
      // Update display size if image just loaded
      if (ThrownBomb.imagesLoaded[this.team] && ThrownBomb.originalDimensions && ThrownBomb.originalDimensions[this.team]) {
        const orig = ThrownBomb.originalDimensions[this.team];
        const aspectRatio = orig.width / orig.height;
        this.bombDisplayWidth = this.width;
        this.bombDisplayHeight = this.width / aspectRatio;
      }
      
      // Draw bomb image if loaded
      if (ThrownBomb.imagesLoaded[this.team] && ThrownBomb.images[this.team]) {
        // Position bomb centered on character (using lagged position)
        const bombX = this.bombX;
        const bombY = this.bombY;
        
        // Draw bomb image with preserved aspect ratio, centered on character
        const drawX = bombX - this.bombDisplayWidth / 2;
        const drawY = bombY - this.bombDisplayHeight;
        ctx.drawImage(ThrownBomb.images[this.team], drawX, drawY, this.bombDisplayWidth, this.bombDisplayHeight);
      }
    }
  }
  
  drawTrail(ctx) {
    // Draw white fading trail
    // When in air: draw active trail
    // When on ground: draw fading trail (if any points remain from being in air)
    if (this.trail.length < 2) return; // Need at least 2 points to draw a line
    
    ctx.save();
    ctx.strokeStyle = '#ffffff'; // White color
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    // Draw trail as connected segments with fading opacity
    for (let i = 0; i < this.trail.length - 1; i++) {
      const point1 = this.trail[i];
      const point2 = this.trail[i + 1];
      
      // Use the opacity of the older point (fades from new to old)
      ctx.globalAlpha = point1.opacity;
      
      // Calculate line width based on opacity (thicker at start, thinner at end)
      const lineWidth = 3 * point1.opacity;
      ctx.lineWidth = Math.max(1, lineWidth);
      
      // Draw line segment
      ctx.beginPath();
      ctx.moveTo(point1.x, point1.y);
      ctx.lineTo(point2.x, point2.y);
      ctx.stroke();
    }
    
    ctx.restore();
  }
  
  drawParticles(ctx) {
    // Draw all paint particles
    for (const p of this.particles) {
      ctx.save();
      ctx.globalAlpha = p.life; // Fade out as particle dies
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

