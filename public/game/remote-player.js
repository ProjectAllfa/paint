// RemotePlayer class - represents a remote player (controlled by server)
// This is a simplified version that only displays and updates from server state
class RemotePlayer {
  constructor(x, y, team, playerId) {
    // Snapshot buffer for interpolation
    this.snapshotBuffer = []; // Array of { tick, serverTime, x, y, velocityX, velocityY, ... }
    this.maxBufferSize = 5; // Keep last 5 snapshots
    this.lastProcessedTick = -1; // Track last processed snapshot tick to only reconcile on new snapshots
    this.lastServerJumpsUsed = 0; // Track last server jumpsUsed to detect jump events
    this.justAppliedJump = false; // Track if we just applied a jump (prevent position correction)
    this.jumpApplyFrameCount = 0; // Count frames since jump was applied
    
    // Temporal interpolation settings
    this.renderDelay = 100; // Render 100ms in the past for smooth interpolation (matches Game class)
    
    // Position smoothing to reduce jitter
    this.smoothedX = x;
    this.smoothedY = y;
    this.positionSmoothing = 0.25; // How quickly position converges (lower = smoother but more lag)
    
    // Interpolated render position
    this.x = x;
    this.y = y;
    
    this.team = team;
    this.playerId = playerId;
    this.width = 0;
    this.height = 0;
    
    // Physics constants (matching Character class EXACTLY)
    this.speed = 180; // pixels per second (horizontal movement) - matching Character
    this.gravity = 1500; // gravity acceleration (pixels per second squared)
    this.maxFallSpeed = 1200; // pixels per second
    this.jumpPower = -600; // jump velocity (pixels per second) - matching Character
    this.jumpPadBounce = -900; // jump pad bounce velocity (pixels per second)
    this.maxJumps = 2; // allow double jump - matching Character
    
    // Visual state (for rendering)
    this.velocityX = 0;
    this.velocityY = 0;
    this.hasBomb = false;
    this.onGround = false;
    this.wasInJumpPad = false; // track if we were in a jump pad last frame
    this.jumpsUsed = 0; // track jumps (for consistency with Character)
    
    // Bomb position with lag (for drag effect)
    this.bombX = x;
    this.bombY = y;
    this.bombDisplayWidth = 0;
    this.bombDisplayHeight = 0;
    
    // Squish animation (for visual consistency - matching Character)
    this.squishScaleX = 1.0;
    this.squishScaleY = 1.0;
    this.animationTime = 0; // time accumulator for looping animation (radians)
    this.animationSpeed = 15; // how fast the animation cycles (radians per second)
    this.squishAmount = 0.08; // how much to stretch/squish (8%)
    
    // Air trail effect (white fading tail when mid-air) - matching Character
    this.trail = []; // array of trail points {x, y, opacity}
    this.trailMaxLength = 15; // maximum number of trail points
    this.trailSpawnTimer = 0; // timer in seconds
    this.trailSpawnInterval = 0.0333; // add trail point every N seconds (2 frames at 60fps = 0.0333s)
    
    // Jump effect animation state - matching Character
    this.jumpEffectActive = false;
    this.jumpEffectFrame = 0;
    this.jumpEffectFrameTimer = 0; // timer in seconds
    this.jumpEffectFrameDuration = 0.05; // seconds per animation frame (3 frames at 60fps = 0.05s)
    this.wasOnGround = true; // track previous frame's ground state
    this.jumpEffectSpawnX = 0; // X position where jump effect spawns
    this.jumpEffectSpawnY = 0; // Y position where jump effect spawns
    this.lastJumpsUsed = 0; // track previous frame's jumpsUsed to detect jump events
    this.lastVelocityY = 0; // track previous frame's velocityY to detect sudden changes (jump pad bounces)
    
    // Paint particle system - matching Character
    this.particles = []; // array of paint particles
    this.particleSpawnTimer = 0; // timer to control particle spawn rate (seconds)
    this.particleSpawnInterval = 0.0667; // spawn a particle every N seconds (4 frames at 60fps = 0.0667s)
    
    // Use Character's image cache (shared)
    if (typeof Character !== 'undefined') {
      if (!Character.imagesLoading[team] && !Character.imagesLoaded[team]) {
        Character.loadImage(team);
      }
      
      // Load jump effect spritesheet if not already loading/loaded (shared with Character)
      if (!Character.jumpEffectLoading && !Character.jumpEffectLoaded) {
        Character.loadJumpEffectImage();
      }
    }
  }

