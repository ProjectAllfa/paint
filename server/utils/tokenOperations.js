const { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL, VersionedTransaction } = require('@solana/web3.js');
const { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, createAssociatedTokenAccountIdempotentInstruction, getAccount, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, createBurnInstruction, createTransferInstruction, getMint } = require('@solana/spl-token');
const bs58 = require('bs58');
const AdminConfig = require('../../models/adminConfig');
const { decrypt } = require('./encryption');

/**
 * Get token decimals from mint address
 * @param {Connection} connection - Solana connection
 * @param {PublicKey} tokenMint - Token mint address
 * @param {PublicKey} tokenProgramId - Token program ID (Token or Token-2022)
 * @returns {Promise<number>} Token decimals
 */
async function getTokenDecimals(connection, tokenMint, tokenProgramId = TOKEN_PROGRAM_ID) {
    try {
        const mintInfo = await getMint(connection, tokenMint, 'confirmed', tokenProgramId);
        return mintInfo.decimals;
    } catch (error) {
        // If failed with one program, try the other
        const otherProgram = tokenProgramId.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;
        try {
            const mintInfo = await getMint(connection, tokenMint, 'confirmed', otherProgram);
            return mintInfo.decimals;
        } catch (e) {
            console.warn(`[TokenOps] ⚠️  Could not get token decimals, defaulting to 6: ${e.message}`);
            return 6; // Default to 6 decimals (common for most tokens)
        }
    }
}

/**
 * Convert raw token amount to human-readable amount (disregarding decimals)
 * @param {BigInt|number} rawAmount - Raw token amount
 * @param {number} decimals - Token decimals
 * @returns {number} Human-readable token amount (whole number)
 */
function formatTokenAmount(rawAmount, decimals) {
    const divisor = BigInt(10 ** decimals);
    const rawBigInt = typeof rawAmount === 'bigint' ? rawAmount : BigInt(rawAmount);
    return Number(rawBigInt / divisor);
}

/**
 * Buys SPL tokens on pump.fun using PumpPortal Local Transaction API
 * @param {string} potWalletPrivateKey - Base58 encoded private key
 * @param {string} potWalletPublicKey - Public key of pot wallet
 * @param {string} tokenMintAddress - Token mint address (CA)
 * @param {number} solAmount - Amount of SOL to spend (in lamports)
 * @param {string} rpcEndpoint - Solana RPC endpoint
 * @returns {Promise<{success: boolean, signature?: string, tokenAmount?: number, error?: string}>}
 */
