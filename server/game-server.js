// Game server - runs authoritative game logic for multiplayer
const GameServer = require('./game-logic');
const { claimAndTransferFees, calculatePotAndBuyTokens } = require('./utils/pumpportal');
const { distributeTokensToWinners } = require('./utils/tokenOperations');
const AdminConfig = require('../models/adminConfig');
const PlayerStats = require('../models/playerStats');
const TokenStats = require('../models/tokenStats');
const Round = require('../models/rounds');
const { decrypt } = require('./utils/encryption');

class GameServerManager {
  constructor(io, mapName = 'map1', sendSystemMessageFn = null) {
    this.io = io;
    this.mapName = mapName;
    this.gameServer = new GameServer(mapName);
    this.sendSystemMessageFn = sendSystemMessageFn; // Function to send system announcements
    this.players = new Map(); // playerId -> { socketId, team, character }
    this.spectators = new Map(); // socketId -> { playerId } (for spectators who haven't joined)
    
    // Game state management
    this.gameState = 'QUEUE'; // 'QUEUE', 'PLAYING', 'ENDED'
    this.queueCountdown = 60; // 60 seconds (1 minute)
    this.gameCountdown = 120; // 120 seconds (2 minutes)
    this.queueTimer = null;
    this.gameTimer = null;
    this.lastQueueUpdate = Date.now();
    this.lastGameUpdate = Date.now();
    
    // Simulation runs at 60 ticks per second (fixed timestep) - matches client
    // This ensures physics stay in sync between client and server
    this.TICK_RATE = 60;
    this.TICK_DT = 1 / this.TICK_RATE; // ~0.0167 seconds
    this.tickInterval = 1000 / this.TICK_RATE; // ~16.67ms
    
    // Snapshots sent at 12 Hz (every ~2.5 simulation ticks)
    this.SNAPSHOT_RATE = 12;
    this.snapshotInterval = 1000 / this.SNAPSHOT_RATE; // ~83.33ms
    this.snapshotCounter = 0;
    this.lastSnapshotTime = Date.now();
    
    this.lastTick = Date.now();
    
    // Crypto token tracking for current round
    this.currentTokenAmount = null;
    this.currentTokenAccount = null;
    this.currentTokenMint = null;
    this.currentFormattedTokenAmount = null; // Formatted amount for announcements
    this.roundNumber = 0;
    this.currentRoundStartTime = null;
    
    // Flag to prevent multiple pause checks
    this.pauseCheckInProgress = false;
    
    // Track if token distribution is in progress to prevent overwrite
    this.tokenDistributionInProgress = false;
    this.distributionRoundNumber = null; // Track which round is being distributed
    this.pendingTokenDistribution = null; // Store token info for pending distribution
    
    // Track if crypto operations have been started for current queue phase
    this.cryptoOperationsStarted = false;
    
    // Start queue countdown
    this.startQueueCountdown();
    
    this.startGameLoop();
  }

  startGameLoop() {
    // Use fixed timestep with accumulator (matches client approach exactly)
    let lastTime = Date.now();
    
    const gameLoop = () => {
      const now = Date.now();
      let deltaTime = (now - lastTime) / 1000; // Convert to seconds
      lastTime = now;
      
      // Cap deltaTime to prevent huge jumps (spiral of death protection)
      deltaTime = Math.min(deltaTime, 0.1);
      
      // Only update game logic if game is playing
      if (this.gameState === 'PLAYING') {
        // Use GameServer's update() method which handles fixed timestep with accumulator
        // This ensures server uses fixed timestep only, matching client
        this.gameServer.update(deltaTime);
      }
      
      // Update timers
      this.updateTimers();

      // Send snapshots at lower rate (12 Hz)
      this.snapshotCounter++;
      const ticksPerSnapshot = Math.floor(this.TICK_RATE / this.SNAPSHOT_RATE); // ~5 ticks
      if (this.snapshotCounter >= ticksPerSnapshot) {
        this.snapshotCounter = 0;
        this.broadcastSnapshot();
      }

      // Use setTimeout with precise interval for fixed tick rate
      setTimeout(gameLoop, this.tickInterval);
    };

    gameLoop();
  }
  
