// Server-side game logic - simplified version for multiplayer
// This runs the authoritative game state
const fs = require('fs');
const path = require('path');

class GameServer {
  constructor(mapName = 'map1') {
    this.players = new Map(); // playerId -> { team, x, y, velocityY, hasBomb, onGround, etc. }
    this.playerInputs = new Map(); // playerId -> { a: false, d: false, w: false, s: false } - current key states
    this.lastProcessedSequence = new Map(); // playerId -> last processed input sequence number
    this.bombs = []; // Bomb items
    this.thrownBombs = []; // Active thrown bombs
    this.gameTime = 0;
    this.fixedTimestep = 1/60; // 60 ticks per second (matches client and server tick rate)
    this.accumulator = 0; // Persisted accumulator for fixed timestep updates
    
    // Game constants (must match client)
    this.GRAVITY = 1500;
    this.JUMP_POWER = -600;
    this.JUMP_PAD_BOUNCE = -900; // Match client jumpPadBounce
    this.SPEED = 180;
    this.MAX_FALL_SPEED = 1200; // Match client maxFallSpeed
    this.MAX_JUMPS = 2; // Match client maxJumps
    
    // Map data
    this.mapData = null;
    this.mapCols = 63;
    this.mapRows = 43;
    this.GAME_WIDTH = 1920;
    this.GAME_HEIGHT = 1080;
    this.spawnPoints = {
      red: [],
      blue: []
    };
    this.spawnIndices = {
      red: 0,
      blue: 0
    };
    
    // Block collision data
    this.blocks = []; // 2D array: blocks[row][col] = { x, y, width, height, imageIndex } or null
    this.blockColors = []; // 2D array: blockColors[row][col] = 'white' | 'red' | 'blue' (server-authoritative)
    this.blockWidth = 0;
    this.blockHeight = 0;
    this.startX = 0;
    this.startY = 0;
    this.JUMP_PAD_INDEX = 9; // Match client Block.JUMP_PAD_INDEX
    
    // Track changed blocks for efficient delta compression
    this.changedBlocks = new Set(); // Set of "row,col" strings for blocks that changed color
    
    // Character dimensions (same as block size)
    this.CHAR_WIDTH = 0;
    this.CHAR_HEIGHT = 0;
    
    // Load map
    this.loadMap(mapName);
  }
  
  loadMap(mapName) {
    try {
      const mapPath = path.join(__dirname, '..', 'public', 'assets', 'maps', `${mapName}.json`);
      const mapFile = fs.readFileSync(mapPath, 'utf8');
      this.mapData = JSON.parse(mapFile);
      
      // Extract map dimensions
      if (this.mapData.cols) this.mapCols = this.mapData.cols;
      if (this.mapData.rows) this.mapRows = this.mapData.rows;
      
      // Calculate block dimensions (EXACTLY match client calculation)
      const padding = 20;
      const availableWidth = this.GAME_WIDTH - (padding * 2);
      const availableHeight = this.GAME_HEIGHT - (padding * 2);
      
      // Match client: blockWidthByCols and blockHeightByRows
      const blockWidthByCols = availableWidth / this.mapCols;
      const blockHeightByRows = availableHeight / this.mapRows;
      
      // Match client: Math.floor(Math.min(...))
      this.blockWidth = Math.floor(Math.min(blockWidthByCols, blockHeightByRows));
      this.blockHeight = this.blockWidth;
      
      // Character dimensions (same as block size)
      this.CHAR_WIDTH = this.blockWidth;
      this.CHAR_HEIGHT = this.blockHeight;
      
      // Calculate grid dimensions
      const gridWidth = this.blockWidth * this.mapCols;
      const gridHeight = this.blockHeight * this.mapRows;
      
      // Center the grid (match client calculation exactly - no rounding)
      this.startX = (this.GAME_WIDTH - gridWidth) / 2;
      this.startY = (this.GAME_HEIGHT - gridHeight) / 2;
      
      // Debug: Log map calculation to verify it matches client
      console.log(`Server map: cols=${this.mapCols}, rows=${this.mapRows}, blockWidth=${this.blockWidth}, startX=${this.startX}, startY=${this.startY}`);
      
      // Initialize blocks array and block colors
      this.blocks = [];
      this.blockColors = [];
      for (let row = 0; row < this.mapRows; row++) {
        this.blocks[row] = [];
        this.blockColors[row] = [];
        for (let col = 0; col < this.mapCols; col++) {
          this.blocks[row][col] = null;
          this.blockColors[row][col] = 'white'; // All blocks start as white
        }
      }
      
      // Load blocks from map data
      let blockCount = 0;
      if (this.mapData.blocks) {
        this.mapData.blocks.forEach((blockData) => {
          let row, col, imageIndex = 0;
          if (blockData.length === 2) {
            [row, col] = blockData;
            imageIndex = 0;
          } else if (blockData.length === 3) {
            [row, col, imageIndex] = blockData;
          } else {
            return; // Skip invalid entries
          }
          
          if (row >= 0 && row < this.mapRows && col >= 0 && col < this.mapCols) {
            // Match client calculation exactly: x = startX + col * blockWidth, y = startY + row * blockHeight
            const x = this.startX + col * this.blockWidth;
            const y = this.startY + row * this.blockHeight;
            this.blocks[row][col] = {
              x: x,
              y: y,
              width: this.blockWidth,
              height: this.blockHeight,
              imageIndex: imageIndex
            };
            // Initialize block color as white
            this.blockColors[row][col] = 'white';
            blockCount++;
          }
        });
      }
      
      // Calculate spawn points from map data (matches client fallback calculation)
      // Store row/col to identify spawn locations and blocks beneath them
      if (this.mapData.spawns) {
        // Red spawns
        if (this.mapData.spawns.red) {
          this.mapData.spawns.red.forEach(spawnData => {
            const row = spawnData.row;
            const col = spawnData.col;
            // Match client calculation: x = startX + col * blockWidth + blockWidth / 2
            const x = this.startX + col * this.blockWidth + this.blockWidth / 2;
            // Match client calculation: y = startY + row * blockHeight
            const y = this.startY + row * this.blockHeight;
            this.spawnPoints.red.push({ x, y, row, col });
            console.log(`  Red spawn point: row ${row}, col ${col} -> (${x}, ${y})`);
          });
        }
        
        // Blue spawns
        if (this.mapData.spawns.blue) {
          this.mapData.spawns.blue.forEach(spawnData => {
            const row = spawnData.row;
            const col = spawnData.col;
            // Match client calculation: x = startX + col * blockWidth + blockWidth / 2
            const x = this.startX + col * this.blockWidth + this.blockWidth / 2;
            // Match client calculation: y = startY + row * blockHeight
            const y = this.startY + row * this.blockHeight;
            this.spawnPoints.blue.push({ x, y, row, col });
            console.log(`  Blue spawn point: row ${row}, col ${col} -> (${x}, ${y})`);
          });
        }
      }
      
      console.log(`Map loaded: ${mapName}, Red spawns: ${this.spawnPoints.red.length}, Blue spawns: ${this.spawnPoints.blue.length}`);
      
      // Initialize bombs from map bomb spawn points
      this.initializeBombs();
    } catch (error) {
      console.error('Failed to load map:', error);
      // Use default spawn positions
      this.spawnPoints.red.push({ x: 960, y: 500 });
      this.spawnPoints.blue.push({ x: 960, y: 500 });
    }
  }
  
