// Map class - manages the grid of blocks
class Map {
  // Static flag images cache
  static flagImages = {
    red: null,
    blue: null
  };
  static flagImagesLoaded = {
    red: false,
    blue: false
  };
  static flagImagesLoading = {
    red: false,
    blue: false
  };
  
  static loadFlagImage(team) {
    if (Map.flagImagesLoading[team] || Map.flagImagesLoaded[team]) return;
    
    Map.flagImagesLoading[team] = true;
    const img = new Image();
    img.onload = () => {
      Map.flagImagesLoaded[team] = true;
      Map.flagImagesLoading[team] = false;
    };
    img.onerror = () => {
      console.error(`Failed to load flag image: assets/flags/${team}_flag.png`);
      Map.flagImagesLoading[team] = false;
    };
    img.src = `assets/flags/${team}_flag.png`;
    Map.flagImages[team] = img;
  }
  
  constructor(canvasWidth, canvasHeight, mapData = null) {
    // Use mapData if provided, otherwise use defaults
    if (mapData) {
      this.cols = mapData.cols;
      this.rows = mapData.rows;
      this.mapData = mapData;
    } else {
      this.cols = 63;
      this.rows = 43;
      this.mapData = null;
    }
    
    this.blocks = [];
    this.blockWidth = 0;
    this.blockHeight = 0;
    this.startX = 0;
    this.startY = 0;
    
    // Spawn points: {red: [{row, col, x, y}], blue: [{row, col, x, y}]}
    this.spawns = {
      red: [],
      blue: []
    };
    
    // Bomb spawn points: [{row, col, x, y}]
    this.bombSpawns = [];
    
    this.initializeMap(canvasWidth, canvasHeight);
  }

  initializeMap(canvasWidth, canvasHeight) {
    // Calculate block size to fit the grid in the center
    // Leave some padding around the edges
    const padding = 20;
    const availableWidth = canvasWidth - (padding * 2);
    const availableHeight = canvasHeight - (padding * 2);
    
    // Calculate block size to maintain square blocks
    const blockWidthByCols = availableWidth / this.cols;
    const blockHeightByRows = availableHeight / this.rows;
    
    // Use the smaller dimension to ensure blocks fit and remain square-ish
    // Round to integer for pixel-perfect rendering (prevents sub-pixel block sizes)
    this.blockWidth = Math.floor(Math.min(blockWidthByCols, blockHeightByRows));
    this.blockHeight = this.blockWidth; // Keep blocks square
    
    // Calculate total grid dimensions
    const gridWidth = this.blockWidth * this.cols;
    const gridHeight = this.blockHeight * this.rows;
    
    // Center the grid
    this.startX = (canvasWidth - gridWidth) / 2;
    this.startY = (canvasHeight - gridHeight) / 2;
    
    // Create blocks based on map data
    this.blocks = [];
    for (let row = 0; row < this.rows; row++) {
      this.blocks[row] = [];
      for (let col = 0; col < this.cols; col++) {
        this.blocks[row][col] = null; // Initialize as null
      }
    }
    
    // If mapData is provided, create blocks only at specified positions
    let blockCount = 0;
    if (this.mapData && this.mapData.blocks) {
      this.mapData.blocks.forEach((blockData) => {
        // Support both old format [row, col] and new format [row, col, imageIndex]
        let row, col, imageIndex = 0;
        if (blockData.length === 2) {
          [row, col] = blockData;
          imageIndex = 0; // Default to 0 for old format
        } else if (blockData.length === 3) {
          [row, col, imageIndex] = blockData;
        } else {
          return; // Skip invalid entries
        }
        
        if (row >= 0 && row < this.rows && col >= 0 && col < this.cols) {
          const x = this.startX + col * this.blockWidth;
          const y = this.startY + row * this.blockHeight;
          this.blocks[row][col] = new Block(x, y, this.blockWidth, this.blockHeight, imageIndex);
          blockCount++;
        }
      });
    }
    
    // Load spawn points from spawns data (spawn markers are stored here)
    if (this.mapData && this.mapData.spawns) {
      // Preload flag images
      if (this.mapData.spawns.red && this.mapData.spawns.red.length > 0) {
        Map.loadFlagImage('red');
      }
      if (this.mapData.spawns.blue && this.mapData.spawns.blue.length > 0) {
        Map.loadFlagImage('blue');
      }
      
      // Load red spawns - spawn marker block position
      if (this.mapData.spawns.red) {
        this.mapData.spawns.red.forEach((spawnData) => {
          const row = spawnData.row;
          const col = spawnData.col;
          if (row >= 0 && row < this.rows && col >= 0 && col < this.cols) {
            // Find the block at this position (the spawn marker)
            const block = this.blocks[row][col];
            if (block !== null) {
              // Spawn at the top of the marker block
              this.spawns.red.push({
                row,
                col,
                x: block.x + block.width / 2,
                y: block.y // Top of block (where character spawns)
              });
            } else {
              // Fallback: use grid position
              const x = this.startX + col * this.blockWidth;
              const y = this.startY + row * this.blockHeight;
              this.spawns.red.push({
                row,
                col,
                x: x + this.blockWidth / 2,
                y: y
              });
            }
          }
        });
      }
      
      // Load blue spawns - spawn marker block position
      if (this.mapData.spawns.blue) {
        this.mapData.spawns.blue.forEach((spawnData) => {
          const row = spawnData.row;
          const col = spawnData.col;
          if (row >= 0 && row < this.rows && col >= 0 && col < this.cols) {
            // Find the block at this position (the spawn marker)
            const block = this.blocks[row][col];
            if (block !== null) {
              // Spawn at the top of the marker block
              this.spawns.blue.push({
                row,
                col,
                x: block.x + block.width / 2,
                y: block.y // Top of block (where character spawns)
              });
            } else {
              // Fallback: use grid position
              const x = this.startX + col * this.blockWidth;
              const y = this.startY + row * this.blockHeight;
              this.spawns.blue.push({
                row,
                col,
                x: x + this.blockWidth / 2,
                y: y
              });
            }
          }
        });
      }
    }
    
    // Load bomb spawn points
    if (this.mapData && this.mapData.bombSpawns) {
      this.mapData.bombSpawns.forEach((spawnData) => {
        const row = spawnData.row;
        const col = spawnData.col;
        if (row >= 0 && row < this.rows && col >= 0 && col < this.cols) {
          // Find the block at this position (the bomb spawn marker)
          const block = this.blocks[row][col];
          if (block !== null) {
            // Spawn at the top center of the marker block
            this.bombSpawns.push({
              row,
              col,
              x: block.x + block.width / 2,
              y: block.y // Top of block
            });
          } else {
            // Fallback: use grid position
            const x = this.startX + col * this.blockWidth;
            const y = this.startY + row * this.blockHeight;
            this.bombSpawns.push({
              row,
              col,
              x: x + this.blockWidth / 2,
              y: y
            });
          }
        }
      });
    }
  }

