// Initialize the game when the page loads
window.addEventListener('DOMContentLoaded', async () => {
  const canvas = document.getElementById('gameCanvas');
  const game = new Game(canvas);
  
  // Load saved username and wallet from localStorage and pre-fill form
  try {
    const savedUsername = localStorage.getItem('playerUsername');
    const savedWallet = localStorage.getItem('playerWallet');
    if (savedUsername || savedWallet) {
      const usernameInput = document.getElementById('usernameInput');
      const walletInput = document.getElementById('walletInput');
      if (usernameInput && savedUsername) {
        usernameInput.value = savedUsername;
      }
      if (walletInput && savedWallet) {
        walletInput.value = savedWallet;
      }
    }
  } catch (error) {
    console.warn('Failed to load from localStorage:', error);
  }
  
  // Initialize game first
  await game.init('map1'); // Load map1.json from assets/maps/
  
  // Connect to multiplayer server
  game.connectToServer();
  
  // Load and display token stats
  loadTokenStats();
  loadLeaderboard();
  
  // Show "How It Works" panel
  const howItWorks = document.getElementById('how-it-works');
  if (howItWorks) {
    howItWorks.classList.add('loaded');
  }
  
  // Update leaderboard every 30 seconds
  setInterval(loadLeaderboard, 30000);
  
  // Refresh token stats every 10 seconds
  setInterval(loadTokenStats, 10000);
  
  // Set up copy button handler
  const copyCAButton = document.getElementById('copyCAButton');
  if (copyCAButton) {
    copyCAButton.addEventListener('click', async () => {
      const caEl = document.getElementById('tokenCA');
      if (caEl) {
        const fullAddress = caEl.getAttribute('data-full-address');
        if (fullAddress) {
          try {
            await navigator.clipboard.writeText(fullAddress);
            // Visual feedback
            const originalTitle = copyCAButton.title;
            copyCAButton.title = 'Copied!';
            copyCAButton.style.color = '#4fc3f7';
            setTimeout(() => {
              copyCAButton.title = originalTitle;
              copyCAButton.style.color = '';
            }, 2000);
          } catch (error) {
            console.error('Failed to copy:', error);
            // Fallback for older browsers
            const textArea = document.createElement('textarea');
            textArea.value = fullAddress;
            textArea.style.position = 'fixed';
            textArea.style.opacity = '0';
            document.body.appendChild(textArea);
            textArea.select();
            try {
              document.execCommand('copy');
              copyCAButton.title = 'Copied!';
              setTimeout(() => {
                copyCAButton.title = 'Copy contract address';
              }, 2000);
            } catch (err) {
              console.error('Fallback copy failed:', err);
            }
            document.body.removeChild(textArea);
          }
        }
      }
    });
  }
  
  // Initialize chat immediately (handlers will wait for socket)
  initializeChat(game);
  
  // Set up join button handler
  const joinButton = document.getElementById('joinButton');
  if (joinButton) {
    joinButton.addEventListener('click', () => {
      game.joinGame();
    });
  }
  
  // Set up hide UI button handler
  const hideUIButton = document.getElementById('hideUIButton');
  if (hideUIButton) {
    let uiHidden = false;
    hideUIButton.addEventListener('click', () => {
      uiHidden = !uiHidden;
      if (uiHidden) {
        document.body.classList.add('ui-hidden');
        hideUIButton.title = 'Show UI';
      } else {
        document.body.classList.remove('ui-hidden');
        hideUIButton.title = 'Hide UI';
      }
    });
  }
  
  // Set up profile button handler
  const profileButton = document.getElementById('profileButton');
  if (profileButton) {
    profileButton.addEventListener('click', async () => {
      // Open modal in editing mode
      await game.showPlayerInfoModal(true);
    });
  }
  
  // Set up player info form submission handler
  const playerInfoForm = document.getElementById('playerInfoForm');
  if (playerInfoForm) {
    playerInfoForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const usernameInput = document.getElementById('usernameInput');
      const walletInput = document.getElementById('walletInput');
      const usernameError = document.getElementById('usernameError');
      const walletError = document.getElementById('walletError');
      const submitButton = document.getElementById('submitPlayerInfo');
      
      // Clear previous errors
      if (usernameError) usernameError.textContent = '';
      if (walletError) walletError.textContent = '';
      
      // Get values
      const username = usernameInput?.value?.trim() || '';
      const publicWallet = walletInput?.value?.trim() || '';
      
      // Validate inputs
      let hasErrors = false;
      
      if (!username) {
        if (usernameError) usernameError.textContent = 'Username is required';
        hasErrors = true;
      } else if (username.length > 50) {
        if (usernameError) usernameError.textContent = 'Username must be 50 characters or less';
        hasErrors = true;
      }
      
      if (!publicWallet) {
        if (walletError) walletError.textContent = 'Public wallet address is required';
        hasErrors = true;
      } else if (publicWallet.length > 200) {
        if (walletError) walletError.textContent = 'Wallet address must be 200 characters or less';
        hasErrors = true;
      }
      
      if (hasErrors) {
        return;
      }
      
      // Disable submit button while saving
      if (submitButton) {
        submitButton.disabled = true;
        const buttonText = submitButton.querySelector('.button-text');
        if (buttonText) {
          buttonText.textContent = 'Saving...';
        } else {
          submitButton.textContent = 'Saving...';
        }
      }
      
      let result = null;
      try {
        // Save player info
        result = await game.savePlayerInfo(username, publicWallet);
        
        if (result.success) {
          // Save to localStorage for persistence
          try {
            localStorage.setItem('playerUsername', username);
            localStorage.setItem('playerWallet', publicWallet);
          } catch (error) {
            console.warn('Failed to save to localStorage:', error);
          }
          
          // Success - hide modal
          game.hidePlayerInfoModal();
          
          // Check if we're in editing mode (opened from profile button)
          const modalTitle = document.querySelector('.modal-title');
          const wasEditing = modalTitle && modalTitle.textContent.includes('Edit');
          
          // Don't clear form - keep values for next time
          // Only auto-join if not editing (first time entry)
          if (!wasEditing) {
            // Now proceed with joining the game
            game.joinGame();
          } else {
            // If editing, re-enable button and update button text
            if (submitButton) {
              submitButton.disabled = true; // Disabled because values haven't changed (just saved)
              const buttonText = submitButton.querySelector('.button-text');
              if (buttonText) {
                buttonText.textContent = 'Submit';
              } else {
                submitButton.textContent = 'Submit';
              }
            }
            // Re-open modal to update initial values for change detection
            setTimeout(() => {
              game.showPlayerInfoModal(true);
            }, 100);
          }
        } else {
          // Show error message
          const errorMessage = result.error || 'Failed to save player info';
          
          // Check if it's a username or wallet error
          if (errorMessage.toLowerCase().includes('username')) {
            if (usernameError) usernameError.textContent = errorMessage;
          } else if (errorMessage.toLowerCase().includes('wallet')) {
            if (walletError) walletError.textContent = errorMessage;
          } else {
            // Generic error - show in username field
            if (usernameError) usernameError.textContent = errorMessage;
          }
        }
      } catch (error) {
        console.error('Error in form submission:', error);
        if (usernameError) {
          usernameError.textContent = error.message || 'An error occurred';
        }
      } finally {
        // Reset button text if there was an error (button state handled by input listeners)
        if (submitButton && (!result || !result.success)) {
          const buttonText = submitButton.querySelector('.button-text');
          if (buttonText) {
            buttonText.textContent = 'Submit';
          } else {
            submitButton.textContent = 'Submit';
          }
          // Button disabled state will be updated by input listeners based on whether values changed
          // Trigger a check by dispatching input events
          if (usernameInput) {
            usernameInput.dispatchEvent(new Event('input'));
          }
          if (walletInput) {
            walletInput.dispatchEvent(new Event('input'));
          }
        }
      }
    });
  }
  
  // Close modal when clicking overlay
  const modal = document.getElementById('playerInfoModal');
  const modalOverlay = modal?.querySelector('.modal-overlay');
  if (modalOverlay) {
    modalOverlay.addEventListener('click', () => {
      game.hidePlayerInfoModal();
    });
  }
  
  // Close modal when pressing Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const modal = document.getElementById('playerInfoModal');
      if (modal && modal.style.display !== 'none' && modal.style.display !== '') {
        game.hidePlayerInfoModal();
      }
    }
  });
  
  // Prevent modal from closing when clicking on modal content
  const modalContent = modal?.querySelector('.modal-content');
  if (modalContent) {
    modalContent.addEventListener('click', (e) => {
      e.stopPropagation();
    });
  }
});