  initializeBombs() {
    if (!this.mapData || !this.mapData.bombSpawns) return;
    
    this.bombs = [];
    
    // Create a bomb at each bomb spawn point
    this.mapData.bombSpawns.forEach((spawnData) => {
      const row = spawnData.row;
      const col = spawnData.col;
      
      // Calculate bomb position (match client calculation)
      let x, y;
      if (row >= 0 && row < this.mapRows && col >= 0 && col < this.mapCols) {
        const block = this.blocks[row][col];
        if (block !== null) {
          // Spawn at the top center of the marker block
          x = block.x + block.width / 2;
          y = block.y; // Top of block
        } else {
          // Fallback: use grid position
          x = this.startX + col * this.blockWidth + this.blockWidth / 2;
          y = this.startY + row * this.blockHeight;
        }
      } else {
        // Invalid position, skip
        return;
      }
      
      // Bomb size is 20% of original image dimensions (match client)
      // Using approximate size since we don't have image dimensions on server
      // Client uses: Bomb.originalWidth * 0.2, Bomb.originalHeight * 0.2
      // Approximate: assume original is ~100x100, so size is ~20x20
      const bombWidth = 20;
      const bombHeight = 20;
      
      const bomb = {
        id: this.bombs.length, // Simple ID for tracking
        x: x,
        y: y,
        width: bombWidth,
        height: bombHeight,
        spawnPoint: { x, y, row, col }, // Store spawn point for respawning
        collected: false,
        respawnTimer: 0,
        respawnDelay: 10 // 10 seconds (match client)
      };
      
      this.bombs.push(bomb);
    });
    
    console.log(`Initialized ${this.bombs.length} bombs`);
  }
  
  getSpawnPoint(team) {
    const spawns = this.spawnPoints[team] || [];
    if (spawns.length === 0) {
      // Fallback to center
      return { x: 960, y: 500 };
    }
    
    // Round-robin through spawn points
    const index = this.spawnIndices[team] % spawns.length;
    this.spawnIndices[team]++;
    return spawns[index];
  }

  update(deltaTime) {
    // Cap deltaTime to prevent huge jumps (spiral of death protection)
    deltaTime = Math.min(deltaTime, 0.1);
    
    // Accumulate time and step the simulation at a fixed rate
    this.accumulator += deltaTime;
    const maxUpdates = 5; // Prevent spiral of death
    
    let updates = 0;
    while (this.accumulator >= this.fixedTimestep && updates < maxUpdates) {
      this.gameTime += this.fixedTimestep;
      this.updateGame(this.fixedTimestep);
      this.accumulator -= this.fixedTimestep;
      updates++;
    }
    
    // Clamp accumulator if we hit the limit
    if (this.accumulator >= this.fixedTimestep) {
      this.accumulator = this.fixedTimestep;
    }
  }