  setSize(width, height) {
    this.width = width;
    this.height = height;
    
    // Update bomb display size if carrying one (always recalculate to ensure correct aspect ratio)
    if (this.hasBomb && typeof ThrownBomb !== 'undefined') {
      ThrownBomb.loadImage(this.team);
      
      if (ThrownBomb.originalDimensions && ThrownBomb.originalDimensions[this.team]) {
        const orig = ThrownBomb.originalDimensions[this.team];
        const aspectRatio = orig.width / orig.height;
        this.bombDisplayWidth = width;
        this.bombDisplayHeight = width / aspectRatio;
      } else {
        // Fallback: use character size (will be updated when image loads in updateVisualEffects)
        this.bombDisplayWidth = width;
        this.bombDisplayHeight = height;
      }
    }
  }

  // Add snapshot to buffer and reconcile (matching local player - only reconcile on new snapshots)
  addSnapshot(tick, serverTime, playerState) {
    const snapshot = {
      tick: tick,
      serverTime: serverTime,
      clientReceiveTime: performance.now(),
      x: playerState.x,
      y: playerState.y,
      velocityX: playerState.velocityX || 0,
      velocityY: playerState.velocityY,
      hasBomb: playerState.hasBomb,
      onGround: playerState.onGround,
      jumpsUsed: playerState.jumpsUsed || 0
    };
    
    this.snapshotBuffer.push(snapshot);
    
    // Keep buffer size limited
    if (this.snapshotBuffer.length > this.maxBufferSize) {
      this.snapshotBuffer.shift(); // Remove oldest
    }
    
    // CRITICAL: Only reconcile on NEW snapshots (matching local player behavior)
    // This prevents aggressive corrections every frame
    // CRITICAL: Don't set position/velocity directly on first snapshot - let reconciliation handle it
    // This matches local player: it never gets position set from snapshots, only reconciled
    if (tick > this.lastProcessedTick) {
      this.lastProcessedTick = tick;
      
      // If this is the first snapshot, set initial position/velocity (but still reconcile)
      if (this.snapshotBuffer.length === 1) {
        this.x = playerState.x;
        this.y = playerState.y;
        this.smoothedX = playerState.x;
        this.smoothedY = playerState.y;
        this.velocityX = playerState.velocityX || 0;
        this.velocityY = playerState.velocityY || 0;
        this.bombX = playerState.x;
        this.bombY = playerState.y;
        this.lastServerJumpsUsed = playerState.jumpsUsed || 0; // Initialize for jump detection
        // Don't reconcile first snapshot - it's already set correctly
        return;
      }
      
      // Reconcile with this snapshot (matching local player reconciliation)
      this.reconcileWithSnapshot(snapshot);
    }
  }
  
