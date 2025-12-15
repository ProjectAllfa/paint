// Map Builder - Click to place/remove blocks and download as JSON
class MapBuilder {
  // Static image cache - shared across all map builder instances
  static image = null;
  static imageLoaded = false;
  static imageLoading = false;

  // Static image cache - shared across all map builder instances
  static images = [];
  static imagesLoaded = [];
  static imagesLoading = [];
  
  // Flag images cache
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

  constructor(canvas) {
    this.canvas = canvas;
    this.canvasManager = new CanvasManager(canvas);
    this.ctx = this.canvasManager.getContext();
    
    // Override resize to account for sidebar
    this.sidebarWidth = 200;
    this.resizeCanvas();
    
    // Grid dimensions
    this.cols = 63;
    this.rows = 43;
    this.blockWidth = 0;
    this.blockHeight = 0;
    this.startX = 0;
    this.startY = 0;
    
    // Store which grid positions have blocks: (row, col) -> imageIndex
    // Special indices: 10 = red spawn marker, 11 = blue spawn marker
    this.blocks = new Map();
    
    // Mode: 'blocks', 'spawns', or 'bombs'
    this.mode = 'blocks';
    
    // Currently selected image index (0-8 for blocks, 9 for jump pad)
    this.selectedImageIndex = 0;
    
    // Currently selected team for flags ('red' or 'blue')
    this.selectedTeam = 'red';
    
    // Mouse state
    this.isMouseDown = false;
    this.lastPlacedBlock = null;
    this.lastPlacedSpawn = null;
    
    // Preload all images
    this.preloadImages();
    this.preloadFlagImages();
    
    this.initialize();
    this.setupImageSelector();
    this.setupModeSelector();
    this.setupEventListeners();
  }

  preloadImages() {
    // Load regular blocks (0-8)
    for (let i = 0; i <= 8; i++) {
      if (!MapBuilder.imagesLoading[i] && !MapBuilder.imagesLoaded[i]) {
        MapBuilder.loadImage(i);
      }
    }
    // Load jump pad (index 9)
    if (!MapBuilder.imagesLoading[9] && !MapBuilder.imagesLoaded[9]) {
      MapBuilder.loadImage(9);
    }
    // Spawn markers use regular block images (we'll render them with colored tint)
    // Index 10 = red spawn, 11 = blue spawn
  }
  
  static SPAWN_MARKER_RED = 10;
  static SPAWN_MARKER_BLUE = 11;
  static SPAWN_MARKER_BOMB = 12;
  
  preloadFlagImages() {
    // Load flag images
    if (!MapBuilder.flagImagesLoading.red && !MapBuilder.flagImagesLoaded.red) {
      MapBuilder.loadFlagImage('red');
    }
    if (!MapBuilder.flagImagesLoading.blue && !MapBuilder.flagImagesLoaded.blue) {
      MapBuilder.loadFlagImage('blue');
    }
  }
  
  static loadFlagImage(team) {
    if (MapBuilder.flagImagesLoading[team] || MapBuilder.flagImagesLoaded[team]) return;
    
    MapBuilder.flagImagesLoading[team] = true;
    const img = new Image();
    img.onload = () => {
      MapBuilder.flagImagesLoaded[team] = true;
      MapBuilder.flagImagesLoading[team] = false;
    };
    img.onerror = () => {
      console.error(`Failed to load flag image: assets/flags/${team}_flag.png`);
      MapBuilder.flagImagesLoading[team] = false;
    };
    img.src = `assets/flags/${team}_flag.png`;
    MapBuilder.flagImages[team] = img;
  }