  updateTimers() {
    const now = Date.now();
    
    if (this.gameState === 'QUEUE') {
      const delta = (now - this.lastQueueUpdate) / 1000; // Convert to seconds
      this.lastQueueUpdate = now;
      this.queueCountdown -= delta;
      
      if (this.queueCountdown <= 0) {
        // Queue countdown ended - check if game is paused (async check)
        this.checkGamePaused().then(isPaused => {
          if (isPaused) {
            // Game is paused, restart queue countdown without starting game
            console.log('[GameServer] ⏸️  Game is paused, restarting queue countdown');
            this.queueCountdown = 60;
            this.broadcastGameState();
          } else if (this.players.size >= 2) {
            // Start game
            this.startGame();
          } else {
            // Not enough players, restart queue
            this.queueCountdown = 60;
            this.broadcastGameState();
          }
        }).catch(error => {
          console.error('[GameServer] Error checking game paused status:', error);
          // On error, default to normal behavior
          if (this.players.size >= 2) {
            this.startGame();
          } else {
            this.queueCountdown = 60;
            this.broadcastGameState();
          }
        });
        // Reset countdown to prevent multiple checks while async operation is pending
        this.queueCountdown = 0.1;
      } else {
        // Broadcast queue state every second
        if (Math.floor(this.queueCountdown) !== Math.floor(this.queueCountdown + delta)) {
          this.broadcastGameState();
        }
      }
    } else if (this.gameState === 'PLAYING') {
      const delta = (now - this.lastGameUpdate) / 1000; // Convert to seconds
      this.lastGameUpdate = now;
      this.gameCountdown -= delta;
      
      if (this.gameCountdown <= 0) {
        // Game ended
        this.endGame();
      } else {
        // Broadcast game state every second
        if (Math.floor(this.gameCountdown) !== Math.floor(this.gameCountdown + delta)) {
          this.broadcastGameState();
        }
      }
    }
  }
  
  startQueueCountdown() {
    this.gameState = 'QUEUE';
    this.queueCountdown = 60;
    this.lastQueueUpdate = Date.now();
    
    // Reset flag for crypto operations - new queue phase means we can start new crypto ops
    this.cryptoOperationsStarted = false;
    
    // Completely reset everything when returning to queue
    // Reset all blocks to white
    this.gameServer.resetAllBlocks();
    
    // Reset game time
    this.gameServer.gameTime = 0;
    
    // Clear and reinitialize bombs
    this.gameServer.bombs = [];
    this.gameServer.thrownBombs = [];
    this.gameServer.initializeBombs();
    
    // Clear all players from game server
    this.gameServer.players.clear();
    
    // Start crypto operations: Claim fees and buy tokens (once per queue phase)
    // Each queue/game cycle is independent, so we can start new operations even if
    // previous round's distribution is still in progress
    // But only if game is not paused
    this.checkGamePaused().then(isPaused => {
      if (isPaused) {
        console.log('[GameServer] ⏸️  Game is paused, skipping crypto operations');
        return;
      }
      
      if (!this.cryptoOperationsStarted) {
        if (this.tokenDistributionInProgress) {
          console.log(`[GameServer] ℹ️  Previous round distribution still in progress, but starting new cycle crypto operations (each cycle is independent)`);
        }
        
        this.cryptoOperationsStarted = true;
        this.handleCryptoOperations().catch(error => {
          console.error('[GameServer] Error in crypto operations:', error);
          // Reset flag on error so we can retry
          this.cryptoOperationsStarted = false;
        });
      }
    }).catch(error => {
      console.error('[GameServer] Error checking game paused status:', error);
    });
    
    // Broadcast state and snapshot
    this.broadcastGameState();
    this.broadcastSnapshot();
  }
  