  updateGame(deltaTime) {
    // Cap deltaTime to match client
    deltaTime = Math.min(deltaTime, 1/30);
    
    // Update all players
    this.players.forEach((player, playerId) => {
      // STEP 1: Check if standing on ground BEFORE processing input (matches client)
      const groundY = this.getGroundY(player.x, player.y);
      // Match client threshold exactly: 2 pixels, 36 pixels/second
      if (groundY !== null && Math.abs(player.y - groundY) < 2 && Math.abs(player.velocityY) < 36) {
        player.y = groundY;
        player.velocityY = 0;
        player.onGround = true;
        player.jumpsUsed = 0;
      } else {
        player.onGround = false;
      }
      
      // STEP 1.5: Check if touching/near any block - only reset jumps when actually using wall jump
      // Don't reset jumps just for being near a block mid-air - that allows extra jumps
      // The reset will happen in processJumpInput when actually performing a wall jump
      // This matches the original design: jump once from ground, then jump once mid-air
      
      // STEP 2: Apply horizontal movement (matches client - happens after ground check)
      // CRITICAL: Apply inputs right before movement to ensure they're used in the same frame
      // This ensures inputs are applied at the correct time relative to physics
      this.applyMovement(playerId, deltaTime);
      
      // STEP 2.5: Process jump input (matches frontend - happens BEFORE gravity)
      // This ensures jump velocity is set before gravity is applied in the same frame
      this.processJumpInput(playerId);
      
      // STEP 3: Apply gravity (matches client)
      player.velocityY += this.GRAVITY * deltaTime;
      if (player.velocityY > this.MAX_FALL_SPEED) {
        player.velocityY = this.MAX_FALL_SPEED;
      }

      // STEP 4: Try vertical movement (matches client)
      const newY = player.y + player.velocityY * deltaTime;
      const prevY = player.y; // Store previous Y for collision detection
      
      // Check if we're entering a jump pad (weren't in one before, but will be now)
      const currentlyInJumpPad = this.checkJumpPadCollision(player.x, player.y);
      const willBeInJumpPad = this.checkJumpPadCollision(player.x, newY);
      const enteringJumpPad = !player.wasInJumpPad && willBeInJumpPad;
      
      // Check if we're falling or landing on a jump pad (before collision check)
      // IMPORTANT: Match frontend - use CURRENT position to find ground, not newY
      // Frontend does: const newGroundY = this.getGroundY(this.x, map); (uses this.y internally)
      const newGroundY = this.getGroundY(player.x, player.y);
      const jumpPad = newGroundY !== null ? this.getJumpPadAt(player.x, newGroundY) : null;
      
      if (player.velocityY > 0) {
        // Falling - match client logic exactly
        // Frontend checks: this.y + this.velocityY * deltaTime >= newGroundY
        // Which is equivalent to: newY >= newGroundY
        if (newGroundY !== null && newY >= newGroundY) {
          if (jumpPad) {
            // Bounce on jump pad - position on top
            player.y = newGroundY;
            player.velocityY = this.JUMP_PAD_BOUNCE; // Moderate upward bounce
            player.onGround = false;
            player.jumpsUsed = 0; // Reset jumps
            player.wasInJumpPad = true; // Mark that we're in jump pad (matches frontend)
            // Skip collision check for this frame since we handled the bounce
          } else {
            // Normal ground - check collision normally
            const collision = this.checkCollision(player.x, newY, player.velocityY, prevY);
            if (!collision.collided) {
              player.y = newY;
              player.onGround = false;
            } else {
              player.y = newGroundY;
              player.velocityY = 0;
              player.onGround = true;
              player.jumpsUsed = 0;
            }
          }
        } else {
          // Not landing on ground - check collision normally
          // Check if entering jump pad while falling
          if (enteringJumpPad) {
            // Entering jump pad from side while falling - bounce upward
            player.velocityY = this.JUMP_PAD_BOUNCE;
            player.jumpsUsed = 0;
            player.y = newY;
            player.onGround = false;
            player.wasInJumpPad = true; // Mark that we're in jump pad (matches frontend)
          } else {
            const collision = this.checkCollision(player.x, newY, player.velocityY, prevY);
            if (!collision.collided) {
              player.y = newY;
              player.onGround = false;
            } else {
              player.velocityY = 0;
              player.onGround = false;
            }
          }
        }
      } else {
        // Moving up or stationary
        // Check if we're entering a jump pad from the side or bottom
        if (enteringJumpPad) {
          // Entering jump pad - apply bounce based on direction
          if (player.velocityY < 0) {
            // Moving up - bounce upward (stronger)
            player.velocityY = this.JUMP_PAD_BOUNCE;
          } else if (player.velocityY === 0) {
            // Stationary or very slow - bounce upward
            player.velocityY = this.JUMP_PAD_BOUNCE;
          }
          player.jumpsUsed = 0; // Reset jumps
          player.y = newY; // Allow movement through
          player.onGround = false;
        } else {
          // Check if we're currently inside/on a jump pad - if so and moving up, always allow movement
          const currentlyOnJumpPad = this.checkJumpPadCollision(player.x, player.y);
          if (currentlyOnJumpPad && player.velocityY < 0) {
            // Already on/in a jump pad and moving up - always allow movement
            player.y = newY;
            player.onGround = false;
            player.wasInJumpPad = true; // Mark that we're in jump pad (matches frontend)
          } else {
            // Check collision normally
            const collision = this.checkCollision(player.x, newY, player.velocityY, prevY);
            if (!collision.collided) {
              player.y = newY;
              player.onGround = false;
              player.wasInJumpPad = willBeInJumpPad; // Update state (matches frontend)
            } else {
              // Hitting something - check if it's a jump pad (should pass through when moving up)
              // This matches frontend logic exactly
              const hitJumpPad = this.checkJumpPadCollision(player.x, newY);
              if (hitJumpPad && player.velocityY < 0) {
                // Moving up and hit jump pad - allow passing through (matches frontend)
                player.y = newY;
                player.onGround = false;
                player.wasInJumpPad = true;
              } else {
                // Hit ceiling - position character correctly and reset jumps
                if (player.velocityY < 0 && collision.blockBottom !== null) {
                  player.y = collision.blockBottom + this.CHAR_HEIGHT;
                }
                player.velocityY = 0;
                player.onGround = false;
                player.jumpsUsed = 0; // Reset jumps when hitting ceiling
                player.wasInJumpPad = false;
              }
            }
          }
        }
      }
      
      // STEP 6: Final ground check - match client's final check exactly
      // IMPORTANT: Only run this check if we didn't just bounce on a jump pad
      // This prevents the final ground check from interfering with jump pad bounces
      const justBouncedOnJumpPad = player.velocityY < -400 && player.wasInJumpPad;
      
      if (!justBouncedOnJumpPad) {
        const finalGroundY = this.getGroundY(player.x, player.y);
        // Match client threshold: 3 pixels, 36 pixels/second
        if (finalGroundY !== null && Math.abs(player.y - finalGroundY) < 3 && Math.abs(player.velocityY) < 36) {
          // Check if standing on a jump pad (matches frontend)
          const jumpPad = this.getJumpPadAt(player.x, finalGroundY);
          if (jumpPad) {
            // On jump pad - position naturally on top
            player.y = finalGroundY;
            player.onGround = false; // Not "on ground" in the normal sense, but can bounce
            // Don't reset jumpsUsed when on jump pad (matches frontend)
          } else {
            // Normal ground - ensure onGround is true
            player.y = finalGroundY;
            player.velocityY = 0; // Stop any small vertical movement
            player.onGround = true;
            player.jumpsUsed = 0; // Reset jumps when on ground
          }
        } else if (player.velocityY > 0.1) {
          // Falling with significant velocity - definitely not on ground (matches frontend)
          player.onGround = false;
        }
      }
      
      // Update jump pad state for next frame (matches frontend - happens at end of update)
      // This must happen AFTER all movement logic, not before
      const finalWillBeInJumpPad = this.checkJumpPadCollision(player.x, player.y);
      if (!finalWillBeInJumpPad) {
        player.wasInJumpPad = false;
      } else {
        player.wasInJumpPad = true;
      }
      
      // Safety check: Ensure player is not inside a block (fix any invalid positions)
      // IMPORTANT: Skip this check if player is inside a jump pad (jump pads allow passing through)
      const isInsideJumpPad = this.checkJumpPadCollision(player.x, player.y);
      if (!isInsideJumpPad) {
        const safetyCollision = this.checkCollision(player.x, player.y, 0, null);
        if (safetyCollision.collided) {
          // Player is inside a block - try to find valid position
          const safetyGroundY = this.getGroundY(player.x, player.y);
          if (safetyGroundY !== null) {
            player.y = safetyGroundY;
            player.velocityY = 0;
            player.onGround = true;
          } else {
            // No ground found - respawn at spawn point
            console.log(`Player ${playerId} stuck in block, respawning...`);
            const spawnPoint = this.getSpawnPoint(player.team);
            player.x = spawnPoint.x;
            player.y = spawnPoint.y;
            player.velocityY = 0;
            player.onGround = true;
          }
        }
      }
      // If inside jump pad, allow it (jump pads allow passing through when moving up)
      
      // Boundary check - keep players in bounds
      const mapLeft = this.startX + this.CHAR_WIDTH / 2;
      const mapRight = this.startX + (this.mapCols * this.blockWidth) - this.CHAR_WIDTH / 2;
      player.x = Math.max(mapLeft, Math.min(mapRight, player.x));
      
      // If player falls below map, try to find ground or respawn
      if (player.y > this.GAME_HEIGHT) {
        // Try to find ground one more time
        const emergencyGround = this.getGroundY(player.x, this.GAME_HEIGHT);
        if (emergencyGround !== null) {
          player.y = emergencyGround;
          player.velocityY = 0;
          player.onGround = true;
        } else {
          // No ground found - respawn at spawn point
          console.log(`Player ${playerId} fell out of map, respawning...`);
          const spawnPoint = this.getSpawnPoint(player.team);
          player.x = spawnPoint.x;
          player.y = spawnPoint.y;
          player.velocityY = 0;
          player.onGround = true;
        }
      }
    });

      // Update thrown bombs
      this.thrownBombs = this.thrownBombs.filter(bomb => {
        bomb.velocityY += this.GRAVITY * deltaTime;
        bomb.y += bomb.velocityY * deltaTime;
        bomb.x += bomb.velocityX * deltaTime;
        bomb.timer += deltaTime;
        
        // Remove if exploded or out of bounds
        if (bomb.exploded || bomb.timer > 2 || bomb.y > 1200) {
          return false;
        }
        return true;
      });
      
      // Color blocks that players are touching (server-authoritative)
      // Collect all touches first to avoid flickering when multiple players touch the same block
      const blockTouches = new Map(); // "row,col" -> { team, playerId }
      
      this.players.forEach((player, playerId) => {
        this.collectBlockTouches(player, blockTouches);
      });
      
      // Apply colors based on collected touches (last player to touch wins)
      blockTouches.forEach((touch, blockKey) => {
        const [row, col] = blockKey.split(',').map(Number);
        this.setBlockColor(row, col, touch.team);
      });
    
    // Update bombs (respawn timers and check collisions with players)
    this.bombs.forEach(bomb => {
      // Update respawn timer if collected
      if (bomb.collected) {
        bomb.respawnTimer += deltaTime;
        if (bomb.respawnTimer >= bomb.respawnDelay) {
          // Respawn the bomb
          bomb.collected = false;
          bomb.respawnTimer = 0;
        }
      }
      
      // Check collision with players (only if bomb is not collected)
      if (!bomb.collected) {
        this.players.forEach((player, playerId) => {
          // Only check if player doesn't already have a bomb
          if (!player.hasBomb) {
            if (this.checkBombCollision(player, bomb)) {
              // Collect bomb
              bomb.collected = true;
              bomb.respawnTimer = 0;
              player.hasBomb = true;
            }
          }
        });
      }
    });
  }
  
