const { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL, VersionedTransaction } = require('@solana/web3.js');
const bs58 = require('bs58');
const https = require('https');
const AdminConfig = require('../../models/adminConfig');
const { decrypt } = require('./encryption');
const { buySPLToken, burnTokens, formatTokenAmount, getTokenDecimals } = require('./tokenOperations');

// Use fetch if available (Node 18+), otherwise use https module
const useFetch = typeof fetch !== 'undefined';

/**
 * Claims creator fees from Pump.fun using PumpPortal Local Transaction API
 * @param {string} devWalletPublicKey - Public key of dev wallet
 * @param {string} priorityFee - Priority fee in SOL (default: 0.000001)
 * @returns {Promise<{success: boolean, transaction?: VersionedTransaction, error?: string}>}
 */
async function claimCreatorFeesLocal(devWalletPublicKey, priorityFee = 0.000001) {
    try {
        if (!devWalletPublicKey) {
            return { success: false, error: 'Missing dev wallet public key' };
        }

        console.log('[PumpPortal] 📤 Requesting creator fee claim transaction from PumpPortal...');
        console.log(`[PumpPortal]    Dev wallet: ${devWalletPublicKey}`);
        console.log(`[PumpPortal]    Priority fee: ${priorityFee} SOL`);
        
        const requestBody = JSON.stringify({
            publicKey: devWalletPublicKey,
            action: 'collectCreatorFee',
            priorityFee: priorityFee
        });

        let transactionBytes;
        
        if (useFetch) {
            const response = await fetch('https://pumpportal.fun/api/trade-local', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: requestBody
            });

            if (response.status !== 200) {
                const errorText = await response.text();
                console.error(`[PumpPortal] ❌ PumpPortal API returned error: ${response.status}`);
                console.error(`[PumpPortal]    Response: ${errorText}`);
                return { success: false, error: `API error: ${response.status} - ${errorText}` };
            }

            console.log('[PumpPortal] ✅ Received transaction from PumpPortal');
            const arrayBuffer = await response.arrayBuffer();
            transactionBytes = new Uint8Array(arrayBuffer);
            console.log(`[PumpPortal]    Transaction size: ${transactionBytes.length} bytes`);
        } else {
            // Fallback to https module for older Node.js versions
            const result = await new Promise((resolve, reject) => {
                const options = {
                    hostname: 'pumpportal.fun',
                    path: '/api/trade-local',
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(requestBody)
                    }
                };
                
                const req = https.request(options, (res) => {
                    let responseData = [];
                    res.on('data', (chunk) => {
                        responseData.push(chunk);
                    });
                    res.on('end', () => {
                        if (res.statusCode !== 200) {
                            reject(new Error(`API error: ${res.statusCode}`));
                            return;
                        }
                        resolve(Buffer.concat(responseData));
                    });
                });
                
                req.on('error', reject);
                req.write(requestBody);
                req.end();
            });
            
            transactionBytes = new Uint8Array(result);
        }

        // Deserialize the transaction
        console.log('[PumpPortal] 🔄 Deserializing transaction...');
        const transaction = VersionedTransaction.deserialize(transactionBytes);
        console.log('[PumpPortal] ✅ Transaction deserialized successfully');
        return { success: true, transaction: transaction };
    } catch (error) {
        console.error('[PumpPortal] Error getting creator fee claim transaction:', error);
        return { success: false, error: error.message || 'Failed to get creator fee claim transaction' };
    }
}

/**
 * Signs and submits a transaction to Solana
 * @param {VersionedTransaction} transaction - The transaction to sign and submit
 * @param {Keypair} keypair - The keypair to sign with
 * @param {string} rpcEndpoint - Solana RPC endpoint
 * @returns {Promise<{success: boolean, signature?: string, error?: string}>}
 */
