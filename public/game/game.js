// Main game class
class Game {
  // Static arrow images for local player indicator
  static arrowImages = {
    red: null,
    blue: null
  };
  static arrowImagesLoaded = {
    red: false,
    blue: false
  };
  static arrowImagesLoading = {
    red: false,
    blue: false
  };
  
  static loadArrowImage(team) {
    if (Game.arrowImagesLoading[team] || Game.arrowImagesLoaded[team]) return;
    
    Game.arrowImagesLoading[team] = true;
    const img = new Image();
    img.onload = () => {
      Game.arrowImagesLoaded[team] = true;
      Game.arrowImagesLoading[team] = false;
    };
    img.onerror = () => {
      console.error(`Failed to load arrow image: assets/arrow/${team}_arrow.png`);
      Game.arrowImagesLoading[team] = false;
    };
    img.src = `assets/arrow/${team}_arrow.png`;
    Game.arrowImages[team] = img;
  }
  
  // Static key indicator images (wasd and s)
  static wasdImage = null;
  static wasdImageLoaded = false;
  static wasdImageLoading = false;
  
  static sImage = null;
  static sImageLoaded = false;
  static sImageLoading = false;
  
  static loadKeyImages() {
    // Load WASD image
    if (!Game.wasdImageLoading && !Game.wasdImageLoaded) {
      Game.wasdImageLoading = true;
      const wasdImg = new Image();
      wasdImg.onload = () => {
        Game.wasdImageLoaded = true;
        Game.wasdImageLoading = false;
      };
      wasdImg.onerror = () => {
        console.error('Failed to load WASD image: assets/keys/wasd.png');
        Game.wasdImageLoading = false;
      };
      wasdImg.src = 'assets/keys/wasd.png';
      Game.wasdImage = wasdImg;
    }
    
    // Load S image
    if (!Game.sImageLoading && !Game.sImageLoaded) {
      Game.sImageLoading = true;
      const sImg = new Image();
      sImg.onload = () => {
        Game.sImageLoaded = true;
        Game.sImageLoading = false;
      };
      sImg.onerror = () => {
        console.error('Failed to load S image: assets/keys/s.png');
        Game.sImageLoading = false;
      };
      sImg.src = 'assets/keys/s.png';
      Game.sImage = sImg;
    }
  }
  
  constructor(canvas) {
    this.canvas = canvas;
    this.canvasManager = new CanvasManager(canvas);
    this.ctx = this.canvasManager.getContext();
    this.running = false;
    this.map = null;
    this.inputHandler = new InputHandler();
    
    // Camera - follows player with zoom
    this.camera = new Camera(
      this.canvasManager.getWidth(),
      this.canvasManager.getHeight()
    );
    
    // Star background
    this.starBackground = new StarBackground(
      this.canvasManager.getWidth(),
      this.canvasManager.getHeight()
    );
    
    // Characters array - local player only (Character class)
    this.characters = [];
    
    // Remote players array - remote players (RemotePlayer class)
    this.remotePlayers = [];
    
    // Multiplayer state
    this.localPlayerId = null; // ID of the local player (set by server)
    this.socket = null; // Socket.io connection (set when connecting)
    this.isConnected = false;
    this.isPlayer = false; // Whether this client is a player (false = spectator)
    this.playerTeam = null; // Team of the local player
    this.gameState = 'QUEUE'; // Current game state: 'QUEUE', 'PLAYING', 'ENDED'
    this.lastInputSequence = 0; // Sequence number for input events
    this.lastAcknowledgedSequence = 0; // Last sequence number acknowledged by server
    this.gameResultsData = null; // Store game results data
    
    // Camera transition state (only tracks zoom transition, position uses camera's follow logic)
    this.cameraTransition = {
      active: false,
      startZoom: 1.0,
      endZoom: 1.8,
      duration: 0.8, // seconds
      elapsed: 0
    };
    
    // Client-side prediction: input buffer and state history for reconciliation
    this.inputBuffer = []; // Array of { sequence, inputs, gameTime }
    this.maxInputBufferSize = 60; // Keep last 60 inputs (1 second at 60fps)
    this.stateHistory = []; // Array of { gameTime, x, y, velocityY, ... } for rollback
    this.maxStateHistorySize = 60; // Keep last 60 states (1 second at 60fps)
    
    // Track spawn indices for each team (for round-robin spawning)
    this.spawnIndices = {
      red: 0,
      blue: 0
    };
    
    // Bomb items array
    this.bombs = [];
    
    // Thrown bombs array
    this.thrownBombs = [];
    
    // Animation timing
    this.lastFrameTime = performance.now();
    
    // Fixed timestep for deterministic multiplayer
    this.fixedTimestep = 1/60; // 60 ticks per second (16.67ms per tick)
    this.accumulator = 0; // Accumulates leftover time between frames
    this.maxUpdatesPerFrame = 5; // Prevent spiral of death - max 5 updates per render frame
    
    // Game time for input timestamping (in seconds, starts at 0)
    this.gameTime = 0;
    
    // Network sync
    this.lastStateSyncTime = 0;
    this.stateSyncInterval = 0.1; // Send state sync every 100ms
    
    // Snapshot buffering for interpolation
    this.snapshotBuffer = []; // Array of { tick, serverTime, players, ... }
    this.maxSnapshotBufferSize = 10; // Keep last 10 snapshots
    this.renderDelay = 100; // Render 100ms in the past for smooth interpolation
    this.lastCorrectionTime = 0; // Track when we last corrected local player position
    this.lastReconciliationTime = 0; // Track when we last reconciled with server
    
    // No resize handling needed - game resolution is now fixed!
    
    // Load arrow images for local player indicator
    Game.loadArrowImage('red');
    Game.loadArrowImage('blue');
    
    // Load key indicator images (wasd and s)
    Game.loadKeyImages();
    
    // Visual indicator state for local player (purely visual)
    this.localPlayerVisualIndicators = {
      wasdAlpha: 1.0, // Start visible, fade when player moves
      sAlpha: 0.0, // Start hidden, show when bomb picked up, fade when thrown
      spawnX: null,
      spawnY: null,
      hasMoved: false,
      fadeSpeed: 2.0 // Fade speed per second (alpha units)
    };
  }

  async init(mapName = 'map1') {
    console.log('Game initialized');
    
    // Load map from JSON file
    try {
      const response = await fetch(`assets/maps/${mapName}.json`);
      const mapData = await response.json();
      console.log('Map loaded:', mapData);
      
      // Initialize map with loaded data
      this.map = new Map(
        this.canvasManager.getWidth(),
        this.canvasManager.getHeight(),
        mapData
      );
    } catch (error) {
      console.error('Failed to load map:', error);
      // Fallback to default map if loading fails
      this.map = new Map(
        this.canvasManager.getWidth(),
        this.canvasManager.getHeight()
      );
    }
    
    // Don't spawn character here - wait for server to assign playerId
    // Character will be spawned when we receive 'playerJoined' event
    
    // Initialize bombs from map bomb spawn points
    this.initializeBombs();
    
    this.running = true;
    this.gameLoop();
  }
  
  initializeBombs() {
    if (!this.map) return;
    
    this.bombs = [];
    
    // Create a bomb at each bomb spawn point
    this.map.bombSpawns.forEach(spawnPoint => {
      const bomb = new Bomb(spawnPoint.x, spawnPoint.y, spawnPoint);
      // Size is now based on original image dimensions (50%), not block size
      this.bombs.push(bomb);
    });
  }

  spawnCharacter(team, playerId = null) {
    if (!this.map) return null;
    
    let spawnX = this.canvasManager.getWidth() / 2;
    let spawnY = this.canvasManager.getHeight() / 2;
    
    // Try to use spawn points from map first
    const spawnPoint = this.map.getSpawnPoint(team, this.spawnIndices[team]);
    
    if (spawnPoint) {
      // Use the spawn point from map
      spawnX = spawnPoint.x;
      spawnY = spawnPoint.y;
      // Increment spawn index for next player of this team (round-robin)
      this.spawnIndices[team]++;
    } else {
      // Fallback: Find a safe spawn position - look for a block to spawn on top of
      // Try to find a block near the center to spawn on
      const centerRow = Math.floor(this.map.rows / 2);
      const centerCol = Math.floor(this.map.cols / 2);
      
      // Look for a block in the center area
      for (let offset = 0; offset < 10; offset++) {
        for (let row = centerRow - offset; row <= centerRow + offset; row++) {
          for (let col = centerCol - offset; col <= centerCol + offset; col++) {
            if (row >= 0 && row < this.map.rows && col >= 0 && col < this.map.cols) {
              const block = this.map.blocks[row][col];
              if (block !== null) {
                // Spawn on top of this block (y is the bottom of character, so spawn at top of block)
                spawnX = block.x + block.width / 2;
                spawnY = block.y; // Top of the block (character's bottom will be here)
                offset = 10; // Break outer loop
                row = centerRow + offset + 1; // Break middle loop
                break;
              }
            }
          }
        }
      }
    }
    
    // Character size same as block size
    const charWidth = this.map.blockWidth;
    const charHeight = this.map.blockHeight;
    
    const character = new Character(spawnX, spawnY, team, playerId);
    character.setSize(charWidth, charHeight);
    
    // Initialize visual indicators for local player
    const isLocalPlayer = playerId === this.localPlayerId || 
                         (this.localPlayerId === null && this.characters.length === 0);
    if (isLocalPlayer) {
      this.localPlayerVisualIndicators.wasdAlpha = 1.0;
      this.localPlayerVisualIndicators.sAlpha = 0.0;
      this.localPlayerVisualIndicators.spawnX = spawnX;
      this.localPlayerVisualIndicators.spawnY = spawnY;
      this.localPlayerVisualIndicators.hasMoved = false;
    }
    
    this.characters.push(character);
    return character;
  }