  checkBombCollision(player, bomb) {
    // Simple AABB collision detection (match client logic)
    const charLeft = player.x - this.CHAR_WIDTH / 2;
    const charRight = player.x + this.CHAR_WIDTH / 2;
    const charTop = player.y - this.CHAR_HEIGHT;
    const charBottom = player.y;
    
    const bombLeft = bomb.x - bomb.width / 2;
    const bombRight = bomb.x + bomb.width / 2;
    const bombTop = bomb.y - bomb.height;
    const bombBottom = bomb.y;
    
    return charLeft < bombRight && charRight > bombLeft &&
           charTop < bombBottom && charBottom > bombTop;
  }

  addPlayer(playerId, team) {
    // Get spawn point from map
    const spawnPoint = this.getSpawnPoint(team);
    
    const player = {
      playerId: playerId,
      team: team,
      x: spawnPoint.x,
      y: spawnPoint.y,
      velocityY: 0,
      hasBomb: false,
      onGround: false,
      jumpsUsed: 0,
      wasInJumpPad: false // Track jump pad state (matches frontend)
    };
    
    // Initialize input state for new player
    this.playerInputs.set(playerId, { a: false, d: false, w: false, s: false, wasPressingW: false, wasPressingS: false });
    
    console.log(`Server: Spawning player ${playerId} (${team}) at (${spawnPoint.x}, ${spawnPoint.y})`);
    this.players.set(playerId, player);
    return player;
  }

  removePlayer(playerId) {
    this.players.delete(playerId);
    this.playerInputs.delete(playerId);
    this.lastProcessedSequence.delete(playerId);
  }