  static loadImage(imageIndex) {
    if (MapBuilder.imagesLoading[imageIndex] || MapBuilder.imagesLoaded[imageIndex]) return;
    
    MapBuilder.imagesLoading[imageIndex] = true;
    const img = new Image();
    img.onload = () => {
      MapBuilder.imagesLoaded[imageIndex] = true;
      MapBuilder.imagesLoading[imageIndex] = false;
    };
    img.onerror = () => {
      if (imageIndex === 9) {
        console.error('Failed to load jump pad image: assets/blocks/pads/white_jump_pad.png');
      } else {
        console.error(`Failed to load block image: assets/blocks/white${imageIndex}.png`);
      }
      MapBuilder.imagesLoading[imageIndex] = false;
    };
    
    // Jump pad uses different path
    if (imageIndex === 9) {
      img.src = 'assets/blocks/pads/white_jump_pad.png';
    } else {
      img.src = `assets/blocks/white${imageIndex}.png`;
    }
    MapBuilder.images[imageIndex] = img;
  }

  resizeCanvas() {
    this.canvas.width = window.innerWidth - this.sidebarWidth;
    this.canvas.height = window.innerHeight;
    // Set CSS size to match internal resolution to prevent stretching
    this.canvas.style.width = this.canvas.width + 'px';
    this.canvas.style.height = this.canvas.height + 'px';
  }

  initialize() {
    this.resizeCanvas();
    this.calculateGrid();
    this.render();
  }

  calculateGrid() {
    const padding = 20;
    const availableWidth = this.canvas.width - (padding * 2);
    const availableHeight = this.canvas.height - (padding * 2);
    
    const blockWidthByCols = availableWidth / this.cols;
    const blockHeightByRows = availableHeight / this.rows;
    
    this.blockWidth = Math.min(blockWidthByCols, blockHeightByRows);
    this.blockHeight = this.blockWidth;
    
    const gridWidth = this.blockWidth * this.cols;
    const gridHeight = this.blockHeight * this.rows;
    
    this.startX = (this.canvas.width - gridWidth) / 2;
    this.startY = (this.canvas.height - gridHeight) / 2;
  }

  getGridPosition(x, y) {
    const col = Math.floor((x - this.startX) / this.blockWidth);
    const row = Math.floor((y - this.startY) / this.blockHeight);
    
    if (col >= 0 && col < this.cols && row >= 0 && row < this.rows) {
      return { row, col };
    }
    return null;
  }

  toggleBlock(row, col) {
    const key = `${row},${col}`;
    if (this.blocks.has(key)) {
      this.blocks.delete(key);
    } else {
      this.blocks.set(key, this.selectedImageIndex);
    }
    this.updateBlockCount();
  }
  
  toggleSpawn(row, col) {
    const key = `${row},${col}`;
    const redMarkerIndex = MapBuilder.SPAWN_MARKER_RED;
    const blueMarkerIndex = MapBuilder.SPAWN_MARKER_BLUE;
    const bombMarkerIndex = MapBuilder.SPAWN_MARKER_BOMB;
    
    // Handle bomb spawns
    if (this.mode === 'bombs') {
      const existingIndex = this.blocks.get(key);
      const isBombMarker = existingIndex === bombMarkerIndex;
      
      if (isBombMarker) {
        // Remove bomb marker
        this.blocks.delete(key);
      } else {
        // Place bomb marker
        this.blocks.set(key, bombMarkerIndex);
      }
      this.updateBlockCount();
      this.updateSpawnCount();
      return;
    }
    
    // Handle player spawn points (red/blue)
    // Check if there's already a spawn marker at this position
    const existingIndex = this.blocks.get(key);
    const isRedMarker = existingIndex === redMarkerIndex;
    const isBlueMarker = existingIndex === blueMarkerIndex;
    
    if (isRedMarker || isBlueMarker) {
      // If clicking the same team marker, remove it
      if ((isRedMarker && this.selectedTeam === 'red') || 
          (isBlueMarker && this.selectedTeam === 'blue')) {
        this.blocks.delete(key);
      } else {
        // Replace with new team marker
        const newIndex = this.selectedTeam === 'red' ? redMarkerIndex : blueMarkerIndex;
        this.blocks.set(key, newIndex);
      }
    } else {
      // Place new spawn marker block
      const markerIndex = this.selectedTeam === 'red' ? redMarkerIndex : blueMarkerIndex;
      this.blocks.set(key, markerIndex);
    }
    this.updateBlockCount();
    this.updateSpawnCount();
  }