// Function to load and display token stats
async function loadTokenStats() {
  try {
    const response = await fetch('/api/token-stats/public');
    const data = await response.json();
    
    if (data.success) {
      const tokenStatsUI = document.getElementById('tokenStatsUI');
      
      // Update ticker
      const tickerEl = document.getElementById('tokenTicker');
      if (tickerEl) {
        tickerEl.textContent = data.ticker || '$PAINT';
      }
      
      // Update bought
      const boughtEl = document.getElementById('tokenBought');
      if (boughtEl) {
        boughtEl.textContent = formatTokenAmount(data.bought || 0);
      }
      
      // Update burned
      const burnedEl = document.getElementById('tokenBurned');
      if (burnedEl) {
        burnedEl.textContent = formatTokenAmount(data.burned || 0);
      }
      
      // Update sent
      const sentEl = document.getElementById('tokenSent');
      if (sentEl) {
        sentEl.textContent = formatTokenAmount(data.sent || 0);
      }
      
      // Update contract address
      const caEl = document.getElementById('tokenCA');
      const copyButton = document.getElementById('copyCAButton');
      if (caEl) {
        const contractAddress = data.contractAddress || '';
        if (contractAddress) {
          // Display shortened version (first 6 and last 4 characters)
          const shortened = contractAddress.length > 10 
            ? `${contractAddress.substring(0, 6)}...${contractAddress.substring(contractAddress.length - 4)}`
            : contractAddress;
          caEl.textContent = shortened;
          caEl.title = contractAddress; // Full address on hover
          // Store full address in data attribute for copying
          caEl.setAttribute('data-full-address', contractAddress);
          // Show copy button
          if (copyButton) {
            copyButton.style.display = 'flex';
          }
        } else {
          caEl.textContent = '-';
          caEl.title = '';
          caEl.removeAttribute('data-full-address');
          // Hide copy button
          if (copyButton) {
            copyButton.style.display = 'none';
          }
        }
      }
      
      // Update social buttons
      const socialsContainer = document.getElementById('tokenSocials');
      if (socialsContainer) {
        socialsContainer.innerHTML = ''; // Clear existing
        
        if (data.xLink) {
          const xButton = document.createElement('a');
          xButton.href = data.xLink;
          xButton.target = '_blank';
          xButton.rel = 'noopener noreferrer';
          xButton.className = 'social-button';
          xButton.title = 'Visit X (Twitter)';
          const xImg = document.createElement('img');
          xImg.src = '/assets/socials/x-logo.jpg';
          xImg.alt = 'X (Twitter)';
          xButton.appendChild(xImg);
          socialsContainer.appendChild(xButton);
        }
        
        if (data.pumpfunLink) {
          const pumpButton = document.createElement('a');
          pumpButton.href = data.pumpfunLink;
          pumpButton.target = '_blank';
          pumpButton.rel = 'noopener noreferrer';
          pumpButton.className = 'social-button';
          pumpButton.title = 'Visit Pump.fun';
          const pumpImg = document.createElement('img');
          pumpImg.src = '/assets/socials/pump-logo.jpg';
          pumpImg.alt = 'Pump.fun';
          pumpButton.appendChild(pumpImg);
          socialsContainer.appendChild(pumpButton);
        }
      }
      
      // Show the token stats UI after data is loaded
      if (tokenStatsUI) {
        tokenStatsUI.classList.add('loaded');
      }
    }
  } catch (error) {
    console.error('Error loading token stats:', error);
  }
}