async function signAndSubmitTransaction(transaction, keypair, rpcEndpoint) {
    try {
        console.log('[PumpPortal] 🔐 Signing transaction with dev wallet...');
        const connection = new Connection(rpcEndpoint, 'confirmed');
        
        // Sign the transaction
        transaction.sign([keypair]);
        console.log('[PumpPortal] ✅ Transaction signed');
        
        // Serialize the signed transaction
        const serialized = transaction.serialize();
        console.log(`[PumpPortal] 📦 Serialized transaction: ${serialized.length} bytes`);
        
        // Submit the transaction
        console.log(`[PumpPortal] 📤 Submitting transaction to Solana RPC: ${rpcEndpoint}...`);
        const signature = await connection.sendRawTransaction(serialized, {
            skipPreflight: false,
            maxRetries: 3
        });
        console.log(`[PumpPortal] ✅ Transaction submitted: ${signature}`);
        console.log(`[PumpPortal]    View on Solscan: https://solscan.io/tx/${signature}`);
        
        // Wait for confirmation
        console.log('[PumpPortal] ⏳ Waiting for transaction confirmation...');
        await connection.confirmTransaction(signature, 'confirmed');
        console.log('[PumpPortal] ✅ Transaction confirmed on-chain');
        
        return { success: true, signature: signature };
    } catch (error) {
        console.error('[PumpPortal] Error submitting transaction:', error);
        return { success: false, error: error.message || 'Failed to submit transaction' };
    }
}

/**
 * Transfers a specific amount of SOL from dev wallet to pot wallet
 * @param {string} devWalletPrivateKey - Base58 encoded private key
 * @param {string} potWalletPublicKey - Public key of pot wallet
 * @param {string} rpcEndpoint - Solana RPC endpoint
 * @param {number} amountToTransfer - Amount to transfer in lamports (only this amount, not the full balance)
 * @returns {Promise<{success: boolean, signature?: string, amount?: number, error?: string}>}
 */