  async startGame() {
    console.log('Starting game with', this.players.size, 'players');
    
    // Check if previous round's token distribution is still in progress
    if (this.tokenDistributionInProgress) {
      console.warn('[GameServer] ⚠️  Previous round token distribution still in progress, waiting...');
      // Wait a bit and check again, or handle this case as needed
      // For now, we'll proceed but log a warning
    }
    
    this.gameState = 'PLAYING';
    this.gameCountdown = 120;
    this.lastGameUpdate = Date.now();
    this.roundNumber++;
    this.currentRoundStartTime = Date.now();
    
    // Save round to database
    this.saveRoundToDatabase('PLAYING').catch(error => {
      console.error('[GameServer] Error saving round to database:', error);
    });
    
    // Reset all blocks to white
    this.gameServer.resetAllBlocks();
    
    // Reset game time
    this.gameServer.gameTime = 0;
    
    // Reinitialize bombs for the new game
    this.gameServer.initializeBombs();
    
    // Assign teams evenly (alternate red/blue) and spawn all players
    let teamIndex = 0;
    const teams = ['red', 'blue'];
    this.players.forEach((playerInfo, playerId) => {
      // Assign team (alternate to keep teams even)
      const team = teams[teamIndex % 2];
      teamIndex++;
      
      // Update player info with assigned team
      playerInfo.team = team;
      
      // Add player to game server and spawn them
      const character = this.gameServer.addPlayer(playerId, team);
      playerInfo.character = character;
      
      // Notify player of their team assignment
      const socket = this.io.sockets.sockets.get(playerInfo.socketId);
      if (socket) {
        socket.emit('teamAssigned', {
          playerId: playerId,
          team: team
        });
      }
    });
    
    // Note: Crypto operations (claim/buy/burn) are now handled in startQueueCountdown()
    // The tokens should already be purchased and ready for this game
    
    // Broadcast game state and send snapshot with reset blocks
    this.broadcastGameState();
    this.broadcastSnapshot(); // Send snapshot immediately to show reset blocks
  }
  
  async handleCryptoOperations() {
    try {
      // Get admin config
      const adminConfig = await AdminConfig.findOne();
      if (!adminConfig) {
        console.warn('[GameServer] ⚠️  Admin config not found, skipping crypto operations');
        return;
      }
      
      // Check if game is paused
      if (adminConfig.gamePaused) {
        console.log('[GameServer] ⏸️  Game is paused, skipping crypto operations');
        return;
      }
      
      // Check if token contract is configured
      if (!adminConfig.tokenContractAddress || adminConfig.tokenContractAddress.trim() === '') {
        console.warn('[GameServer] ⚠️  Token contract address not configured, skipping crypto operations');
        return;
      }
      
      // Check if wallets are configured
      if (!adminConfig.devWalletPublic || !adminConfig.potWalletPublic) {
        console.warn('[GameServer] ⚠️  Wallet addresses not configured, skipping crypto operations');
        return;
      }
      
      console.log('[GameServer] 🚀 Starting crypto operations for new queue phase');
      
      // Step 1: Claim fees and transfer to pot
      console.log('[GameServer] Step 1: Claiming fees and transferring to pot...');
      const claimResult = await claimAndTransferFees();
      if (!claimResult.success) {
        console.error('[GameServer] ❌ Failed to claim fees:', claimResult.error);
        return;
      }
      console.log('[GameServer] ✅ Fees claimed and transferred successfully');
      
      // Step 2: Calculate pot (15% of pot wallet) and buy tokens
      console.log('[GameServer] Step 2: Calculating pot and buying tokens...');
      const potResult = await calculatePotAndBuyTokens({
        onBuyComplete: (buyData) => {
          console.log(`[GameServer] 💰 Bought ${buyData.formattedAmount} tokens`);
          // Send system announcement - use next round number (crypto ops happen before game starts)
          const nextRoundNumber = this.roundNumber + 1;
          const buyMessage = `bought ${buyData.formattedAmount.toLocaleString()} $PAINT tokens for round ${nextRoundNumber} <a href="https://solscan.io/tx/${buyData.buySignature}" target="_blank" rel="noopener noreferrer">(view on Solscan)</a>`;
          this.sendSystemAnnouncement(buyMessage);
          // Optional: Send real-time update to clients
          this.io.emit('tokenBuyComplete', {
            amount: buyData.formattedAmount,
            signature: buyData.buySignature
          });
        },
        onBurnComplete: (burnData) => {
          console.log(`[GameServer] 🔥 Burned ${burnData.formattedBurnedAmount} tokens`);
          // Send system announcement - use next round number (crypto ops happen before game starts)
          const nextRoundNumber = this.roundNumber + 1;
          const burnMessage = `burned ${burnData.formattedBurnedAmount.toLocaleString()} $PAINT tokens for round ${nextRoundNumber} <a href="https://solscan.io/tx/${burnData.burnSignature}" target="_blank" rel="noopener noreferrer">(view on Solscan)</a>`;
          this.sendSystemAnnouncement(burnMessage);
          // Optional: Send real-time update to clients
          this.io.emit('tokenBurnComplete', {
            amount: burnData.formattedBurnedAmount,
            signature: burnData.burnSignature
          });
        }
      });
      
      if (!potResult.success) {
        console.error('[GameServer] ❌ Failed to calculate pot and buy tokens:', potResult.error);
        return;
      }
      
      // Store token info for distribution
      this.currentTokenAmount = potResult.tokenAmount;
      this.currentTokenAccount = potResult.tokenAccount;
      this.currentTokenMint = adminConfig.tokenContractAddress;
      this.currentFormattedTokenAmount = potResult.formattedTokenAmount; // Store formatted amount for announcements
      
      console.log('[GameServer] ✅ Crypto operations complete!');
      console.log(`[GameServer]    Token amount: ${potResult.formattedTokenAmount?.toLocaleString() || 'N/A'}`);
      console.log(`[GameServer]    Token account: ${this.currentTokenAccount || 'N/A'}`);
      
      // Emit pot amount update to clients if in queue state
      if (this.gameState === 'QUEUE') {
        this.io.emit('potAmountUpdate', {
          potAmount: this.currentFormattedTokenAmount
        });
        // Also update queue state with pot amount
        this.broadcastGameState();
      }
    } catch (error) {
      console.error('[GameServer] ❌ Exception in crypto operations:', error);
    }
  }
  
