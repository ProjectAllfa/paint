const express = require('express');
const TokenStats = require('../../models/tokenStats');
const AdminConfig = require('../../models/adminConfig');

const router = express.Router();

// Get public token stats (no sensitive data)
router.get('/public', async (req, res) => {
  try {
    // Get token stats
    const tokenStats = await TokenStats.getStats();
    
    // Get admin config (only public fields)
    const adminConfig = await AdminConfig.findOne().select('tokenTicker tokenContractAddress xLink pumpfunLink');
    
    res.json({
      success: true,
      ticker: adminConfig?.tokenTicker || '$PAINT',
      contractAddress: adminConfig?.tokenContractAddress || '',
      bought: tokenStats.totalBoughtTokens || 0,
      burned: tokenStats.totalBurnedTokens || 0,
      sent: tokenStats.totalSentTokens || 0,
      xLink: adminConfig?.xLink || '',
      pumpfunLink: adminConfig?.pumpfunLink || ''
    });
  } catch (error) {
    console.error('Error getting token stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