// Function to format token amounts (add commas for large numbers)
function formatTokenAmount(amount) {
  if (typeof amount !== 'number') {
    amount = parseFloat(amount) || 0;
  }
  
  // For very large numbers, use abbreviated format
  if (amount >= 1000000000) {
    return (amount / 1000000000).toFixed(2) + 'B';
  } else if (amount >= 1000000) {
    return (amount / 1000000).toFixed(2) + 'M';
  } else if (amount >= 1000) {
    return (amount / 1000).toFixed(2) + 'K';
  } else {
    return amount.toLocaleString('en-US', { 
      maximumFractionDigits: 2,
      minimumFractionDigits: 0
    });
  }
}

// Function to load and display leaderboard
async function loadLeaderboard() {
  try {
    const response = await fetch('/api/player/leaderboard?limit=3');
    const data = await response.json();
    
    if (data.success) {
      const leaderboardUI = document.getElementById('leaderboardUI');
      const leaderboardContent = document.getElementById('leaderboardContent');
      
      if (!leaderboardContent) return;
      
      // Clear loading message
      leaderboardContent.innerHTML = '';
      
      if (data.players && data.players.length > 0) {
        // Display top players
        data.players.forEach((player, index) => {
          const rank = index + 1;
          const playerDiv = document.createElement('div');
          playerDiv.className = 'leaderboard-item';
          
          playerDiv.innerHTML = `
            <span class="leaderboard-rank rank-${rank}">${rank}</span>
            <div class="leaderboard-player-info">
              <span class="leaderboard-username" title="${escapeHtml(player.username)}">${escapeHtml(player.username)}</span>
              <div class="leaderboard-stats">
                <span>${player.totalGamesWon || 0}W</span>
                <span>${player.totalGamesPlayed || 0}G</span>
              </div>
            </div>
            <span class="leaderboard-tokens">${formatTokenAmount(player.totalTokensWon || 0)}</span>
          `;
          
          leaderboardContent.appendChild(playerDiv);
        });
      } else {
        // No players yet
        leaderboardContent.innerHTML = '<div class="leaderboard-loading">No players yet</div>';
      }
      
      // Show the leaderboard UI after data is loaded
      if (leaderboardUI) {
        leaderboardUI.classList.add('loaded');
      }
    }
  } catch (error) {
    console.error('Error loading leaderboard:', error);
  }
}

