// Asset Preloader
class AssetPreloader {
  constructor() {
    this.assets = [];
    this.loadedCount = 0;
    this.totalCount = 0;
    this.loadingBar = null;
    this.loadingScreen = null;
  }

  // Define all assets to preload
  getAssetList() {
    return [
      // Logo
      'assets/paint-logo.png',
      
      // Character images
      'assets/characters/red/r1.png',
      'assets/characters/blue/b1.png',
      
      // Bomb images
      'assets/bombs/red_bomb.png',
      'assets/bombs/blue_bomb.png',
      'assets/bombs/bomb_white_flash.png',
      'assets/bombs/bomb_item.png',
      'assets/bombs/bomb_item_background.png',
      
      // Flag images
      'assets/flags/red_flag.png',
      'assets/flags/blue_flag.png',
      
      // Arrow images
      'assets/arrow/red_arrow.png',
      'assets/arrow/blue_arrow.png',
      
      // Key images
      'assets/keys/wasd.png',
      'assets/keys/s.png',
      
      // Social images
      'assets/socials/x-logo.jpg',
      'assets/socials/pump-logo.jpg',
      
      // Jump effect
      'assets/sprites/jump_effect_spritesheet.png',
      
      // Star
      'assets/star.png',
      
      // Block images - white (0-8)
      'assets/blocks/white0.png',
      'assets/blocks/white1.png',
      'assets/blocks/white2.png',
      'assets/blocks/white3.png',
      'assets/blocks/white4.png',
      'assets/blocks/white5.png',
      'assets/blocks/white6.png',
      'assets/blocks/white7.png',
      'assets/blocks/white8.png',
      
      // Block images - red (0-8)
      'assets/blocks/red/red0.png',
      'assets/blocks/red/red1.png',
      'assets/blocks/red/red2.png',
      'assets/blocks/red/red3.png',
      'assets/blocks/red/red4.png',
      'assets/blocks/red/red5.png',
      'assets/blocks/red/red6.png',
      'assets/blocks/red/red7.png',
      'assets/blocks/red/red8.png',
      
      // Block images - blue (0-8)
      'assets/blocks/blue/blue0.png',
      'assets/blocks/blue/blue1.png',
      'assets/blocks/blue/blue2.png',
      'assets/blocks/blue/blue3.png',
      'assets/blocks/blue/blue4.png',
      'assets/blocks/blue/blue5.png',
      'assets/blocks/blue/blue6.png',
      'assets/blocks/blue/blue7.png',
      'assets/blocks/blue/blue8.png',
      
      // Jump pads
      'assets/blocks/pads/white_jump_pad.png',
      'assets/blocks/pads/red_jump_pad.png',
      'assets/blocks/pads/blue_jump_pad.png'
    ];
  }

  // Load a single asset
  loadAsset(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        this.loadedCount++;
        this.updateProgress();
        resolve(img);
      };
      img.onerror = () => {
        console.warn(`Failed to load asset: ${src}`);
        this.loadedCount++;
        this.updateProgress();
        resolve(null); // Continue even if some assets fail
      };
      img.src = src;
    });
  }

  // Update loading bar progress
  updateProgress() {
    if (this.loadingBar) {
      const percentage = (this.loadedCount / this.totalCount) * 100;
      this.loadingBar.style.width = `${percentage}%`;
    }
  }

  // Preload all assets
  async preloadAll() {
    this.loadingBar = document.getElementById('loadingBar');
    this.loadingScreen = document.getElementById('loadingScreen');
    
    const assetList = this.getAssetList();
    this.totalCount = assetList.length;
    this.loadedCount = 0;
    
    // Start loading all assets
    const loadPromises = assetList.map(src => this.loadAsset(src));
    
    // Wait for all assets to load (or fail gracefully)
    await Promise.all(loadPromises);
    
    // Small delay to ensure smooth transition
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Hide loading screen
    if (this.loadingScreen) {
      this.loadingScreen.classList.add('hidden');
      // Remove from DOM after animation
      setTimeout(() => {
        if (this.loadingScreen) {
          this.loadingScreen.remove();
        }
      }, 500);
    }
    
    // Dispatch custom event to signal that assets are loaded
    window.dispatchEvent(new CustomEvent('assetsLoaded'));
  }
}

// Initialize preloader when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  // Add loading class to body
  document.body.classList.add('loading');
  
  const preloader = new AssetPreloader();
  preloader.preloadAll().then(() => {
    // Remove loading class from body
    document.body.classList.remove('loading');
  });
});

