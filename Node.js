/**
 * PGT_Web3_Server_for_Render: Node.js Backend API
 * Handles: 1. Token Holding Verification (Auth) 2. Secure QR Code Ticket Generation
 * Deployed on Render (Public URL: https://my-node-backend-ih5r.onrender.com)
 */
const express = require('express');
const cors = require('cors');
const web3 = require('@solana/web3.js');
const { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } = require('@solana/spl-token');

const app = express();
// Render assigns the port dynamically, so we use process.env.PORT
const PORT = process.env.PORT || 3000; 

// --- Project Configuration (PGT) ---
const PGT_MINT_ADDRESS = new web3.PublicKey('FX9rdswoncAQRTcJZq7pVbJwkD4jXKEbRQLHz3t5utgh'); 
const MIN_REQUIRED_BALANCE = 1; 

// Initialize Solana Connection (using Mainnet-Beta)
const connection = new web3.Connection(web3.clusterApiUrl('mainnet-beta'));

// --- CORS Configuration (Temporary open access for testing) ---
// Allowing all origins (*) to ensure the WordPress domain can connect.
app.use(cors({
    origin: '*', // Allow all origins
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// --- Helper Function: Check PGT Balance ---
async function checkPgtBalance(walletAddressString) {
    let userWalletAddress;
    try {
        userWalletAddress = new web3.PublicKey(walletAddressString);
    } catch (error) {
        throw new Error('Invalid wallet address format.');
    }

    try {
        const associatedTokenAddress = await getAssociatedTokenAddress(
            PGT_MINT_ADDRESS,
            userWalletAddress,
            true,
            TOKEN_PROGRAM_ID
        );

        const tokenAccountInfo = await connection.getTokenAccountBalance(associatedTokenAddress);
        const balance = parseFloat(tokenAccountInfo.value.uiAmountString);
        
        return balance;
    } catch (error) {
        // Return 0 if the token account is not found or other RPC error occurs
        // console.error("Error fetching balance:", error.message);
        return 0;
    }
}


// =================================================================
// 1. Endpoint for Wallet Authentication (Auth)
// =================================================================
app.post('/api/auth/pgt', async (req, res) => {
    const { walletAddress } = req.body;

    if (!walletAddress) {
        return res.status(400).json({ success: false, message: 'آدرس کیف پول ارسال نشده است.' });
    }

    try {
        const balance = await checkPgtBalance(walletAddress);

        if (balance >= MIN_REQUIRED_BALANCE) {
            return res.status(200).json({
                success: true,
                message: 'تأیید موجودی موفقیت‌آمیز بود.',
                balance: balance 
            });
        } else {
            return res.status(401).json({ 
                success: false, 
                message: `حداقل موجودی ${MIN_REQUIRED_BALANCE} توکن PGT برای دسترسی مورد نیاز است. موجودی شما: ${balance}` 
            });
        }

    } catch (error) {
        console.error(`API Error (Auth): ${error.message}`);
        return res.status(500).json({ success: false, message: 'خطای سرور در ارتباط با شبکه سولانا.' });
    }
});


// =================================================================
// 2. Endpoint for QR Code Generation (Secure Ticket)
// =================================================================
app.post('/api/generate-qr', async (req, res) => {
    const { walletAddress, tier } = req.body;
    
    // Quick re-validation (a full secure system would verify token ownership again here)
    if (!walletAddress || !tier) {
        return res.status(400).json({ success: false, message: 'اطلاعات آدرس و Tier ناقص است.' });
    }
    
    const QR_EXPIRY_MINUTES = 5;
    const now = Date.now();
    const expiryTime = now + (QR_EXPIRY_MINUTES * 60 * 1000); // 5 minutes from now
    
    // Create a secure, time-sensitive payload (simulated secure token/ticket)
    const ticketPayload = {
        // In a real security system, this payload would be signed/encrypted.
        wallet: walletAddress,
        tier: tier,
        issued: now,
        expires: expiryTime,
        service: 'PGT_Museum_Access'
    };
    
    // Convert payload to a string (this is the content of the QR Code)
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
    console.log(`\nPGT Auth Server (Node.js) listening on port ${PORT}.`);
    console.log(`-> Public API URL: https://my-node-backend-ih5r.onrender.com`);
});