async function buySPLToken(potWalletPrivateKey, potWalletPublicKey, tokenMintAddress, solAmount, rpcEndpoint) {
    try {
        console.log('[TokenOps] 💰 Buying tokens on pump.fun via PumpPortal...');
        console.log(`[TokenOps]    Token CA: ${tokenMintAddress}`);
        const solAmountNumber = solAmount / LAMPORTS_PER_SOL;
        console.log(`[TokenOps]    SOL amount: ${solAmountNumber.toFixed(4)} SOL`);
        
        // Decode private key
        const keypair = Keypair.fromSecretKey(bs58.default.decode(potWalletPrivateKey));
        const potWalletPublic = new PublicKey(potWalletPublicKey);
        
        // Create connection
        const connection = new Connection(rpcEndpoint, 'confirmed');
        
        const tokenMint = new PublicKey(tokenMintAddress);
        
        // Get associated token account for pot wallet (will be updated with actual account if found)
        let associatedTokenAccount = await getAssociatedTokenAddress(
            tokenMint,
            potWalletPublic
        );
        
        console.log(`[TokenOps]    Expected token account: ${associatedTokenAccount.toString()}`);
        
        // Use PumpPortal Local Transaction API to get buy transaction
        console.log('[TokenOps] 📤 Requesting buy transaction from PumpPortal...');
        
        const requestBody = JSON.stringify({
            publicKey: potWalletPublicKey,
            action: 'buy',
            mint: tokenMintAddress,
            amount: solAmountNumber.toString(), // Amount in SOL as string
            denominatedInSol: 'true',
            slippage: 0.5, // 0.5% slippage
            priorityFee: 0.000001,
            pool: 'pump' // Use pump.fun pool
        });

        let transactionBytes;
        const useFetch = typeof fetch !== 'undefined';
        
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
                console.error(`[TokenOps] ❌ PumpPortal API returned error: ${response.status}`);
                console.error(`[TokenOps]    Response: ${errorText}`);
                return { success: false, error: `API error: ${response.status} - ${errorText}` };
            }

            console.log('[TokenOps] ✅ Received transaction from PumpPortal');
            const arrayBuffer = await response.arrayBuffer();
            transactionBytes = new Uint8Array(arrayBuffer);
            console.log(`[TokenOps]    Transaction size: ${transactionBytes.length} bytes`);
        } else {
            // Fallback to https module for older Node.js versions
            const https = require('https');
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
        console.log('[TokenOps] 🔄 Deserializing transaction...');
        const transaction = VersionedTransaction.deserialize(transactionBytes);
        console.log('[TokenOps] ✅ Transaction deserialized successfully');
        
        // Get balance BEFORE purchase to calculate what we actually bought
        // IMPORTANT: Check this BEFORE submitting the transaction!
        console.log('[TokenOps] 🔍 Checking token account balance BEFORE purchase...');
        let balanceBefore = BigInt(0);
        let actualTokenAccount = associatedTokenAccount;
        try {
            const accountsBefore = await connection.getParsedTokenAccountsByOwner(
                potWalletPublic,
                { mint: tokenMint }
            );
            
            if (accountsBefore.value && accountsBefore.value.length > 0) {
                const tokenAccountBefore = accountsBefore.value[0];
                actualTokenAccount = new PublicKey(tokenAccountBefore.pubkey);
                balanceBefore = BigInt(tokenAccountBefore.account.data.parsed.info.tokenAmount.amount);
                console.log(`[TokenOps]    Balance before purchase: ${balanceBefore.toString()}`);
            } else {
                console.log('[TokenOps]    No existing token account (first purchase)');
            }
        } catch (e) {
            console.log('[TokenOps]    Could not get balance before purchase (account may not exist yet)');
        }
        
        // Sign the transaction
        console.log('[TokenOps] 🔐 Signing transaction...');
        transaction.sign([keypair]);
        console.log('[TokenOps] ✅ Transaction signed');
        
        // Serialize the signed transaction
        const serialized = transaction.serialize();
        console.log(`[TokenOps] 📦 Serialized transaction: ${serialized.length} bytes`);
        
        // Submit the transaction
        console.log(`[TokenOps] 📤 Submitting transaction to Solana RPC: ${rpcEndpoint}...`);
        const signature = await connection.sendRawTransaction(serialized, {
            skipPreflight: false,
            maxRetries: 3
        });
        console.log(`[TokenOps] ✅ Transaction submitted: ${signature}`);
        console.log(`[TokenOps]    View on Solscan: https://solscan.io/tx/${signature}`);
        
        // Wait for confirmation
        console.log('[TokenOps] ⏳ Waiting for transaction confirmation...');
        await connection.confirmTransaction(signature, 'confirmed');
        console.log('[TokenOps] ✅ Transaction confirmed on-chain');
        
        // Wait a bit for transaction to settle (reduced from 3s to 2s)
        console.log('[TokenOps] ⏳ Waiting 2 seconds for transaction to settle...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Use getParsedTokenAccountsByOwner to find token account - reduced retries to avoid rate limits
        console.log('[TokenOps] 🔍 Finding token account using getParsedTokenAccountsByOwner...');
        let balanceAfter = BigInt(0);
        let tokenAccountReady = false;
        let retries = 2; // Reduced from 5 to 2
        
        while (retries > 0 && !tokenAccountReady) {
            try {
                const accounts = await connection.getParsedTokenAccountsByOwner(
                    potWalletPublic,
                    { mint: tokenMint }
                );
                
                if (accounts.value && accounts.value.length > 0) {
                    const tokenAccount = accounts.value[0];
                    actualTokenAccount = new PublicKey(tokenAccount.pubkey);
                    balanceAfter = BigInt(tokenAccount.account.data.parsed.info.tokenAmount.amount);
                    tokenAccountReady = true;
                    console.log(`[TokenOps] ✅ Token account found: ${actualTokenAccount.toString()}`);
                    console.log(`[TokenOps]    Balance after purchase: ${balanceAfter.toString()}`);
                } else {
                    console.log('[TokenOps] ⚠️  No token accounts found for this mint');
                    retries--;
                    if (retries > 0) {
                        console.log(`[TokenOps] ⏳ Retrying... (${retries} retries left)`);
                        await new Promise(resolve => setTimeout(resolve, 3000)); // Increased delay to avoid rate limits
                    }
                }
            } catch (e) {
                retries--;
                if (retries > 0) {
                    console.log(`[TokenOps] ⏳ Error finding token account, retrying... (${retries} retries left)`);
                    console.log(`[TokenOps]    Error: ${e.message}`);
                    await new Promise(resolve => setTimeout(resolve, 3000)); // Increased delay to avoid rate limits
                } else {
                    console.log('[TokenOps] ⚠️  Could not find token account after retries');
                    console.log(`[TokenOps]    Error: ${e.message}`);
                }
            }
        }
        
        // Calculate tokens we actually bought (difference between after and before)
        const tokensPurchased = balanceAfter - balanceBefore;
        console.log(`[TokenOps]    Tokens purchased this transaction: ${tokensPurchased.toString()}`);
        console.log(`[TokenOps]    Total balance in wallet: ${balanceAfter.toString()}`);
        
        // Update associatedTokenAccount to the actual one found
        if (tokenAccountReady) {
            associatedTokenAccount = actualTokenAccount;
        }
        
        // Get token decimals and format amount
        let formattedAmount = Number(tokensPurchased);
        let formattedTotalBalance = Number(balanceAfter);
        if (tokenAccountReady && tokensPurchased > 0) {
            try {
                const decimals = await getTokenDecimals(connection, tokenMint, TOKEN_2022_PROGRAM_ID);
                formattedAmount = formatTokenAmount(tokensPurchased, decimals);
                formattedTotalBalance = formatTokenAmount(balanceAfter, decimals);
                console.log(`[TokenOps]    Formatted purchased: ${formattedAmount.toLocaleString()}`);
                console.log(`[TokenOps]    Formatted total balance: ${formattedTotalBalance.toLocaleString()}`);
            } catch (error) {
                console.warn(`[TokenOps] ⚠️  Could not get decimals for formatting: ${error.message}`);
            }
        }
        
        console.log(`[TokenOps] ✅ Tokens purchased successfully via PumpPortal!`);
        console.log(`[TokenOps]    Transaction: https://solscan.io/tx/${signature}`);
        console.log(`[TokenOps]    Token account: ${associatedTokenAccount.toString()}`);
        if (tokenAccountReady) {
            console.log(`[TokenOps]    Tokens purchased this TX: ${formattedAmount.toLocaleString()} (raw: ${tokensPurchased.toString()})`);
            console.log(`[TokenOps]    Total balance in wallet: ${formattedTotalBalance.toLocaleString()} (raw: ${balanceAfter.toString()})`);
        } else {
            console.log(`[TokenOps]    Token amount: Will be checked during burn operation`);
        }
        
        return {
            success: true,
            signature: signature,
            tokenAmount: tokensPurchased, // Amount we just bought (raw)
            totalBalance: balanceAfter, // Total balance in wallet (raw)
            formattedAmount: formattedAmount, // Amount we just bought (formatted)
            formattedTotalBalance: formattedTotalBalance, // Total balance (formatted)
            tokenAccount: associatedTokenAccount.toString(),
            tokenAccountReady: tokenAccountReady,
            actualTokenAccount: actualTokenAccount.toString()
        };
    } catch (error) {
        console.error('[TokenOps] Error buying token via PumpPortal:', error);
        return { success: false, error: error.message || 'Failed to buy token via PumpPortal' };
    }
}