  applyInputs(playerId, inputs, gameTime, sequence) {
    const player = this.players.get(playerId);
    if (!player) return;

    // Initialize input state if not exists
    if (!this.playerInputs.has(playerId)) {
      this.playerInputs.set(playerId, { 
        a: false, 
        d: false, 
        w: false, 
        s: false, 
        wasPressingW: false, 
        wasPressingS: false
      });
    }
    const inputState = this.playerInputs.get(playerId);

    // Track last processed sequence for reconciliation
    if (sequence !== undefined) {
      this.lastProcessedSequence.set(playerId, sequence);
    }

    // Process input events in order (keydown/keyup events)
    // CRITICAL: For "just pressed" detection to work, we need to track state transitions
    // The client sends actual events (keydown/keyup), so we can detect transitions
    inputs.forEach(input => {
      const key = input.key.toLowerCase();
      if (!['a', 'd', 'w', 's'].includes(key)) return;
      
      const newState = input.pressed;
      const oldState = inputState[key] || false;
      
      // Update key state
      switch (key) {
        case 'a':
          inputState.a = newState;
          break;
        case 'd':
          inputState.d = newState;
          break;
        case 'w':
          // For jump detection: wasPressingW represents the state BEFORE this input
          // If we're receiving an event where pressed=true and oldState=false, that's "just pressed"
          // Update wasPressingW to oldState BEFORE updating w, so processJumpInput can detect transition
          // This matches client: client checks justPressedW, then updates wasPressingW
          inputState.wasPressingW = oldState; // Set to previous state before updating
          inputState.w = newState;
          break;
        case 's':
          inputState.s = newState;
          if (!newState) inputState.wasPressingS = false;
          break;
      }
    });
  }
  
  // Process jump input (called from updateGame to match frontend order)
  processJumpInput(playerId) {
    const player = this.players.get(playerId);
    if (!player) return;
    
    const inputState = this.playerInputs.get(playerId);
    if (!inputState) return;
    
    // Check for jump (W key just pressed, not held)
    // wasPressingW was set in applyInputs to the previous state before updating w
    // So if w=true and wasPressingW=false, that means this is a "just pressed" event
    const justPressedW = inputState.w && !inputState.wasPressingW;
    
    // Update wasPressingW to current state AFTER checking (matches frontend order)
    // This ensures the state is correct for next frame's check
    inputState.wasPressingW = inputState.w;
    
    // Apply jump (only on key press, not hold) - match client logic exactly
    if (justPressedW) {
      // Check if on jump pad - don't allow manual jumping on jump pads
      const currentGroundY = this.getGroundY(player.x, player.y);
      const isOnJumpPad = currentGroundY !== null ? this.getJumpPadAt(player.x, currentGroundY) !== null : false;
      const isInsideJumpPad = this.checkJumpPadCollision(player.x, player.y);
      
      if (isOnJumpPad || isInsideJumpPad) {
        // Ignore jump input - jump pads only bounce when falling onto them
      } else if (player.onGround) {
        // Jump from ground
        player.velocityY = this.JUMP_POWER;
        player.jumpsUsed = 1;
        player.onGround = false;
      } else if (this.isTouchingBlock(player.x, player.y)) {
        // Jump when touching a block (wall jump)
        player.velocityY = this.JUMP_POWER;
        player.jumpsUsed = 0; // Reset since we're touching
      } else if (player.jumpsUsed < this.MAX_JUMPS && player.velocityY > 0) {
        // Double jump only if falling
        player.velocityY = this.JUMP_POWER;
        player.jumpsUsed++;
      }
    }
  }
  