  updateBlockCount() {
    const count = this.blocks.size;
    const infoEl = document.getElementById('blockCount');
    if (infoEl) {
      infoEl.textContent = `Blocks placed: ${count}`;
    }
  }
  
  updateSpawnCount() {
    let redCount = 0;
    let blueCount = 0;
    let bombCount = 0;
    this.blocks.forEach((imageIndex) => {
      if (imageIndex === MapBuilder.SPAWN_MARKER_RED) redCount++;
      if (imageIndex === MapBuilder.SPAWN_MARKER_BLUE) blueCount++;
      if (imageIndex === MapBuilder.SPAWN_MARKER_BOMB) bombCount++;
    });
    const spawnInfoEl = document.getElementById('spawnCount');
    if (spawnInfoEl) {
      spawnInfoEl.textContent = `Red spawns: ${redCount} | Blue spawns: ${blueCount} | Bomb spawns: ${bombCount}`;
    }
  }

  setupImageSelector() {
    const container = document.getElementById('imageButtons');
    if (!container) return;
    
    // Create buttons for each image (0-8)
    for (let i = 0; i <= 8; i++) {
      const btn = this.createImageButton(i, `assets/blocks/white${i}.png`, i.toString());
      container.appendChild(btn);
    }
    
    // Add jump pad button (index 9)
    const jumpPadBtn = this.createImageButton(9, 'assets/blocks/pads/white_jump_pad.png', 'Pad');
    container.appendChild(jumpPadBtn);
  }
  
  setupModeSelector() {
    // Create mode selector buttons
    const modeContainer = document.getElementById('modeSelector');
    if (!modeContainer) return;
    
    // Blocks mode button
    const blocksBtn = document.createElement('button');
    blocksBtn.textContent = 'Blocks';
    blocksBtn.classList.add('modeBtn');
    blocksBtn.dataset.mode = 'blocks';
    blocksBtn.style.background = this.mode === 'blocks' ? '#4CAF50' : '#555';
    blocksBtn.style.width = '100%';
    blocksBtn.style.padding = '8px';
    blocksBtn.style.margin = '2px 0';
    blocksBtn.style.border = 'none';
    blocksBtn.style.borderRadius = '4px';
    blocksBtn.style.cursor = 'pointer';
    blocksBtn.style.color = 'white';
    blocksBtn.addEventListener('click', () => {
      this.mode = 'blocks';
      document.querySelectorAll('.modeBtn').forEach(b => {
        b.style.background = '#555';
      });
      blocksBtn.style.background = '#4CAF50';
      document.getElementById('imageSelector').style.display = 'block';
      document.getElementById('flagSelector').style.display = 'none';
    });
    modeContainer.appendChild(blocksBtn);
    
    // Flags mode button
    const flagsBtn = document.createElement('button');
    flagsBtn.textContent = 'Spawn Points';
    flagsBtn.classList.add('modeBtn');
    flagsBtn.dataset.mode = 'flags';
    flagsBtn.style.background = this.mode === 'flags' ? '#4CAF50' : '#555';
    flagsBtn.style.width = '100%';
    flagsBtn.style.padding = '8px';
    flagsBtn.style.margin = '2px 0';
    flagsBtn.style.border = 'none';
    flagsBtn.style.borderRadius = '4px';
    flagsBtn.style.cursor = 'pointer';
    flagsBtn.style.color = 'white';
    flagsBtn.addEventListener('click', () => {
      this.mode = 'flags';
      document.querySelectorAll('.modeBtn').forEach(b => {
        b.style.background = '#555';
      });
      flagsBtn.style.background = '#4CAF50';
      document.getElementById('imageSelector').style.display = 'none';
      document.getElementById('flagSelector').style.display = 'block';
    });
    modeContainer.appendChild(flagsBtn);
    
    // Bomb spawns mode button
    const bombsBtn = document.createElement('button');
    bombsBtn.textContent = 'Bomb Spawns';
    bombsBtn.classList.add('modeBtn');
    bombsBtn.dataset.mode = 'bombs';
    bombsBtn.style.background = this.mode === 'bombs' ? '#4CAF50' : '#555';
    bombsBtn.style.width = '100%';
    bombsBtn.style.padding = '8px';
    bombsBtn.style.margin = '2px 0';
    bombsBtn.style.border = 'none';
    bombsBtn.style.borderRadius = '4px';
    bombsBtn.style.cursor = 'pointer';
    bombsBtn.style.color = 'white';
    bombsBtn.addEventListener('click', () => {
      this.mode = 'bombs';
      document.querySelectorAll('.modeBtn').forEach(b => {
        b.style.background = '#555';
      });
      bombsBtn.style.background = '#4CAF50';
      document.getElementById('imageSelector').style.display = 'none';
      document.getElementById('flagSelector').style.display = 'none';
    });
    modeContainer.appendChild(bombsBtn);
    
    // Setup flag selector buttons
    this.setupFlagSelector();
    
    // Initially hide flag selector
    const flagSelector = document.getElementById('flagSelector');
    if (flagSelector) {
      flagSelector.style.display = 'none';
    }
  }
  