  // Reconcile with server snapshot - SIMPLIFIED: Just add to buffer, interpolation handles movement
  // CRITICAL CHANGE: Since we're using interpolation as primary method, we don't need complex reconciliation
  // The interpolation will naturally follow server state, preventing desync
  reconcileWithSnapshot(snapshot) {
    // Track previous hasBomb state to detect transitions
    const previousHasBomb = this.hasBomb;
    
    // Sync state flags (server is authoritative) - these don't affect position
    this.hasBomb = snapshot.hasBomb;
    
    // Detect when hasBomb transitions from false to true and initialize bomb position
    if (this.hasBomb && !previousHasBomb) {
      // Always initialize bomb position at character position when picking up
      this.bombX = this.x;
      this.bombY = this.y;
      
      // Initialize bomb display size (always update to ensure correct aspect ratio)
      // Ensure ThrownBomb image is loaded for this team
      if (typeof ThrownBomb !== 'undefined') {
        ThrownBomb.loadImage(this.team);
        
        // Calculate bomb display size preserving aspect ratio
        if (ThrownBomb.originalDimensions && ThrownBomb.originalDimensions[this.team]) {
          const orig = ThrownBomb.originalDimensions[this.team];
          const aspectRatio = orig.width / orig.height;
          this.bombDisplayWidth = this.width;
          this.bombDisplayHeight = this.width / aspectRatio;
        } else {
          // Fallback: use character size (will be updated when image loads in updateVisualEffects)
          this.bombDisplayWidth = this.width;
          this.bombDisplayHeight = this.height;
        }
      } else {
        // Fallback: use character size
        this.bombDisplayWidth = this.width;
        this.bombDisplayHeight = this.height;
      }
    }
    
    if (snapshot.jumpsUsed !== undefined) {
      this.jumpsUsed = snapshot.jumpsUsed;
    }
    
    // Update last server jumpsUsed for tracking (not used for jump detection anymore)
    this.lastServerJumpsUsed = snapshot.jumpsUsed || 0;
    
    // CRITICAL: Don't do position/velocity reconciliation here
    // Interpolation in update() will handle movement based on snapshots
    // This prevents desync issues from trying to reconcile physics simulation
  }
  
  // Update visual effects (squish animation, bomb position)
  // This is called both from interpolation mode and physics mode
  updateVisualEffects(deltaTime, dx = null, map = null) {
    // Calculate dx from velocityX if not provided
    if (dx === null) {
      dx = this.velocityX !== 0 ? (this.velocityX > 0 ? this.speed * deltaTime : -this.speed * deltaTime) : 0;
    }
    
    // Update squish animation based on movement (matching Character)
    if (dx !== 0 || Math.abs(this.velocityX) > 0.1) {
      // Moving - continuously loop the animation
      this.animationTime += this.animationSpeed * deltaTime;
      const sinValue = Math.sin(this.animationTime);
      this.squishScaleX = 1.0 + (sinValue * this.squishAmount);
      this.squishScaleY = 1.0 - (sinValue * this.squishAmount);
      
      // Spawn paint particles only when walking on ground - matching Character, time-based
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
    
    // Detect jump events to trigger jump effect - matching Character
    // Trigger jump effect when jumpsUsed increases (indicates a jump happened)
    if (this.jumpsUsed > this.lastJumpsUsed) {
      // Jump detected - trigger jump effect animation at character center position
      this.jumpEffectActive = true;
      this.jumpEffectFrame = 0;
      this.jumpEffectFrameTimer = 0;
      this.jumpEffectSpawnX = this.x;
      this.jumpEffectSpawnY = this.y - this.height / 2; // Center of character (this.y is bottom)
    }
    // Also trigger when transitioning from onGround to mid-air (for cases where jumpsUsed might not change)
    if (this.wasOnGround && !this.onGround && !this.jumpEffectActive) {
      // Transitioned from ground to air - trigger jump effect
      this.jumpEffectActive = true;
      this.jumpEffectFrame = 0;
      this.jumpEffectFrameTimer = 0;
      this.jumpEffectSpawnX = this.x;
      this.jumpEffectSpawnY = this.y - this.height / 2; // Center of character (this.y is bottom)
    }
    
    // Detect jump pad interactions to trigger jump pad animation - matching Character
    if (map) {
      const jumpPad = this.findJumpPadAt(this.x, this.y, map);
      // Trigger animation when:
      // 1. Entering jump pad (wasn't in one before, now is)
      // 2. VelocityY suddenly becomes very negative (bounce effect from jump pad)
      const suddenUpwardVelocity = this.lastVelocityY >= -100 && this.velocityY < -500;
      if (jumpPad && (!this.wasInJumpPad || suddenUpwardVelocity)) {
        // Entering jump pad or bouncing on it - trigger animation
        jumpPad.triggerAnimation();
      }
      this.wasInJumpPad = !!jumpPad;
      this.lastVelocityY = this.velocityY;
    }
    
    // Update previous state for next frame
    this.lastJumpsUsed = this.jumpsUsed;
    this.wasOnGround = this.onGround;
    
    // Initialize or update bomb display size if hasBomb
    if (this.hasBomb) {
      // Ensure ThrownBomb image is loaded for this team
      if (typeof ThrownBomb !== 'undefined') {
        ThrownBomb.loadImage(this.team);
        
        // Calculate bomb display size preserving aspect ratio
        // Update if dimensions are now available (image loaded) or if not yet initialized
        if (ThrownBomb.originalDimensions && ThrownBomb.originalDimensions[this.team]) {
          const orig = ThrownBomb.originalDimensions[this.team];
          const aspectRatio = orig.width / orig.height;
          // Always update to ensure correct aspect ratio (in case image loaded after initial setup)
          this.bombDisplayWidth = this.width;
          this.bombDisplayHeight = this.width / aspectRatio;
        } else if (this.bombDisplayWidth === 0) {
          // Fallback: use character size (will be updated when image loads)
          this.bombDisplayWidth = this.width;
          this.bombDisplayHeight = this.height;
        }
      } else if (this.bombDisplayWidth === 0) {
        // Fallback: use character size
        this.bombDisplayWidth = this.width;
        this.bombDisplayHeight = this.height;
      }
    }
    
    // Update bomb position with lag (for visual effect) - matching Character
    if (this.hasBomb) {
      const lagFactor = 0.15;
      this.bombX += (this.x - this.bombX) * lagFactor;
      this.bombY += (this.y - this.bombY) * lagFactor;
    } else {
      this.bombX = this.x;
      this.bombY = this.y;
    }
    
    // Update air trail effect (only when mid-air, not on ground) - matching Character, time-based
    if (!this.onGround) {
      // Add trail points when in air
      this.trailSpawnTimer += deltaTime;
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
        this.trail[i].opacity -= 0.05 * deltaTime * 60; // Convert to per-frame equivalent for consistency
        if (this.trail[i].opacity <= 0) {
          this.trail.splice(i, 1); // Remove fully faded points
        }
      }
      this.trailSpawnTimer = 0;
    }
    
    // Update jump effect animation - matching Character, time-based
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
  }
  
