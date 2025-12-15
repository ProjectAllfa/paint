const express = require('express');
const PlayerStats = require('../../models/playerStats');

const router = express.Router();

// Save or update player info (username and public wallet)
router.post('/info', async (req, res) => {
  try {
    const { clientId, username, publicWallet } = req.body;

    if (!clientId) {
      return res.status(400).json({ error: 'Client ID is required' });
    }

    if (!username || !username.trim()) {
      return res.status(400).json({ error: 'Username is required' });
    }

    if (!publicWallet || !publicWallet.trim()) {
      return res.status(400).json({ error: 'Public wallet address is required' });
    }

    const trimmedUsername = username.trim();
    const trimmedWallet = publicWallet.trim();

    // Validate username length
    if (trimmedUsername.length > 50) {
      return res.status(400).json({ error: 'Username must be 50 characters or less' });
    }

    // Validate wallet length
    if (trimmedWallet.length > 200) {
      return res.status(400).json({ error: 'Wallet address must be 200 characters or less' });
    }

    // Get current player info once (to avoid duplicate queries)
    const currentPlayer = await PlayerStats.findOne({ clientId });
    
    // Check if username is already taken by another player
    // First, check if current player already has this username (allow updating to same username)
    const currentPlayerUsername = currentPlayer?.username?.trim() || '';
    const isCurrentPlayerUsername = currentPlayerUsername === trimmedUsername;
    
    // Only check for conflicts if this is not the current player's existing username
    if (!isCurrentPlayerUsername) {
      const existingUsername = await PlayerStats.findOne({ 
        username: trimmedUsername,
        clientId: { $ne: clientId } // Exclude current player
      });

      if (existingUsername) {
        return res.status(400).json({ error: 'Username is already taken' });
      }
    }

    // Check if wallet is already used by another player
    // First, check if current player already has this wallet (allow updating to same wallet)
    const currentPlayerWallet = currentPlayer?.publicWallet?.trim() || '';
    const isCurrentPlayerWallet = currentPlayerWallet.toLowerCase() === trimmedWallet.toLowerCase();
    
    // Only check for conflicts if this is not the current player's existing wallet
    if (!isCurrentPlayerWallet) {
      // Check if another player (not the current one) has this wallet (case-insensitive)
      // Use regex for case-insensitive matching
      const existingWallet = await PlayerStats.findOne({ 
        clientId: { $ne: clientId }, // Exclude current player
        publicWallet: { 
          $ne: '', // Not empty
          $regex: new RegExp(`^${trimmedWallet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') // Case-insensitive exact match
        }
      });

      if (existingWallet) {
        return res.status(400).json({ error: 'Wallet address is already registered' });
      }
    }

    // Get or create player stats
    let playerStats = await PlayerStats.findOne({ clientId });

    if (playerStats) {
      // Update existing player
      playerStats.username = trimmedUsername;
      playerStats.publicWallet = trimmedWallet;
      await playerStats.save();
    } else {
      // Create new player
      playerStats = new PlayerStats({
        clientId,
        username: trimmedUsername,
        publicWallet: trimmedWallet
      });
      await playerStats.save();
    }

    res.json({ 
      success: true, 
      message: 'Player info saved successfully',
      playerStats: {
        clientId: playerStats.clientId,
        username: playerStats.username,
        publicWallet: playerStats.publicWallet
      }
    });
  } catch (error) {
    console.error('Error saving player info:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get player info by client ID
router.get('/info/:clientId', async (req, res) => {
  try {
    const { clientId } = req.params;

    if (!clientId) {
      return res.status(400).json({ error: 'Client ID is required' });
    }

    const playerStats = await PlayerStats.findOne({ clientId });

    if (!playerStats) {
      return res.json({ 
        success: true, 
        hasInfo: false,
        message: 'Player info not found' 
      });
    }

    // Check if player has both username and wallet filled
    const hasInfo = playerStats.username && 
                    playerStats.username.trim() !== '' && 
                    playerStats.publicWallet && 
                    playerStats.publicWallet.trim() !== '';

    // Always return playerStats if they exist (even if incomplete), so modal can pre-fill
    res.json({ 
      success: true, 
      hasInfo: hasInfo,
      playerStats: {
        clientId: playerStats.clientId,
        username: playerStats.username || '',
        publicWallet: playerStats.publicWallet || ''
      }
    });
  } catch (error) {
    console.error('Error getting player info:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get leaderboard (top players by tokens won)
router.get('/leaderboard', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 3; // Default to top 3
    
    const topPlayers = await PlayerStats.getTopPlayers(limit);
    
    res.json({
      success: true,
      players: topPlayers.map(player => ({
        username: player.username || 'Player',
        totalGamesPlayed: player.totalGamesPlayed || 0,
        totalGamesWon: player.totalGamesWon || 0,
        totalTokensWon: player.totalTokensWon || 0
      }))
    });
  } catch (error) {
    console.error('Error getting leaderboard:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