  endGame() {
    console.log('Game ended');
    this.gameState = 'ENDED';
    
    // Count blocks by team
    const scores = this.gameServer.countBlocksByTeam();
    const redBlocks = scores.red || 0;
    const blueBlocks = scores.blue || 0;
    
    // Determine winner
    let winner = null;
    if (redBlocks > blueBlocks) {
      winner = 'red';
    } else if (blueBlocks > redBlocks) {
      winner = 'blue';
    } else {
      winner = 'tie';
    }
    
    // CRITICAL: Create snapshot of players BEFORE clearing them
    // This ensures token distribution has access to player data
    const playersSnapshot = new Map(this.players);
    const roundNumber = this.roundNumber;
    const roundStartTime = this.currentRoundStartTime;
    
    // Store token info for this round before it gets cleared/overwritten
    const tokenInfo = {
      amount: this.currentTokenAmount,
      account: this.currentTokenAccount,
      mint: this.currentTokenMint
    };
    
    // Immediately remove all players and bombs when game ends
    this.gameServer.players.clear();
    this.gameServer.bombs = [];
    this.gameServer.thrownBombs = [];
    
    // Broadcast game end with results
    this.io.emit('gameEnded', {
      redBlocks: redBlocks,
      blueBlocks: blueBlocks,
      winner: winner
    });
    
    // Broadcast empty snapshot to remove all players and bombs from clients
    this.broadcastSnapshot();
    
    // Save round to database with results
    this.saveRoundToDatabase('ENDED', {
      redBlocks,
      blueBlocks,
      winner,
      players: Array.from(playersSnapshot.entries()).map(([playerId, info]) => ({
        playerId,
        socketId: info.socketId,
        team: info.team,
        joinedAt: info.joinedAt
      }))
    }).catch(error => {
      console.error('[GameServer] Error saving round to database:', error);
    });
    
    // Distribute tokens to winners (async, don't block game end)
    // Pass the snapshot and token info to avoid race conditions
    this.handleTokenDistribution(winner, playersSnapshot, tokenInfo, roundNumber).catch(error => {
      console.error('[GameServer] Error distributing tokens:', error);
    });
    
    // Remove all players from queue (they need to manually rejoin)
    this.players.forEach((playerInfo, playerId) => {
      // Remove player from game server
      if (this.gameServer.players.has(playerId)) {
        this.gameServer.removePlayer(playerId);
      }
      
      // Notify player they've been removed from queue
      const socket = this.io.sockets.sockets.get(playerInfo.socketId);
      if (socket) {
        socket.emit('removedFromQueue', {
          playerId: playerId,
          message: 'Game ended. Please join the queue again to play the next game.'
        });
      }
    });
    
    // Clear all players from queue
    this.players.clear();
    
    // Wait 5 seconds before returning to queue
    setTimeout(() => {
      this.startQueueCountdown();
    }, 5000);
  }
  
