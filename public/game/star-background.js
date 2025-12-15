// Star background with diagonal pattern animation
class StarBackground {
  constructor(canvasWidth, canvasHeight) {
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;
    this.starImage = new Image();
    this.starImage.src = 'assets/star.png';
    this.stars = [];
    this.starSize = 80; // Base size for stars (2x bigger)
    this.spacing = 130; // Spacing between stars in diagonal lines (must be > starSize to prevent overlap, increased for safety)
    this.diagonalSpacing = 200; // Spacing between diagonal lines (must account for star size, increased for safety)
    this.speed = 40; // Pixels per second
    this.direction = { x: 0, y: -1 }; // Upward direction
    
    // Initialize stars when image loads
    this.starImage.onload = () => {
      this.initializeStars();
    };
    
    // Initialize even if image is already loaded
    if (this.starImage.complete) {
      this.initializeStars();
    }
  }

  initializeStars() {
    this.stars = [];
    
    // Create fixed diagonal lines - stars will drift upward along these lines
    // Diagonal lines go diagonally (45 degrees from top-left to bottom-right)
    const diagonalAngle = Math.PI / 4; // 45 degrees
    
    // Calculate coverage area - extend beyond screen bounds for seamless looping
    const padding = this.starSize * 3; // Extra padding for seamless loop
    const minX = -padding;
    const maxX = this.canvasWidth + padding;
    const minY = -padding;
    const maxY = this.canvasHeight + padding;
    
    // Perpendicular vector to diagonal (45 degrees) is at -45 degrees
    const perpX = -Math.cos(diagonalAngle);
    const perpY = Math.sin(diagonalAngle);
    
    // Calculate the range of line offsets needed to cover the entire screen
    // We need to ensure all corners are covered, especially top-right
    // For a diagonal line at 45 degrees, we need to cover the full diagonal extent
    const diagonalLength = Math.sqrt(this.canvasWidth ** 2 + this.canvasHeight ** 2);
    
    // Calculate the minimum and maximum line offsets needed to cover the screen
    // Start from a point that ensures top-left corner is covered
    // and extend enough to cover top-right corner
    const startOffset = -diagonalLength / 2 - padding;
    const endOffset = diagonalLength / 2 + padding;
    const numLines = Math.ceil((endOffset - startOffset) / this.diagonalSpacing) + 6;
    const firstLineIndex = Math.floor(startOffset / this.diagonalSpacing) - 2;
    
    // Create stars along diagonal lines
    for (let lineIndex = firstLineIndex; lineIndex < firstLineIndex + numLines; lineIndex++) {
      // Calculate the base position for this diagonal line
      const lineOffset = lineIndex * this.diagonalSpacing;
      
      // Calculate how many stars fit along this diagonal line
      // Stars need to cover the full diagonal length plus padding for seamless loop
      const starsInLine = Math.ceil((diagonalLength + padding * 2) / this.spacing) + 6;
      
      // Start from negative position to ensure top coverage
      const startStarIndex = -Math.ceil((diagonalLength / 2 + padding) / this.spacing) - 2;
      
      for (let starIndex = startStarIndex; starIndex < startStarIndex + starsInLine; starIndex++) {
        // Position along the diagonal line
        const alongLine = starIndex * this.spacing;
        
        // Calculate position along diagonal line
        // Diagonal goes from top-left to bottom-right at 45 degrees
        const baseX = alongLine * Math.cos(diagonalAngle);
        const baseY = alongLine * Math.sin(diagonalAngle);
        
        // Offset perpendicular to create multiple parallel diagonal lines
        // Center the pattern
        const x = baseX + lineOffset * perpX + this.canvasWidth / 2;
        const y = baseY + lineOffset * perpY + this.canvasHeight / 2;
        
        // Only add stars that are within or near the visible area
        if (x >= minX - this.starSize && x <= maxX + this.starSize && 
            y >= minY - this.starSize && y <= maxY + this.starSize) {
          
          // No offsets - stars are placed exactly on grid positions to prevent overlaps
          // Store the diagonal line offset for maintaining pattern during loop
          this.stars.push({
            x: x,
            y: y,
            size: this.starSize, // Constant size for all stars
            opacity: 1.0, // Full opacity for all stars
            lineOffset: lineOffset, // Store which diagonal line this star belongs to
            alongLine: alongLine, // Store position along the diagonal line
            offsetX: 0, // No offset to ensure proper spacing
            offsetY: 0, // No offset to ensure proper spacing
            originalStarIndex: starIndex, // Store original grid position for precise recalculation
            originalLineIndex: lineIndex // Store original line index for precise recalculation
          });
        }
      }
    }
  }

  update(deltaTime) {
    // Move stars upward along their diagonal lines
    const moveX = this.speed * this.direction.x * deltaTime;
    const moveY = this.speed * this.direction.y * deltaTime;
    
    const padding = this.starSize * 3;
    const diagonalAngle = Math.PI / 4; // 45 degrees
    const sinAngle = Math.sin(diagonalAngle);
    const diagonalLength = Math.sqrt(this.canvasWidth ** 2 + this.canvasHeight ** 2);
    
    this.stars.forEach(star => {
      // Update position along diagonal line based on vertical movement
      star.alongLine += moveY / sinAngle;
      
      // Calculate current Y position to check if star needs to reset
      const baseY = star.alongLine * Math.sin(diagonalAngle);
      const currentY = baseY + star.lineOffset * Math.sin(diagonalAngle) + this.canvasHeight / 2;
      
      // When star moves off the top, reset it to the bottom maintaining grid alignment
      if (currentY < -padding) {
        // Calculate how many spacing units the star has moved from its original position
        const spacingUnitsMoved = (star.alongLine - star.originalStarIndex * this.spacing) / this.spacing;
        
        // Calculate how many spacing units to add to move star from top to bottom
        // Use a larger reset distance to ensure star is completely past all visible stars
        const resetDistance = this.canvasHeight + padding * 2;
        const resetSpacingUnits = Math.ceil(resetDistance / sinAngle / this.spacing) + 1; // Add extra spacing unit to prevent overlaps
        
        // Reset to a grid-aligned position by rounding the total spacing units moved
        const totalSpacingUnits = Math.round(spacingUnitsMoved) + resetSpacingUnits;
        star.alongLine = (star.originalStarIndex + totalSpacingUnits) * this.spacing;
      }
      
      // Recalculate x and y positions based on diagonal line to maintain the pattern
      // This ensures stars stay on their diagonal lines
      const perpX = -Math.cos(diagonalAngle);
      const perpY = Math.sin(diagonalAngle);
      const baseX = star.alongLine * Math.cos(diagonalAngle);
      const finalBaseY = star.alongLine * Math.sin(diagonalAngle);
      star.x = baseX + star.lineOffset * perpX + this.canvasWidth / 2 + star.offsetX;
      star.y = finalBaseY + star.lineOffset * perpY + this.canvasHeight / 2 + star.offsetY;
    });
  }

  resize(newWidth, newHeight) {
    this.canvasWidth = newWidth;
    this.canvasHeight = newHeight;
    // Reinitialize stars for new dimensions
    if (this.starImage.complete) {
      this.initializeStars();
    }
  }

  draw(ctx) {
    if (!this.starImage.complete || this.stars.length === 0) {
      return;
    }
    
    ctx.save();
    
    this.stars.forEach(star => {
      ctx.globalAlpha = star.opacity;
      ctx.drawImage(
        this.starImage,
        star.x - star.size / 2,
        star.y - star.size / 2,
        star.size,
        star.size
      );
    });
    
    ctx.restore();
  }
}