  // Handle canvas resize - preserve block colors and update positions
  resize(canvasWidth, canvasHeight) {
    // Calculate new block size and positions
    const padding = 20;
    const availableWidth = canvasWidth - (padding * 2);
    const availableHeight = canvasHeight - (padding * 2);
    
    const blockWidthByCols = availableWidth / this.cols;
    const blockHeightByRows = availableHeight / this.rows;
    
    const newBlockWidth = Math.min(blockWidthByCols, blockHeightByRows);
    const newBlockHeight = newBlockWidth;
    
    const gridWidth = newBlockWidth * this.cols;
    const gridHeight = newBlockHeight * this.rows;
    
    const newStartX = (canvasWidth - gridWidth) / 2;
    const newStartY = (canvasHeight - gridHeight) / 2;
    
    // Calculate scale factors for position updates
    const scaleX = this.blockWidth > 0 ? newBlockWidth / this.blockWidth : 1;
    const scaleY = this.blockHeight > 0 ? newBlockHeight / this.blockHeight : 1;
    
    // Update existing blocks instead of recreating them
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const block = this.blocks[row][col];
        if (block !== null) {
          // Update block position and size, preserving color
          const newX = newStartX + col * newBlockWidth;
          const newY = newStartY + row * newBlockHeight;
          block.x = newX;
          block.y = newY;
          block.width = newBlockWidth;
          block.height = newBlockHeight;
        }
      }
    }
    
    // Update map dimensions
    this.blockWidth = newBlockWidth;
    this.blockHeight = newBlockHeight;
    this.startX = newStartX;
    this.startY = newStartY;
    
    // Update spawn point positions (recalculate based on current block positions)
    ['red', 'blue'].forEach(team => {
      this.spawns[team].forEach(spawn => {
        // Try to find block at original spawn position or nearby
        let block = this.blocks[spawn.row] && this.blocks[spawn.row][spawn.col];
        if (block !== null) {
          spawn.x = block.x + block.width / 2;
          spawn.y = block.y;
        } else {
          // Look for block below
          for (let checkRow = spawn.row + 1; checkRow < this.rows; checkRow++) {
            block = this.blocks[checkRow] && this.blocks[checkRow][spawn.col];
            if (block !== null) {
              spawn.x = block.x + block.width / 2;
              spawn.y = block.y;
              return;
            }
          }
          // Fallback to grid position
          const x = this.startX + spawn.col * this.blockWidth;
          const y = this.startY + spawn.row * this.blockHeight;
          spawn.x = x + this.blockWidth / 2;
          spawn.y = y;
        }
      });
    });
    
    // Update bomb spawn point positions
    this.bombSpawns.forEach(spawn => {
      const block = this.blocks[spawn.row] && this.blocks[spawn.row][spawn.col];
      if (block !== null) {
        spawn.x = block.x + block.width / 2;
        spawn.y = block.y;
      } else {
        // Fallback: recalculate from grid
        spawn.x = this.startX + spawn.col * this.blockWidth + this.blockWidth / 2;
        spawn.y = this.startY + spawn.row * this.blockHeight;
      }
    });
  }

  // Get block at grid coordinates
  getBlock(row, col) {
    if (row >= 0 && row < this.rows && col >= 0 && col < this.cols) {
      return this.blocks[row][col]; // Returns null for interior positions
    }
    return null;
  }

  // Get block at world coordinates (pixel position)
  getBlockAt(x, y) {
    const col = Math.floor((x - this.startX) / this.blockWidth);
    const row = Math.floor((y - this.startY) / this.blockHeight);
    return this.getBlock(row, col);
  }

  // Update all blocks (for animations)
  update(deltaTime) {
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const block = this.blocks[row][col];
        if (block !== null) {
          block.update(deltaTime);
        }
      }
    }
  }

  // Draw all blocks (only border blocks exist)
  draw(ctx) {
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        if (this.blocks[row][col] !== null) {
          this.blocks[row][col].draw(ctx);
        }
      }
    }
  }
  
  // Draw flags at spawn points (pole base at bottom of marker block)
  drawFlags(ctx) {
    // Draw red flags
    this.spawns.red.forEach(spawn => {
      const flagImg = Map.flagImages.red;
      if (Map.flagImagesLoaded.red && flagImg) {
        // Flags are 3 blocks tall, maintain aspect ratio
        const flagHeight = this.blockHeight * 3;
        const aspectRatio = flagImg.width / flagImg.height;
        const flagWidth = flagHeight * aspectRatio;
        
        // Calculate marker block position from grid coordinates
        const blockX = this.startX + spawn.col * this.blockWidth;
        const blockY = this.startY + spawn.row * this.blockHeight;
        const blockCenterX = blockX + this.blockWidth / 2;
        const blockBottom = blockY + this.blockHeight; // Bottom of the marker block
        
        // Position flag: pole base (bottom of flag image) at bottom of marker block
        // Flag extends upward from the block bottom
        const flagX = blockCenterX - flagWidth / 2; // Center horizontally on block
        const flagY = blockBottom - flagHeight; // Bottom of flag image at bottom of block
        
        ctx.drawImage(flagImg, flagX, flagY, flagWidth, flagHeight);
      }
    });
    
    // Draw blue flags
    this.spawns.blue.forEach(spawn => {
      const flagImg = Map.flagImages.blue;
      if (Map.flagImagesLoaded.blue && flagImg) {
        // Flags are 3 blocks tall, maintain aspect ratio
        const flagHeight = this.blockHeight * 3;
        const aspectRatio = flagImg.width / flagImg.height;
        const flagWidth = flagHeight * aspectRatio;
        
        // Calculate marker block position from grid coordinates
        const blockX = this.startX + spawn.col * this.blockWidth;
        const blockY = this.startY + spawn.row * this.blockHeight;
        const blockCenterX = blockX + this.blockWidth / 2;
        const blockBottom = blockY + this.blockHeight; // Bottom of the marker block
        
        // Position flag: pole base (bottom of flag image) at bottom of marker block
        // Flag extends upward from the block bottom
        const flagX = blockCenterX - flagWidth / 2; // Center horizontally on block
        const flagY = blockBottom - flagHeight; // Bottom of flag image at bottom of block
        
        ctx.drawImage(flagImg, flagX, flagY, flagWidth, flagHeight);
      }
    });
  }
  
  // Get spawn point for a team (round-robin if multiple spawns)
  getSpawnPoint(team, spawnIndex = 0) {
    const teamSpawns = this.spawns[team] || [];
    if (teamSpawns.length === 0) {
      return null;
    }
    // Use modulo to cycle through spawn points
    const index = spawnIndex % teamSpawns.length;
    return teamSpawns[index];
  }
  
  // Get all spawn points for a team
  getSpawnPoints(team) {
    return this.spawns[team] || [];
  }
}

