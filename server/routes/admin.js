const express = require('express');
const bcrypt = require('bcrypt');
const AdminConfig = require('../../models/adminConfig');
const TokenStats = require('../../models/tokenStats');
const PlayerStats = require('../../models/playerStats');
const { encrypt, decrypt } = require('../utils/encryption');

// Function to create router with gameServer reference
function createAdminRouter(gameServer) {
  const router = express.Router();

// Middleware to check if user is authenticated
const isAuthenticated = (req, res, next) => {
    if (req.session && req.session.isAdmin) {
        return next();
    }
    return res.status(401).json({ error: 'Unauthorized' });
};

// Login route
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }

        // Get or create admin config
        let config = await AdminConfig.findOne();
        if (!config) {
            // SECURITY WARNING: Default credentials for initial setup only
            // IMPORTANT: Change the default password immediately after first login!
            // Consider using environment variable for default password in production
            const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123';
            if (defaultPassword === 'admin123') {
                console.warn('[SECURITY] Using default admin password. Change it immediately after first login!');
            }
            const hashedPassword = await bcrypt.hash(defaultPassword, 10);
            config = new AdminConfig({
                adminUsername: 'admin',
                adminPassword: hashedPassword
            });
            await config.save();
        }

        // Check username
        if (config.adminUsername !== username) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Check password
        const passwordMatch = await bcrypt.compare(password, config.adminPassword);
        if (!passwordMatch) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Set session
        req.session.isAdmin = true;
        req.session.adminUsername = username;

        res.json({ success: true, message: 'Login successful' });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Logout route
router.post('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: 'Logout failed' });
        }
        res.json({ success: true, message: 'Logout successful' });
    });
});