  async handleTokenDistribution(winnerTeam, playersSnapshot, tokenInfo, roundNumber) {
    try {
      // Set flag to prevent new game from overwriting token info
      this.tokenDistributionInProgress = true;
      this.distributionRoundNumber = roundNumber;
      
      // Update games played for all players (even if tie or no tokens)
      // This ensures all players get credit for playing the game
      for (const [playerId, playerInfo] of playersSnapshot.entries()) {
        try {
          const playerStats = await PlayerStats.findOne({ clientId: playerId });
          if (playerStats) {
            await playerStats.addGamePlayed();
          }
        } catch (error) {
          console.warn(`[GameServer] ⚠️  Could not update games played for player ${playerId}:`, error.message);
        }
      }
      
      // Skip if no winner or tie
      if (!winnerTeam || winnerTeam === 'tie' || !tokenInfo.amount || !tokenInfo.account) {
        console.log('[GameServer] ⚠️  Skipping token distribution:', {
          winner: winnerTeam,
          hasTokens: !!tokenInfo.amount,
          hasAccount: !!tokenInfo.account,
          roundNumber: roundNumber
        });
        this.tokenDistributionInProgress = false;
        this.distributionRoundNumber = null;
        return;
      }
      
      // Get admin config
      const adminConfig = await AdminConfig.findOne();
      if (!adminConfig || !adminConfig.potWalletPrivate) {
        console.warn('[GameServer] ⚠️  Pot wallet private key not configured, skipping distribution');
        this.tokenDistributionInProgress = false;
        this.distributionRoundNumber = null;
        return;
      }
      
      // Get RPC endpoint
      const rpcEndpoint = process.env.SOLANA_RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com';
      
      // Decrypt pot wallet private key
      const potWalletPrivateKey = decrypt(adminConfig.potWalletPrivate);
      if (!potWalletPrivateKey) {
        console.error('[GameServer] ❌ Failed to decrypt pot wallet private key');
        this.tokenDistributionInProgress = false;
        this.distributionRoundNumber = null;
        return;
      }
      
      // Get winners from the winning team using the provided snapshot
      const winners = [];
      
      for (const [playerId, playerInfo] of playersSnapshot.entries()) {
        if (playerInfo.team === winnerTeam) {
          // Try to get player wallet from PlayerStats
          try {
            const playerStats = await PlayerStats.findOne({ clientId: playerId });
            if (playerStats && playerStats.publicWallet && playerStats.publicWallet.trim() !== '') {
              winners.push({
                playerId: playerId,
                publicWallet: playerStats.publicWallet
              });
            }
          } catch (error) {
            console.warn(`[GameServer] ⚠️  Could not get wallet for player ${playerId}:`, error.message);
          }
        }
      }
      
      if (winners.length === 0) {
        console.log(`[GameServer] ⚠️  No winners with wallet addresses found for round ${roundNumber}`);
        this.tokenDistributionInProgress = false;
        this.distributionRoundNumber = null;
        return;
      }
      
      console.log(`[GameServer] 🎁 Distributing tokens to ${winners.length} winners from team ${winnerTeam} (Round ${roundNumber})`);
      
      // Distribute tokens using the token info from this specific round
      const distributeResult = await distributeTokensToWinners(
        potWalletPrivateKey,
        tokenInfo.mint,
        tokenInfo.account,
        winners,
        tokenInfo.amount,
        rpcEndpoint
      );
      
      if (distributeResult.success) {
        console.log(`[GameServer] ✅ Distributed ${distributeResult.formattedDistributedAmount?.toLocaleString() || 'N/A'} tokens to ${winners.length} winners (Round ${roundNumber})`);
        
        // Update TokenStats with total sent tokens
        try {
          const tokenStats = await TokenStats.getStats();
          await tokenStats.addSentTokens(distributeResult.formattedDistributedAmount);
          console.log(`[GameServer] 📊 Updated token stats: +${distributeResult.formattedDistributedAmount?.toLocaleString() || 'N/A'} sent tokens`);
        } catch (error) {
          console.warn(`[GameServer] ⚠️  Failed to update token stats: ${error.message}`);
        }
        
        // Update player stats for winners
        // Note: Games played was already updated above for all players
        for (const winner of winners) {
          try {
            const playerStats = await PlayerStats.findOne({ clientId: winner.playerId });
            if (playerStats) {
              const tokensPerWinner = distributeResult.formattedDistributedAmount / winners.length;
              await playerStats.addTokensWon(tokensPerWinner);
              await playerStats.addGameWon();
              // Games played already updated above for all players
            }
          } catch (error) {
            console.warn(`[GameServer] ⚠️  Could not update stats for player ${winner.playerId}:`, error.message);
          }
        }
        
        // Send system announcement for token distribution
        const teamName = winnerTeam === 'red' ? 'red' : winnerTeam === 'blue' ? 'blue' : '';
        const teamText = teamName ? ` from ${teamName} team` : '';
        const distributionMessage = `sent ${distributeResult.formattedDistributedAmount.toLocaleString()} $PAINT to ${winners.length} winner${winners.length !== 1 ? 's' : ''}${teamText}`;
        this.sendSystemAnnouncement(distributionMessage);
        
        // Broadcast distribution complete
        this.io.emit('tokenDistributionComplete', {
          winnerTeam: winnerTeam,
          winnerCount: winners.length,
          totalAmount: distributeResult.formattedDistributedAmount,
          roundNumber: roundNumber
        });
      } else {
        console.error(`[GameServer] ❌ Failed to distribute tokens for round ${roundNumber}:`, distributeResult.error);
        // Games played was already updated for all players at the start of the function
      }
      
      // Clear token info after distribution (only if it matches current round)
      // This prevents clearing tokens from a newer round
      if (roundNumber === this.roundNumber || !this.currentTokenAmount) {
        this.currentTokenAmount = null;
        this.currentTokenAccount = null;
        this.currentTokenMint = null;
        this.currentFormattedTokenAmount = null;
      }
      
      this.tokenDistributionInProgress = false;
      this.distributionRoundNumber = null;
    } catch (error) {
      console.error(`[GameServer] ❌ Exception in token distribution for round ${roundNumber}:`, error);
      this.tokenDistributionInProgress = false;
      this.distributionRoundNumber = null;
    }
  }
  