  updateCharacterSizes() {
    if (!this.map) return;
    
    // Character size same as block size
    const charWidth = this.map.blockWidth;
    const charHeight = this.map.blockHeight;
    
    this.characters.forEach(char => {
      char.setSize(charWidth, charHeight);
    });
  }

  updateCharacterPositions(oldStartX, oldStartY, oldTotalWidth, oldTotalHeight) {
    // Keep character positions relative to map when resizing
    // Use grid-based positioning for precision instead of ratio-based to avoid drift
    if (!this.map || this.characters.length === 0) return;
    
    const oldBlockWidth = oldTotalWidth / this.map.cols;
    const oldBlockHeight = oldTotalHeight / this.map.rows;
    
    this.characters.forEach(char => {
      // Calculate character position relative to old map
      const relX = char.x - oldStartX;
      const relY = char.y - oldStartY;
      
      // Calculate grid position in old map (more precise than ratios)
      const oldCol = relX / oldBlockWidth;
      const oldRow = relY / oldBlockHeight;
      
      // Calculate offset within the grid cell (0.0 to 1.0)
      const colOffset = oldCol - Math.floor(oldCol);
      const rowOffset = oldRow - Math.floor(oldRow);
      
      // Apply to new map using grid-based positioning (ensures alignment with blocks)
      const newCol = Math.floor(oldCol);
      const newRow = Math.floor(oldRow);
      
      // Clamp to valid grid bounds
      const clampedCol = Math.max(0, Math.min(this.map.cols - 1, newCol));
      const clampedRow = Math.max(0, Math.min(this.map.rows - 1, newRow));
      
      // Calculate new position using grid coordinates + offset
      char.x = this.map.startX + (clampedCol + colOffset) * this.map.blockWidth;
      char.y = this.map.startY + (clampedRow + rowOffset) * this.map.blockHeight;
    });
  }

  gameLoop() {
    if (!this.running) return;

    // Skip if window is hidden/minimized - prevents catch-up when restored
    if (document.hidden) {
      this.lastFrameTime = performance.now(); // Reset time to prevent accumulation
      this.accumulator = 0; // Reset accumulator when hidden
      requestAnimationFrame(() => this.gameLoop());
      return;
    }

    // Calculate deltaTime
    const currentTime = performance.now();
    let deltaTime = (currentTime - this.lastFrameTime) / 1000; // Convert to seconds
    this.lastFrameTime = currentTime;
    
    // Cap deltaTime to prevent huge jumps (max 1/10 second = 100ms)
    // This prevents the game from trying to catch up too much after being inactive
    if (deltaTime > 0.1) {
      deltaTime = 0.1;
    }

    // Fixed timestep: accumulate time and process fixed-size updates
    this.accumulator += deltaTime;
    
    // Process fixed timestep updates (with cap to prevent spiral of death)
    let updatesThisFrame = 0;
    while (this.accumulator >= this.fixedTimestep && updatesThisFrame < this.maxUpdatesPerFrame) {
      // Update game time for input timestamping
      this.gameTime += this.fixedTimestep;
      this.inputHandler.updateGameTime(this.gameTime);
      
      this.update(this.fixedTimestep);
      this.accumulator -= this.fixedTimestep;
      updatesThisFrame++;
    }
    
    // If we hit the cap, clamp accumulator to prevent infinite accumulation
    if (this.accumulator >= this.fixedTimestep) {
      this.accumulator = this.fixedTimestep;
    }

    // Render at variable rate (independent of update rate)
    this.render();
    requestAnimationFrame(() => this.gameLoop());
  }