  // Apply movement based on current input state (called every frame in updateGame)
  applyMovement(playerId, deltaTime) {
    const player = this.players.get(playerId);
    if (!player) return;
    
    const inputState = this.playerInputs.get(playerId);
    if (!inputState) return;

    // Calculate horizontal movement based on current key states (like client does)
    let dx = 0;
    if (inputState.a) dx -= this.SPEED * deltaTime;
    if (inputState.d) dx += this.SPEED * deltaTime;

    if (dx !== 0) {
      const newX = player.x + dx;
      
      // Check if we're already touching a block in the direction we're trying to move
      // This prevents getting stuck when already at an edge (matches frontend logic)
      const currentCharLeft = player.x - this.CHAR_WIDTH / 2;
      const currentCharRight = player.x + this.CHAR_WIDTH / 2;
      let alreadyTouching = false;
      const touchThreshold = 2; // Match frontend threshold
      
      const charTop = player.y - this.CHAR_HEIGHT;
      const charBottom = player.y;
      
      for (let row = 0; row < this.mapRows; row++) {
        for (let col = 0; col < this.mapCols; col++) {
          const block = this.blocks[row][col];
          if (block !== null) {
            const blockWidth = block.imageIndex === this.JUMP_PAD_INDEX ? block.width * 3 : block.width;
            const blockLeft = block.x;
            const blockRight = block.x + blockWidth;
            const blockTop = block.y;
            const blockBottom = block.y + block.height;
            
            // Check if we're vertically overlapping
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
      
      // If already touching, don't try to move (matches frontend)
      if (!alreadyTouching) {
        // Check horizontal collision using full checkCollision (matches client exactly)
        // Client uses: checkCollision(newX, this.y, map) which internally uses this.velocityY
        // For horizontal movement, velocityY doesn't matter, but we need to match the exact logic
        const collision = this.checkCollision(newX, player.y, player.velocityY, null);
        if (!collision.collided) {
          // No collision - apply movement, but respect boundaries
          const mapLeft = this.startX + this.CHAR_WIDTH / 2;
          const mapRight = this.startX + (this.mapCols * this.blockWidth) - this.CHAR_WIDTH / 2;
          player.x = Math.max(mapLeft, Math.min(mapRight, newX));
        } else {
          // Collision detected - find exact block and position at edge (matches client logic)
          // Client finds the colliding block and calculates exact position
          const charLeft = newX - this.CHAR_WIDTH / 2;
          const charRight = newX + this.CHAR_WIDTH / 2;
          let newPosition = null;
          
          // Find which block we're colliding with (matches client logic)
          outer: for (let row = 0; row < this.mapRows; row++) {
            for (let col = 0; col < this.mapCols; col++) {
              const block = this.blocks[row][col];
              if (block !== null) {
                const blockWidth = block.imageIndex === this.JUMP_PAD_INDEX ? block.width * 3 : block.width;
                const blockLeft = block.x;
                const blockRight = block.x + blockWidth;
                const blockTop = block.y;
                const blockBottom = block.y + block.height;
                
                // Check if character would overlap with this block horizontally
                if (charLeft < blockRight && charRight > blockLeft) {
                  // Check if character is vertically overlapping (collision)
                  const charTop = player.y - this.CHAR_HEIGHT;
                  const charBottom = player.y;
                  if (charTop < blockBottom && charBottom > blockTop) {
                    // Calculate exact position at block edge - NO GAP for pixel-perfect alignment (matches client)
                    if (dx > 0) {
                      // Moving right - position exactly at left edge of block
                      newPosition = blockLeft - this.CHAR_WIDTH / 2;
                    } else {
                      // Moving left - position exactly at right edge of block
                      newPosition = blockRight + this.CHAR_WIDTH / 2;
                    }
                    break outer; // Found the block, no need to check others
                  }
                }
              }
            }
          }
          
          // Only update position if we found a collision and it's different from current (matches client)
          if (newPosition !== null) {
            const positionDiff = Math.abs(player.x - newPosition);
            if (positionDiff > 0.001) {
              // Apply the new position, ensuring it's within map boundaries
              const mapLeft = this.startX + this.CHAR_WIDTH / 2;
              const mapRight = this.startX + (this.mapCols * this.blockWidth) - this.CHAR_WIDTH / 2;
              player.x = Math.max(mapLeft, Math.min(mapRight, newPosition));
            }
          }
        }
      }
      
      // Final boundary check to keep players in map bounds (safety net)
      const mapLeft = this.startX + this.CHAR_WIDTH / 2;
      const mapRight = this.startX + (this.mapCols * this.blockWidth) - this.CHAR_WIDTH / 2;
      player.x = Math.max(mapLeft, Math.min(mapRight, player.x));
    }
  }

  throwBomb(playerId, x, y, team, throwDirection) {
    const bomb = {
      playerId: playerId,
      x: x,
      y: y,
      team: team,
      velocityX: throwDirection * 300,
      velocityY: -480,
      timer: 0,
      exploded: false
    };
    
    this.thrownBombs.push(bomb);
    
    // Remove bomb from player
    const player = this.players.get(playerId);
    if (player) {
      player.hasBomb = false;
    }
  }

  // Removed collectBomb - now handled server-authoritatively in updateGame

  getGroundY(x, y) {
    // Find the top of the block directly below the character's x position
    // Character center is at x, bottom is at y
    const charLeft = x - this.CHAR_WIDTH / 2;
    const charRight = x + this.CHAR_WIDTH / 2;
    let closestGround = null;
    
    // Maximum distance to consider for ground detection (prevents finding blocks far below)
    // This prevents jump pads far below from being detected as ground when at ceiling
    // Match client: maxGroundDistance = 50
    const maxGroundDistance = 50; // Only consider blocks within 50 pixels below character
    
    // Check all blocks to find the closest ground under the character
    for (let row = 0; row < this.mapRows; row++) {
      for (let col = 0; col < this.mapCols; col++) {
        const block = this.blocks[row][col];
        if (block !== null) {
          // Jump pads are 3 blocks wide
          const blockWidth = block.imageIndex === this.JUMP_PAD_INDEX ? block.width * 3 : block.width;
          const blockLeft = block.x;
          const blockRight = block.x + blockWidth;
          const blockTop = block.y;
          
          // Check if character is horizontally over this block (allow touching edges)
          if (charLeft < blockRight && charRight > blockLeft) {
            // Only consider blocks that are at or below the character (blockTop >= y - 3)
            // AND within the maximum distance (blockTop - y <= maxGroundDistance)
            // This prevents finding blocks that are far below (like jump pads when at ceiling)
            // Match client logic exactly
            const distanceBelow = blockTop - y;
            if (distanceBelow >= -3 && distanceBelow <= maxGroundDistance) {
              // This block is under or very close to the character - find the closest one
              // Match client: closestGround is the smallest blockTop (highest block)
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
  
  checkCollision(x, y, velocityY, prevY = null) {
    // Check if character would collide with any block at given position
    // Character center is at x, bottom is at y
    // prevY is used for better collision detection when moving up (matches frontend)
    const charLeft = x - this.CHAR_WIDTH / 2;
    const charRight = x + this.CHAR_WIDTH / 2;
    const charTop = y - this.CHAR_HEIGHT;
    const charBottom = y;
    const prevCharTop = prevY !== null ? prevY - this.CHAR_HEIGHT : charTop;
    
    const epsilon = 0.5;
    
    // Check collision with all blocks
    for (let row = 0; row < this.mapRows; row++) {
      for (let col = 0; col < this.mapCols; col++) {
        const block = this.blocks[row][col];
        if (block !== null) {
          // Jump pads are 3 blocks wide
          const blockWidth = block.imageIndex === this.JUMP_PAD_INDEX ? block.width * 3 : block.width;
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
            
            // Jump pads: special handling for one-way collision (matches frontend exactly)
            if (block.imageIndex === this.JUMP_PAD_INDEX) {
              // Always allow passing through when moving up (regardless of position)
              if (velocityY < 0) {
                continue; // Moving upward - can always pass through jump pad
              }
              // When falling or stationary, check if character is on top of or inside the pad
              const charBottomY = y; // y is the bottom of the character
              const charTopY = y - this.CHAR_HEIGHT; // Top of the character
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
            if (velocityY < 0) {
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
  
  checkHorizontalCollision(x, y) {
    // Check if character would collide horizontally at given position
    // Character center is at x, bottom is at y
    const charLeft = x - this.CHAR_WIDTH / 2;
    const charRight = x + this.CHAR_WIDTH / 2;
    const charTop = y - this.CHAR_HEIGHT;
    const charBottom = y;
    
    // Check collision with all blocks
    for (let row = 0; row < this.mapRows; row++) {
      for (let col = 0; col < this.mapCols; col++) {
        const block = this.blocks[row][col];
        if (block !== null) {
          // Jump pads are 3 blocks wide
          const blockWidth = block.imageIndex === this.JUMP_PAD_INDEX ? block.width * 3 : block.width;
          const blockLeft = block.x;
          const blockRight = block.x + blockWidth;
          const blockTop = block.y;
          const blockBottom = block.y + block.height;
          
          // Check if character would overlap with this block horizontally
          if (charLeft < blockRight && charRight > blockLeft) {
            // Check if character is vertically overlapping (collision)
            if (charTop < blockBottom && charBottom > blockTop) {
              return { collided: true, blockLeft: blockLeft, blockRight: blockRight };
            }
          }
        }
      }
    }
    
    return { collided: false, blockLeft: null, blockRight: null };
  }
  
  isTouchingBlock(x, y) {
    // Check if character is touching or very close to any block (for wall jumps)
    // Character center is at x, bottom is at y
    const charLeft = x - this.CHAR_WIDTH / 2;
    const charRight = x + this.CHAR_WIDTH / 2;
    const charTop = y - this.CHAR_HEIGHT;
    const charBottom = y;
    
    // Scale touch distance with block size to maintain consistent detection
    const baseTouchDistance = 5;
    const baseBlockSize = 20; // Reference block size
    const touchDistance = Math.max(3, (baseTouchDistance / baseBlockSize) * this.blockWidth);
    const ceilingTouchDistance = Math.max(5, (8 / baseBlockSize) * this.blockWidth);
    
    // Check all blocks
    for (let row = 0; row < this.mapRows; row++) {
      for (let col = 0; col < this.mapCols; col++) {
        const block = this.blocks[row][col];
        if (block !== null) {
          // Jump pads are 3 blocks wide
          const blockWidth = block.imageIndex === this.JUMP_PAD_INDEX ? block.width * 3 : block.width;
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
          // Top of block (ceiling)
          if (charBottom >= blockTop - ceilingTouchDistance && charBottom <= blockTop + ceilingTouchDistance &&
              charLeft < blockRight && charRight > blockLeft) {
            return true;
          }
          // Bottom of block (floor)
          if (charTop <= blockBottom + touchDistance && charTop >= blockBottom - touchDistance &&
              charLeft < blockRight && charRight > blockLeft) {
            return true;
          }
        }
      }
    }
    
    return false;
  }
  
  checkJumpPadCollision(x, y) {
    // Check if character is colliding with a jump pad at given position
    const charLeft = x - this.CHAR_WIDTH / 2;
    const charRight = x + this.CHAR_WIDTH / 2;
    const charTop = y - this.CHAR_HEIGHT;
    const charBottom = y;
    
    for (let row = 0; row < this.mapRows; row++) {
      for (let col = 0; col < this.mapCols; col++) {
        const block = this.blocks[row][col];
        if (block !== null && block.imageIndex === this.JUMP_PAD_INDEX) {
          const blockWidth = block.width * 3; // Jump pads are 3 blocks wide
          const blockLeft = block.x;
          const blockRight = block.x + blockWidth;
          const blockTop = block.y;
          const blockBottom = block.y + block.height;
          
          // Check if character overlaps with jump pad
          if (charLeft < blockRight && charRight > blockLeft &&
              charTop < blockBottom && charBottom > blockTop) {
            return true;
          }
        }
      }
    }
    
    return false;
  }
  
  getJumpPadAt(x, groundY) {
    // Get the jump pad block at the given ground position
    for (let row = 0; row < this.mapRows; row++) {
      for (let col = 0; col < this.mapCols; col++) {
        const block = this.blocks[row][col];
        if (block !== null && block.imageIndex === this.JUMP_PAD_INDEX) {
          const blockWidth = block.width * 3; // Jump pads are 3 blocks wide
          const blockLeft = block.x;
          const blockRight = block.x + blockWidth;
          const blockTop = block.y;
          
          // Check if character is horizontally over this jump pad and groundY matches
          const charLeft = x - this.CHAR_WIDTH / 2;
          const charRight = x + this.CHAR_WIDTH / 2;
          
          // Match frontend threshold exactly: < 2 pixels
          if (charLeft < blockRight && charRight > blockLeft && Math.abs(groundY - blockTop) < 2) {
            return block;
          }
        }
      }
    }
    
    return null;
  }
  
  // Set block color (server-authoritative) and track changes
  setBlockColor(row, col, color) {
    if (row < 0 || row >= this.mapRows || col < 0 || col >= this.mapCols) return;
    if (this.blocks[row][col] === null) return; // Can't color non-existent blocks
    
    // Check if this block is at or beneath a spawn point
    let isAtSpawn = false;
    for (const team of ['red', 'blue']) {
      const spawns = this.spawnPoints[team] || [];
      for (const spawn of spawns) {
        if (spawn.row === row && spawn.col === col) {
          isAtSpawn = true;
          break;
        }
        if (spawn.row !== undefined && spawn.col !== undefined && 
            row === spawn.row + 1 && col === spawn.col) {
          isAtSpawn = true;
          break;
        }
      }
      if (isAtSpawn) break;
    }
    
    const oldColor = this.blockColors[row][col];
    
    // Always update the color (even if same) to ensure blocks can be colored
    // This is especially important for blocks at spawn locations where the color
    // might already be correct but needs to be sent to clients
    if (oldColor !== color) {
      this.blockColors[row][col] = color;
      // Track this block as changed for delta compression
      this.changedBlocks.add(`${row},${col}`);
    } else {
      // Even if color is the same, still track it as changed if it's at a spawn location
      // This ensures clients receive updates for blocks beneath spawn points
      if (isAtSpawn) {
        this.changedBlocks.add(`${row},${col}`);
      }
    }
  }
  
  // Collect blocks that a player is touching (without applying colors yet)
  // This allows us to process all players first, then apply colors with priority rules
  collectBlockTouches(player, blockTouches) {
    const charLeft = player.x - this.CHAR_WIDTH / 2;
    const charRight = player.x + this.CHAR_WIDTH / 2;
    const charTop = player.y - this.CHAR_HEIGHT;
    const charBottom = player.y;
    
    // Scale touch distance with block size to maintain consistent detection
    const baseTouchDistance = 5;
    const baseBlockSize = 20; // Reference block size
    const touchDistance = Math.max(3, (baseTouchDistance / baseBlockSize) * this.blockWidth);
    
    // Check all blocks
    for (let row = 0; row < this.mapRows; row++) {
      for (let col = 0; col < this.mapCols; col++) {
        const block = this.blocks[row][col];
        if (block !== null) {
          // Jump pads are 3 blocks wide, regular blocks use normal width
          const blockWidth = block.imageIndex === this.JUMP_PAD_INDEX ? block.width * 3 : block.width;
          const blockLeft = block.x;
          const blockRight = block.x + blockWidth;
          const blockTop = block.y;
          const blockBottom = block.y + block.height;
          
          // Check if character is within touchDistance of any side of the block
          let isTouching = false;
          
          // Left side
          if (charRight >= blockLeft - touchDistance && charRight <= blockLeft + touchDistance &&
              charTop < blockBottom && charBottom > blockTop) {
            isTouching = true;
          }
          // Right side
          else if (charLeft <= blockRight + touchDistance && charLeft >= blockRight - touchDistance &&
              charTop < blockBottom && charBottom > blockTop) {
            isTouching = true;
          }
          // Top
          else if (charBottom >= blockTop - touchDistance && charBottom <= blockTop + touchDistance &&
              charLeft < blockRight && charRight > blockLeft) {
            isTouching = true;
          }
          // Bottom
          else if (charTop <= blockBottom + touchDistance && charTop >= blockBottom - touchDistance &&
              charLeft < blockRight && charRight > blockLeft) {
            isTouching = true;
          }
          
          // If touching, record the touch (last player to touch wins)
          if (isTouching) {
            const blockKey = `${row},${col}`;
            blockTouches.set(blockKey, { team: player.team, playerId: player.playerId });
          }
        }
      }
    }
  }

  getSnapshot() {
    // Convert players map to array for JSON serialization
    const players = Array.from(this.players.values());
    
    // Calculate tick number (gameTime in ticks)
    const tick = Math.floor(this.gameTime / this.fixedTimestep);
    const serverTime = Date.now();
    
    // Build delta of changed blocks (efficient compression)
    // Only include blocks that changed since last snapshot
    const blockChanges = [];
    this.changedBlocks.forEach(blockKey => {
      const [row, col] = blockKey.split(',').map(Number);
      if (row >= 0 && row < this.mapRows && col >= 0 && col < this.mapCols) {
        blockChanges.push({
          row: row,
          col: col,
          color: this.blockColors[row][col]
        });
      }
    });
    
    // Clear changed blocks after snapshot (they've been sent)
    this.changedBlocks.clear();
    
    const snapshot = {
      type: 'snapshot',
      tick: tick,
      serverTime: serverTime,
      gameTime: this.gameTime,
      players: players.map(player => {
        // Calculate velocityX from input state
        const inputState = this.playerInputs.get(player.playerId);
        let velocityX = 0;
        if (inputState) {
          if (inputState.a) velocityX = -this.SPEED;
          if (inputState.d) velocityX = this.SPEED;
        }
        
        return {
          playerId: player.playerId,
          team: player.team,
          x: player.x,
          y: player.y,
          velocityX: velocityX,
          velocityY: player.velocityY,
          hasBomb: player.hasBomb,
          onGround: player.onGround,
          jumpsUsed: player.jumpsUsed // CRITICAL: Sync jump state to prevent desync
        };
      }),
      thrownBombs: this.thrownBombs.map(bomb => ({
        playerId: bomb.playerId,
        x: bomb.x,
        y: bomb.y,
        team: bomb.team,
        velocityX: bomb.velocityX,
        velocityY: bomb.velocityY,
        timer: bomb.timer,
        exploded: bomb.exploded
      })),
      bombs: this.bombs.map(bomb => ({
        id: bomb.id,
        x: bomb.x,
        y: bomb.y,
        collected: bomb.collected,
        respawnTimer: bomb.respawnTimer
      })),
      // Include only changed blocks (delta compression)
      blockChanges: blockChanges,
      // Include last processed sequence for each player (for reconciliation)
      lastProcessedSequences: {}
    };
    
    // Add last processed sequence for each player
    this.lastProcessedSequence.forEach((sequence, playerId) => {
      snapshot.lastProcessedSequences[playerId] = sequence;
    });
    
    return snapshot;
  }
  
  // Legacy method (keep for compatibility)
  getGameState() {
    return this.getSnapshot();
  }
  
  // Reset all blocks to white (for new game)
  resetAllBlocks() {
    for (let row = 0; row < this.mapRows; row++) {
      for (let col = 0; col < this.mapCols; col++) {
        if (this.blocks[row][col] !== null) {
          this.blockColors[row][col] = 'white';
          this.changedBlocks.add(`${row},${col}`);
        }
      }
    }
  }
  
  // Count blocks by team color
  countBlocksByTeam() {
    let redCount = 0;
    let blueCount = 0;
    
    for (let row = 0; row < this.mapRows; row++) {
      for (let col = 0; col < this.mapCols; col++) {
        if (this.blocks[row][col] !== null) {
          const color = this.blockColors[row][col];
          if (color === 'red') {
            redCount++;
          } else if (color === 'blue') {
            blueCount++;
          }
        }
      }
    }
    
    return { red: redCount, blue: blueCount };
  }
  
  // Respawn a player at their team's spawn point
  respawnPlayer(playerId) {
    const player = this.players.get(playerId);
    if (!player) return;
    
    const spawnPoint = this.getSpawnPoint(player.team);
    player.x = spawnPoint.x;
    player.y = spawnPoint.y;
    player.velocityY = 0;
    player.hasBomb = false;
    player.onGround = false;
    player.jumpsUsed = 0;
    player.wasInJumpPad = false;
  }
}

module.exports = GameServer;