  async saveRoundToDatabase(status, gameData = {}) {
    try {
      // Find existing round for this round number or create new one
      let round = await Round.findOne({ roundNumber: this.roundNumber });
      
      if (!round) {
        // Create new round
        round = new Round({
          roundNumber: this.roundNumber,
          mapName: this.mapName || 'map1',
          startTime: this.currentRoundStartTime || Date.now(),
          status: status,
          gameDuration: this.gameCountdown || 120,
          queueCountdown: this.queueCountdown || 60
        });
      }
      
      // Update round data
      if (status === 'PLAYING') {
        // Save player list when game starts
        round.players = Array.from(this.players.entries()).map(([playerId, info]) => ({
          playerId: playerId,
          socketId: info.socketId,
          team: info.team,
          joinedAt: info.joinedAt || Date.now()
        }));
        round.playerCount = this.players.size;
      } else if (status === 'ENDED') {
        // Save game results when game ends
        round.endTime = Date.now();
        round.duration = round.endTime - round.startTime;
        round.status = 'ENDED';
        round.scores = {
          red: gameData.redBlocks || 0,
          blue: gameData.blueBlocks || 0
        };
        round.winner = gameData.winner || null;
        
        // Update players if provided
        if (gameData.players) {
          round.players = gameData.players;
        }
      }
      
      await round.save();
      console.log(`[GameServer] ✅ Saved round ${this.roundNumber} to database (status: ${status})`);
    } catch (error) {
      console.error('[GameServer] ❌ Error saving round to database:', error);
      throw error;
    }
  }
  