  // Interpolate position from snapshot buffer using temporal interpolation
  // This provides smooth movement by interpolating between snapshots based on time
  interpolateFromSnapshots() {
    if (this.snapshotBuffer.length < 2) {
      // Not enough snapshots for interpolation - use latest or skip
      if (this.snapshotBuffer.length === 1) {
        const latest = this.snapshotBuffer[0];
        // Only use if snapshot is recent (within 500ms)
        const age = performance.now() - latest.clientReceiveTime;
        if (age < 500) {
          // Apply smoothing even for single snapshot to reduce jitter
          this.x = this.smoothedX + (latest.x - this.smoothedX) * (1.0 - this.positionSmoothing);
          this.smoothedX = this.x;
          this.y = this.smoothedY + (latest.y - this.smoothedY) * (1.0 - this.positionSmoothing);
          this.smoothedY = this.y;
          this.velocityX = latest.velocityX || 0;
          this.velocityY = latest.velocityY || 0;
          // Update state flags from latest snapshot
          this.onGround = latest.onGround || false;
        }
      }
      return;
    }
    
    // Calculate target time (current time - render delay for smooth interpolation)
    const targetTime = performance.now() - this.renderDelay;
    
    // Find two snapshots that bracket the target time
    // Sort by serverTime to ensure chronological order
    const sortedSnapshots = [...this.snapshotBuffer].sort((a, b) => a.serverTime - b.serverTime);
    
    // Remove stale snapshots (older than 500ms) to prevent using outdated data
    const now = performance.now();
    const recentSnapshots = sortedSnapshots.filter(s => now - s.clientReceiveTime < 500);
    
    if (recentSnapshots.length < 2) {
      // Not enough recent snapshots - use latest with smoothing
      if (recentSnapshots.length > 0) {
        const latest = recentSnapshots[recentSnapshots.length - 1];
        this.x = this.smoothedX + (latest.x - this.smoothedX) * (1.0 - this.positionSmoothing);
        this.smoothedX = this.x;
        this.y = this.smoothedY + (latest.y - this.smoothedY) * (1.0 - this.positionSmoothing);
        this.smoothedY = this.y;
        this.velocityX = latest.velocityX || 0;
        this.velocityY = latest.velocityY || 0;
        this.onGround = latest.onGround || false;
      }
      return;
    }
    
    // Find the two snapshots to interpolate between
    let prevSnapshot = null;
    let nextSnapshot = null;
    
    for (let i = 0; i < recentSnapshots.length - 1; i++) {
      const current = recentSnapshots[i];
      const next = recentSnapshots[i + 1];
      
      // Check if target time falls between these two snapshots
      // Use clientReceiveTime for interpolation (more accurate for network jitter)
      if (targetTime >= current.clientReceiveTime && targetTime <= next.clientReceiveTime) {
        prevSnapshot = current;
        nextSnapshot = next;
        break;
      }
    }
    
    // If we didn't find bracketing snapshots, use the two most recent
    if (!prevSnapshot || !nextSnapshot) {
      prevSnapshot = recentSnapshots[recentSnapshots.length - 2];
      nextSnapshot = recentSnapshots[recentSnapshots.length - 1];
    }
    
    // Calculate time delta from previous snapshot
    const deltaTimeFromPrev = (targetTime - prevSnapshot.clientReceiveTime) / 1000; // Convert to seconds
    const timeRange = nextSnapshot.clientReceiveTime - prevSnapshot.clientReceiveTime;
    
    // Calculate interpolation factor (0 = prevSnapshot, 1 = nextSnapshot)
    let t = 0;
    if (timeRange > 0) {
      t = deltaTimeFromPrev / (timeRange / 1000);
      // Clamp to [0, 1] to prevent extrapolation
      t = Math.max(0, Math.min(1, t));
    }
    
    // CRITICAL: For horizontal movement, use linear interpolation with smoothing
    const targetX = prevSnapshot.x + (nextSnapshot.x - prevSnapshot.x) * t;
    this.x = this.smoothedX + (targetX - this.smoothedX) * (1.0 - this.positionSmoothing);
    this.smoothedX = this.x;
    this.velocityX = prevSnapshot.velocityX + (nextSnapshot.velocityX - prevSnapshot.velocityX) * t;
    
    // CRITICAL: Detect sudden velocity changes (jump pad bounces, collisions, etc.)
    // When velocity changes dramatically, physics extrapolation doesn't work because
    // the server has already applied the collision/bounce. Use linear interpolation instead.
    const prevVelY = prevSnapshot.velocityY || 0;
    const nextVelY = nextSnapshot.velocityY || 0;
    const velocityChange = Math.abs(nextVelY - prevVelY);
    
    // Detect jump pad bounce: velocity goes from falling/neutral to very negative
    // Jump pad bounce is typically -900, so detect when velocity becomes very negative
    const isJumpPadBounce = prevVelY >= -100 && nextVelY < -500;
    
    // Detect other sudden velocity changes (collisions, wall bounces, etc.)
    // If velocity changes by more than 400 in a short time, it's likely a collision
    const isSuddenVelocityChange = velocityChange > 400 && timeRange < 200; // Within 200ms
    
    // If we detect a sudden velocity change (especially jump pad), use linear interpolation
    // This ensures the visual position matches the server state immediately
    // This prevents the visual lag where player appears to bounce before touching jump pad
    if (isJumpPadBounce || isSuddenVelocityChange) {
      // Use linear interpolation for Y position to match server state exactly
      // Linear interpolation ensures we follow the server's trajectory, which already accounts
      // for the jump pad collision, rather than extrapolating from the pre-collision state
      const targetY = prevSnapshot.y + (nextSnapshot.y - prevSnapshot.y) * t;
      this.y = this.smoothedY + (targetY - this.smoothedY) * (1.0 - this.positionSmoothing);
      this.smoothedY = this.y;
      this.velocityY = prevSnapshot.velocityY + (nextSnapshot.velocityY - prevSnapshot.velocityY) * t;
    } else {
      // CRITICAL: For normal vertical movement, use physics-based extrapolation to preserve natural gravity arc
      // Linear interpolation creates straight lines, but jumps/falls follow parabolas due to gravity
      // Solution: Start from previous snapshot's position and velocity, extrapolate forward using physics
      // This ensures the natural parabolic trajectory is preserved
      
      // Extrapolate Y position using physics from previous snapshot
      // Formula: y = y0 + v0*t + 0.5*g*t^2
      // Start with previous snapshot's velocity, then apply gravity over time
      const extrapolatedY = prevSnapshot.y + prevSnapshot.velocityY * deltaTimeFromPrev + 
                             0.5 * this.gravity * deltaTimeFromPrev * deltaTimeFromPrev;
      
      // Calculate expected velocity at this point (velocity changes due to gravity)
      const expectedVelocityY = prevSnapshot.velocityY + this.gravity * deltaTimeFromPrev;
      // Clamp velocity to max fall speed
      const extrapolatedVelocityY = Math.min(expectedVelocityY, this.maxFallSpeed);
      
      // Calculate linear interpolation for comparison
      const linearY = prevSnapshot.y + (nextSnapshot.y - prevSnapshot.y) * t;
      const linearVelocityY = prevSnapshot.velocityY + (nextSnapshot.velocityY - prevSnapshot.velocityY) * t;
      
      // Use linear interpolation for Y position (simpler and smoother)
      // Physics extrapolation was causing jitter due to constant corrections
      // Linear interpolation follows server state exactly, preventing jitter
      const targetY = linearY;
      
      // Apply smoothing to reduce jitter
      this.y = this.smoothedY + (targetY - this.smoothedY) * (1.0 - this.positionSmoothing);
      this.smoothedY = this.y;
      
      // Use linear velocity interpolation
      this.velocityY = linearVelocityY;
    }
    
    // Use state flags from the most recent snapshot (not interpolated)
    // This ensures we have the correct onGround state for visual effects
    this.onGround = nextSnapshot.onGround || false;
  }
  
