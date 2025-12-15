const mongoose = require('mongoose');

const tokenStatsSchema = new mongoose.Schema({
    totalBoughtTokens: {
        type: Number,
        default: 0
    },
    totalBurnedTokens: {
        type: Number,
        default: 0
    },
    totalSentTokens: {
        type: Number,
        default: 0
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

// Update timestamp before saving
tokenStatsSchema.pre('save', async function() {
    this.updatedAt = new Date();
});

// Static method to get or create stats document (singleton pattern)
tokenStatsSchema.statics.getStats = async function() {
    let stats = await this.findOne();
    if (!stats) {
        stats = new this({
            totalBoughtTokens: 0,
            totalBurnedTokens: 0,
            totalSentTokens: 0
        });
        await stats.save();
    }
    return stats;
};

// Static method to reset all stats
tokenStatsSchema.statics.resetStats = async function() {
    const stats = await this.getStats();
    stats.totalBoughtTokens = 0;
    stats.totalBurnedTokens = 0;
    stats.totalSentTokens = 0;
    await stats.save();
    return stats;
};

// Instance method to add bought tokens
tokenStatsSchema.methods.addBoughtTokens = async function(amount) {
    this.totalBoughtTokens += amount;
    await this.save();
};

// Instance method to add burned tokens
tokenStatsSchema.methods.addBurnedTokens = async function(amount) {
    this.totalBurnedTokens += amount;
    await this.save();
};

// Instance method to add sent tokens
tokenStatsSchema.methods.addSentTokens = async function(amount) {
    this.totalSentTokens += amount;
    await this.save();
};

const TokenStats = mongoose.model('TokenStats', tokenStatsSchema);

module.exports = TokenStats;