  async broadcastGameState() {
    if (this.gameState === 'QUEUE') {
      const isPaused = await this.checkGamePaused();
      this.io.emit('queueState', {
        state: 'QUEUE',
        countdown: Math.ceil(this.queueCountdown),
        playerCount: this.players.size,
        potAmount: this.currentFormattedTokenAmount || null,
        isPaused: isPaused
      });
    } else if (this.gameState === 'PLAYING') {
      this.io.emit('gameState', {
        state: 'PLAYING',
        countdown: Math.ceil(this.gameCountdown)
      });
    }
  }

  async handleSpectatorJoin(socket, playerId) {
    console.log(`Spectator ${playerId} connected`);
    
    // Store spectator info
    this.spectators.set(socket.id, { playerId: playerId });
    
    // Send current game/queue state to spectator
    if (this.gameState === 'QUEUE') {
      const isPaused = await this.checkGamePaused();
      socket.emit('queueState', {
        state: 'QUEUE',
        countdown: Math.ceil(this.queueCountdown),
        playerCount: this.players.size,
        potAmount: this.currentFormattedTokenAmount || null,
        isPaused: isPaused
      });
    } else if (this.gameState === 'PLAYING') {
      socket.emit('gameState', {
        state: 'PLAYING',
        countdown: Math.ceil(this.gameCountdown)
      });
    }
    
    // Send snapshot so spectator can watch
    const snapshot = this.gameServer.getSnapshot();
    socket.emit('snapshot', snapshot);
    
    // Notify spectator they're in spectator mode
    socket.emit('spectatorMode', { playerId: playerId });
  }

  async handlePlayerJoin(socket, playerId) {
    // Remove from spectators if they were spectating
    if (this.spectators.has(socket.id)) {
      this.spectators.delete(socket.id);
    }
    
    // Check if already a player
    if (this.players.has(playerId)) {
      console.log(`Player ${playerId} already joined`);
      return;
    }
    
    console.log(`Player ${playerId} joined queue. Total players: ${this.players.size + 1}`);
    
    // Store player info in queue (no team assigned yet - will be assigned when game starts)
    this.players.set(playerId, {
      socketId: socket.id,
      team: null, // Team will be assigned when game starts
      character: null // Will be created when game starts
    });

    // Send confirmation to player (no team yet)
    socket.emit('playerJoined', {
      playerId: playerId,
      team: null // No team assigned yet
    });

    // Send current game/queue state to new player
    if (this.gameState === 'QUEUE') {
      const isPaused = await this.checkGamePaused();
      socket.emit('queueState', {
        state: 'QUEUE',
        countdown: Math.ceil(this.queueCountdown),
        playerCount: this.players.size,
        potAmount: this.currentFormattedTokenAmount || null,
        isPaused: isPaused
      });
    } else if (this.gameState === 'PLAYING') {
      socket.emit('gameState', {
        state: 'PLAYING',
        countdown: Math.ceil(this.gameCountdown)
      });
    }

    // Send snapshot so player can see the game
    const snapshot = this.gameServer.getSnapshot();
    socket.emit('snapshot', snapshot);

    // Notify other players about new player
    socket.broadcast.emit('playerJoined', {
      playerId: playerId,
      team: null // No team assigned yet
    });
    
    // Update queue state for all players (player count changed)
    if (this.gameState === 'QUEUE') {
      this.broadcastGameState();
    }
  }