// Get admin config (decrypt private keys for display)
router.get('/config', isAuthenticated, async (req, res) => {
    try {
        let config = await AdminConfig.findOne();
        if (!config) {
            return res.status(404).json({ error: 'Config not found' });
        }

        // Convert to plain object
        const configObj = config.toObject();

        // Decrypt private keys for display (if they exist)
        if (configObj.devWalletPrivate) {
            configObj.devWalletPrivate = decrypt(configObj.devWalletPrivate) || '';
        }
        if (configObj.potWalletPrivate) {
            configObj.potWalletPrivate = decrypt(configObj.potWalletPrivate) || '';
        }

        // Don't send password hash
        delete configObj.adminPassword;

        res.json(configObj);
    } catch (error) {
        console.error('Get config error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Update admin config
router.post('/config', isAuthenticated, async (req, res) => {
    try {
        let config = await AdminConfig.findOne();
        if (!config) {
            config = new AdminConfig();
        }

        // Store previous paused state to detect changes
        const wasPaused = config.gamePaused === true;

        // Update fields - only update if value is provided and not empty
        const updateFields = [
            'adminUsername',
            'devWalletPublic',
            'potWalletPublic',
            'tokenContractAddress',
            'tokenTicker',
            'gamePaused',
            'xLink',
            'pumpfunLink'
        ];

        updateFields.forEach(field => {
            // Only update if field is provided and has a non-empty value
            if (req.body[field] !== undefined) {
                // For string fields, check if trimmed value is not empty
                if (typeof req.body[field] === 'string') {
                    if (req.body[field].trim() !== '') {
                        config[field] = req.body[field].trim();
                    }
                    // If empty string, skip update (don't overwrite existing value)
                } else {
                    // For non-string fields (like gamePaused boolean), update if defined
                    config[field] = req.body[field];
                }
            }
        });

        // Handle password update (if provided)
        if (req.body.adminPassword && req.body.adminPassword.trim() !== '') {
            const hashedPassword = await bcrypt.hash(req.body.adminPassword, 10);
            config.adminPassword = hashedPassword;
        }

        // Encrypt private keys before saving - only update if non-empty value provided
        if (req.body.devWalletPrivate !== undefined) {
            const trimmedKey = req.body.devWalletPrivate.trim();
            if (trimmedKey !== '') {
                config.devWalletPrivate = encrypt(trimmedKey);
            }
            // If empty, skip update (don't overwrite existing value)
        }

        if (req.body.potWalletPrivate !== undefined) {
            const trimmedKey = req.body.potWalletPrivate.trim();
            if (trimmedKey !== '') {
                config.potWalletPrivate = encrypt(trimmedKey);
            }
            // If empty, skip update (don't overwrite existing value)
        }

        await config.save();

        // Check if game was unpaused (changed from paused to unpaused)
        const isNowPaused = config.gamePaused === true;
        if (wasPaused && !isNowPaused && gameServer) {
            // Game was unpaused, restart queue with fresh crypto operations
            console.log('[Admin] ▶️  Game unpaused, restarting queue');
            gameServer.restartQueueIfUnpaused().catch(error => {
                console.error('[Admin] Error restarting queue after unpause:', error);
            });
        } else if (!wasPaused && isNowPaused && gameServer) {
            // Game was just paused - stop crypto operations immediately
            console.log('[Admin] ⏸️  Game paused, stopping crypto operations');
            gameServer.stopCryptoOperationsIfPaused().catch(error => {
                console.error('[Admin] Error stopping crypto operations:', error);
            });
        }

        res.json({ success: true, message: 'Config updated successfully' });
    } catch (error) {
        console.error('Update config error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Check if user is authenticated
router.get('/check-auth', (req, res) => {
    if (req.session && req.session.isAdmin) {
        res.json({ authenticated: true, username: req.session.adminUsername });
    } else {
        res.json({ authenticated: false });
    }
});

// Reset token stats
router.post('/reset-token-stats', isAuthenticated, async (req, res) => {
    try {
        await TokenStats.resetStats();
        res.json({ success: true, message: 'Token stats reset successfully' });
    } catch (error) {
        console.error('Reset token stats error:', error);
        res.status(500).json({ error: 'Failed to reset token stats' });
    }
});

// Reset player stats (delete all player stats)
router.post('/reset-player-stats', isAuthenticated, async (req, res) => {
    try {
        const result = await PlayerStats.deleteMany({});
        res.json({ 
            success: true, 
            message: `Player stats reset successfully. Deleted ${result.deletedCount} player records.` 
        });
    } catch (error) {
        console.error('Reset player stats error:', error);
        res.status(500).json({ error: 'Failed to reset player stats' });
    }
});

// Toggle game pause/unpause (immediate action, no need to save config)
router.post('/toggle-pause', isAuthenticated, async (req, res) => {
    try {
        let config = await AdminConfig.findOne();
        if (!config) {
            config = new AdminConfig();
        }

        // Store previous paused state
        const wasPaused = config.gamePaused === true;
        
        // Toggle pause state
        config.gamePaused = !wasPaused;
        await config.save();

        const isNowPaused = config.gamePaused === true;

        // Handle pause/unpause actions
        if (wasPaused && !isNowPaused && gameServer) {
            // Game was unpaused, restart queue with fresh crypto operations
            console.log('[Admin] ▶️  Game unpaused via toggle, restarting queue');
            gameServer.restartQueueIfUnpaused().catch(error => {
                console.error('[Admin] Error restarting queue after unpause:', error);
            });
        } else if (!wasPaused && isNowPaused && gameServer) {
            // Game was just paused - stop crypto operations immediately
            console.log('[Admin] ⏸️  Game paused via toggle, stopping crypto operations');
            gameServer.stopCryptoOperationsIfPaused().catch(error => {
                console.error('[Admin] Error stopping crypto operations:', error);
            });
        }

        // Broadcast updated state to all clients
        if (gameServer && gameServer.gameState === 'QUEUE') {
            gameServer.broadcastGameState().catch(error => {
                console.error('[Admin] Error broadcasting game state:', error);
            });
        }

        res.json({ 
            success: true, 
            message: isNowPaused ? 'Game paused' : 'Game unpaused',
            gamePaused: isNowPaused
        });
    } catch (error) {
        console.error('Toggle pause error:', error);
        res.status(500).json({ error: 'Failed to toggle game pause state' });
    }
});

  return router;
}

module.exports = createAdminRouter;
