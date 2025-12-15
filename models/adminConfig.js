const mongoose = require('mongoose');

const adminConfigSchema = new mongoose.Schema({
    // Admin credentials
    adminUsername: {
        type: String,
        required: true,
        default: 'admin'
    },
    adminPassword: {
        type: String,
        required: true
        // Password will be hashed with bcrypt before saving
    },
    
    // Wallet configuration
    devWalletPublic: {
        type: String,
        default: ''
    },
    devWalletPrivate: {
        type: String,
        default: ''
        // Private key will be encrypted before storing (handled in routes)
    },
    
    potWalletPublic: {
        type: String,
        default: ''
    },
    potWalletPrivate: {
        type: String,
        default: ''
        // Private key will be encrypted before storing (handled in routes)
    },
    
    // Token configuration
    tokenContractAddress: {
        type: String,
        default: ''
    },
    tokenTicker: {
        type: String,
        default: '$PAINT'
    },
    
    // Game control
    gamePaused: {
        type: Boolean,
        default: false
    },
    
    // Social links
    xLink: {
        type: String,
        default: ''
    },
    pumpfunLink: {
        type: String,
        default: ''
    },
    
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

// Update timestamp before saving
adminConfigSchema.pre('save', async function() {
    this.updatedAt = new Date();
});

// Static method to get or create the single admin config instance
adminConfigSchema.statics.getConfig = async function() {
    let config = await this.findOne();
    if (!config) {
        // SECURITY WARNING: Default credentials for initial setup only
        // IMPORTANT: Change the default password immediately after first login!
        const bcrypt = require('bcrypt');
        const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123';
        if (defaultPassword === 'admin123') {
            console.warn('[SECURITY] Using default admin password. Change it immediately after first login!');
        }
        const hashedPassword = await bcrypt.hash(defaultPassword, 10);
        config = new this({
            adminUsername: 'admin',
            adminPassword: hashedPassword
        });
        await config.save();
    }
    return config;
};

const AdminConfig = mongoose.model('AdminConfig', adminConfigSchema);

module.exports = AdminConfig;

