// Input handler class - manages keyboard input
class InputHandler {
  constructor() {
    this.keys = {};
    
    // Input queue for multiplayer synchronization
    // Stores input events with timestamps for network transmission
    this.inputQueue = [];
    this.maxQueueSize = 1000; // Prevent memory issues
    
    // Current game time (updated by game loop)
    this.currentGameTime = 0;
    
    // Listen for keydown events
    window.addEventListener('keydown', (e) => {
      const key = e.key.toLowerCase();
      if (!this.keys[key]) {
        // Only record if key wasn't already pressed (avoid duplicate events)
        this.keys[key] = true;
        this.recordInput(key, true);
      }
    });
    
    // Listen for keyup events
    window.addEventListener('keyup', (e) => {
      const key = e.key.toLowerCase();
      if (this.keys[key]) {
        // Only record if key was pressed (avoid duplicate events)
        this.keys[key] = false;
        this.recordInput(key, false);
      }
    });
    
    // Prevent default behavior for game keys (only when not typing in input fields)
    window.addEventListener('keydown', (e) => {
      // Check if user is typing in an input field
      const activeElement = document.activeElement;
      const isTyping = activeElement && (
        activeElement.tagName === 'INPUT' ||
        activeElement.tagName === 'TEXTAREA' ||
        activeElement.isContentEditable
      );
      
      // Only prevent default if not typing in an input field
      if (!isTyping && ['w', 'a', 's', 'd', 'W', 'A', 'S', 'D'].includes(e.key)) {
        e.preventDefault();
      }
    });
  }

  // Record input event with timestamp for network synchronization
  recordInput(key, pressed) {
    const inputEvent = {
      key: key,
      pressed: pressed,
      timestamp: this.currentGameTime
    };
    
    this.inputQueue.push(inputEvent);
    
    // Limit queue size to prevent memory issues
    if (this.inputQueue.length > this.maxQueueSize) {
      this.inputQueue.shift(); // Remove oldest
    }
  }

  // Update current game time (called by game loop)
  updateGameTime(gameTime) {
    this.currentGameTime = gameTime;
  }

  // Get inputs since a specific timestamp (for network sync)
  getInputsSince(timestamp) {
    return this.inputQueue.filter(input => input.timestamp >= timestamp);
  }

  // Clear inputs older than timestamp (cleanup)
  clearInputsOlderThan(timestamp) {
    this.inputQueue = this.inputQueue.filter(input => input.timestamp >= timestamp);
  }

  // Get all queued inputs (for network transmission)
  getAllQueuedInputs() {
    return [...this.inputQueue];
  }

  // Clear input queue (after successful network transmission)
  clearInputQueue() {
    this.inputQueue = [];
  }

  isKeyPressed(key) {
    return this.keys[key] || false;
  }

  getKeys() {
    return this.keys;
  }
}

