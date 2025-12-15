const mongoose = require('mongoose');

const roundSchema = new mongoose.Schema({
    roundNumber: {
        type: Number,
        required: true,
        index: true
    },
    mapName: {
        type: String,
        default: 'map1'
    },
    startTime: {
        type: Date,
        required: true
    },
    endTime: {
        type: Date,
        default: null
    },
    duration: {
        type: Number, // Duration in milliseconds
        default: null
    },
    status: {
        type: String,
        enum: ['QUEUE', 'PLAYING', 'ENDED'],
        default: 'QUEUE'
    },
    players: [{
        playerId: {
            type: String,
            required: true
        },
        socketId: String,
        team: {
            type: String,
            enum: ['red', 'blue', null],
            default: null
        },
        joinedAt: {
            type: Date,
            default: Date.now
        }
    }],
    // Team scores at end of game
    scores: {
        red: {
            type: Number,
            default: 0
        },
        blue: {
            type: Number,
            default: 0
        }
    },
    winner: {
        type: String,
        enum: ['red', 'blue', 'tie', null],
        default: null
    },
    // Game configuration
    gameDuration: {
        type: Number, // Duration in seconds
        default: 120
    },
    queueCountdown: {
        type: Number, // Queue countdown in seconds
        default: 60
    },
    playerCount: {
        type: Number,
        default: 0
    }
}, {
    timestamps: true
});

// Index for querying active rounds
roundSchema.index({ status: 1, roundNumber: -1 });
roundSchema.index({ createdAt: -1 });

const Round = mongoose.model('Round', roundSchema);

module.exports = Round;

