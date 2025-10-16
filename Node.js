/**
 * PGT_Web3_Server_with_Firestore: Node.js Backend API
 * Handles: 1. Token Holding Verification (Auth) 2. Secure Unique Ticket Distribution (Firestore)
 * Deployed on Render.
 */
const express = require('express');
const cors = require('cors');
const web3 = require('@solana/web3.js');
const { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const admin = require('firebase-admin');

const app = express();
// Render assigns the port dynamically, so we use process.env.PORT
const PORT = process.env.PORT || 3000; 

// --- 1. FIREBASE SETUP ---
// FIREBASE_CREDENTIALS must be set as an Environment Variable in Render
if (process.env.FIREBASE_CREDENTIALS) {
    // Attempt to parse the credentials JSON stored in the environment variable
    try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    } catch (e) {
        console.error("FIREBASE_CREDENTIALS parse error. Ensure the JSON is correctly formatted and not escaped.");
        console.error(e);
        // Do not proceed with Firestore if initialization fails
    }
} else {
    console.error("FIREBASE_CREDENTIALS environment variable is not set. Firestore will not work.");
}

const db = admin.firestore();
const ticketsCollection = db.collection('tickets'); // Collection name used: 'tickets'

// --- 2. PROJECT CONFIGURATION (PGT) ---
const PGT_MINT_ADDRESS = new web3.PublicKey('FX9rdswoncAQRTcJZq7pVbJwkD4jXKEbRQLHz3t5utgh'); 
const MIN_REQUIRED_BALANCE = 1; 

// Initialize Solana Connection (using Mainnet-Beta)
const connection = new web3.Connection(web3.clusterApiUrl('mainnet-beta'));

// Define Tier thresholds for validation (must match frontend logic)
const TIER_MAPPING = {
    // Add all required museum IDs and their required tiers here
    saadabad_palace: 'Silver' // Example: Saadabad requires Silver tier
};

// --- 3. CORS Configuration ---
const corsOptions = {
    // Allowing all origins for easy debugging. FOR PRODUCTION, change '*' to your WordPress URL!
    origin: '*', 
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
    optionsSuccessStatus: 204
};
app.use(cors(corsOptions));
app.use(express.json());

// --- 4. Helper Function: Check PGT Balance ---
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
        return 0;
    }
}

// --- 5. Helper Function: Determine Tier for Server-Side Validation ---
// Note: This logic must match the frontend logic
const getCurrentTierLevel = (balance) => {
    // PGT price: $0.0003
    const TIER_THRESHOLDS = {
        SILVER: 333334,
        GOLD: 1666667,
        PLATINUM: 3333334
    };
    if (balance >= TIER_THRESHOLDS.PLATINUM) return 'Platinum';
    if (balance >= TIER_THRESHOLDS.GOLD) return 'Gold';
    if (balance >= TIER_THRESHOLDS.SILVER) return 'Silver';
    return 'Base';
};

// =================================================================
// 6. Endpoint for Wallet Authentication (Auth)
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
// 7. Endpoint for Claiming Unique Tickets (Firestore)
// =================================================================
app.post('/api/claim-ticket', async (req, res) => {
    const { walletAddress, museumId, tier } = req.body;
    
    if (!walletAddress || !museumId || !tier) {
        return res.status(400).json({ success: false, message: 'اطلاعات آدرس، موزه یا Tier ناقص است.' });
    }

    try {
        // Validation Check 1: Tier Qualification
        const requiredTier = TIER_MAPPING[museumId];
        
        // Simple Tier Check (Base is the lowest, Silver is higher)
        if (requiredTier && (tier !== requiredTier && tier !== 'Gold' && tier !== 'Platinum')) {
            return res.status(403).json({ success: false, message: `شما به Tier ${requiredTier} برای دریافت این بلیط نیاز دارید.` });
        }
        
        // --- Find and Claim an Available Ticket (Transactional Write) ---
        
        // 1. Search for an available ticket for this museum
        const availableTicketQuery = ticketsCollection
            .where('museumId', '==', museumId)
            .where('status', '==', 'available')
            .limit(1);

        const snapshot = await availableTicketQuery.get();

        if (snapshot.empty) {
            return res.status(404).json({ success: false, message: 'متأسفانه، موجودی بلیط این موزه به پایان رسیده است.' });
        }
        
        const ticketDoc = snapshot.docs[0];
        const ticketRef = ticketDoc.ref;
        const ticketData = ticketDoc.data();

        // 2. Claim the ticket in a Transaction (ensures atomicity)
        await db.runTransaction(async (t) => {
            const doc = await t.get(ticketRef);
            
            // Re-check: Was it claimed milliseconds ago?
            if (doc.data().status !== 'available') {
                throw new Error('Claimed by another user.');
            }

            // Update the document status and assign it to the user
            t.update(ticketRef, { 
                status: 'claimed', 
                assignedTo: walletAddress,
                assignedTime: admin.firestore.FieldValue.serverTimestamp()
            });
        });

        // 3. Return the unique ticket code
        return res.status(200).json({
            success: true,
            message: 'بلیط یکتای شما با موفقیت توزیع شد.',
            ticketCode: ticketData.code,
            museumName: ticketData.museumName || 'بلیط موزه'
        });

    } catch (error) {
        console.error('Ticket Claim Error:', error);
        if (error.message === 'Claimed by another user.') {
             return res.status(409).json({ success: false, message: 'در لحظه درخواست شما، این بلیط توزیع شد. لطفاً دوباره تلاش کنید.' });
        }
        return res.status(500).json({ success: false, message: 'خطای سرور در ارتباط با دیتابیس (Firestore).' });
    }
});


// Start the server
app.listen(PORT, () => {
    console.log(`\nPGT Auth Server (Node.js) listening on port ${PORT}.`);
    console.log(`-> Public API URL: https://my-node-backend-ih5r.onrender.com`);
});