  setupFlagSelector() {
    const flagContainer = document.getElementById('flagButtons');
    if (!flagContainer) return;
    
    // Red flag button
    const redBtn = document.createElement('button');
    redBtn.textContent = 'Red';
    redBtn.dataset.team = 'red';
    redBtn.style.background = this.selectedTeam === 'red' ? '#f44336' : '#555';
    redBtn.style.color = 'white';
    redBtn.style.padding = '10px';
    redBtn.style.border = 'none';
    redBtn.style.borderRadius = '4px';
    redBtn.style.cursor = 'pointer';
    redBtn.style.fontWeight = 'bold';
    redBtn.addEventListener('click', () => {
      this.selectedTeam = 'red';
      document.querySelectorAll('#flagButtons button').forEach(b => {
        b.style.background = '#555';
      });
      redBtn.style.background = '#f44336';
    });
    flagContainer.appendChild(redBtn);
    
    // Blue flag button
    const blueBtn = document.createElement('button');
    blueBtn.textContent = 'Blue';
    blueBtn.dataset.team = 'blue';
    blueBtn.style.background = this.selectedTeam === 'blue' ? '#2196F3' : '#555';
    blueBtn.style.color = 'white';
    blueBtn.style.padding = '10px';
    blueBtn.style.border = 'none';
    blueBtn.style.borderRadius = '4px';
    blueBtn.style.cursor = 'pointer';
    blueBtn.style.fontWeight = 'bold';
    blueBtn.addEventListener('click', () => {
      this.selectedTeam = 'blue';
      document.querySelectorAll('#flagButtons button').forEach(b => {
        b.style.background = '#555';
      });
      blueBtn.style.background = '#2196F3';
    });
    flagContainer.appendChild(blueBtn);
  }

