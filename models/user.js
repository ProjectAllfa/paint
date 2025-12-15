const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    clientId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    username: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        maxlength: 50,
        index: true
    },
    publicWallet: {
        type: String,
        required: true,
        trim: true,
        maxlength: 200
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    lastPlayed: {
        type: Date,
        default: Date.now
    }
});

// Update lastPlayed timestamp before saving
userSchema.pre('save', async function() {
    this.lastPlayed = new Date();
});

const User = mongoose.model('User', userSchema);

module.exports = User;