/**
 * Burns a percentage of tokens
 * @param {string} potWalletPrivateKey - Base58 encoded private key
 * @param {string} potWalletPublicKey - Public key of pot wallet
 * @param {string} tokenMintAddress - Token mint address
 * @param {number} burnPercentage - Percentage to burn (0-100)
 * @param {string} rpcEndpoint - Solana RPC endpoint
 * @param {number} [specificAmount] - Optional: specific raw amount to burn from (if not provided, burns from total balance)
 * @param {string} [tokenAccountAddress] - Optional: token account address (if provided, skips searching for it)
 * @returns {Promise<{success: boolean, signature?: string, burnedAmount?: number, remainingAmount?: number, error?: string}>}
 */
async function burnTokens(potWalletPrivateKey, potWalletPublicKey, tokenMintAddress, burnPercentage, rpcEndpoint, specificAmount = null, tokenAccountAddress = null) {
    try {
        console.log(`[TokenOps] 🔥 Burning ${burnPercentage}% of tokens...`);
        
        // Decode private key
        const keypair = Keypair.fromSecretKey(bs58.default.decode(potWalletPrivateKey));
        const potWalletPublic = new PublicKey(potWalletPublicKey);
        
        // Create connection
        const connection = new Connection(rpcEndpoint, 'confirmed');
        
        const tokenMint = new PublicKey(tokenMintAddress);
        
        let tokenAccountInfo;
        let tokenAccount;
        
        // If token account address is provided, use it directly (avoids unnecessary RPC call)
        if (tokenAccountAddress) {
            console.log(`[TokenOps] ✅ Using provided token account: ${tokenAccountAddress}`);
            tokenAccount = new PublicKey(tokenAccountAddress);
            
            // Get account info to determine program and balance
            let accountInfo;
            let tokenProgramId = TOKEN_PROGRAM_ID;
            try {
                // Try Token-2022 first (pump.fun default)
                try {
                    accountInfo = await getAccount(connection, tokenAccount, 'confirmed', TOKEN_2022_PROGRAM_ID);
                    tokenProgramId = TOKEN_2022_PROGRAM_ID;
                    console.log(`[TokenOps]    Program: Token-2022`);
                } catch (e) {
                    accountInfo = await getAccount(connection, tokenAccount, 'confirmed', TOKEN_PROGRAM_ID);
                    tokenProgramId = TOKEN_PROGRAM_ID;
                    console.log(`[TokenOps]    Program: Token`);
                }
                
                tokenAccountInfo = {
                    amount: accountInfo.amount,
                    programId: tokenProgramId
                };
                console.log(`[TokenOps] ✅ Token balance: ${accountInfo.amount.toString()}`);
            } catch (error) {
                console.error(`[TokenOps] ❌ Could not get account info: ${error.message}`);
                return { 
                    success: false, 
                    error: `Could not get token account info: ${error.message}` 
                };
            }
        } else {
            // Fallback: search for token account (only if not provided)
            console.log('[TokenOps] ⏳ Waiting 2 seconds for token account to be ready...');
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            console.log('[TokenOps] 🔍 Finding token account using getParsedTokenAccountsByOwner...');
            let retries = 2;
            
            while (retries > 0) {
                try {
                    const accounts = await connection.getParsedTokenAccountsByOwner(
                        potWalletPublic,
                        { mint: tokenMint }
                    );
                    
                    if (accounts.value && accounts.value.length > 0) {
                        const account = accounts.value[0];
                        tokenAccount = new PublicKey(account.pubkey);
                        const balance = BigInt(account.account.data.parsed.info.tokenAmount.amount);
                        
                        // Check which program this account uses
                        const accountProgramId = account.account.owner;
                        const isToken2022 = accountProgramId === TOKEN_2022_PROGRAM_ID.toString();
                        
                        tokenAccountInfo = {
                            amount: balance,
                            programId: isToken2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID
                        };
                        
                        console.log(`[TokenOps] ✅ Token account found: ${tokenAccount.toString()}`);
                        console.log(`[TokenOps] ✅ Token balance: ${balance.toString()}`);
                        console.log(`[TokenOps]    Program: ${isToken2022 ? 'Token-2022' : 'Token'}`);
                        break;
                    } else {
                        console.log('[TokenOps] ⚠️  No token accounts found for this mint');
                        retries--;
                        if (retries > 0) {
                            console.log(`[TokenOps] ⏳ Retrying... (${retries} retries left)`);
                            await new Promise(resolve => setTimeout(resolve, 3000));
                        }
                    }
                } catch (error) {
                    retries--;
                    if (retries === 0) {
                        console.error('[TokenOps] ❌ Token account not found after all retries');
                        console.error(`[TokenOps]    Error: ${error.message}`);
                        return { 
                            success: false, 
                            error: 'Token account not found. Tokens may not have been purchased successfully.' 
                        };
                    }
                    console.log(`[TokenOps] ⏳ Error finding token account, retrying... (${retries} retries left)`);
                    await new Promise(resolve => setTimeout(resolve, 3000));
                }
            }
            
            if (!tokenAccountInfo || !tokenAccount) {
                return { 
                    success: false, 
                    error: 'Could not find token account after retries' 
                };
            }
        }
        
        const totalAmount = tokenAccountInfo.amount;
        const totalAmountNumber = Number(totalAmount);
        
        // Determine the amount to calculate burn from
        // If specificAmount is provided, use that (amount we just purchased)
        // Otherwise, use total balance (for backwards compatibility)
        const amountToBurnFrom = specificAmount !== null ? BigInt(specificAmount) : totalAmount;
        const amountToBurnFromNumber = Number(amountToBurnFrom);
        
        console.log(`[TokenOps]    Total tokens in wallet: ${totalAmountNumber.toLocaleString()}`);
        if (specificAmount !== null) {
            console.log(`[TokenOps]    Burning from purchased amount: ${amountToBurnFromNumber.toLocaleString()}`);
        }
        
        // Get token decimals and format amount
        let formattedTotalAmount = totalAmountNumber;
        let formattedBurnFromAmount = amountToBurnFromNumber;
        try {
            const decimals = await getTokenDecimals(connection, tokenMint, tokenAccountInfo.programId);
            formattedTotalAmount = formatTokenAmount(totalAmount, decimals);
            formattedBurnFromAmount = formatTokenAmount(amountToBurnFrom, decimals);
        } catch (error) {
            console.warn(`[TokenOps] ⚠️  Could not get decimals for formatting: ${error.message}`);
        }
        
        console.log(`[TokenOps]    Total tokens in wallet: ${formattedTotalAmount.toLocaleString()} (raw: ${totalAmountNumber.toLocaleString()})`);
        if (specificAmount !== null) {
            console.log(`[TokenOps]    Burning from: ${formattedBurnFromAmount.toLocaleString()} (raw: ${amountToBurnFromNumber.toLocaleString()})`);
        }
        
        if (amountToBurnFromNumber === 0) {
            console.log('[TokenOps] ⚠️  No tokens to burn (amount is 0)');
            return {
                success: true,
                burnedAmount: 0,
                remainingAmount: totalAmountNumber
            };
        }
        
        // Calculate burn amount from the specified amount (or total if not specified)
        const burnAmount = BigInt(Math.floor(amountToBurnFromNumber * (burnPercentage / 100)));
        const remainingAmount = totalAmount - burnAmount; // Remaining in wallet after burn
        
        console.log(`[TokenOps]    Burning: ${burnAmount.toString()} tokens`);
        console.log(`[TokenOps]    Remaining: ${remainingAmount.toString()} tokens`);
        
        if (burnAmount <= 0) {
            console.log('[TokenOps] ⚠️  No tokens to burn (calculated amount is 0)');
            return {
                success: true,
                burnedAmount: 0,
                remainingAmount: totalAmountNumber
            };
        }
        
        // Determine which token program to use from the parsed account data
        let tokenProgramId = TOKEN_PROGRAM_ID;
        let accountInfo;
        
        // Use the program ID we detected from getParsedTokenAccountsByOwner
        if (tokenAccountInfo.programId) {
            tokenProgramId = tokenAccountInfo.programId;
            console.log(`[TokenOps] 🔍 Using ${tokenProgramId.equals(TOKEN_2022_PROGRAM_ID) ? 'Token-2022' : 'Token'} program (detected from account)`);
        } else {
            // Fallback: try Token-2022 first (pump.fun default), then Token
            console.log('[TokenOps] 🔍 Program ID not detected, trying Token-2022 first...');
            tokenProgramId = TOKEN_2022_PROGRAM_ID;
        }
        
        // Verify the token account with the correct program
        // Since we already have the balance from getParsedTokenAccountsByOwner, we can skip verification
        // and just use the parsed data. However, we still need accountInfo for the owner.
        console.log('[TokenOps] 🔍 Getting account info for burn operation...');
        
        try {
            accountInfo = await getAccount(connection, tokenAccount, 'confirmed', tokenProgramId);
            console.log(`[TokenOps] ✅ Token account verified with ${tokenProgramId.equals(TOKEN_2022_PROGRAM_ID) ? 'Token-2022' : 'Token'} program`);
            console.log(`[TokenOps]    Account owner: ${accountInfo.owner.toString()}`);
            console.log(`[TokenOps]    Account mint: ${accountInfo.mint.toString()}`);
            console.log(`[TokenOps]    Account amount: ${accountInfo.amount.toString()}`);
        } catch (error) {
            // If getAccount fails, try the other program
            console.log(`[TokenOps] ⚠️  Failed with ${tokenProgramId.equals(TOKEN_2022_PROGRAM_ID) ? 'Token-2022' : 'Token'} program: ${error.message}`);
            
            const otherProgram = tokenProgramId.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;
            try {
                accountInfo = await getAccount(connection, tokenAccount, 'confirmed', otherProgram);
                tokenProgramId = otherProgram;
                console.log(`[TokenOps] ✅ Token account verified with ${tokenProgramId.equals(TOKEN_2022_PROGRAM_ID) ? 'Token-2022' : 'Token'} program`);
                console.log(`[TokenOps]    Account owner: ${accountInfo.owner.toString()}`);
                console.log(`[TokenOps]    Account mint: ${accountInfo.mint.toString()}`);
                console.log(`[TokenOps]    Account amount: ${accountInfo.amount.toString()}`);
            } catch (error2) {
                console.error('[TokenOps] ❌ Could not get account info with either program');
                console.error(`[TokenOps]    Token-2022 error: ${error.message}`);
                console.error(`[TokenOps]    Token error: ${error2.message}`);
                
                // If we can't get account info, we can still try to burn using the parsed data
                // We'll use potWalletPublic as authority (should work for associated token accounts)
                console.log('[TokenOps] ⚠️  Will attempt burn using parsed account data');
                accountInfo = {
                    owner: new PublicKey(potWalletPublicKey),
                    mint: tokenMint,
                    amount: tokenAccountInfo.amount
                };
            }
        }
        
        // Verify mint matches
        if (accountInfo.mint.toString() !== tokenMint.toString()) {
            console.error('[TokenOps] ❌ Token account mint does not match expected mint!');
            return { 
                success: false, 
                error: 'Token account mint mismatch' 
            };
        }
        
        // Verify balance
        if (accountInfo.amount < burnAmount) {
            console.error(`[TokenOps] ❌ Insufficient balance to burn!`);
            console.error(`[TokenOps]    Available: ${accountInfo.amount.toString()}`);
            console.error(`[TokenOps]    Requested: ${burnAmount.toString()}`);
            return { 
                success: false, 
                error: 'Insufficient token balance to burn' 
            };
        }
        
        // Create burn instruction using the correct token program
        // The authority must be the owner of the token account (which should be potWalletPublic)
        console.log('[TokenOps] 🔥 Creating burn instruction...');
        console.log(`[TokenOps]    Token account: ${tokenAccount.toString()}`);
        console.log(`[TokenOps]    Token mint: ${tokenMint.toString()}`);
        console.log(`[TokenOps]    Token program: ${tokenProgramId.equals(TOKEN_2022_PROGRAM_ID) ? 'Token-2022' : 'Token'}`);
        console.log(`[TokenOps]    Account owner: ${accountInfo.owner.toString()}`);
        console.log(`[TokenOps]    Pot wallet: ${potWalletPublic.toString()}`);
        console.log(`[TokenOps]    Amount: ${burnAmount.toString()}`);
        
        // Use the account owner as authority (should match potWalletPublic for associated token accounts)
        const burnAuthority = accountInfo.owner;
        
        const burnInstruction = createBurnInstruction(
            tokenAccount,
            tokenMint,
            burnAuthority, // Use the account owner as authority
            burnAmount,
            [], // No multiSigners
            tokenProgramId // Use the correct program ID
        );
        
        // Create transaction
        const transaction = new Transaction().add(burnInstruction);
        
        // Get recent blockhash
        const { blockhash } = await connection.getLatestBlockhash('confirmed');
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = potWalletPublic;
        
        // Sign transaction
        console.log('[TokenOps] 🔐 Signing burn transaction...');
        transaction.sign(keypair);
        
        // Send transaction (skip preflight to avoid simulation issues)
        console.log('[TokenOps] 📤 Sending burn transaction...');
        const signature = await sendAndConfirmTransaction(
            connection,
            transaction,
            [keypair],
            {
                commitment: 'confirmed',
                skipPreflight: true // Skip preflight to avoid simulation errors
            }
        );
        
        // Get token decimals and format amounts
        let formattedBurnedAmount = Number(burnAmount);
        let formattedRemainingAmount = Number(remainingAmount);
        try {
            const decimals = await getTokenDecimals(connection, tokenMint, tokenAccountInfo.programId);
            formattedBurnedAmount = formatTokenAmount(burnAmount, decimals);
            formattedRemainingAmount = formatTokenAmount(remainingAmount, decimals);
        } catch (error) {
            console.warn(`[TokenOps] ⚠️  Could not get decimals for formatting: ${error.message}`);
        }
        
        console.log(`[TokenOps] ✅ Tokens burned successfully!`);
        console.log(`[TokenOps]    Transaction: https://solscan.io/tx/${signature}`);
        console.log(`[TokenOps]    Burned: ${formattedBurnedAmount.toLocaleString()} tokens (raw: ${burnAmount.toString()})`);
        console.log(`[TokenOps]    Remaining: ${formattedRemainingAmount.toLocaleString()} tokens (raw: ${remainingAmount.toString()})`);
        
        return {
            success: true,
            signature: signature,
            burnedAmount: Number(burnAmount), // Keep raw for calculations
            formattedBurnedAmount: formattedBurnedAmount, // Add formatted for display
            remainingAmount: Number(remainingAmount), // Keep raw for calculations
            formattedRemainingAmount: formattedRemainingAmount // Add formatted for display
        };
    } catch (error) {
        console.error('[TokenOps] Error burning tokens:', error);
        return { success: false, error: error.message || 'Failed to burn tokens' };
    }
}