  // Update position - PRIMARY: Use server snapshots with interpolation, SECONDARY: Minimal physics smoothing
  // CRITICAL CHANGE: Rely more on server state to prevent desync issues
  // Root problem: Client-side physics prediction for remote players causes desync with server
  // Solution: Use server snapshots as primary source, only apply minimal physics for smoothing
  update(deltaTime = 1/60, map = null) {
    if (!map) return;
    
    // Ensure deltaTime is reasonable (prevent huge jumps)
    deltaTime = Math.min(deltaTime, 1/30); // Cap at 30fps minimum
    
    // PRIMARY: Use interpolation from server snapshots (server is authoritative)
    // This ensures we follow server state exactly, preventing desync
    if (this.snapshotBuffer.length >= 2) {
      // We have enough snapshots for interpolation - use that as primary source
      this.interpolateFromSnapshots();
      
      // Update visual effects based on interpolated velocity
      const dx = this.velocityX !== 0 ? (this.velocityX > 0 ? this.speed * deltaTime : -this.speed * deltaTime) : 0;
      this.updateVisualEffects(deltaTime, dx, map);
      // Update paint particles (pass map and deltaTime for collision detection) - matching Character
      this.updateParticles(map, deltaTime);
      return; // Skip physics simulation - server snapshots are authoritative
    } else if (this.snapshotBuffer.length === 1) {
      // Only one snapshot - use it directly
      // CRITICAL: Always set position directly from snapshot to ensure player is visible
      const latestSnapshot = this.snapshotBuffer[0];
      const age = performance.now() - latestSnapshot.clientReceiveTime;
      
      if (age < 1000) {
        // Snapshot is recent enough - use it directly
        // Don't use smoothing here - it can cause issues if position is uninitialized
        this.x = latestSnapshot.x;
        this.y = latestSnapshot.y;
        this.velocityX = latestSnapshot.velocityX || 0;
        this.velocityY = latestSnapshot.velocityY || 0;
        this.onGround = latestSnapshot.onGround || false;
        this.jumpsUsed = latestSnapshot.jumpsUsed || 0;
        
        // Update visual effects
        const dx = this.velocityX !== 0 ? (this.velocityX > 0 ? this.speed * deltaTime : -this.speed * deltaTime) : 0;
        this.updateVisualEffects(deltaTime, dx, map);
        // Update paint particles (pass map and deltaTime for collision detection) - matching Character
        this.updateParticles(map, deltaTime);
        return;
      }
    }
    
    // FALLBACK: No snapshots or very stale - use latest snapshot if available
    if (this.snapshotBuffer.length > 0) {
      const latestSnapshot = this.snapshotBuffer[this.snapshotBuffer.length - 1];
      // Use snapshot even if stale - better than nothing, but apply smoothing
      this.x = this.smoothedX + (latestSnapshot.x - this.smoothedX) * (1.0 - this.positionSmoothing);
      this.smoothedX = this.x;
      this.y = this.smoothedY + (latestSnapshot.y - this.smoothedY) * (1.0 - this.positionSmoothing);
      this.smoothedY = this.y;
      this.velocityX = latestSnapshot.velocityX || 0;
      this.velocityY = latestSnapshot.velocityY || 0;
      this.onGround = latestSnapshot.onGround || false;
      this.jumpsUsed = latestSnapshot.jumpsUsed || 0;
      
      // Update visual effects
      const dx = this.velocityX !== 0 ? (this.velocityX > 0 ? this.speed * deltaTime : -this.speed * deltaTime) : 0;
      this.updateVisualEffects(deltaTime, dx);
      // Update paint particles (pass map and deltaTime for collision detection) - matching Character
      this.updateParticles(map, deltaTime);
      return;
    }
    
    // No snapshots available - can't update (shouldn't happen in normal gameplay)
    // Just update visual effects with current state
    const dx = this.velocityX !== 0 ? (this.velocityX > 0 ? this.speed * deltaTime : -this.speed * deltaTime) : 0;
    this.updateVisualEffects(deltaTime, dx, map);
    // Update paint particles (pass map and deltaTime for collision detection) - matching Character
    this.updateParticles(map, deltaTime);
  }
  