  createImageButton(imageIndex, imageSrc, labelText) {
    const btn = document.createElement('button');
    btn.classList.add('imageBtn');
    btn.dataset.index = imageIndex;
    
    // Create image element
    const img = document.createElement('img');
    img.src = imageSrc;
    img.alt = labelText;
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'contain';
    img.style.display = 'block';
    
    // Create label
    const label = document.createElement('span');
    label.textContent = labelText;
    label.style.position = 'absolute';
    label.style.bottom = '2px';
    label.style.right = '2px';
    label.style.background = 'rgba(0, 0, 0, 0.7)';
    label.style.color = 'white';
    label.style.padding = '2px 4px';
    label.style.borderRadius = '2px';
    label.style.fontSize = '10px';
    label.style.fontWeight = 'bold';
    
    btn.appendChild(img);
    btn.appendChild(label);
    
    // Style button
    btn.style.position = 'relative';
    btn.style.padding = '0';
    btn.style.width = '100%';
    btn.style.aspectRatio = '1';
    btn.style.overflow = 'hidden';
    btn.style.cursor = 'pointer';
    btn.style.border = '2px solid transparent';
    btn.style.background = '#333';
    btn.style.borderRadius = '4px';
    
    if (imageIndex === this.selectedImageIndex) {
      btn.style.border = '2px solid #4CAF50';
      btn.style.boxShadow = '0 0 8px rgba(76, 175, 80, 0.5)';
    }
    
    btn.addEventListener('click', () => {
      // Update selected button style
      document.querySelectorAll('.imageBtn').forEach(b => {
        b.style.border = '2px solid transparent';
        b.style.boxShadow = 'none';
      });
      btn.style.border = '2px solid #4CAF50';
      btn.style.boxShadow = '0 0 8px rgba(76, 175, 80, 0.5)';
      this.selectedImageIndex = imageIndex;
    });
    
    return btn;
  }

