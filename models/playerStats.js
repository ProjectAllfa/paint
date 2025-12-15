const mongoose = require('mongoose');

const playerStatsSchema = new mongoose.Schema({
    clientId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    username: {
        type: String,
        required: true
    },
    publicWallet: {
        type: String,
        default: '',
        index: true
    },
    totalGamesPlayed: {
        type: Number,
        default: 0
    },
    totalTokensWon: {
        type: Number,
        default: 0
    },
    totalGamesWon: {
        type: Number,
        default: 0
    },
    lastUpdated: {
        type: Date,
        default: Date.now
    }
});

// Update timestamp before saving
playerStatsSchema.pre('save', async function() {
    this.lastUpdated = new Date();
});

// Static method to get or create player stats
playerStatsSchema.statics.getOrCreateStats = async function(clientId, username, publicWallet) {
    let stats = await this.findOne({ clientId });
    if (!stats) {
        stats = new this({
            clientId,
            username: username || 'Player',
            publicWallet: publicWallet || ''
        });
        await stats.save();
    } else {
        // Update username and wallet if provided and different
        if (username && stats.username !== username) {
            stats.username = username;
        }
        if (publicWallet && stats.publicWallet !== publicWallet) {
            stats.publicWallet = publicWallet;
        }
        await stats.save();
    }
    return stats;
};

// Static method to get top players by tokens won
playerStatsSchema.statics.getTopPlayers = async function(limit = 10) {
    return await this.find()
        .sort({ totalTokensWon: -1 })
        .limit(limit)
        .select('username totalGamesPlayed totalTokensWon totalGamesWon')
        .lean();
};

// Instance method to add a game played
playerStatsSchema.methods.addGamePlayed = async function() {
    this.totalGamesPlayed += 1;
    await this.save();
};

// Instance method to add tokens won
playerStatsSchema.methods.addTokensWon = async function(tokens) {
    this.totalTokensWon += tokens;
    await this.save();
};

// Instance method to add a game won
playerStatsSchema.methods.addGameWon = async function() {
    this.totalGamesWon += 1;
    await this.save();
};

const PlayerStats = mongoose.model('PlayerStats', playerStatsSchema);

module.exports = PlayerStats;