  // Legacy method (kept for compatibility)
  updateFromServer(state) {
    // If state has tick and serverTime, use new snapshot system
    if (state.tick !== undefined && state.serverTime !== undefined) {
      this.addSnapshot(state.tick, state.serverTime, state);
    } else {
      // Fallback: use snapshot system with fake tick to avoid direct position setting
      // CRITICAL: Don't set position directly - it causes snapping
      // Use addSnapshot which will handle it properly
      const fakeTick = this.lastProcessedTick + 1;
      this.addSnapshot(fakeTick, Date.now(), state);
    }
  }
  
  // Get ground Y position (matching Character.getGroundY)
  getGroundY(x, map) {
    if (!map) return null;
    
    // Find the top of the block directly below the character's x position
    // Use current Y position (this.y) to determine which blocks are "below" the character
    const charLeft = x - this.width / 2;
    const charRight = x + this.width / 2;
    let closestGround = null;
    
    // Maximum distance to consider for ground detection (prevents finding blocks far below)
    // This prevents jump pads far below from being detected as ground when at ceiling
    // Match Character.getGroundY: maxGroundDistance = 50
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
            // Match Character.getGroundY logic exactly
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
  
  // Get jump pad at position (matching Character.getJumpPadAt)
  getJumpPadAt(x, groundY, map) {
    if (!map) return null;
    
    // Match Character.getJumpPadAt logic: check if character is horizontally over jump pad
    // and groundY matches the jump pad's top (within 2 pixel threshold)
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
          
          // Check if character is horizontally over this jump pad and groundY matches
          // Match Character threshold: < 2 pixels
          if (charLeft < blockRight && charRight > blockLeft && Math.abs(groundY - blockTop) < 2) {
            return block;
          }
        }
      }
    }
    
    return null;
  }
  
  // Check collision (matching Character.checkCollision)
  checkCollision(x, y, map, prevY = null) {
    // Check if character would collide with any block
    // Returns: {collided: bool, blockBottom: number|null} for proper positioning
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
              // When falling or stationary, check if character is on top of the pad
              const charBottomY = y; // y is the bottom of the character
              const distanceFromTop = charBottomY - blockTop;
              
              // If character's bottom is at or near the pad's top, they're on top (not inside)
              if (distanceFromTop <= 5) {
                continue; // Character is on top - allow passing through
              }
              // If character is inside the pad, always allow passing through to prevent getting stuck
              if (distanceFromTop > 5 && distanceFromTop < block.height) {
                continue; // Character is inside - allow passing through
              }
            }
            
            // For upward movement, check if character is overlapping with block
            if (this.velocityY < 0) {
              // Moving upward - check if character is horizontally aligned with block
              if (charLeft < blockRight && charRight > blockLeft) {
                // Check if character's top is at or past the block's bottom
                if (charTop <= blockBottom) {
                  if (prevY !== null) {
                    const wasBelow = prevCharTop > blockBottom;
                    return { collided: true, blockBottom: blockBottom };
                  } else {
                    return { collided: true, blockBottom: blockBottom };
                  }
                }
                continue;
              }
              continue;
            }
            
            // For downward or horizontal movement, use normal collision
            return { collided: true, blockBottom: null };
          }
        }
      }
    }
    
    return { collided: false, blockBottom: null };
  }
  
  // Check if touching or very close to any block (matching Character.isTouchingBlock)
  isTouchingBlock(map) {
    if (!map) return false;
    
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
  
  // Check jump pad collision (matching Character.checkJumpPadCollision)
  checkJumpPadCollision(x, y, map) {
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
  
  // Find jump pad at position (matching Character.findJumpPadAt)
  findJumpPadAt(x, y, map) {
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
            return block;
          }
        }
      }
    }
    return null;
  }
  
  spawnPaintParticle() {
    // Spawn a paint particle behind the character - matching Character
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
    
    // Update all particles - matching Character, time-based
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
    // Check if particle collides with any block - matching Character
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
          if (typeof Block !== 'undefined' && block.imageIndex === Block.JUMP_PAD_INDEX) continue;
          
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
  
  drawParticles(ctx) {
    // Draw all paint particles - matching Character
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
  
  draw(ctx) {
    // Draw paint particles first (behind character) - matching Character
    this.drawParticles(ctx);
    
    // Draw air trail effect (behind character, only when mid-air) - matching Character
    this.drawTrail(ctx);
    
    // Draw jump effect animation (if active) - matching Character
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
    
    // Use Character's shared image cache
    const img = typeof Character !== 'undefined' ? Character.images[this.team] : null;
    const isLoaded = typeof Character !== 'undefined' ? Character.imagesLoaded[this.team] : false;
    
    if (isLoaded && img && this.width > 0 && this.height > 0) {
      // Apply squish/squash transformation (matching Character)
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
    
    // Draw bomb on character if carrying one
    if (this.hasBomb && typeof ThrownBomb !== 'undefined') {
      if (ThrownBomb.imagesLoaded[this.team] && ThrownBomb.images[this.team]) {
        const drawX = this.bombX - this.bombDisplayWidth / 2;
        const drawY = this.bombY - this.bombDisplayHeight;
        ctx.drawImage(ThrownBomb.images[this.team], drawX, drawY, this.bombDisplayWidth, this.bombDisplayHeight);
      }
    }
  }
  
  drawTrail(ctx) {
    // Draw white fading trail - matching Character
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
}