  setupEventListeners() {
    // Handle canvas resize
    window.addEventListener('resize', () => {
      this.resizeCanvas();
      this.calculateGrid();
      this.render();
    });

    // Mouse events for placing blocks/spawns
    this.canvas.addEventListener('mousedown', (e) => {
      this.isMouseDown = true;
      const rect = this.canvas.getBoundingClientRect();
      // Scale coordinates to match canvas internal resolution
      const scaleX = this.canvas.width / rect.width;
      const scaleY = this.canvas.height / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;
      const gridPos = this.getGridPosition(x, y);
      if (gridPos) {
        if (this.mode === 'blocks') {
          this.toggleBlock(gridPos.row, gridPos.col);
          this.lastPlacedBlock = `${gridPos.row},${gridPos.col}`;
        } else if (this.mode === 'flags' || this.mode === 'bombs') {
          this.toggleSpawn(gridPos.row, gridPos.col);
          this.lastPlacedSpawn = `${gridPos.row},${gridPos.col}`;
        }
        this.render();
      }
    });

    this.canvas.addEventListener('mousemove', (e) => {
      if (this.isMouseDown) {
        const rect = this.canvas.getBoundingClientRect();
        // Scale coordinates to match canvas internal resolution
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;
        const gridPos = this.getGridPosition(x, y);
        if (gridPos) {
          const key = `${gridPos.row},${gridPos.col}`;
          if (this.mode === 'blocks') {
            // Only toggle if it's a different block than the last one
            if (key !== this.lastPlacedBlock) {
              this.toggleBlock(gridPos.row, gridPos.col);
              this.lastPlacedBlock = key;
              this.render();
            }
          } else if (this.mode === 'flags' || this.mode === 'bombs') {
            // Only toggle if it's a different spawn than the last one
            if (key !== this.lastPlacedSpawn) {
              this.toggleSpawn(gridPos.row, gridPos.col);
              this.lastPlacedSpawn = key;
              this.render();
            }
          }
        }
      }
    });

    this.canvas.addEventListener('mouseup', () => {
      this.isMouseDown = false;
      this.lastPlacedBlock = null;
      this.lastPlacedSpawn = null;
    });

    this.canvas.addEventListener('mouseleave', () => {
      this.isMouseDown = false;
      this.lastPlacedBlock = null;
      this.lastPlacedSpawn = null;
    });

    // Clear button
    document.getElementById('clearBtn').addEventListener('click', () => {
      if (confirm('Clear all blocks and spawns?')) {
        this.blocks.clear();
        this.updateBlockCount();
        this.updateSpawnCount();
        this.render();
      }
    });

    // Download button
    document.getElementById('downloadBtn').addEventListener('click', () => {
      this.downloadJSON();
    });

    // Load map button
    document.getElementById('loadMapBtn').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        this.loadMap(file);
      }
      // Reset the input so the same file can be selected again
      e.target.value = '';
    });
  }

  loadMap(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const mapData = JSON.parse(e.target.result);
        this.loadMapData(mapData);
      } catch (error) {
        alert('Failed to load map: Invalid JSON file');
        console.error('Error loading map:', error);
      }
    };
    reader.onerror = () => {
      alert('Failed to read file');
    };
    reader.readAsText(file);
  }

  loadMapData(mapData) {
    // Clear existing blocks (spawn markers are stored as blocks)
    this.blocks.clear();
    
    // Validate map data
    if (!mapData.cols || !mapData.rows || !mapData.blocks) {
      alert('Invalid map format: Missing required fields');
      return;
    }
    
    // Update grid dimensions if different
    if (mapData.cols !== this.cols || mapData.rows !== this.rows) {
      if (confirm(`Map dimensions (${mapData.cols}x${mapData.rows}) differ from current (${this.cols}x${this.rows}). Load anyway?`)) {
        this.cols = mapData.cols;
        this.rows = mapData.rows;
        this.calculateGrid();
      } else {
        return;
      }
    }
    
    // Load blocks
    mapData.blocks.forEach((blockData) => {
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
        const key = `${row},${col}`;
        this.blocks.set(key, imageIndex);
      }
    });
    
    // Load spawn points from old format if they exist, convert to marker blocks
    if (mapData.spawns) {
      if (mapData.spawns.red) {
        mapData.spawns.red.forEach((spawnData) => {
          const row = spawnData.row;
          const col = spawnData.col;
          if (row >= 0 && row < this.rows && col >= 0 && col < this.cols) {
            const key = `${row},${col}`;
            this.blocks.set(key, MapBuilder.SPAWN_MARKER_RED);
          }
        });
      }
      if (mapData.spawns.blue) {
        mapData.spawns.blue.forEach((spawnData) => {
          const row = spawnData.row;
          const col = spawnData.col;
          if (row >= 0 && row < this.rows && col >= 0 && col < this.cols) {
            const key = `${row},${col}`;
            this.blocks.set(key, MapBuilder.SPAWN_MARKER_BLUE);
          }
        });
      }
    }
    
    // Load bomb spawns if they exist
    if (mapData.bombSpawns) {
      mapData.bombSpawns.forEach((spawnData) => {
        const row = spawnData.row;
        const col = spawnData.col;
        if (row >= 0 && row < this.rows && col >= 0 && col < this.cols) {
          const key = `${row},${col}`;
          this.blocks.set(key, MapBuilder.SPAWN_MARKER_BOMB);
        }
      });
    }
    
    this.updateBlockCount();
    this.updateSpawnCount();
    this.render();
  }

  downloadJSON() {
    // Separate regular blocks from spawn markers
    const blockArray = [];
    const spawnData = {
      red: [],
      blue: []
    };
    const bombSpawns = [];
    
    this.blocks.forEach((imageIndex, key) => {
      const [row, col] = key.split(',').map(Number);
      
      if (imageIndex === MapBuilder.SPAWN_MARKER_RED) {
        spawnData.red.push({ row, col });
      } else if (imageIndex === MapBuilder.SPAWN_MARKER_BLUE) {
        spawnData.blue.push({ row, col });
      } else if (imageIndex === MapBuilder.SPAWN_MARKER_BOMB) {
        bombSpawns.push({ row, col });
      } else {
        // Regular block or jump pad
        blockArray.push([row, col, imageIndex]);
      }
    });

    const mapData = {
      cols: this.cols,
      rows: this.rows,
      blocks: blockArray
    };
    
    // Only include spawns if there are any
    if (spawnData.red.length > 0 || spawnData.blue.length > 0) {
      mapData.spawns = spawnData;
    }
    
    // Only include bomb spawns if there are any
    if (bombSpawns.length > 0) {
      mapData.bombSpawns = bombSpawns;
    }

    const json = JSON.stringify(mapData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'map.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  render() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    // Draw background
    this.ctx.fillStyle = '#1a1a1a';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    
    // Draw grid lines (light gray for reference)
    this.ctx.strokeStyle = '#333';
    this.ctx.lineWidth = 1;
    
    // Vertical lines
    for (let col = 0; col <= this.cols; col++) {
      const x = this.startX + col * this.blockWidth;
      this.ctx.beginPath();
      this.ctx.moveTo(x, this.startY);
      this.ctx.lineTo(x, this.startY + this.blockHeight * this.rows);
      this.ctx.stroke();
    }
    
    // Horizontal lines
    for (let row = 0; row <= this.rows; row++) {
      const y = this.startY + row * this.blockHeight;
      this.ctx.beginPath();
      this.ctx.moveTo(this.startX, y);
      this.ctx.lineTo(this.startX + this.blockWidth * this.cols, y);
      this.ctx.stroke();
    }
    
    // Draw placed blocks
    this.ctx.strokeStyle = '#333';
    this.ctx.lineWidth = 1;
    
    this.blocks.forEach((imageIndex, key) => {
      const [row, col] = key.split(',').map(Number);
      const x = this.startX + col * this.blockWidth;
      const y = this.startY + row * this.blockHeight;
      
      // Handle spawn markers (special rendering)
      if (imageIndex === MapBuilder.SPAWN_MARKER_RED || imageIndex === MapBuilder.SPAWN_MARKER_BLUE) {
        // Draw spawn marker as a colored block
        const color = imageIndex === MapBuilder.SPAWN_MARKER_RED ? '#ff4444' : '#4444ff';
        this.ctx.fillStyle = color;
        this.ctx.fillRect(x, y, this.blockWidth, this.blockHeight);
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(x, y, this.blockWidth, this.blockHeight);
        
        // Draw a small indicator
        this.ctx.fillStyle = 'white';
        this.ctx.font = 'bold 12px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText(imageIndex === MapBuilder.SPAWN_MARKER_RED ? 'R' : 'B', 
                         x + this.blockWidth / 2, 
                         y + this.blockHeight / 2);
        return;
      }
      
      // Handle bomb spawn markers
      if (imageIndex === MapBuilder.SPAWN_MARKER_BOMB) {
        // Draw bomb spawn marker as a yellow/orange block
        const color = '#ffaa00';
        this.ctx.fillStyle = color;
        this.ctx.fillRect(x, y, this.blockWidth, this.blockHeight);
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(x, y, this.blockWidth, this.blockHeight);
        
        // Draw bomb indicator (💣 emoji or "B" text)
        this.ctx.fillStyle = 'white';
        this.ctx.font = 'bold 12px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText('💣', 
                         x + this.blockWidth / 2, 
                         y + this.blockHeight / 2);
        return;
      }
      
      // Jump pads are 3 blocks wide
      const drawWidth = imageIndex === 9 ? this.blockWidth * 3 : this.blockWidth;
      
      // Draw image if loaded, otherwise fallback to solid color
      const img = MapBuilder.images[imageIndex];
      if (MapBuilder.imagesLoaded[imageIndex] && img) {
        this.ctx.drawImage(img, x, y, drawWidth, this.blockHeight);
      } else {
        // Fallback to solid color while image loads
        this.ctx.fillStyle = 'white';
        this.ctx.fillRect(x, y, drawWidth, this.blockHeight);
      }
      
      this.ctx.strokeRect(x, y, drawWidth, this.blockHeight);
    });
  }
}

// Initialize map builder when page loads
window.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('gameCanvas');
  new MapBuilder(canvas);
});