async function transferSolToPot(devWalletPrivateKey, potWalletPublicKey, rpcEndpoint, amountToTransfer) {
    try {
        if (!devWalletPrivateKey || !potWalletPublicKey || !rpcEndpoint || !amountToTransfer) {
            return { success: false, error: 'Missing required parameters for SOL transfer' };
        }

        // Decode private key
        const keypair = Keypair.fromSecretKey(bs58.default.decode(devWalletPrivateKey));
        const devWalletPublic = keypair.publicKey;
        
        // Create connection
        const connection = new Connection(rpcEndpoint, 'confirmed');
        
        // Get dev wallet balance to verify we have enough
        console.log('[PumpPortal] 💰 Checking dev wallet balance...');
        const balance = await connection.getBalance(devWalletPublic);
        const balanceInSol = balance / LAMPORTS_PER_SOL;
        console.log(`[PumpPortal]    Current balance: ${balanceInSol.toFixed(4)} SOL`);
        
        // Verify we have enough balance (including transaction fees)
        // Reserve 0.01 SOL for transaction fees
        const reserveAmount = 0.01 * LAMPORTS_PER_SOL;
        const requiredBalance = amountToTransfer + reserveAmount;
        
        if (balance < requiredBalance) {
            console.log(`[PumpPortal] ⚠️  Insufficient balance to transfer ${(amountToTransfer / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
            console.log(`[PumpPortal]    Required: ${(requiredBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL (including fees)`);
            console.log(`[PumpPortal]    Available: ${balanceInSol.toFixed(4)} SOL`);
            return { success: false, error: 'Insufficient balance', amount: balanceInSol };
        }
        
        const transferAmountInSol = amountToTransfer / LAMPORTS_PER_SOL;
        console.log(`[PumpPortal] 💸 Transferring ${transferAmountInSol.toFixed(4)} SOL from dev wallet to pot wallet...`);
        console.log(`[PumpPortal]    From: ${devWalletPublic.toString()}`);
        console.log(`[PumpPortal]    To: ${potWalletPublicKey}`);
        console.log(`[PumpPortal]    Amount: ${transferAmountInSol.toFixed(4)} SOL (only claimed amount)`);
        
        // Create transfer transaction
        const potWalletPubkey = new PublicKey(potWalletPublicKey);
        
        // Get recent blockhash
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
        
        const transaction = new Transaction({
            feePayer: devWalletPublic,
            recentBlockhash: blockhash
        }).add(
            SystemProgram.transfer({
                fromPubkey: devWalletPublic,
                toPubkey: potWalletPubkey,
                lamports: amountToTransfer
            })
        );
        
        // Sign and send transaction
        transaction.sign(keypair);
        const signature = await sendAndConfirmTransaction(
            connection,
            transaction,
            [keypair],
            {
                commitment: 'confirmed',
                skipPreflight: false
            }
        );
        
        console.log(`[PumpPortal] ✅ SOL transferred successfully!`);
        console.log(`[PumpPortal]    Transfer TX: https://solscan.io/tx/${signature}`);
        console.log(`[PumpPortal]    Amount: ${transferAmountInSol.toFixed(4)} SOL`);
        return { 
            success: true, 
            signature: signature,
            amount: transferAmountInSol
        };
    } catch (error) {
        console.error('[PumpPortal] Error transferring SOL:', error);
        return { success: false, error: error.message || 'Failed to transfer SOL' };
    }
}

/**
 * Claims creator fees and transfers to pot wallet
 * This is the main function to call at the start of each round
 * @returns {Promise<{success: boolean, claimed?: boolean, transferred?: boolean, error?: string}>}
 */
async function claimAndTransferFees() {
    console.log('[PumpPortal] ========================================');
    console.log('[PumpPortal] Starting creator fee claim and transfer');
    console.log('[PumpPortal] ========================================');
    
    try {
        // Get admin config
        console.log('[PumpPortal] 📋 Loading admin configuration...');
        const adminConfig = await AdminConfig.findOne();
        if (!adminConfig) {
            console.error('[PumpPortal] ❌ Admin config not found in database');
            return { success: false, error: 'Admin config not found' };
        }
        console.log('[PumpPortal] ✅ Admin config loaded');

        // Check if required fields are set
        if (!adminConfig.devWalletPrivate || !adminConfig.devWalletPublic || !adminConfig.potWalletPublic) {
            console.error('[PumpPortal] ❌ Missing required wallet configuration');
            console.error(`[PumpPortal]    devWalletPrivate: ${adminConfig.devWalletPrivate ? '✓' : '✗'}`);
            console.error(`[PumpPortal]    devWalletPublic: ${adminConfig.devWalletPublic ? '✓' : '✗'}`);
            console.error(`[PumpPortal]    potWalletPublic: ${adminConfig.potWalletPublic ? '✓' : '✗'}`);
            return { success: false, error: 'Dev wallet keys or pot wallet public key not configured' };
        }
        console.log('[PumpPortal] ✅ All required wallet fields configured');

        // Get RPC endpoint from environment
        const rpcEndpoint = process.env.SOLANA_RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com';
        console.log(`[PumpPortal] 🌐 Using RPC endpoint: ${rpcEndpoint}`);
        
        // Decrypt dev wallet private key
        console.log('[PumpPortal] 🔓 Decrypting dev wallet private key...');
        const devWalletPrivateKey = decrypt(adminConfig.devWalletPrivate);
        if (!devWalletPrivateKey) {
            console.error('[PumpPortal] ❌ Failed to decrypt dev wallet private key');
            return { success: false, error: 'Failed to decrypt dev wallet private key' };
        }
        console.log('[PumpPortal] ✅ Dev wallet private key decrypted');

        // Create keypair from private key
        console.log('[PumpPortal] 🔑 Creating keypair from private key...');
        const keypair = Keypair.fromSecretKey(bs58.default.decode(devWalletPrivateKey));
        console.log(`[PumpPortal] ✅ Keypair created: ${keypair.publicKey.toString()}`);

        // Create connection for balance checks
        const connection = new Connection(rpcEndpoint, 'confirmed');

        // Step 0: Check balance BEFORE claiming fees
        console.log('[PumpPortal] ────────────────────────────────────────');
        console.log('[PumpPortal] STEP 0: Checking balance before claim');
        console.log('[PumpPortal] ────────────────────────────────────────');
        console.log('[PumpPortal] 💰 Checking dev wallet balance BEFORE claim...');
        const balanceBefore = await connection.getBalance(keypair.publicKey);
        const balanceBeforeSol = balanceBefore / LAMPORTS_PER_SOL;
        console.log(`[PumpPortal]    Balance before claim: ${balanceBeforeSol.toFixed(4)} SOL`);

        // Step 1: Claim creator fees using local transaction API
        console.log('[PumpPortal] ────────────────────────────────────────');
        console.log('[PumpPortal] STEP 1: Claiming creator fees');
        console.log('[PumpPortal] ────────────────────────────────────────');
        const claimResult = await claimCreatorFeesLocal(adminConfig.devWalletPublic);
        if (!claimResult.success || !claimResult.transaction) {
            // If there are no fees to claim, that's okay - continue anyway
            console.log('[PumpPortal] ℹ️  No fees to claim or claim failed');
            console.log(`[PumpPortal]    Reason: ${claimResult.error || 'No transaction returned'}`);
            return { 
                success: true, 
                claimed: false, 
                transferred: false,
                message: 'No fees to claim'
            };
        }

        // Sign and submit the claim transaction
        console.log('[PumpPortal] ────────────────────────────────────────');
        console.log('[PumpPortal] STEP 2: Signing and submitting claim transaction');
        console.log('[PumpPortal] ────────────────────────────────────────');
        const submitResult = await signAndSubmitTransaction(claimResult.transaction, keypair, rpcEndpoint);
        
        if (!submitResult.success) {
            console.error('[PumpPortal] ❌ Failed to submit claim transaction');
            console.error(`[PumpPortal]    Error: ${submitResult.error}`);
            return { 
                success: false, 
                claimed: false,
                error: submitResult.error 
            };
        }

        console.log('[PumpPortal] ✅ Creator fees claimed successfully!');
        console.log(`[PumpPortal]    Transaction: ${submitResult.signature}`);

        // Step 3: Check balance AFTER claiming fees to calculate amount claimed
        console.log('[PumpPortal] ────────────────────────────────────────');
        console.log('[PumpPortal] STEP 3: Calculating claimed amount');
        console.log('[PumpPortal] ────────────────────────────────────────');
        // Wait a bit for the claim transaction to settle
        console.log('[PumpPortal] ⏳ Waiting 2 seconds for claim transaction to settle...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        console.log('[PumpPortal] 💰 Checking dev wallet balance AFTER claim...');
        const balanceAfter = await connection.getBalance(keypair.publicKey);
        const balanceAfterSol = balanceAfter / LAMPORTS_PER_SOL;
        console.log(`[PumpPortal]    Balance after claim: ${balanceAfterSol.toFixed(4)} SOL`);
        
        // Calculate the amount claimed (difference)
        const amountClaimed = balanceAfter - balanceBefore;
        const amountClaimedSol = amountClaimed / LAMPORTS_PER_SOL;
        
        if (amountClaimed <= 0) {
            console.log('[PumpPortal] ⚠️  No SOL was claimed (balance did not increase)');
            console.log(`[PumpPortal]    Balance before: ${balanceBeforeSol.toFixed(4)} SOL`);
            console.log(`[PumpPortal]    Balance after: ${balanceAfterSol.toFixed(4)} SOL`);
            console.log(`[PumpPortal]    Difference: ${amountClaimedSol.toFixed(4)} SOL`);
            return { 
                success: true, 
                claimed: true, 
                transferred: false,
                claimSignature: submitResult.signature,
                message: 'No SOL was claimed (balance did not increase)',
                amountClaimed: amountClaimedSol
            };
        }
        
        console.log(`[PumpPortal] ✅ Amount claimed: ${amountClaimedSol.toFixed(4)} SOL`);
        console.log(`[PumpPortal]    This is the amount we will transfer (only claimed amount, not existing balance)`);

        // Step 4: Transfer ONLY the claimed amount to pot wallet
        console.log('[PumpPortal] ────────────────────────────────────────');
        console.log('[PumpPortal] STEP 4: Transferring claimed SOL to pot wallet');
        console.log('[PumpPortal] ────────────────────────────────────────');
        
        const transferResult = await transferSolToPot(
            devWalletPrivateKey,
            adminConfig.potWalletPublic,
            rpcEndpoint,
            amountClaimed  // Only transfer the amount that was claimed
        );

        if (!transferResult.success) {
            // If transfer fails due to insufficient balance, that's okay
            if (transferResult.error && transferResult.error.includes('Insufficient')) {
                console.log('[PumpPortal] ⚠️  Insufficient balance to transfer claimed amount');
                console.log(`[PumpPortal]    Amount claimed: ${amountClaimedSol.toFixed(4)} SOL`);
                console.log(`[PumpPortal]    Current balance: ${transferResult.amount?.toFixed(4) || 'unknown'} SOL`);
                return { 
                    success: true, 
                    claimed: true, 
                    transferred: false,
                    claimSignature: submitResult.signature,
                    amountClaimed: amountClaimedSol,
                    message: 'Insufficient balance to transfer claimed amount'
                };
            }
            console.error('[PumpPortal] ❌ Failed to transfer SOL');
            console.error(`[PumpPortal]    Error: ${transferResult.error}`);
            return { 
                success: false, 
                claimed: true,
                claimSignature: submitResult.signature,
                amountClaimed: amountClaimedSol,
                transferred: false,
                error: transferResult.error 
            };
        }

        console.log('[PumpPortal] ========================================');
        console.log('[PumpPortal] ✅ COMPLETE SUCCESS!');
        console.log('[PumpPortal] ========================================');
        console.log(`[PumpPortal] Balance before claim: ${balanceBeforeSol.toFixed(4)} SOL`);
        console.log(`[PumpPortal] Balance after claim: ${balanceAfterSol.toFixed(4)} SOL`);
        console.log(`[PumpPortal] Amount claimed: ${amountClaimedSol.toFixed(4)} SOL`);
        console.log(`[PumpPortal] Claim TX: https://solscan.io/tx/${submitResult.signature}`);
        console.log(`[PumpPortal] Transfer TX: https://solscan.io/tx/${transferResult.signature}`);
        console.log(`[PumpPortal] Amount transferred: ${transferResult.amount?.toFixed(4)} SOL (only claimed amount)`);
        console.log('[PumpPortal] ========================================');

        return {
            success: true,
            claimed: true,
            transferred: true,
            claimSignature: submitResult.signature,
            transferSignature: transferResult.signature,
            transferAmount: transferResult.amount,
            amountClaimed: amountClaimedSol
        };
    } catch (error) {
        console.error('[PumpPortal] ========================================');
        console.error('[PumpPortal] ❌ EXCEPTION in claimAndTransferFees');
        console.error('[PumpPortal] ========================================');
        console.error('[PumpPortal] Error:', error);
        console.error('[PumpPortal] Stack:', error.stack);
        return { success: false, error: error.message || 'Unknown error' };
    }
}

/**
 * Calculates pot (10% of pot wallet) and buys tokens for the round
 * This is called after claimAndTransferFees completes
 * @returns {Promise<{success: boolean, potAmount?: number, potAmountSol?: number, tokenAmount?: number, tokenAccount?: string, error?: string}>}
 */
/**
 * Calculate pot and buy tokens
 * @param {Object} callbacks - Optional callbacks for real-time updates
 * @param {Function} callbacks.onBuyComplete - Called immediately after buy completes with {formattedAmount, buySignature, potAmountSol}
 * @param {Function} callbacks.onBurnComplete - Called immediately after burn completes with {formattedBurnedAmount, burnSignature}
 */
async function calculatePotAndBuyTokens(callbacks = {}) {
    console.log('[PumpPortal] ========================================');
    console.log('[PumpPortal] Calculating pot and buying tokens');
    console.log('[PumpPortal] ========================================');
    
    try {
        // Get admin config
        const adminConfig = await AdminConfig.findOne();
        if (!adminConfig) {
            console.error('[PumpPortal] ❌ Admin config not found');
            return { success: false, error: 'Admin config not found' };
        }

        // Check if required fields are set
        if (!adminConfig.potWalletPrivate || !adminConfig.potWalletPublic || !adminConfig.tokenContractAddress) {
            console.error('[PumpPortal] ❌ Missing required configuration');
            console.error(`[PumpPortal]    potWalletPrivate: ${adminConfig.potWalletPrivate ? '✓' : '✗'}`);
            console.error(`[PumpPortal]    potWalletPublic: ${adminConfig.potWalletPublic ? '✓' : '✗'}`);
            console.error(`[PumpPortal]    tokenContractAddress: ${adminConfig.tokenContractAddress ? '✓' : '✗'}`);
            return { success: false, error: 'Pot wallet or token contract address not configured' };
        }

        // Get RPC endpoint
        const rpcEndpoint = process.env.SOLANA_RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com';
        
        // Decrypt pot wallet private key
        const potWalletPrivateKey = decrypt(adminConfig.potWalletPrivate);
        if (!potWalletPrivateKey) {
            console.error('[PumpPortal] ❌ Failed to decrypt pot wallet private key');
            return { success: false, error: 'Failed to decrypt pot wallet private key' };
        }

        // Create connection
        const connection = new Connection(rpcEndpoint, 'confirmed');
        const potWalletPublicKey = new PublicKey(adminConfig.potWalletPublic);
        
        // Check pot wallet balance
        console.log('[PumpPortal] 💰 Checking pot wallet balance...');
        const potBalance = await connection.getBalance(potWalletPublicKey);
        const potBalanceSol = potBalance / LAMPORTS_PER_SOL;
        console.log(`[PumpPortal]    Total pot wallet balance: ${potBalanceSol.toFixed(4)} SOL`);
        
        if (potBalanceSol <= 0) {
            console.log('[PumpPortal] ⚠️  Pot wallet has no SOL');
            return { 
                success: true, 
                potAmount: 0, 
                potAmountSol: 0,
                message: 'Pot wallet has no SOL' 
            };
        }
        
        // Calculate 10% of pot wallet
        const potAmount = Math.floor(potBalance * 0.10);
        const potAmountSol = potAmount / LAMPORTS_PER_SOL;
        console.log(`[PumpPortal] 🎰 Pot for this round: ${potAmountSol.toFixed(4)} SOL (10% of ${potBalanceSol.toFixed(4)} SOL)`);
        
        if (potAmountSol < 0.001) {
            console.log('[PumpPortal] ⚠️  Pot amount too small to buy tokens');
            return { 
                success: true, 
                potAmount: potAmount, 
                potAmountSol: potAmountSol,
                message: 'Pot amount too small' 
            };
        }
        
        // Buy tokens with the pot amount
        console.log('[PumpPortal] ────────────────────────────────────────');
        console.log('[PumpPortal] Buying tokens with pot amount');
        console.log('[PumpPortal] ────────────────────────────────────────');
        
        const buyResult = await buySPLToken(
            potWalletPrivateKey,
            adminConfig.potWalletPublic,
            adminConfig.tokenContractAddress,
            potAmount,
            rpcEndpoint
        );
        
        if (!buyResult.success) {
            console.error('[PumpPortal] ❌ Failed to buy tokens');
            console.error(`[PumpPortal]    Error: ${buyResult.error}`);
            return { 
                success: false, 
                potAmount: potAmount,
                potAmountSol: potAmountSol,
                error: buyResult.error 
            };
        }
        
        // Use formatted amount for display (this is what we actually bought, not total balance)
        const purchasedFormatted = buyResult.formattedAmount || Number(buyResult.tokenAmount || 0);
        const totalBalanceFormatted = buyResult.formattedTotalBalance || Number(buyResult.totalBalance || 0);
        console.log(`[PumpPortal] ✅ Tokens purchased this transaction: ${purchasedFormatted.toLocaleString()} (raw: ${buyResult.tokenAmount?.toString() || 'unknown'})`);
        console.log(`[PumpPortal]    Total balance in wallet: ${totalBalanceFormatted.toLocaleString()} (raw: ${buyResult.totalBalance?.toString() || 'unknown'})`);
        
        // Track bought tokens in statistics
        if (buyResult.tokenAccountReady && purchasedFormatted > 0) {
            try {
                const TokenStats = require('../../models/tokenStats');
                const stats = await TokenStats.getStats();
                await stats.addBoughtTokens(purchasedFormatted);
                console.log(`[PumpPortal] 📊 Updated token stats: +${purchasedFormatted.toLocaleString()} bought`);
            } catch (error) {
                console.warn(`[PumpPortal] ⚠️  Failed to update token stats: ${error.message}`);
            }
        }
        
        // Send buy message and update pot amount immediately after buy completes
        if (callbacks && callbacks.onBuyComplete && buyResult.tokenAccountReady && purchasedFormatted > 0) {
            callbacks.onBuyComplete({
                formattedAmount: purchasedFormatted,
                buySignature: buyResult.signature,
                potAmountSol: potAmountSol
            });
        }
        
        // Burn 1% of PURCHASED tokens (not total balance)
        // Only burn if we successfully got token amount from buy
        const tokensPurchasedRaw = Number(buyResult.tokenAmount || 0); // Amount we just bought
        let remainingTokens = tokensPurchasedRaw;
        let burnSignature = null;
        let burnedAmount = 0;
        let formattedBurnedAmount = 0;
        let formattedRemainingAmount = purchasedFormatted;
        
        if (buyResult.tokenAccountReady && tokensPurchasedRaw > 0) {
            console.log('[PumpPortal] ────────────────────────────────────────');
            console.log(`[PumpPortal] Burning 1% of purchased tokens (${purchasedFormatted.toLocaleString()})`);
            console.log('[PumpPortal] ────────────────────────────────────────');
            
            // Pass the amount we purchased (not total balance) and token account to burn function
            // This avoids unnecessary RPC calls to search for the account again
            const burnResult = await burnTokens(
                potWalletPrivateKey,
                adminConfig.potWalletPublic,
                adminConfig.tokenContractAddress,
                5, // 1% for testing
                rpcEndpoint,
                tokensPurchasedRaw, // Pass the amount we purchased
                buyResult.tokenAccount // Pass the token account address to avoid searching again
            );
            
            if (!burnResult.success) {
                console.error('[PumpPortal] ❌ Failed to burn tokens');
                console.error(`[PumpPortal]    Error: ${burnResult.error}`);
                console.error('[PumpPortal]    Continuing with full purchased amount for distribution');
                // Continue with full purchased amount if burn fails
                remainingTokens = tokensPurchasedRaw; // Use what we purchased
            } else {
                // Calculate remaining from what we purchased (not total wallet balance)
                burnedAmount = burnResult.burnedAmount || 0;
                formattedBurnedAmount = burnResult.formattedBurnedAmount || 0;
                remainingTokens = tokensPurchasedRaw - burnedAmount; // What we bought minus what we burned
                burnSignature = burnResult.signature;
                
                // Format the remaining amount using the same decimals
                try {
                    const { Connection } = require('@solana/web3.js');
                    const connection = new Connection(rpcEndpoint, 'confirmed');
                    const decimals = await getTokenDecimals(connection, new PublicKey(adminConfig.tokenContractAddress), TOKEN_2022_PROGRAM_ID);
                    formattedRemainingAmount = formatTokenAmount(BigInt(remainingTokens), decimals);
                } catch (error) {
                    // Fallback: calculate from formatted amounts
                    formattedRemainingAmount = Math.max(0, purchasedFormatted - formattedBurnedAmount);
                }
                
                console.log(`[PumpPortal] ✅ Burned ${formattedBurnedAmount.toLocaleString()} tokens (1% of ${purchasedFormatted.toLocaleString()} purchased)`);
                console.log(`[PumpPortal] ✅ Remaining tokens for distribution: ${formattedRemainingAmount.toLocaleString()} (raw: ${remainingTokens.toLocaleString()})`);
                
                // Track burned tokens in statistics
                if (formattedBurnedAmount > 0) {
                    try {
                        const TokenStats = require('../../models/tokenStats');
                        const stats = await TokenStats.getStats();
                        await stats.addBurnedTokens(formattedBurnedAmount);
                        console.log(`[PumpPortal] 📊 Updated token stats: +${formattedBurnedAmount.toLocaleString()} burned`);
                    } catch (error) {
                        console.warn(`[PumpPortal] ⚠️  Failed to update token stats: ${error.message}`);
                    }
                }
                
                // Send burn message immediately after burn completes
                if (callbacks && callbacks.onBurnComplete && burnSignature) {
                    callbacks.onBurnComplete({
                        formattedBurnedAmount: formattedBurnedAmount,
                        burnSignature: burnSignature
                    });
                }
            }
        } else {
            console.log('[PumpPortal] ⚠️  Skipping burn - token account not ready or no tokens received');
            console.log(`[PumpPortal]    Token account ready: ${buyResult.tokenAccountReady || false}`);
            console.log(`[PumpPortal]    Token amount: ${purchasedFormatted.toLocaleString()} (raw: ${remainingTokens.toLocaleString()})`);
            console.log(`[PumpPortal]    Token account: ${buyResult.tokenAccount || 'unknown'}`);
            console.log(`[PumpPortal]    Buy TX: https://solscan.io/tx/${buyResult.signature}`);
            console.log(`[PumpPortal]    Will attempt to get token balance during distribution`);
        }
        
        console.log('[PumpPortal] ========================================');
        console.log('[PumpPortal] ✅ Pot calculation and token purchase complete!');
        console.log('[PumpPortal] ========================================');
        
        return {
            success: true,
            potAmount: potAmount,
            potAmountSol: potAmountSol,
            tokenAmount: remainingTokens, // Keep raw for calculations
            formattedTokenAmount: formattedRemainingAmount, // Add formatted for display
            tokenAccount: buyResult.tokenAccount,
            buySignature: buyResult.signature,
            burnSignature: burnSignature,
            burnedAmount: burnedAmount, // Keep raw for calculations
            formattedBurnedAmount: formattedBurnedAmount // Add formatted for display
        };
    } catch (error) {
        console.error('[PumpPortal] ========================================');
        console.error('[PumpPortal] ❌ EXCEPTION in calculatePotAndBuyTokens');
        console.error('[PumpPortal] ========================================');
        console.error('[PumpPortal] Error:', error);
        return { success: false, error: error.message || 'Unknown error' };
    }
}

module.exports = {
    claimCreatorFeesLocal,
    signAndSubmitTransaction,
    transferSolToPot,
    claimAndTransferFees,
    calculatePotAndBuyTokens
};