  update(deltaTime) {
    // Update star background
    this.starBackground.update(deltaTime);
    
    // Update map (for block animations)
    if (this.map) {
      this.map.update(deltaTime);
    }
    
    // Save state before applying inputs (for rollback/reconciliation)
    this.saveStateForRollback();
    
    // Update characters (only if we're a player)
    if (this.isPlayer) {
      // Only apply local inputs to local player's character
      const keys = this.inputHandler.getKeys();
      this.characters.forEach(character => {
        // Only apply inputs to local player's character
        const isLocalPlayer = character.playerId === this.localPlayerId;
        
        // Apply inputs only to local player, remote players are updated via network sync
        // If game is not playing, pass empty inputs to stop movement
        let inputKeys = {};
        if (isLocalPlayer) {
          if (this.gameState === 'PLAYING') {
            inputKeys = keys;
          } else {
            // Game ended - ensure no inputs are processed
            inputKeys = {};
            // Also stop character velocity immediately if game just ended
            if (this.gameState === 'ENDED') {
              character.velocityY = 0;
            }
          }
        }
        const thrownBomb = character.update(inputKeys, this.map, deltaTime);
        
        // If character threw a bomb, add it to thrown bombs array
        if (thrownBomb && this.gameState === 'PLAYING') {
          this.thrownBombs.push(thrownBomb);
          
          // Send bomb throw event to server if local player
          if (isLocalPlayer && this.socket && this.isConnected) {
            this.socket.emit('bombThrown', {
              playerId: this.localPlayerId,
              x: thrownBomb.x,
              y: thrownBomb.y,
              team: thrownBomb.team,
              throwDirection: thrownBomb.velocityX > 0 ? 1 : -1,
              gameTime: this.gameTime
            });
          }
        }
        
        // Bomb collection is now server-authoritative
        // Client only updates visual state (bombX, bombY, bombDisplayWidth, etc.) when hasBomb changes
        // The server handles collision detection and sets hasBomb in snapshots
        
        // Track previous hasBomb state to detect transitions
        if (character.previousHasBomb === undefined) {
          character.previousHasBomb = character.hasBomb;
        }
        
        // Update bomb visual state when hasBomb changes (for display purposes)
        // Detect when hasBomb transitions from false to true
        const justPickedUpBomb = character.hasBomb && !character.previousHasBomb;
        
        // Detect when bomb is thrown (hasBomb transitions from true to false)
        const justThrewBomb = !character.hasBomb && character.previousHasBomb;
        
        if (justPickedUpBomb) {
          // Always initialize bomb position at character position when picking up
          character.bombX = character.x;
          character.bombY = character.y;
          
          // Show S indicator when bomb is picked up (local player only)
          if (isLocalPlayer) {
            this.localPlayerVisualIndicators.sAlpha = 1.0;
          }
        }
        
        // Update visual indicators for local player
        if (isLocalPlayer) {
          // Check if player has provided input (pressed movement keys)
          // Only fade WASD when player actually presses movement keys, not just when position changes
          if (!this.localPlayerVisualIndicators.hasMoved) {
            // Check if any movement keys are pressed (A, D, W, or S)
            const hasInput = (keys['a'] || keys['A'] || keys['d'] || keys['D'] || 
                             keys['w'] || keys['W'] || keys['s'] || keys['S']);
            
            if (hasInput) {
              this.localPlayerVisualIndicators.hasMoved = true;
            }
          }
          
          // Fade out WASD indicator when player has provided input
          if (this.localPlayerVisualIndicators.hasMoved && this.localPlayerVisualIndicators.wasdAlpha > 0) {
            this.localPlayerVisualIndicators.wasdAlpha -= this.localPlayerVisualIndicators.fadeSpeed * deltaTime;
            this.localPlayerVisualIndicators.wasdAlpha = Math.max(0, this.localPlayerVisualIndicators.wasdAlpha);
          }
          
          // Fade out S indicator when bomb is thrown or no longer has bomb
          if (justThrewBomb || (!character.hasBomb && this.localPlayerVisualIndicators.sAlpha > 0)) {
            this.localPlayerVisualIndicators.sAlpha -= this.localPlayerVisualIndicators.fadeSpeed * deltaTime;
            this.localPlayerVisualIndicators.sAlpha = Math.max(0, this.localPlayerVisualIndicators.sAlpha);
          }
        }
        
        if (character.hasBomb && character.bombDisplayWidth === 0) {
          // Ensure ThrownBomb image is loaded for this team
          if (typeof ThrownBomb !== 'undefined') {
            ThrownBomb.loadImage(character.team);
            
            // Calculate bomb display size preserving aspect ratio
            if (ThrownBomb.originalDimensions && ThrownBomb.originalDimensions[character.team]) {
              const orig = ThrownBomb.originalDimensions[character.team];
              const aspectRatio = orig.width / orig.height;
              character.bombDisplayWidth = character.width;
              character.bombDisplayHeight = character.width / aspectRatio;
            } else {
              // Fallback: use character size (will be updated when image loads)
              character.bombDisplayWidth = character.width;
              character.bombDisplayHeight = character.height;
            }
          } else {
            // Fallback: use character size
            character.bombDisplayWidth = character.width;
            character.bombDisplayHeight = character.height;
          }
        }
        
        // Update previous state for next frame
        character.previousHasBomb = character.hasBomb;
        
        // Update bomb position to follow character (with lag for drag effect)
        if (character.hasBomb) {
          // Smoothly move bomb position towards character position
          const lagFactor = 0.15; // How much lag (lower = more lag)
          character.bombX += (character.x - character.bombX) * lagFactor;
          character.bombY += (character.y - character.bombY) * lagFactor;
        }
      });
    }
    
    // Update bombs (respawn timers and visual effects)
    // Note: Bomb collection state comes from server snapshots
    this.bombs.forEach(bomb => {
      bomb.update(deltaTime);
    });
    
    // Update thrown bombs
    this.thrownBombs = this.thrownBombs.filter(thrownBomb => {
      return thrownBomb.update(this.map, deltaTime);
    });
    
    // Update remote players (physics-based movement matching Character class)
    // Remote players now use the same physics as local players
    this.remotePlayers.forEach(remotePlayer => {
      remotePlayer.update(deltaTime, this.map);
    });
    
    // Send inputs to server if connected
    if (this.isConnected && this.socket && this.localPlayerId !== null) {
      this.sendInputsToServer();
    }
    
    // Send periodic state sync to server
    if (this.isConnected && this.socket && this.gameTime - this.lastStateSyncTime >= this.stateSyncInterval) {
      this.sendStateSync();
      this.lastStateSyncTime = this.gameTime;
    }
    
    // Update camera to follow player (only for players, not spectators)
    if (this.gameState === 'PLAYING') {
      if (this.isPlayer) {
        // Player mode: follow local player
        const localPlayer = this.getLocalPlayer();
        if (localPlayer) {
          const player = localPlayer;
          this.camera.setTarget(player.x, player.y);
        }
        
        // Always update camera (follows player naturally)
        this.camera.update();
        
        // Update zoom transition if active (only for players)
        if (this.cameraTransition.active) {
          this.cameraTransition.elapsed += deltaTime;
          const progress = Math.min(this.cameraTransition.elapsed / this.cameraTransition.duration, 1.0);
          
          // Smooth easing function (ease-in-out)
          const eased = progress < 0.5
            ? 2 * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 2) / 2;
          
          // Interpolate zoom only (camera is already following player naturally)
          const currentZoom = this.cameraTransition.startZoom + 
            (this.cameraTransition.endZoom - this.cameraTransition.startZoom) * eased;
          this.camera.setZoom(currentZoom);
          
          // Transition complete
          if (progress >= 1.0) {
            this.cameraTransition.active = false;
          }
        }
      } else {
        // Spectator mode: keep camera at zoom 1.0, centered on map
        if (this.map) {
          const mapLeft = this.map.startX;
          const mapRight = this.map.startX + (this.map.cols * this.map.blockWidth);
          const mapTop = this.map.startY;
          const mapBottom = this.map.startY + (this.map.rows * this.map.blockHeight);
          
          const centerX = (mapLeft + mapRight) / 2;
          const centerY = (mapTop + mapBottom) / 2;
          
          this.camera.x = centerX;
          this.camera.y = centerY;
          this.camera.setZoom(1.0);
          this.cameraTransition.active = false; // Disable any active transitions
        }
      }
      
      // Set camera bounds to map boundaries
      if (this.map) {
        const mapLeft = this.map.startX;
        const mapRight = this.map.startX + (this.map.cols * this.map.blockWidth);
        const mapTop = this.map.startY;
        const mapBottom = this.map.startY + (this.map.rows * this.map.blockHeight);
        
        // Calculate visible area with current zoom
        const visibleWidth = this.canvas.width / this.camera.zoom;
        const visibleHeight = this.canvas.height / this.camera.zoom;
        
        // Calculate bounds, but only if map is larger than visible area
        const minX = mapLeft + visibleWidth / 2;
        const maxX = mapRight - visibleWidth / 2;
        const minY = mapTop + visibleHeight / 2;
        const maxY = mapBottom - visibleHeight / 2;
        
        // Only set bounds if they're valid (min < max)
        if (minX < maxX && minY < maxY) {
          this.camera.setBounds(minX, maxX, minY, maxY);
        } else {
          // Map is smaller than visible area, center camera on map
          this.camera.clearBounds();
          this.camera.x = (mapLeft + mapRight) / 2;
          this.camera.y = (mapTop + mapBottom) / 2;
        }
      }
    } else if (this.gameState !== 'PLAYING') {
      // Queue or ended state: show full map without zoom/following
      if (this.map) {
        const mapLeft = this.map.startX;
        const mapRight = this.map.startX + (this.map.cols * this.map.blockWidth);
        const mapTop = this.map.startY;
        const mapBottom = this.map.startY + (this.map.rows * this.map.blockHeight);
        
        const centerX = (mapLeft + mapRight) / 2;
        const centerY = (mapTop + mapBottom) / 2;
        
        // Set camera target to map center
        this.camera.setTarget(centerX, centerY);
        this.camera.update();
        
        // Update zoom transition if active (zooming out) - only for players
        if (this.isPlayer && this.cameraTransition.active) {
          this.cameraTransition.elapsed += deltaTime;
          const progress = Math.min(this.cameraTransition.elapsed / this.cameraTransition.duration, 1.0);
          
          // Smooth easing function (ease-in-out)
          const eased = progress < 0.5
            ? 2 * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 2) / 2;
          
          // Interpolate zoom only (camera is already moving to center naturally)
          const currentZoom = this.cameraTransition.startZoom + 
            (this.cameraTransition.endZoom - this.cameraTransition.startZoom) * eased;
          this.camera.setZoom(currentZoom);
          
          // Transition complete
          if (progress >= 1.0) {
            this.cameraTransition.active = false;
          }
        } else {
          // No transition active (or spectator), ensure zoom is 1.0
          this.camera.setZoom(1.0);
          this.cameraTransition.active = false; // Disable any active transitions for spectators
        }
        
        this.camera.clearBounds();
      }
    }
  }

  render() {
    this.canvasManager.clear();
    
    // Fill letterbox/pillarbox areas with blue
    this.ctx.fillStyle = '#56ccea';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    
    // Apply camera transform (zoom + follow player)
    // Only apply camera transforms for players, not spectators
    if (this.isPlayer) {
      // During transitions, use current interpolated zoom and position
      // When playing (after transition), use normal camera transform
      // When queue/ended (after transition), use no zoom
      if (this.gameState === 'PLAYING' || this.cameraTransition.active) {
        this.camera.applyTransform(this.ctx, this.canvas.width, this.canvas.height);
      } else {
        // Queue/ended state: show full map without zoom
        // Apply transform with zoom = 1.0 and centered on map
        this.ctx.save();
        this.ctx.imageSmoothingEnabled = false;
        const screenCenterX = this.canvas.width / 2;
        const screenCenterY = this.canvas.height / 2;
        this.ctx.translate(screenCenterX, screenCenterY);
        this.ctx.scale(1.0, 1.0); // No zoom
        this.ctx.translate(-this.camera.x, -this.camera.y);
      }
    } else {
      // Spectator mode: always show full map without zoom or following
      this.ctx.save();
      this.ctx.imageSmoothingEnabled = false;
      const screenCenterX = this.canvas.width / 2;
      const screenCenterY = this.canvas.height / 2;
      this.ctx.translate(screenCenterX, screenCenterY);
      this.ctx.scale(1.0, 1.0); // No zoom
      this.ctx.translate(-this.camera.x, -this.camera.y);
    }
    
    // Get visible bounds for culling (optional optimization)
    let visibleBounds;
    if (this.gameState === 'PLAYING' || this.cameraTransition.active) {
      // Use camera's visible bounds (works during transitions too)
      visibleBounds = this.camera.getVisibleBounds(this.canvas.width, this.canvas.height);
    } else {
      // Queue/ended state: show full map
      if (this.map) {
        visibleBounds = {
          left: this.map.startX,
          top: this.map.startY,
          width: this.map.cols * this.map.blockWidth,
          height: this.map.rows * this.map.blockHeight
        };
      } else {
        visibleBounds = {
          left: 0,
          top: 0,
          width: this.canvasManager.getWidth(),
          height: this.canvasManager.getHeight()
        };
      }
    }
    
    // Draw background color (cover entire visible area)
    this.ctx.fillStyle = '#56ccea';
    // Draw a large rectangle to cover the visible area
    this.ctx.fillRect(
      visibleBounds.left - 100,
      visibleBounds.top - 100,
      visibleBounds.width + 200,
      visibleBounds.height + 200
    );
    
    // Draw star background (will be drawn at full size, camera will show portion)
    this.starBackground.draw(this.ctx);
    
    // Draw map (all blocks)
    if (this.map) {
      this.map.draw(this.ctx);
    }
    
    // Draw flags at spawn points (behind characters)
    if (this.map) {
      this.map.drawFlags(this.ctx);
    }
    
    // Draw bombs (behind characters)
    this.bombs.forEach(bomb => {
      bomb.draw(this.ctx);
    });
    
    // Draw thrown bombs (behind characters)
    this.thrownBombs.forEach(thrownBomb => {
      thrownBomb.draw(this.ctx);
    });
    
    // Draw local character
    this.characters.forEach(character => {
      character.draw(this.ctx);
    });
    
    // Draw remote players
    this.remotePlayers.forEach(remotePlayer => {
      remotePlayer.draw(this.ctx);
    });
    
    // Draw arrow above local player (purely visual indicator)
    const localPlayer = this.getLocalPlayer();
    if (localPlayer && localPlayer.width > 0 && localPlayer.height > 0) {
      const team = localPlayer.team;
      if (Game.arrowImagesLoaded[team] && Game.arrowImages[team]) {
        const arrowImg = Game.arrowImages[team];
        
        // Safety check: ensure image has valid dimensions
        if (arrowImg.width > 0 && arrowImg.height > 0) {
          // Position arrow above character (centered horizontally, offset above)
          const arrowOffset = 8; // Offset above character in pixels (smaller = closer to character, appears lower)
          const arrowY = localPlayer.y - localPlayer.height - arrowOffset;
          const arrowX = localPlayer.x;
          
          // Calculate arrow size (scale based on character width, maintain aspect ratio)
          // Make arrow slightly smaller than character width for better visibility
          const arrowScale = (localPlayer.width * 0.5) / arrowImg.width;
          const arrowWidth = arrowImg.width * arrowScale;
          const arrowHeight = arrowImg.height * arrowScale;
          
          // Draw arrow centered above character
          this.ctx.drawImage(
            arrowImg,
            arrowX - arrowWidth / 2,
            arrowY - arrowHeight,
            arrowWidth,
            arrowHeight
          );
        }
      }
      
      // Draw WASD indicator (fades out when player moves)
      if (Game.wasdImageLoaded && Game.wasdImage && this.localPlayerVisualIndicators.wasdAlpha > 0) {
        const wasdImg = Game.wasdImage;
        if (wasdImg.width > 0 && wasdImg.height > 0) {
          // Position WASD above character (higher than arrow)
          const wasdOffset = 8; // Offset above character in pixels (smaller = closer to character, appears lower)
          const wasdY = localPlayer.y - localPlayer.height - wasdOffset;
          const wasdX = localPlayer.x;
          
          // Calculate WASD size (scale based on character width, maintain aspect ratio)
          const wasdScale = (localPlayer.width * 2.5) / wasdImg.width; // Increased from 1.2 to 1.5 (150% of character width)
          const wasdWidth = wasdImg.width * wasdScale;
          const wasdHeight = wasdImg.height * wasdScale;
          
          // Draw WASD with alpha transparency
          this.ctx.save();
          this.ctx.globalAlpha = this.localPlayerVisualIndicators.wasdAlpha;
          this.ctx.drawImage(
            wasdImg,
            wasdX - wasdWidth / 2,
            wasdY - wasdHeight,
            wasdWidth,
            wasdHeight
          );
          this.ctx.restore();
        }
      }
      
      // Draw S indicator (shows when bomb picked up, fades when thrown)
      if (Game.sImageLoaded && Game.sImage && this.localPlayerVisualIndicators.sAlpha > 0) {
        const sImg = Game.sImage;
        if (sImg.width > 0 && sImg.height > 0) {
          // Position S above character (same as WASD)
          const sOffset = 8; // Offset above character in pixels (matches WASD)
          const sY = localPlayer.y - localPlayer.height - sOffset;
          const sX = localPlayer.x;
          
          // Calculate S size (scale based on character width, maintain aspect ratio - matches WASD)
          const sScale = (localPlayer.width * 1) / sImg.width; // Matches WASD size (250% of character width)
          const sWidth = sImg.width * sScale;
          const sHeight = sImg.height * sScale;
          
          // Draw S with alpha transparency
          this.ctx.save();
          this.ctx.globalAlpha = this.localPlayerVisualIndicators.sAlpha;
          this.ctx.drawImage(
            sImg,
            sX - sWidth / 2,
            sY - sHeight,
            sWidth,
            sHeight
          );
          this.ctx.restore();
        }
      }
    }
    
    // Remove camera transform
    // Remove camera transform (only if we applied it)
    if (this.gameState === 'PLAYING') {
      this.camera.removeTransform(this.ctx);
    } else {
      // Queue/ended state: restore context from our manual transform
      this.ctx.restore();
    }
  }

  // Serialize game state for network transmission or save/load
  serializeState() {
    return {
      gameTime: this.gameTime,
      characters: this.characters.map(char => ({
        x: char.x,
        y: char.y,
        velocityY: char.velocityY,
        team: char.team,
        hasBomb: char.hasBomb,
        onGround: char.onGround,
        jumpsUsed: char.jumpsUsed
      })),
      bombs: this.bombs.map(bomb => ({
        x: bomb.x,
        y: bomb.y,
        collected: bomb.collected,
        respawnTimer: bomb.respawnTimer,
        rotation: bomb.rotation,
        floatTimer: bomb.floatTimer
      })),
      thrownBombs: this.thrownBombs.map(bomb => ({
        x: bomb.x,
        y: bomb.y,
        velocityX: bomb.velocityX,
        velocityY: bomb.velocityY,
        rotation: bomb.rotation,
        timer: bomb.timer,
        exploded: bomb.exploded,
        explosionRadius: bomb.explosionRadius,
        team: bomb.team
      })),
      mapState: this.map ? {
        blockColors: this.map.blocks.map(row => 
          row.map(block => block ? block.color : null)
        )
      } : null
    };
  }

  // Deserialize game state (for network sync or load)
  deserializeState(state) {
    if (!state) return;

    // Update game time
    this.gameTime = state.gameTime || 0;

    // Update characters
    if (state.characters && this.characters.length === state.characters.length) {
      state.characters.forEach((charState, index) => {
        const char = this.characters[index];
        if (char && char.team === charState.team) {
          char.x = charState.x;
          char.y = charState.y;
          char.velocityY = charState.velocityY;
          char.hasBomb = charState.hasBomb;
          char.onGround = charState.onGround;
          char.jumpsUsed = charState.jumpsUsed;
        }
      });
    }

    // Update bombs
    if (state.bombs && this.bombs.length === state.bombs.length) {
      state.bombs.forEach((bombState, index) => {
        const bomb = this.bombs[index];
        if (bomb) {
          bomb.x = bombState.x;
          bomb.y = bombState.y;
          bomb.collected = bombState.collected;
          bomb.respawnTimer = bombState.respawnTimer;
          bomb.rotation = bombState.rotation;
          bomb.floatTimer = bombState.floatTimer;
        }
      });
    }

    // Update thrown bombs (may need to recreate if count differs)
    if (state.thrownBombs) {
      // For now, just update existing ones - full sync would require recreation
      state.thrownBombs.forEach((bombState, index) => {
        if (index < this.thrownBombs.length) {
          const bomb = this.thrownBombs[index];
          if (bomb && bomb.team === bombState.team) {
            bomb.x = bombState.x;
            bomb.y = bombState.y;
            bomb.velocityX = bombState.velocityX;
            bomb.velocityY = bombState.velocityY;
            bomb.rotation = bombState.rotation;
            bomb.timer = bombState.timer;
            bomb.exploded = bombState.exploded;
            bomb.explosionRadius = bombState.explosionRadius;
          }
        }
      });
    }

    // Update map state (block colors)
    if (state.mapState && state.mapState.blockColors && this.map) {
      state.mapState.blockColors.forEach((row, rowIndex) => {
        if (rowIndex < this.map.rows) {
          row.forEach((color, colIndex) => {
            if (colIndex < this.map.cols && this.map.blocks[rowIndex][colIndex]) {
              const block = this.map.blocks[rowIndex][colIndex];
              if (color && block.color !== color) {
                block.setColor(color);
              }
            }
          });
        }
      });
    }
  }

  // Get current game state snapshot (lightweight, for quick checks)
  getStateSnapshot() {
    return {
      gameTime: this.gameTime,
      characterCount: this.characters.length,
      bombCount: this.bombs.length,
      thrownBombCount: this.thrownBombs.length
    };
  }

  // Multiplayer helper methods
  getLocalPlayer() {
    if (this.localPlayerId === null) {
      return this.characters.length > 0 ? this.characters[0] : null;
    }
    return this.characters.find(char => char.playerId === this.localPlayerId) || null;
  }

  getCharacterByPlayerId(playerId) {
    return this.characters.find(char => char.playerId === playerId) || null;
  }

  getRemotePlayerByPlayerId(playerId) {
    return this.remotePlayers.find(player => player.playerId === playerId) || null;
  }

  // Connect to multiplayer server
  connectToServer(serverUrl = 'http://localhost:3000') {
    if (typeof io === 'undefined') {
      console.error('Socket.io not loaded. Make sure to include socket.io client script.');
      return;
    }

    this.socket = io(serverUrl);
    
    this.socket.on('connect', () => {
      console.log('Connected to server');
      this.isConnected = true;
      // Initialize queue UI on connect (as spectator)
      this.updateQueueUI({ countdown: 10, playerCount: 0 });
      this.isPlayer = false; // Start as spectator
    });
    
    // Handle spectator mode
    this.socket.on('spectatorMode', (data) => {
      console.log('In spectator mode');
      this.isPlayer = false;
      this.updateJoinButton();
    });

    this.socket.on('disconnect', () => {
      console.log('Disconnected from server');
      this.isConnected = false;
    });

    this.socket.on('playerJoined', (data) => {
      console.log('Player joined event:', data);
      
      // Check if this is the local player (matches our socket ID)
      const isLocalPlayer = data.playerId === this.socket.id;
      
      if (isLocalPlayer) {
        this.localPlayerId = data.playerId;
        this.isPlayer = true;
        // Team will be assigned when game starts (data.team may be null)
        if (data.team) {
          this.playerTeam = data.team;
        }
        console.log('Local player ID set to:', this.localPlayerId, 'team:', data.team || 'not assigned yet');
        
        // Update UI to show joined status
        this.updateJoinButton();
        
        // Don't spawn character yet - wait for game to start
        // The character will be spawned when the game starts via snapshot
      } else {
        // Remote player joined - don't create RemotePlayer yet
        // Wait for first snapshot which will have the correct position
        // This prevents remote players from appearing at wrong position (960, 500)
        // The snapshot handler will create the remote player with correct position
        console.log('Remote player joined:', data.playerId, 'team:', data.team || 'not assigned yet', '- waiting for snapshot');
      }
    });
    
    // Handle removal from queue (e.g., after game ends)
    this.socket.on('removedFromQueue', (data) => {
      console.log('Removed from queue:', data);
      
      // Check if this is the local player
      const isLocalPlayer = data.playerId === this.socket.id;
      
      if (isLocalPlayer) {
        // Reset player state
        this.isPlayer = false;
        this.localPlayerId = null;
        this.playerTeam = null;
        
        // Update UI to show join button again
        this.updateJoinButton();
      }
    });
    
    // Handle team assignment when game starts
    this.socket.on('teamAssigned', (data) => {
      if (data.playerId === this.localPlayerId) {
        this.playerTeam = data.team;
        console.log('Team assigned:', data.team);
        // Update UI to show team
        this.updateJoinButton();
      }
    });

    this.socket.on('playerLeft', (data) => {
      console.log('Player left:', data);
      // Remove player's character (if local)
      const charIndex = this.characters.findIndex(char => char.playerId === data.playerId);
      if (charIndex !== -1) {
        this.characters.splice(charIndex, 1);
      }
      // Remove remote player
      const remoteIndex = this.remotePlayers.findIndex(player => player.playerId === data.playerId);
      if (remoteIndex !== -1) {
        this.remotePlayers.splice(remoteIndex, 1);
      }
    });

    // Handle snapshots (new snapshot-based system)
    this.socket.on('snapshot', (snapshot) => {
      this.handleSnapshot(snapshot);
    });
    
    // Legacy gameState handler (for compatibility)
    this.socket.on('gameState', (state) => {
      // Convert to snapshot format if needed
      if (state.type !== 'snapshot') {
        state.type = 'snapshot';
        state.tick = Math.floor(state.gameTime * 60);
        state.serverTime = Date.now();
      }
      this.handleSnapshot(state);
    });

    this.socket.on('playerState', (data) => {
      // Update specific remote player's state
      if (data.playerId !== this.localPlayerId) {
        const remotePlayer = this.getRemotePlayerByPlayerId(data.playerId);
        if (remotePlayer) {
          remotePlayer.updateFromServer(data);
        }
      }
    });

    this.socket.on('bombThrown', (data) => {
      // Server confirmed bomb throw
      if (data.playerId !== this.localPlayerId) {
        // Create bomb for remote player
        const thrownBomb = new ThrownBomb(data.x, data.y, data.team, data.throwDirection);
        if (this.map) {
          thrownBomb.setSize(this.map.blockWidth);
        }
        this.thrownBombs.push(thrownBomb);
      }
    });
    
    // Queue state handler
    this.socket.on('queueState', (data) => {
      this.updateQueueUI(data);
    });
    
    // Pot amount update handler
    this.socket.on('potAmountUpdate', (data) => {
      // Update pot amount in queue UI if currently in queue
      if (this.gameState === 'QUEUE') {
        const potAmountEl = document.getElementById('queuePotAmount');
        const potValueEl = document.getElementById('queuePotValue');
        if (data.potAmount !== null && data.potAmount !== undefined) {
          if (potValueEl) {
            potValueEl.textContent = `${data.potAmount.toLocaleString()} $PAINT`;
          }
          if (potAmountEl) {
            potAmountEl.style.display = 'flex';
          }
        }
      }
    });
    
    // Game state handler
    this.socket.on('gameState', (data) => {
      this.updateGameUI(data);
    });
    
    // Game ended handler
    this.socket.on('gameEnded', (data) => {
      this.showGameResults(data);
    });
  }
  
  updateQueueUI(data) {
    this.gameState = 'QUEUE';
    
    // If transitioning from ended state, ensure camera is at map center with no zoom (only for players)
    if (this.isPlayer && !this.cameraTransition.active && this.map) {
      const mapLeft = this.map.startX;
      const mapRight = this.map.startX + (this.map.cols * this.map.blockWidth);
      const mapTop = this.map.startY;
      const mapBottom = this.map.startY + (this.map.rows * this.map.blockHeight);
      
      this.camera.x = (mapLeft + mapRight) / 2;
      this.camera.y = (mapTop + mapBottom) / 2;
      this.camera.setZoom(1.0);
    }
    
    const queueUI = document.getElementById('queueUI');
    const gameUI = document.getElementById('gameUI');
    const resultsUI = document.getElementById('resultsUI');
    
    if (queueUI) queueUI.style.display = 'flex';
    if (gameUI) gameUI.style.display = 'none';
    if (resultsUI) resultsUI.style.display = 'none';
    
    const countdownEl = document.getElementById('queueCountdown');
    const playerCountEl = document.getElementById('queuePlayerCount');
    const potAmountEl = document.getElementById('queuePotAmount');
    const potValueEl = document.getElementById('queuePotValue');
    
    if (countdownEl) {
      if (data.isPaused) {
        countdownEl.textContent = 'PAUSED';
        countdownEl.style.color = '#ff6b6b';
      } else {
        const countdown = Math.ceil(data.countdown || 10);
        countdownEl.textContent = countdown + 's';
        countdownEl.style.color = ''; // Reset to default color
      }
    }
    if (playerCountEl) playerCountEl.textContent = data.playerCount || 0;
    
    // Update pot amount display
    if (data.potAmount !== null && data.potAmount !== undefined) {
      if (potValueEl) {
        potValueEl.textContent = `${data.potAmount.toLocaleString()} $PAINT`;
      }
      if (potAmountEl) {
        potAmountEl.style.display = 'flex';
      }
    } else {
      if (potAmountEl) {
        potAmountEl.style.display = 'none';
      }
    }
    
    // Update join button state
    this.updateJoinButton();
    
    // Show UI elements when returning to queue
    this.updateUIVisibility();
  }
  
  updateJoinButton() {
    const joinButton = document.getElementById('joinButton');
    const joinedStatus = document.getElementById('joinedStatus');
    
    if (joinButton && joinedStatus) {
      if (this.isPlayer) {
        // Player has joined
        joinButton.disabled = false;
        joinButton.style.display = 'none';
        joinedStatus.style.display = 'block';
        if (this.playerTeam) {
          joinedStatus.textContent = `You are in the queue! (Team: ${this.playerTeam})`;
        } else {
          joinedStatus.textContent = 'You are in the queue!';
        }
      } else {
        // Spectator mode
        // Disable join button if game is playing
        if (this.gameState === 'PLAYING') {
          joinButton.disabled = true;
        } else {
          joinButton.disabled = false;
        }
        joinButton.style.display = 'block';
        joinedStatus.style.display = 'none';
      }
    }
  }
  
  // Hide/show UI elements based on game state and player status
  updateUIVisibility() {
    // List of UI elements to hide/show
    const uiElements = [
      '#tokenStatsUI',
      '#leaderboardUI',
      '#how-it-works',
      '#chatUI'
    ];
    
    const bottomActionBar = document.querySelector('.bottom-action-bar');
    
    // Auto-hide UI for players when game is playing
    // Keep UI visible for spectators (they can manually hide with eye icon)
    if (this.isPlayer && this.gameState === 'PLAYING') {
      // Hide UI for players during game (only if not manually toggled)
      if (!document.body.classList.contains('ui-hidden')) {
        uiElements.forEach(selector => {
          const element = document.querySelector(selector);
          if (element) {
            element.style.opacity = '0';
            element.style.pointerEvents = 'none';
          }
        });
        // Also hide bottom action bar for players during game
        if (bottomActionBar) {
          bottomActionBar.style.opacity = '0';
          bottomActionBar.style.pointerEvents = 'none';
        }
      }
    } else {
      // Show UI when queue/ended or for spectators
      // Only show if not manually hidden by user
      if (!document.body.classList.contains('ui-hidden')) {
        uiElements.forEach(selector => {
          const element = document.querySelector(selector);
          if (element) {
            // Remove inline styles to restore CSS defaults
            element.style.opacity = '';
            element.style.pointerEvents = '';
          }
        });
        // Show bottom action bar for spectators or when not playing
        if (bottomActionBar) {
          bottomActionBar.style.opacity = '';
          bottomActionBar.style.pointerEvents = '';
        }
      }
    }
  }
  
  async joinGame() {
    if (!this.socket || !this.isConnected) {
      console.error('Cannot join: not connected to server');
      return;
    }
    
    if (this.isPlayer) {
      console.log('Already joined as player');
      return;
    }
    
    // Check if player has filled out their info
    const hasInfo = await this.checkPlayerInfo();
    
    if (!hasInfo) {
      // Show modal to collect player info
      this.showPlayerInfoModal();
      return;
    }
    
    // Player has info, proceed with joining
    console.log('Sending join request to server');
    this.socket.emit('joinGame');
  }
  
  async checkPlayerInfo() {
    // First check localStorage (persists across page refreshes)
    try {
      const savedUsername = localStorage.getItem('playerUsername');
      const savedWallet = localStorage.getItem('playerWallet');
      
      if (savedUsername && savedWallet && savedUsername.trim() !== '' && savedWallet.trim() !== '') {
        // User has saved info in localStorage, consider them as having info
        // But also try to save to server if not already saved
        const clientId = this.localPlayerId || this.socket?.id;
        if (clientId) {
          // Try to save to server in background (don't block)
          this.savePlayerInfo(savedUsername, savedWallet).catch(error => {
            console.warn('Failed to sync player info to server:', error);
          });
        }
        return true;
      }
    } catch (error) {
      console.warn('Error checking localStorage:', error);
    }
    
    // Fallback: check server
    try {
      const clientId = this.localPlayerId || this.socket?.id;
      if (!clientId) {
        return false;
      }
      
      const response = await fetch(`/api/player/info/${clientId}`);
      const data = await response.json();
      
      if (data.success && data.hasInfo) {
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('Error checking player info from server:', error);
      return false;
    }
  }
  
  async showPlayerInfoModal(isEditing = false) {
    const modal = document.getElementById('playerInfoModal');
    if (modal) {
      modal.style.display = 'flex';
      
      // Always try to load existing player info first (if available)
      await this.loadPlayerInfoIntoModal();
      
      // Store initial values for change detection
      const usernameInput = document.getElementById('usernameInput');
      const walletInput = document.getElementById('walletInput');
      const submitButton = document.getElementById('submitPlayerInfo');
      
      if (usernameInput && walletInput) {
        const initialUsername = usernameInput.value.trim();
        const initialWallet = walletInput.value.trim();
        
        // Function to check if values have changed and update button state
        const updateSubmitButton = () => {
          if (!submitButton) return;
          
          const currentUsername = usernameInput.value.trim();
          const currentWallet = walletInput.value.trim();
          
          const hasChanged = currentUsername !== initialUsername || currentWallet !== initialWallet;
          const isValid = currentUsername.length > 0 && currentWallet.length > 0;
          
          // Enable button only if values changed AND are valid
          submitButton.disabled = !hasChanged || !isValid;
        };
        
        // Set initial button state
        updateSubmitButton();
        
        // Add input listeners to check for changes
        usernameInput.addEventListener('input', updateSubmitButton);
        walletInput.addEventListener('input', updateSubmitButton);
        
        // Store listeners so we can remove them later if needed
        if (!this._playerInfoInputListeners) {
          this._playerInfoInputListeners = [];
        }
        this._playerInfoInputListeners.push(
          { element: usernameInput, handler: updateSubmitButton },
          { element: walletInput, handler: updateSubmitButton }
        );
      }
      
      // Update modal title and subtitle based on context
      const modalTitle = modal.querySelector('.modal-title');
      const modalSubtitle = modal.querySelector('.modal-subtitle');
      
      if (isEditing) {
        if (modalTitle) modalTitle.textContent = 'Edit Your Information';
        if (modalSubtitle) modalSubtitle.textContent = 'Update your username and public wallet address';
      } else {
        if (modalTitle) modalTitle.textContent = 'Enter Your Information';
        if (modalSubtitle) modalSubtitle.textContent = 'Please provide your username and public wallet address to join the game';
      }
      
      // Clear any previous errors
      const usernameError = document.getElementById('usernameError');
      const walletError = document.getElementById('walletError');
      if (usernameError) usernameError.textContent = '';
      if (walletError) walletError.textContent = '';
      
      // Focus on username input
      if (usernameInput) {
        setTimeout(() => usernameInput.focus(), 100);
      }
    }
  }
  
  async loadPlayerInfoIntoModal() {
    const usernameInput = document.getElementById('usernameInput');
    const walletInput = document.getElementById('walletInput');
    
    // First, try to load from localStorage (persists across page refreshes)
    try {
      const savedUsername = localStorage.getItem('playerUsername');
      const savedWallet = localStorage.getItem('playerWallet');
      
      if (savedUsername && usernameInput) {
        usernameInput.value = savedUsername;
      }
      if (savedWallet && walletInput) {
        walletInput.value = savedWallet;
      }
    } catch (error) {
      console.warn('Failed to load from localStorage:', error);
    }
    
    // Then try to load from server (if available, will override localStorage)
    try {
      const clientId = this.localPlayerId || this.socket?.id;
      if (!clientId) {
        return;
      }
      
      const response = await fetch(`/api/player/info/${clientId}`);
      const data = await response.json();
      
      if (data.success && data.playerStats) {
        // Pre-fill username if it exists (server data takes precedence)
        if (usernameInput && data.playerStats.username) {
          usernameInput.value = data.playerStats.username;
        }
        // Pre-fill wallet if it exists (server data takes precedence)
        if (walletInput && data.playerStats.publicWallet) {
          walletInput.value = data.playerStats.publicWallet;
        }
      }
    } catch (error) {
      console.error('Error loading player info from server:', error);
      // If error, keep localStorage values (already loaded above)
    }
  }
  
  hidePlayerInfoModal() {
    const modal = document.getElementById('playerInfoModal');
    if (modal) {
      modal.style.display = 'none';
      
      // Clean up input listeners
      if (this._playerInfoInputListeners) {
        this._playerInfoInputListeners.forEach(({ element, handler }) => {
          element.removeEventListener('input', handler);
        });
        this._playerInfoInputListeners = [];
      }
    }
  }
  
  async savePlayerInfo(username, publicWallet) {
    try {
      const clientId = this.localPlayerId || this.socket?.id;
      if (!clientId) {
        throw new Error('No client ID available');
      }
      
      const response = await fetch('/api/player/info', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          clientId: clientId,
          username: username,
          publicWallet: publicWallet
        })
      });
      
      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Failed to save player info');
      }
      
      return { success: true, data };
    } catch (error) {
      console.error('Error saving player info:', error);
      return { success: false, error: error.message };
    }
  }
  
  updateGameUI(data) {
    const previousState = this.gameState;
    this.gameState = 'PLAYING';
    
    // Only start transition once when transitioning from QUEUE/ENDED to PLAYING (only for players)
    if (this.isPlayer && previousState !== 'PLAYING' && !this.cameraTransition.active) {
      // Start zoom transition (camera will already be following player naturally)
      this.cameraTransition.active = true;
      this.cameraTransition.startZoom = this.camera.zoom;
      this.cameraTransition.endZoom = 1.8;
      this.cameraTransition.elapsed = 0;
    } else if (!this.isPlayer) {
      // Spectator: disable any transitions and keep zoom at 1.0
      this.cameraTransition.active = false;
      if (this.map) {
        const mapLeft = this.map.startX;
        const mapRight = this.map.startX + (this.map.cols * this.map.blockWidth);
        const mapTop = this.map.startY;
        const mapBottom = this.map.startY + (this.map.rows * this.map.blockHeight);
        const centerX = (mapLeft + mapRight) / 2;
        const centerY = (mapTop + mapBottom) / 2;
        this.camera.x = centerX;
        this.camera.y = centerY;
        this.camera.setZoom(1.0);
      }
    }
    
    const queueUI = document.getElementById('queueUI');
    const gameUI = document.getElementById('gameUI');
    const resultsUI = document.getElementById('resultsUI');
    
    if (queueUI) queueUI.style.display = 'none';
    if (gameUI) gameUI.style.display = 'flex';
    if (resultsUI) resultsUI.style.display = 'none';
    
    const countdownEl = document.getElementById('gameCountdown');
    if (countdownEl) countdownEl.textContent = data.countdown || 120;
    
    // Hide UI for players when game starts (keep visible for spectators)
    this.updateUIVisibility();
    
    // Update join button (disable it during game)
    this.updateJoinButton();
    
    // Update block counts from snapshot if available
    // This will be called from applySnapshot when we receive block data
  }
  
  showGameResults(data) {
    const previousState = this.gameState;
    this.gameState = 'ENDED'; // Immediately stop inputs
    
    // Show UI elements when game ends (will be fully shown when queue starts)
    this.updateUIVisibility();
    
    // Immediately remove all players and bombs when game ends
    this.characters = [];
    this.remotePlayers = [];
    this.bombs = [];
    this.thrownBombs = [];
    
    // Store results data for later display
    this.gameResultsData = data;
    
    // Only start transition once when transitioning from PLAYING to ENDED (only for players)
    if (this.isPlayer && previousState === 'PLAYING' && !this.cameraTransition.active && this.map) {
      const mapLeft = this.map.startX;
      const mapRight = this.map.startX + (this.map.cols * this.map.blockWidth);
      const mapTop = this.map.startY;
      const mapBottom = this.map.startY + (this.map.rows * this.map.blockHeight);
      
      const centerX = (mapLeft + mapRight) / 2;
      const centerY = (mapTop + mapBottom) / 2;
      
      // Set camera target to map center (camera will smoothly move to it)
      this.camera.setTarget(centerX, centerY);
      
      // Start zoom transition (camera is already moving to center naturally)
      this.cameraTransition.active = true;
      this.cameraTransition.startZoom = this.camera.zoom;
      this.cameraTransition.endZoom = 1.0;
      this.cameraTransition.elapsed = 0;
      
      // Wait for zoom transition to complete before showing results
      this.waitForZoomThenShowResults();
    } else {
      // No transition needed (spectator or already transitioned), show results immediately
      this.displayGameResults(data);
    }
    
    const queueUI = document.getElementById('queueUI');
    const gameUI = document.getElementById('gameUI');
    
    if (queueUI) queueUI.style.display = 'none';
    if (gameUI) gameUI.style.display = 'none';
  }
  
  waitForZoomThenShowResults() {
    // Check if zoom transition is complete
    if (!this.cameraTransition.active) {
      // Transition complete, show results
      this.displayGameResults(this.gameResultsData);
    } else {
      // Check again next frame
      requestAnimationFrame(() => this.waitForZoomThenShowResults());
    }
  }
  
  displayGameResults(data) {
    const resultsUI = document.getElementById('resultsUI');
    if (resultsUI) resultsUI.style.display = 'block';
    
    // Calculate final percentages
    const redBlocks = data.redBlocks || 0;
    const blueBlocks = data.blueBlocks || 0;
    const totalBlocks = redBlocks + blueBlocks;
    
    let finalRedPercentage = 0;
    let finalBluePercentage = 0;
    
    if (totalBlocks > 0) {
      finalRedPercentage = Math.round((redBlocks / totalBlocks) * 100);
      finalBluePercentage = Math.round((blueBlocks / totalBlocks) * 100);
    }
    
    // Get elements
    const redPercentageEl = document.getElementById('redPercentage');
    const bluePercentageEl = document.getElementById('bluePercentage');
    const winnerText = document.getElementById('winnerText');
    
    // Hide winner text during animation
    if (winnerText) {
      winnerText.style.display = 'none';
    }
    
    // Set initial percentages to 0
    if (redPercentageEl) redPercentageEl.textContent = '0%';
    if (bluePercentageEl) bluePercentageEl.textContent = '0%';
    
    // Animate percentages from 0 to final value
    const animationDuration = 2500; // 2.5 seconds
    const startTime = performance.now();
    
    const animate = (currentTime) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / animationDuration, 1.0);
      
      // Easing function (ease-out)
      const eased = 1 - Math.pow(1 - progress, 3);
      
      // Calculate current percentages
      const currentRed = Math.round(finalRedPercentage * eased);
      const currentBlue = Math.round(finalBluePercentage * eased);
      
      // Update displays
      if (redPercentageEl) redPercentageEl.textContent = currentRed + '%';
      if (bluePercentageEl) bluePercentageEl.textContent = currentBlue + '%';
      
      if (progress < 1.0) {
        // Continue animation
        requestAnimationFrame(animate);
      } else {
        // Animation complete - show winner text
        if (winnerText) {
          if (data.winner === 'red') {
            winnerText.textContent = 'Red Team Wins';
            winnerText.style.color = '#ff4444';
          } else if (data.winner === 'blue') {
            winnerText.textContent = 'Blue Team Wins';
            winnerText.style.color = '#4444ff';
          } else {
            winnerText.textContent = 'It\'s a Tie';
            winnerText.style.color = '#ffd700';
          }
          winnerText.style.display = 'block';
        }
      }
    };
    
    // Start animation
    requestAnimationFrame(animate);
  }
  
  updateBlockCounts() {
    if (!this.map) return;
    
    let redCount = 0;
    let blueCount = 0;
    
    for (let row = 0; row < this.map.rows; row++) {
      for (let col = 0; col < this.map.cols; col++) {
        const block = this.map.blocks[row][col];
        if (block && block.color === 'red') {
          redCount++;
        } else if (block && block.color === 'blue') {
          blueCount++;
        }
      }
    }
    
    const redBlockCount = document.getElementById('redBlockCount');
    const blueBlockCount = document.getElementById('blueBlockCount');
    
    if (redBlockCount) redBlockCount.textContent = redCount;
    if (blueBlockCount) blueBlockCount.textContent = blueCount;
  }

    // Send inputs to server (with client-side prediction)
    // CRITICAL: Send actual input events (keydown/keyup), not current state
    // This allows server to detect "just pressed" correctly, matching client behavior
  sendInputsToServer() {
    if (!this.socket || !this.isConnected || this.localPlayerId === null || !this.isPlayer || this.gameState !== 'PLAYING') return;

    // Get actual input events from queue (keydown/keyup events)
    // This ensures server processes the same events client processed
    // CRITICAL: Sending actual events allows server to detect "just pressed" correctly
    const inputEvents = this.inputHandler.getAllQueuedInputs();
    
    // Filter to only game-relevant keys and convert to input format
    // CRITICAL: Only send actual events (keydown/keyup), NOT current state
    // Sending current state every frame causes duplicate events and desync
    // The server maintains the last known state, so we only need to send state changes
    const inputs = inputEvents
      .filter(event => ['a', 'd', 'w', 's'].includes(event.key.toLowerCase()))
      .map(event => ({
        key: event.key.toLowerCase(),
        pressed: event.pressed,
        timestamp: event.timestamp
      }));
    
    // Clear the queue after sending (events have been transmitted)
    this.inputHandler.clearInputQueue();
    
    // Always send input packet (even if empty) to maintain connection
    // Increment sequence and store in buffer for reconciliation
    this.lastInputSequence++;
    const inputPacket = {
      sequence: this.lastInputSequence,
      inputs: inputs,
      gameTime: this.gameTime
    };
    
    // Store input in buffer for reconciliation
    this.inputBuffer.push(inputPacket);
    if (this.inputBuffer.length > this.maxInputBufferSize) {
      this.inputBuffer.shift();
    }
    
    // Send to server
    this.socket.emit('playerInput', {
      playerId: this.localPlayerId,
      ...inputPacket
    });
  }
  
  // Save current state for rollback (called before applying inputs)
  saveStateForRollback() {
    const localPlayer = this.getLocalPlayer();
    if (!localPlayer) return;
    
    const state = {
      gameTime: this.gameTime,
      x: localPlayer.x,
      y: localPlayer.y,
      velocityY: localPlayer.velocityY,
      velocityX: 0, // Calculate from inputs if needed
      onGround: localPlayer.onGround,
      hasBomb: localPlayer.hasBomb,
      jumpsUsed: localPlayer.jumpsUsed,
      wasInJumpPad: localPlayer.wasInJumpPad
    };
    
    this.stateHistory.push(state);
    if (this.stateHistory.length > this.maxStateHistorySize) {
      this.stateHistory.shift();
    }
  }
  
  // Reconcile: smooth correction to server state (similar to remote player interpolation)
  // CRITICAL: Smart reconciliation that avoids jitter during fast movements
  // During jumps and jump pads, position corrections are very visible and cause jitter
  // Solution: Only sync state flags during fast movement, skip position correction unless catastrophic
  reconcileWithServer(serverState, lastAcknowledgedSequence) {
    const localPlayer = this.getLocalPlayer();
    if (!localPlayer) return;
    
    // Update last acknowledged sequence
    this.lastAcknowledgedSequence = lastAcknowledgedSequence || 0;
    
    // CRITICAL: Always sync state flags (server is authoritative)
    // These don't cause visual jitter and prevent desync accumulation
    localPlayer.hasBomb = serverState.hasBomb;
    if (serverState.jumpsUsed !== undefined) {
      localPlayer.jumpsUsed = serverState.jumpsUsed;
    }
    
    // Detect fast vertical movement (jumping, jump pads, fast falling)
    // During fast movement, position corrections are very visible and cause jitter
    // Jump power: -600, Jump pad: -900, Max fall: 1200
    // Use threshold that catches jumps/jump pads but allows corrections when moving slowly
    const fastMovementThreshold = 400; // Catches jumps (-600) and jump pads (-900)
    const isMovingFastVertically = Math.abs(localPlayer.velocityY) > fastMovementThreshold || 
                                    Math.abs(serverState.velocityY) > fastMovementThreshold;
    const isOnGround = localPlayer.onGround || serverState.onGround;
    
    // Calculate desync
    const dx = serverState.x - localPlayer.x;
    const dy = serverState.y - localPlayer.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const velocityDiff = Math.abs(serverState.velocityY - localPlayer.velocityY);
    
    // During fast vertical movement, use much larger dead zone to avoid jitter
    // Only correct position if desync is catastrophic or if on ground
    if (isMovingFastVertically && !isOnGround) {
      // Fast movement (jump/jump pad) - only correct if catastrophic desync
      // This prevents jitter during jumps while still catching major bugs
      if (distance > 50) {
        // Catastrophic desync during fast movement - snap immediately
        // This should be very rare (only on major bugs or network issues)
        localPlayer.x = serverState.x;
        localPlayer.y = serverState.y;
        localPlayer.velocityY = serverState.velocityY;
        localPlayer.onGround = serverState.onGround;
      } else {
        // Small desync during fast movement - trust client-side prediction
        // Don't correct position at all - it causes visible jitter
        // Only sync velocity if there's a huge mismatch (likely a bug)
        if (velocityDiff > 300) {
          // Huge velocity mismatch - gentle correction to prevent divergence
          localPlayer.velocityY += (serverState.velocityY - localPlayer.velocityY) * 0.1;
        }
        // Sync onGround state even during fast movement (important for jump decisions)
        if (serverState.onGround !== undefined) {
          localPlayer.onGround = serverState.onGround;
        }
      }
    } else {
      // Normal movement or on ground - use standard reconciliation
      if (distance > 100) {
        // Catastrophic desync - snap immediately
        localPlayer.x = serverState.x;
        localPlayer.y = serverState.y;
        localPlayer.velocityY = serverState.velocityY;
        localPlayer.onGround = serverState.onGround;
      } else if (distance > 0.5) {
        // Normal desync - use smooth interpolation
        const smoothingFactor = 0.3;
        localPlayer.x += dx * smoothingFactor;
        localPlayer.y += dy * smoothingFactor;
        localPlayer.velocityY += (serverState.velocityY - localPlayer.velocityY) * smoothingFactor;
        
        // Sync onGround state (server is authoritative)
        if (serverState.onGround !== undefined) {
          localPlayer.onGround = serverState.onGround;
        }
      } else {
        // Very small desync - trust client-side prediction
        // Only correct velocity if there's a significant difference
        if (velocityDiff > 50) {
          localPlayer.velocityY += (serverState.velocityY - localPlayer.velocityY) * 0.2;
        }
        // Sync onGround even for small desyncs (prevents jump desync)
        if (serverState.onGround !== undefined) {
          localPlayer.onGround = serverState.onGround;
        }
      }
    }
    
    // Remove acknowledged inputs from buffer
    this.inputBuffer = this.inputBuffer.filter(
      input => input.sequence > Math.max(0, this.lastAcknowledgedSequence - 10)
    );
  }

  // Send state sync to server (for validation)
  sendStateSync() {
    if (!this.socket || !this.isConnected || this.localPlayerId === null) return;

    const localPlayer = this.getLocalPlayer();
    if (localPlayer) {
      this.socket.emit('playerStateSync', {
        playerId: this.localPlayerId,
        x: localPlayer.x,
        y: localPlayer.y,
        velocityY: localPlayer.velocityY,
        hasBomb: localPlayer.hasBomb,
        gameTime: this.gameTime
      });
    }
  }

  // Handle snapshot from server
  handleSnapshot(snapshot) {
    // CRITICAL: Do NOT adjust client gameTime to match server
    // Client and server have independent gameTime clocks
    // Adjusting gameTime causes inputs to be applied at different times, causing desync
    // The client's gameTime is used for input timestamping and should remain independent
    // Server gameTime is only used for interpolation of remote players
    
    // Add snapshot to buffer
    this.snapshotBuffer.push({
      ...snapshot,
      clientReceiveTime: performance.now()
    });
    
    // Keep buffer size limited
    if (this.snapshotBuffer.length > this.maxSnapshotBufferSize) {
      this.snapshotBuffer.shift(); // Remove oldest
    }
    
    // Update ALL players from snapshot (server is authoritative)
    this.applySnapshot(snapshot);
    
    // For local player: Reconcile on every snapshot to prevent desync accumulation
    // CRITICAL: Frequent reconciliation with smooth correction prevents huge snaps
    // The smooth correction in reconcileWithServer prevents visible snapping
    if (snapshot.players) {
      const localPlayerState = snapshot.players.find(p => p.playerId === this.localPlayerId);
      if (localPlayerState) {
        // Get last processed sequence for this player
        const lastProcessedSequence = snapshot.lastProcessedSequences?.[this.localPlayerId] || 0;
        // Reconcile: smooth correction prevents desync accumulation
        this.reconcileWithServer(localPlayerState, lastProcessedSequence);
        this.lastReconciliationTime = Date.now();
      }
    }
  }
  
  // Apply snapshot to ALL players (server is authoritative)
  applySnapshot(snapshot) {
    if (!snapshot.players || !Array.isArray(snapshot.players)) return;
    
    snapshot.players.forEach(playerState => {
      // Handle local player
      if (playerState.playerId === this.localPlayerId) {
        // If we're a player but don't have a character yet, spawn one
        if (this.isPlayer && this.localPlayerId && this.map) {
          const existingChar = this.characters.find(char => char.playerId === this.localPlayerId);
          if (!existingChar) {
            // Spawn local player character (game has started)
            const char = this.spawnCharacter(playerState.team, this.localPlayerId);
            if (char) {
              // Set position from server
              char.x = playerState.x || char.x;
              char.y = playerState.y || char.y;
              console.log('Spawned local character when game started:', this.localPlayerId);
              
              // Camera will automatically follow player via the update loop
              // No special handling needed here - camera.setTarget() is called in update()
            }
          }
        }
        return;
      }
      
      // Get or create remote player
      let remotePlayer = this.getRemotePlayerByPlayerId(playerState.playerId);
      
      if (!remotePlayer) {
        // New remote player - create RemotePlayer with actual server position
        if (this.map) {
          remotePlayer = new RemotePlayer(
            playerState.x || 960,
            playerState.y || 500,
            playerState.team,
            playerState.playerId
          );
          remotePlayer.setSize(this.map.blockWidth, this.map.blockHeight);
          this.remotePlayers.push(remotePlayer);
        }
      }
      
      if (remotePlayer) {
        // Store snapshot data - server is authoritative
        remotePlayer.addSnapshot(snapshot.tick || 0, snapshot.serverTime || Date.now(), playerState);
      }
    });
    
    // Remove remote players that are no longer in the snapshot
    const serverPlayerIds = new Set(snapshot.players.map(p => p.playerId));
    this.remotePlayers = this.remotePlayers.filter(player => {
      return serverPlayerIds.has(player.playerId);
    });
    
    // Sync bomb state from server (server is authoritative)
    if (snapshot.bombs && Array.isArray(snapshot.bombs) && this.map) {
      // Ensure we have the same number of bombs as the server
      while (this.bombs.length < snapshot.bombs.length) {
        // Create missing bombs from server data
        const serverBomb = snapshot.bombs[this.bombs.length];
        if (serverBomb) {
          // Find corresponding spawn point from map (bombs are in same order as spawn points)
          const spawnPointIndex = this.bombs.length;
          let spawnPoint = null;
          if (this.map.bombSpawns && spawnPointIndex < this.map.bombSpawns.length) {
            spawnPoint = this.map.bombSpawns[spawnPointIndex];
          } else {
            // Fallback: create a spawn point from bomb position
            spawnPoint = { x: serverBomb.x, y: serverBomb.y };
          }
          const bomb = new Bomb(serverBomb.x, serverBomb.y, spawnPoint);
          this.bombs.push(bomb);
        }
      }
      
      // Remove extra bombs if server has fewer
      if (this.bombs.length > snapshot.bombs.length) {
        this.bombs = this.bombs.slice(0, snapshot.bombs.length);
      }
      
      // Update existing bombs to match server state
      snapshot.bombs.forEach((serverBomb, index) => {
        if (index < this.bombs.length) {
          const clientBomb = this.bombs[index];
          // Update authoritative bomb state from server
          // Visual effects (rotation, floatTimer) are handled client-side
          clientBomb.collected = serverBomb.collected;
          clientBomb.respawnTimer = serverBomb.respawnTimer;
          // Update position in case it changed
          if (serverBomb.x !== undefined) clientBomb.x = serverBomb.x;
          if (serverBomb.y !== undefined) clientBomb.y = serverBomb.y;
        }
      });
    } else if (!snapshot.bombs || snapshot.bombs.length === 0) {
      // No bombs in snapshot - clear all bombs
      this.bombs = [];
    }
    
    // Apply block color changes from server (server-authoritative)
    if (snapshot.blockChanges && Array.isArray(snapshot.blockChanges) && this.map) {
      snapshot.blockChanges.forEach(change => {
        const { row, col, color } = change;
        if (row >= 0 && row < this.map.rows && col >= 0 && col < this.map.cols) {
          const block = this.map.blocks[row][col];
          if (block) {
            // Always update the color from server (server is authoritative)
            // This ensures blocks at spawn locations get updated even if client thinks
            // the color is already correct
            block.setColor(color);
          }
        }
      });
      
      // Update block counts in UI
      this.updateBlockCounts();
    }
  }
  
  // Smooth correction for local player - only called for VERY large desyncs (50+ pixels)
  // This should be rare - client-side prediction should handle most cases
  correctLocalPlayer(serverState) {
    const localPlayer = this.getLocalPlayer();
    if (!localPlayer || !this.map) return;
    
    const dx = serverState.x - localPlayer.x;
    const dy = serverState.y - localPlayer.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // Only correct if desync is VERY large (50+ pixels) - this is a last resort
    // For large desyncs, we need to correct more aggressively but still smoothly
    if (distance > 50) {
      // Check if server position is valid (not inside a block)
      const collision = localPlayer.checkCollision(serverState.x, serverState.y, this.map, localPlayer.y);
      if (!collision.collided) {
        // Server position is valid - use smooth interpolation (10% per frame over many frames)
        // This will correct over ~10 frames (0.16 seconds at 60fps)
        const correctionFactor = 0.1; // Smooth but noticeable correction
        localPlayer.x += dx * correctionFactor;
        localPlayer.y += dy * correctionFactor;
        
        // Sync velocity and state for large desyncs
        const velocityDiff = serverState.velocityY - localPlayer.velocityY;
        localPlayer.velocityY += velocityDiff * 0.3; // Smooth velocity correction
        localPlayer.onGround = serverState.onGround;
      } else {
        // Server position is invalid - just sync velocity and state, don't move position
        const velocityDiff = serverState.velocityY - localPlayer.velocityY;
        localPlayer.velocityY += velocityDiff * 0.3;
        localPlayer.onGround = serverState.onGround;
      }
    }
  }

  // Apply server state update (legacy method - kept for compatibility)
  applyServerState(state) {
    if (state.type === 'snapshot') {
      this.handleSnapshot(state);
      return;
    }
    // Update remote players from server state (server is authoritative)
    if (state.players && Array.isArray(state.players)) {
      state.players.forEach(playerState => {
        // Skip local player - we handle that with client-side prediction
        // Server corrections would cause jitter and "invisible walls" feeling
        if (playerState.playerId === this.localPlayerId) {
          return;
        }
        
        // Get or create remote player
        let remotePlayer = this.getRemotePlayerByPlayerId(playerState.playerId);
        
        if (!remotePlayer) {
          // New remote player - create RemotePlayer
          if (this.map) {
            remotePlayer = new RemotePlayer(
              playerState.x || 960,
              playerState.y || 500,
              playerState.team,
              playerState.playerId
            );
            remotePlayer.setSize(this.map.blockWidth, this.map.blockHeight);
            this.remotePlayers.push(remotePlayer);
            console.log('Created remote player from gameState:', playerState.playerId, 'team:', playerState.team);
          }
        }
        
        if (remotePlayer) {
          // Update remote player from server state (server is authoritative)
          // This updates serverX/serverY, and interpolation happens in update()
          remotePlayer.updateFromServer(playerState);
        }
      });
      
      // Remove remote players that are no longer in the server state (players left)
      const serverPlayerIds = new Set(state.players.map(p => p.playerId));
      this.remotePlayers = this.remotePlayers.filter(player => {
        return serverPlayerIds.has(player.playerId);
      });
    }
    
    // Clean up any characters without playerId (orphaned from old init)
    this.characters = this.characters.filter(char => char.playerId !== null);
  }
}