  handleDisconnect(socket, playerId) {
    // Check if it's a player
    if (this.players.has(playerId)) {
      console.log(`Player ${playerId} left`);
      
      // Remove player from game server if they were spawned
      if (this.gameServer.players.has(playerId)) {
        this.gameServer.removePlayer(playerId);
      }
      
      // Remove from players map
      this.players.delete(playerId);

      // Notify other players
      socket.broadcast.emit('playerLeft', {
        playerId: playerId
      });
      
      // Update queue state for all players (player count changed)
      if (this.gameState === 'QUEUE') {
        this.broadcastGameState();
      }
    } else if (this.spectators.has(socket.id)) {
      // It's a spectator
      console.log(`Spectator ${playerId} left`);
      this.spectators.delete(socket.id);
    }
  }

  handlePlayerInput(socket, data) {
    // Don't process inputs if game is not playing
    if (this.gameState !== 'PLAYING') {
      return;
    }
    
    const { playerId, inputs, gameTime, sequence } = data;
    
    // Apply inputs to player's character in game server
    // Include sequence number for reconciliation
    this.gameServer.applyInputs(playerId, inputs, gameTime, sequence);
  }

  handlePlayerStateSync(socket, data) {
    const { playerId, x, y, velocityY, hasBomb, gameTime } = data;
    
    // Server is authoritative, but we can use this for validation
    // For now, we trust the server state (which is calculated from inputs)
    // In a more advanced implementation, we could validate and correct
  }

  handleBombThrown(socket, data) {
    // Don't process bomb throws if game is not playing
    if (this.gameState !== 'PLAYING') {
      return;
    }
    
    const { playerId, x, y, team, throwDirection, gameTime } = data;
    
    // Add bomb to game server
    this.gameServer.throwBomb(playerId, x, y, team, throwDirection);
    
    // Broadcast to all clients
    this.io.emit('bombThrown', {
      playerId: playerId,
      x: x,
      y: y,
      team: team,
      throwDirection: throwDirection,
      gameTime: gameTime
    });
  }

  // Removed handleBombCollected - bomb collection is now server-authoritative
  // The server checks collisions in its update loop and handles collection automatically

  broadcastSnapshot() {
    const snapshot = this.gameServer.getSnapshot();
    
    // Send snapshot to all clients (players and spectators)
    this.io.emit('snapshot', snapshot);
  }

  getPlayerCount() {
    return this.players.size;
  }
  
  // Send system announcement to chat
  sendSystemAnnouncement(message) {
    try {
      if (this.sendSystemMessageFn) {
        console.log('[GameServer] 📢 Sending system announcement:', message);
        this.sendSystemMessageFn(message);
      } else {
        console.warn('[GameServer] ⚠️  sendSystemMessage function not available');
      }
    } catch (error) {
      console.error('[GameServer] ❌ Error sending system announcement:', error);
    }
  }

  // Check if game is paused
  async checkGamePaused() {
    try {
      const adminConfig = await AdminConfig.findOne();
      return adminConfig ? (adminConfig.gamePaused === true) : false;
    } catch (error) {
      console.error('[GameServer] Error checking game paused status:', error);
      return false;
    }
  }

  // Restart queue when game is unpaused
  async restartQueueIfUnpaused() {
    const isPaused = await this.checkGamePaused();
    if (!isPaused) {
      console.log('[GameServer] ▶️  Game unpaused, restarting queue with fresh crypto operations');
      
      // If currently playing, let the game finish naturally
      // Otherwise, restart queue
      if (this.gameState === 'PLAYING') {
        console.log('[GameServer] ℹ️  Game is currently playing, will restart queue after game ends');
        // The queue will restart automatically after the game ends
      } else {
        // Reset crypto operations flag so new operations can start
        this.cryptoOperationsStarted = false;
        // Reset current token amount so fresh operations start
        this.currentFormattedTokenAmount = null;
        // Start new queue phase
        this.startQueueCountdown();
      }
    }
  }
  
  // Stop crypto operations if game is paused (called when pause is detected)
  async stopCryptoOperationsIfPaused() {
    const isPaused = await this.checkGamePaused();
    if (isPaused) {
      console.log('[GameServer] ⏸️  Game paused, stopping crypto operations');
      // Reset flag so operations won't continue
      this.cryptoOperationsStarted = false;
      // Clear current token amount
      this.currentFormattedTokenAmount = null;
    }
  }
}

module.exports = GameServerManager;