/**
 * Distributes tokens to winners evenly
 * @param {string} potWalletPrivateKey - Base58 encoded private key
 * @param {string} tokenMintAddress - Token mint address
 * @param {string} tokenAccountAddress - Token account address
 * @param {Array<{playerId: string, publicWallet: string}>} winners - Array of winner objects with publicWallet
 * @param {number} totalTokens - Total tokens to distribute
 * @param {string} rpcEndpoint - Solana RPC endpoint
 * @returns {Promise<{success: boolean, signatures?: string[], error?: string}>}
 */
async function distributeTokensToWinners(potWalletPrivateKey, tokenMintAddress, tokenAccountAddress, winners, totalTokens, rpcEndpoint) {
    try {
        if (!winners || winners.length === 0) {
            console.log('[TokenOps] ⚠️  No winners to distribute tokens to');
            return { success: true, signatures: [] };
        }
        
        console.log(`[TokenOps] 🎁 Distributing tokens to ${winners.length} winners...`);
        console.log(`[TokenOps]    Expected total tokens: ${totalTokens.toLocaleString()}`);
        
        // Decode private key
        const keypair = Keypair.fromSecretKey(bs58.default.decode(potWalletPrivateKey));
        const potWalletPublic = keypair.publicKey;
        
        // Create connection
        const connection = new Connection(rpcEndpoint, 'confirmed');
        
        const tokenMint = new PublicKey(tokenMintAddress);
        const sourceTokenAccount = new PublicKey(tokenAccountAddress);
        
        // Verify actual token account balance and detect program
        console.log('[TokenOps] 🔍 Verifying token account balance...');
        let actualBalance = BigInt(0);
        let tokenProgramId = TOKEN_PROGRAM_ID;
        
        try {
            // Try to get account with Token-2022 first (pump.fun default)
            try {
                const accountInfo = await getAccount(connection, sourceTokenAccount, 'confirmed', TOKEN_2022_PROGRAM_ID);
                actualBalance = accountInfo.amount;
                tokenProgramId = TOKEN_2022_PROGRAM_ID;
                console.log(`[TokenOps] ✅ Token account balance (Token-2022): ${actualBalance.toString()}`);
            } catch (e) {
                // Try standard Token program
                try {
                    const accountInfo = await getAccount(connection, sourceTokenAccount, 'confirmed', TOKEN_PROGRAM_ID);
                    actualBalance = accountInfo.amount;
                    tokenProgramId = TOKEN_PROGRAM_ID;
                    console.log(`[TokenOps] ✅ Token account balance (Token): ${actualBalance.toString()}`);
                } catch (e2) {
                    console.error('[TokenOps] ❌ Could not get token account balance');
                    return { success: false, error: 'Could not verify token account balance' };
                }
            }
        } catch (error) {
            console.error('[TokenOps] ❌ Error getting token account balance:', error);
            return { success: false, error: `Failed to get token account balance: ${error.message}` };
        }
        
        // Use actual balance if it's less than expected (safety check)
        const tokensToDistribute = actualBalance < BigInt(totalTokens) ? actualBalance : BigInt(totalTokens);
        
        // Get token decimals for formatting (store in variable for reuse)
        let tokenDecimals = 6; // Default
        try {
            tokenDecimals = await getTokenDecimals(connection, tokenMint, tokenProgramId);
        } catch (error) {
            console.warn(`[TokenOps] ⚠️  Could not get decimals for formatting: ${error.message}`);
        }
        
        // Format amount for display
        const formattedDistributeAmount = formatTokenAmount(tokensToDistribute, tokenDecimals);
        
        console.log(`[TokenOps]    Tokens to distribute: ${formattedDistributeAmount.toLocaleString()} (raw: ${tokensToDistribute.toString()})`);
        
        if (tokensToDistribute === BigInt(0)) {
            console.log('[TokenOps] ⚠️  No tokens available to distribute');
            return { success: true, signatures: [], formattedDistributedAmount: 0, message: 'No tokens in account' };
        }
        
        // Calculate amount per winner
        const tokensPerWinner = tokensToDistribute / BigInt(winners.length);
        const remainder = tokensToDistribute % BigInt(winners.length);
        
        const formattedPerWinner = formatTokenAmount(tokensPerWinner, tokenDecimals);
        console.log(`[TokenOps]    Tokens per winner: ${formattedPerWinner.toLocaleString()} (raw: ${tokensPerWinner.toString()})`);
        if (remainder > 0) {
            const formattedRemainder = formatTokenAmount(remainder, tokenDecimals);
            console.log(`[TokenOps]    Remainder (will be kept in pot): ${formattedRemainder.toLocaleString()} (raw: ${remainder.toString()})`);
        }
        
        const signatures = [];
        
        // Distribute to each winner
        for (let i = 0; i < winners.length; i++) {
            const winner = winners[i];
            if (!winner.publicWallet) {
                console.warn(`[TokenOps] ⚠️  Winner ${winner.playerId} has no public wallet, skipping`);
                continue;
            }
            
            try {
                const winnerPublicKey = new PublicKey(winner.publicWallet);
                
                // Get or create associated token account for winner
                // IMPORTANT: Use the correct token program ID when deriving the address
                const winnerTokenAccount = await getAssociatedTokenAddress(
                    tokenMint,
                    winnerPublicKey,
                    false, // allowOwnerOffCurve
                    tokenProgramId, // Use the detected program ID for derivation
                    ASSOCIATED_TOKEN_PROGRAM_ID
                );
                
                console.log(`[TokenOps]    Winner token account: ${winnerTokenAccount.toString()}`);
                
                // Check if token account exists (using the detected program)
                let tokenAccountExists = false;
                try {
                    await getAccount(connection, winnerTokenAccount, 'confirmed', tokenProgramId);
                    tokenAccountExists = true;
                    console.log(`[TokenOps]    Token account already exists`);
                } catch (e) {
                    // Account doesn't exist, will create it
                    console.log(`[TokenOps]    Token account does not exist, will create it`);
                }
                
                // Create transaction
                const transaction = new Transaction();
                
                // Add instruction to create associated token account if needed
                // Use idempotent instruction to avoid errors if account already exists
                if (!tokenAccountExists) {
                    transaction.add(
                        createAssociatedTokenAccountIdempotentInstruction(
                            potWalletPublic,
                            winnerTokenAccount,
                            winnerPublicKey,
                            tokenMint,
                            tokenProgramId, // Use the detected program ID
                            ASSOCIATED_TOKEN_PROGRAM_ID
                        )
                    );
                }
                
                // Add transfer instruction
                // For the last winner, add any remainder to ensure all tokens are distributed
                const transferAmount = (i === winners.length - 1 && remainder > 0) 
                    ? tokensPerWinner + remainder 
                    : tokensPerWinner;
                
                transaction.add(
                    createTransferInstruction(
                        sourceTokenAccount,
                        winnerTokenAccount,
                        potWalletPublic,
                        transferAmount,
                        [], // No multiSigners
                        tokenProgramId // Use the detected program ID
                    )
                );
                
                // Get recent blockhash
                const { blockhash } = await connection.getLatestBlockhash('confirmed');
                transaction.recentBlockhash = blockhash;
                transaction.feePayer = potWalletPublic;
                
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
                
                signatures.push(signature);
                console.log(`[TokenOps] ✅ Sent ${tokensPerWinner.toString()} tokens to ${winner.publicWallet}`);
                console.log(`[TokenOps]    TX: https://solscan.io/tx/${signature}`);
                
                // Small delay between transactions
                await new Promise(resolve => setTimeout(resolve, 500));
            } catch (error) {
                console.error(`[TokenOps] ❌ Error sending tokens to ${winner.publicWallet}:`, error);
                // Continue with other winners
            }
        }
        
        console.log(`[TokenOps] ✅ Distribution complete! Sent tokens to ${signatures.length} winners`);
        
        // Calculate total distributed (tokensToDistribute minus any remainder)
        const totalDistributed = tokensToDistribute - remainder;
        
        // Get formatted amount for return - always recalculate from totalDistributed to ensure accuracy
        let formattedDistributedAmount = 0;
        try {
            // Use the same decimals we got earlier
            formattedDistributedAmount = formatTokenAmount(totalDistributed, tokenDecimals);
        } catch (error) {
            console.warn(`[TokenOps] ⚠️  Could not format distributed amount: ${error.message}`);
            // Fallback: calculate from per-winner amount
            const formattedPerWinner = formatTokenAmount(tokensPerWinner, tokenDecimals);
            formattedDistributedAmount = Number(formattedPerWinner) * winners.length;
        }
        
        console.log(`[TokenOps]    Total distributed: ${formattedDistributedAmount.toLocaleString()} (raw: ${totalDistributed.toString()})`);
        
        return {
            success: true,
            signatures: signatures,
            distributedAmount: Number(totalDistributed), // Keep raw for calculations
            formattedDistributedAmount: formattedDistributedAmount // Add formatted for display
        };
    } catch (error) {
        console.error('[TokenOps] Error distributing tokens:', error);
        return { success: false, error: error.message || 'Failed to distribute tokens' };
    }
}

module.exports = {
    buySPLToken,
    burnTokens,
    distributeTokensToWinners,
    formatTokenAmount,
    getTokenDecimals
};