// Initialize chat functionality
function initializeChat(game) {
  const chatToggle = document.getElementById('chatToggle');
  const chatMessages = document.getElementById('chatMessages');
  const chatInput = document.getElementById('chatInput');
  const chatSend = document.getElementById('chatSend');
  const chatInputContainer = document.querySelector('.chat-input-container');
  let isCollapsed = false;
  
  // Toggle chat collapse
  if (chatToggle) {
    chatToggle.addEventListener('click', () => {
      isCollapsed = !isCollapsed;
      chatToggle.classList.toggle('collapsed', isCollapsed);
      chatMessages.classList.toggle('collapsed', isCollapsed);
      chatInputContainer.classList.toggle('collapsed', isCollapsed);
    });
  }
  
  // Send message function
  function sendMessage() {
    if (!game.socket || !game.isConnected) {
      return;
    }
    
    const message = chatInput?.value?.trim();
    if (!message || message.length === 0) {
      return;
    }
    
    if (message.length > 200) {
      alert('Message too long (max 200 characters)');
      return;
    }
    
    // Get username from player stats if available
    let username = null;
    try {
      // Try to get username from stored player info
      const usernameInput = document.getElementById('usernameInput');
      // We'll get it from the server instead
    } catch (error) {
      console.error('Error getting username:', error);
    }
    
    // Send message to server
    game.socket.emit('chatMessage', {
      message: message,
      username: username
    });
    
    // Clear input
    if (chatInput) {
      chatInput.value = '';
    }
  }
  
  // Send button click
  if (chatSend) {
    chatSend.addEventListener('click', sendMessage);
  }
  
  // Enter key to send
  if (chatInput) {
    chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        sendMessage();
      }
    });
  }
  
  // Track message IDs to prevent duplicates
  const messageIds = new Set();
  
  // Add message to chat
  function addMessageToChat(messageData) {
    if (!chatMessages) return;
    
    // Check if we've already added this message (prevent duplicates)
    if (messageData.id) {
      if (messageIds.has(messageData.id)) {
        return; // Already added, skip
      }
      messageIds.add(messageData.id);
    }
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${messageData.isSystem ? 'system' : ''}`;
    messageDiv.setAttribute('data-message-id', messageData.id || Date.now().toString());
    
    const time = new Date(messageData.timestamp);
    const timeString = time.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
    
    // For system messages, allow HTML (for links), but escape user messages
    const messageText = messageData.isSystem ? messageData.message : escapeHtml(messageData.message);
    
    messageDiv.innerHTML = `
      <div class="chat-message-header">
        <span class="chat-message-username">${escapeHtml(messageData.username)}</span>
        <span class="chat-message-time">${timeString}</span>
      </div>
      <div class="chat-message-text">${messageText}</div>
    `;
    
    chatMessages.appendChild(messageDiv);
    
    // Auto-scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    // Keep only last 100 messages in DOM (performance)
    // Also clean up old message IDs
    const messages = chatMessages.querySelectorAll('.chat-message');
    if (messages.length > 100) {
      const removedMessage = messages[0];
      const removedId = removedMessage.getAttribute('data-message-id');
      if (removedId) {
        messageIds.delete(removedId);
      }
      removedMessage.remove();
    }
  }
  
  // Handle chat history - exposed globally so game.js can call it
  window.handleChatHistory = (messages) => {
    if (!chatMessages) return;
    
    // Clear existing messages and tracked IDs
    chatMessages.innerHTML = '';
    messageIds.clear();
    
    // Add all messages from history
    if (Array.isArray(messages) && messages.length > 0) {
      messages.forEach(message => {
        addMessageToChat(message);
      });
    }
  };
  
  // Set up chat handlers when socket is available (only once)
  let handlersSetup = false;
  let tokenDistributionListenerSetup = false;
  
  function setupChatHandlers() {
    if (!game.socket) {
      // Wait for socket to be available
      setTimeout(setupChatHandlers, 100);
      return;
    }
    
    // Only set up handlers once to prevent duplicates
    if (handlersSetup) {
      return;
    }
    handlersSetup = true;
    
    // Handle chat history (when connecting) - set up immediately to catch history
    game.socket.on('chatHistory', (messages) => {
      console.log('Received chat history:', messages?.length || 0, 'messages');
      window.handleChatHistory(messages);
    });
    
    // Handle new chat messages
    game.socket.on('chatMessage', (messageData) => {
      addMessageToChat(messageData);
    });
    
    // Handle chat errors
    game.socket.on('chatError', (data) => {
      if (data && data.error) {
        alert(data.error);
      }
    });
  }
  
  // Set up token distribution listener (only once)
  function setupTokenDistributionListener() {
    if (!game.socket) {
      setTimeout(setupTokenDistributionListener, 100);
      return;
    }
    
    if (tokenDistributionListenerSetup) {
      return;
    }
    tokenDistributionListenerSetup = true;
    
    // Update leaderboard when tokens are distributed
    game.socket.on('tokenDistributionComplete', () => {
      loadLeaderboard();
    });
  }
  
  // Set up handlers immediately
  setupChatHandlers();
  setupTokenDistributionListener();
  
  // Also set up handler when socket connects (in case socket is created after initialization)
  if (game.socket) {
    game.socket.on('connect', () => {
      // Handlers should already be set up, but ensure they are
      if (!handlersSetup) {
        setupChatHandlers();
      }
      if (!tokenDistributionListenerSetup) {
        setupTokenDistributionListener();
      }
    });
  }
}

// Helper function to escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

