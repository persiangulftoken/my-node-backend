// PGT_Web3_Server: Node.js Backend for PGT Token and QR Code Verification
// This server runs on http://localhost:3000 and handles two main tasks:
// 1. Verifying if a connected Phantom wallet holds the PGT token.
// 2. Generating a time-limited, secured ticket (QR Code payload) based on holding status.

const express = require('express');
const cors = require('cors');
const web3 = require('@solana/web3.js');
const { getAssociatedTokenAddress } = require('@solana/spl-token');

const app = express();
const PORT = 3000;

// --- Project Configuration (PGT) ---
// IMPORTANT: This Mint ID must be the actual PGT token address on Solana Mainnet-Beta.
const PGT_MINT_ADDRESS = new web3.PublicKey('FX9rdswoncAQRTcJZq7pVbJwkD4jXKEbRQLHz3t5utgh'); 
const MIN_REQUIRED_BALANCE = 1; // Minimum PGT required for access (Tier 1)
const QR_EXPIRY_MINUTES = 5;    // QR code validity time

// Middleware
app.use(cors());
app.use(express.json());

// Initialize Solana Connection (using Mainnet-Beta as requested)
const connection = new web3.Connection(web3.clusterApiUrl('mainnet-beta'));
const TOKEN_PROGRAM_ID = new web3.PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

// =================================================================
// 1. Endpoint for Wallet Authentication (Check Token Balance)
// =================================================================
app.post('/api/auth/pgt', async (req, res) => {
    const { walletAddress } = req.body;

    if (!walletAddress) {
        return res.status(400).json({ success: false, message: 'آدرس کیف پول ارسال نشده است.' });
    }

    let userWalletAddress;
    try {
        userWalletAddress = new web3.PublicKey(walletAddress);
    } catch (error) {
        return res.status(400).json({ success: false, message: 'فرمت آدرس کیف پول معتبر نیست.' });
    }

    try {
        // 1. Calculate Associated Token Account (ATA)
        const associatedTokenAddress = await getAssociatedTokenAddress(
            PGT_MINT_ADDRESS,
            userWalletAddress,
            true, // allowOwnerOffCurve
            TOKEN_PROGRAM_ID
        );

        // 2. Fetch token account balance
        const tokenAccountInfo = await connection.getTokenAccountBalance(associatedTokenAddress);
        const balance = parseFloat(tokenAccountInfo.value.uiAmountString);
        
        // 3. Verification check
        if (balance >= MIN_REQUIRED_BALANCE) {
            return res.json({ 
                success: true, 
                message: 'تأیید موجودی موفقیت‌آمیز بود.',
                balance: balance 
            });
        } else {
            return res.status(401).json({ 
                success: false, 
                message: `توکن PGT در کیف پول شما یافت نشد یا موجودی کمتر از ${MIN_REQUIRED_BALANCE} است.` 
            });
        }
    } catch (error) {
        // This usually catches if the ATA does not exist at all (wallet never held the token)
        return res.status(404).json({ 
            success: false, 
            message: 'حساب توکن PGT برای این آدرس پیدا نشد.' 
        });
    }
});

// =================================================================
// 2. Endpoint for QR Code Generation (Secure Ticket)
// =================================================================
app.post('/api/generate-qr', async (req, res) => {
    const { walletAddress, tier } = req.body;
    
    if (!walletAddress || !tier) {
        return res.status(400).json({ success: false, message: 'اطلاعات آدرس و Tier ناقص است.' });
    }
    
    // In a real application, you would re-verify the token balance here.
    // For this simulation, we trust the client to send the correct info after login.
    
    const now = Date.now();
    const expiryTime = now + (QR_EXPIRY_MINUTES * 60 * 1000); // 5 minutes from now
    
    // 1. Create a secure, time-sensitive payload (simulated JWT/Ticket)
    const ticketPayload = {
        // In a real-world scenario, this payload would be securely signed (JWT)
        // using a private key known only to the server.
        wallet: walletAddress,
        tier: tier,
        issued: now,
        expires: expiryTime,
        service: 'PGT_Museum_Access'
    };
    
    // 2. Convert payload to a string (which will be the content of the QR Code)
    const ticketString = JSON.stringify(ticketPayload);

    return res.json({
        success: true,
        message: `کد دسترسی با موفقیت تولید شد. انقضا: ${QR_EXPIRY_MINUTES} دقیقه.`,
        qrData: ticketString,
        expiresAt: expiryTime
    });
});

// Start the server
app.listen(PORT, () => {
    console.log(`\nPGT Auth Server (Node.js) در پورت ${PORT} فعال شد.`);
    console.log(`-> آدرس توکن PGT: ${PGT_MINT_ADDRESS.toBase58()}`);
    console.log(`-> شبکه: Mainnet-Beta\n`);
});
