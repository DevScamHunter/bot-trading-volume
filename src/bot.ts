import { ethers } from 'ethers';
import { BOT_CONFIG, OSTIUM_PAIRS } from './config.js';
import { OSTIUM_ABI } from './abi/ostium.abi.js';

export class OstiumVolumeBot {
    private provider: ethers.JsonRpcProvider;
    private wallet: ethers.Wallet;
    private contract: ethers.Contract;
    private usdc: ethers.Contract;

    private running = true;
    private tradeCount = 0;
    private totalVolumeUsd = 0;

    // ===== New: store USDC info =====
    private initialUsdcBalance = 0;
    private volumeByPair: Record<string, number> = {};

    constructor() {
        this.provider = new ethers.JsonRpcProvider(process.env.ARB_RPC);
        this.wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, this.provider);

        this.contract = new ethers.Contract(
            process.env.OSTIUM_CONTRACT!, // 0x6D0bA1f9996DBD8885827e1b2e8f6593e7702411 ( add cái này vô OSTIUM_CONTRACT trong file config.ts)
            OSTIUM_ABI,
            this.wallet
        );

        this.usdc = new ethers.Contract(
            BOT_CONFIG.usdcAddress,
            ['function approve(address,uint256) external returns (bool)', 'function balanceOf(address) view returns (uint256)'],
            this.wallet
        );
    }

    async start() {
        console.log(' OSTIUM LONG VOLUME BOT STARTED');

        // ===== Lấy USDC ban đầu =====
        this.initialUsdcBalance = Number(
            ethers.formatUnits(await this.usdc.balanceOf(this.wallet.address), 6)
        );
        console.log('USDC ban đầu:', this.initialUsdcBalance);

        await this.checkEthBalance();
        await this.approveUsdc();

        while (this.running) {
            try {
                await this.tradePairsLoop();
            } catch (err) {
                console.error('Error / revert, retry...', err);
                await this.sleep(BOT_CONFIG.retryDelayMs);
            }
        }
    }
    // ===== Mở tất cả các cặp đồng thời =====
    private async tradePairsLoop() {
        let tradePromises = OSTIUM_PAIRS.map(pair => this.tradePair(pair));
        await Promise.all(tradePromises); // chạy cùng lúc 4 cặp
    }

    // ===== Trade a single pair =====
    private async tradePair(pair: { id: number; name: string; maxLeverage: number }) {
        let collateralWei = ethers.parseUnits(BOT_CONFIG.collateralUsd.toString(), 6);
        let leverage = pair.maxLeverage;

        console.log(` TRADING ${pair.name} | ${leverage}x`);

        try {
            // ===== OPEN LONG =====
            let tradeId = await this.executeWithRetryTx(async () => {
                let gasEstimate = await this.contract.estimateGas('openTrade',pair.id, true, collateralWei, leverage, 0);
                let tx = await this.contract.openTrade(pair.id, true, collateralWei, leverage, 0, {
                    gasLimit: gasEstimate * 120n / 100n
                });
                let receipt = await tx.wait();
                let id = this.extractTradeId(receipt);
                if (!id) throw new Error('Cannot extract tradeId');
                return id;
            }, BOT_CONFIG.maxRetries, BOT_CONFIG.retryDelayMs);

            // ===== Update stats =====
            this.tradeCount++;
            let tradeVolume = BOT_CONFIG.collateralUsd * leverage;
            this.totalVolumeUsd += tradeVolume;
            this.volumeByPair[pair.name] = (this.volumeByPair[pair.name] || 0) + tradeVolume;

            console.log(` LONG #${this.tradeCount} | ${pair.name} | Volume=${tradeVolume}$`);

            // ===== HOLD =====
            await this.sleep(BOT_CONFIG.holdTimeMs);

            // ===== CLOSE TRADE =====
            await this.executeWithRetryTx(async () => {
                let gasEstimate = await this.contract.estimateGas('closeTrade',tradeId);
                let tx = await this.contract.closeTrade(tradeId, { gasLimit: gasEstimate * 120n / 100n });
                await tx.wait();
            }, BOT_CONFIG.maxRetries, BOT_CONFIG.retryDelayMs);

            console.log(` CLOSED ${pair.name} | tradeId=${tradeId}`);
        } catch (err) {
            console.error(` Trade failed for ${pair.name}:`, err);
            // chỉ log, không throw → các cặp khác vẫn chạy
        }
    }

    // ===== USDC Approval =====
    private async approveUsdc() {
        console.log(' Approving USDC...');
        let tx = await this.usdc.approve(process.env.OSTIUM_CONTRACT!, ethers.MaxUint256);
        await tx.wait();
        console.log(' USDC approved');
    }

    private extractTradeId(receipt: ethers.TransactionReceipt): number | null {
        for (let log of receipt.logs) {
            try {
                let parsed = this.contract.interface.parseLog(log);
                if (parsed?.name === 'TradeOpened') return Number(parsed.args.tradeId);
            } catch { }
        }
        return null;
    }
    private async executeWithRetryTx<T>(
        fn: () => Promise<T>,
        retries = 3,
        delayMs = 1000
    ): Promise<T> {
        let lastError: any;
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                return await fn();
            } catch (err: any) {
                lastError = err;

                // Lọc lỗi không nên retry
                let msg = (err.reason || err.message || '').toLowerCase();
                if (msg.includes('insufficient funds') || msg.includes('balance')) {
                    console.error(' Cannot retry due to insufficient balance:', err);
                    throw err; // không retry nữa
                }

                console.warn(` Attempt ${attempt} failed, retrying in ${delayMs}ms...`, err);
                await this.sleep(delayMs);
                delayMs *= 2; // exponential backoff
            }
        }
        throw new Error(` Max retries reached. Last error: ${lastError}`);
    }

    async checkEthBalance() {
        let balance = await this.provider.getBalance(this.wallet.address);
        let eth = Number(ethers.formatEther(balance));

        if (eth < 0.003) throw new Error(`Đéo đủ tiền : ${eth}`);
        console.log(` ETH balance: ${eth}`);
    }

    // ===== Stop bot & full report =====
    async stopAndReport() {
        this.running = false;

        let balanceEth = ethers.formatEther(await this.provider.getBalance(this.wallet.address));
        let usdcRemaining = Number(ethers.formatUnits(await this.usdc.balanceOf(this.wallet.address), 6));

        console.log('====== DAILY REPORT ======');
        console.log('Trades executed:', this.tradeCount);
        console.log('Volume by pair:', this.volumeByPair);
        console.log('Total volume (USD):', this.totalVolumeUsd);
        console.log('Initial USDC balance:', this.initialUsdcBalance);
        console.log('USDC remaining:', usdcRemaining);
        console.log('Wallet balance (ETH):', balanceEth);
        console.log('==========================');

        process.exit(0);
    }

    private sleep(ms: number) {
        return new Promise(res => setTimeout(res, ms));
    }
}
