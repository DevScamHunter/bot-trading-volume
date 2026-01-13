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
    private initialEthBalance = 0;
    private volumeByPair: Record<string, number> = {};
    usdcBalance: any;
    ethBalance: any;

    constructor(private options?: { onUpdate?: (data: any) => void }, private mock = true) {
        this.provider = new ethers.JsonRpcProvider(process.env.ARB_RPC);
        this.wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, this.provider);

        this.contract = new ethers.Contract(
            process.env.OSTIUM_CONTRACT!, // 0x6D0bA1f9996DBD8885827e1b2e8f6593e7702411 ( add cái này vô OSTIUM_CONTRACT trong file config.ts)
            OSTIUM_ABI,
            this.wallet
        );

        this.usdc = new ethers.Contract(
            BOT_CONFIG.usdcAddress,
            [
                'function approve(address,uint256) external returns (bool)',
                'function balanceOf(address) view returns (uint256)',
                'function allowance(address owner, address spender) view returns (uint256)'
            ],
            this.wallet
        );

    }
    private async updateDashboard() {
        if (this.options?.onUpdate) {
            let usdcBalance = Number(ethers.formatUnits(await this.usdc.balanceOf(this.wallet.address), 6));
            let ethBalance = Number(ethers.formatEther(await this.provider.getBalance(this.wallet.address)));

            this.options.onUpdate({
                tradeCount: this.tradeCount,
                totalVolumeUsd: this.totalVolumeUsd,
                volumeByPair: this.volumeByPair,
                usdcInitial: this.initialUsdcBalance,
                ethInitial: this.initialEthBalance,
                usdc: usdcBalance,
                eth: ethBalance,
            });
        }
    }
    async start() {
        console.log('OSTIUM LONG VOLUME BOT STARTED');
        let raw = await this.usdc.balanceOf(this.wallet.address);
        let balance = Number(ethers.formatUnits(raw, 6));
        console.log(` USDC balance for ${this.wallet.address}: ${balance}`);
        
        if (this.mock) {
            // ===== MOCK =====
            await this.runMockLoop();
        } else {
            // ===== REAL =====
            await this.runRealBot();
        }
    }
    private async runMockLoop() {
        // mock init
        this.tradeCount = 3;
        this.totalVolumeUsd = 1500;
        this.volumeByPair = { 'BTC/USD': 800, 'ETH/USD': 700 };

        // mock số dư
        let mockUsdcInitial = 1000;
        let mockEthInitial = 0.05;

        // gán cho các property lưu lại ban đầu
        this.initialUsdcBalance = mockUsdcInitial;
        this.ethBalance = mockEthInitial;

        // gửi lần đầu cho dashboard
        this.updateDashboardMock(mockUsdcInitial, mockEthInitial);

        while (this.running) {
            await this.sleep(5000);

            // tăng dần trade + volume
            this.tradeCount++;
            this.totalVolumeUsd += 500;
            this.volumeByPair['BTC/USD'] += 300;
            this.volumeByPair['ETH/USD'] += 200;

            // giả lập số dư giảm (ví dụ trừ đi tổng volume USD/ETH tương ứng)
            let currentUsdc = mockUsdcInitial - this.totalVolumeUsd * 0.5 / 1000; // tuỳ mock logic
            let currentEth = mockEthInitial - 0.001; // mock giảm ETH

            this.updateDashboardMock(currentUsdc, currentEth);
        }
    }
    private updateDashboardMock(usdc: number, eth: number) {
        this.options?.onUpdate?.({
            tradeCount: this.tradeCount,
            totalVolumeUsd: this.totalVolumeUsd,
            volumeByPair: this.volumeByPair,
            usdc,                         // số dư hiện tại
            eth,                          // số dư hiện tại
            usdcInitial: this.initialUsdcBalance,  // số dư ban đầu
            ethInitial: this.ethBalance            // số dư ban đầu
        });
    }
    private async runRealBot() {
        this.initialUsdcBalance = Number(ethers.formatUnits(await this.usdc.balanceOf(this.wallet.address), 6));
        await this.approveUsdcIfNeeded();
        await this.updateDashboard();
        while (this.running) {
            let canTrade = await this.checkEthBalance();
            if (!canTrade) {
                await this.sleep(10_000); // chờ ETH
                continue;
            }
            try {
                await this.tradePairsLoop();
                await this.updateDashboard();
            } catch (err) {
                console.error(' Loop error:', err);
                await this.sleep(BOT_CONFIG.retryDelayMs);
            }
        }
    }

    // ===== Mở tất cả các cặp đồng thời =====
    private async tradePairsLoop() {
        for (let pair of OSTIUM_PAIRS) {
            //  Nếu ETH thấp → nghỉ
            let eth = Number(ethers.formatEther(await this.provider.getBalance(this.wallet.address)));
            if (eth < BOT_CONFIG.minEthToTrade) {
                console.warn(` ETH thấp (${eth}), pause bot`);
                await this.sleep(10_000);
                continue;
            }
            await this.tradePair(pair);
            await this.sleep(1500); // nghỉ cho gas nguội
        }
    }

    // ===== Trade a single pair =====
    private async tradePair(pair: { id: number; name: string; maxLeverage: number }) {
        let collateralWei = ethers.parseUnits(
            BOT_CONFIG.collateralUsd.toString(),
            6
        );
        let leverage = pair.maxLeverage;
        console.log(` TRADING ${pair.name} | ${leverage}x`);
        try {
            // ===== OPEN LONG =====
            let ORDER_TYPE_LIMIT = 1;
            let oraclePrice = await this.contract.getPrice(pair.id);
            // let limitPrice = oraclePrice * 10005n / 10000n;
            let tradeId = await this.executeWithRetryTx(async () => {
                await this.contract.openTrade.staticCall(
                    pair.id,
                    true,
                    collateralWei,
                    leverage,
                    ORDER_TYPE_LIMIT,
                );

                //  estimate gas
                let gasEstimate = await this.contract.openTrade.estimateGas(
                    pair.id,
                    true,
                    collateralWei,
                    leverage,
                    ORDER_TYPE_LIMIT,
                );

                //  gửi tx
                let tx = await this.contract.openTrade(
                    pair.id,
                    true,
                    collateralWei,
                    leverage,
                    ORDER_TYPE_LIMIT,
                    {
                        gasLimit: gasEstimate * 110n / 100n
                    }
                );

                let receipt = await tx.wait();
                let id = this.extractTradeId(receipt);
                if (!id) throw new Error('Cannot extract tradeId');
                return id;
            }, BOT_CONFIG.maxRetries, BOT_CONFIG.retryDelayMs);

            // ===== Update stats =====
            this.tradeCount++;
            let tradeVolume = BOT_CONFIG.collateralUsd * leverage;
            this.totalVolumeUsd += tradeVolume;
            this.volumeByPair[pair.name] =
                (this.volumeByPair[pair.name] || 0) + tradeVolume;

            console.log(
                ` LONG #${this.tradeCount} | ${pair.name} | Volume=${tradeVolume}$`
            );
            // ===== HOLD =====
            await this.sleep(BOT_CONFIG.holdTimeMs);
            // ===== CLOSE TRADE =====
            await this.executeWithRetryTx(async () => {
                let gasEstimate =
                    await this.contract.closeTrade.estimateGas(tradeId);

                let tx = await this.contract.closeTrade(tradeId, {
                    gasLimit: gasEstimate * 110n / 100n
                });
                await tx.wait();
            }, BOT_CONFIG.maxRetries, BOT_CONFIG.retryDelayMs);

            console.log(` CLOSED ${pair.name} | tradeId=${tradeId}`);
        } catch (err) {
            console.error(` Trade failed for ${pair.name}:`, err);
        }
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
    private async approveUsdcIfNeeded() {
        let allowance = await this.usdc.allowance(this.wallet.address,process.env.OSTIUM_CONTRACT!);
        let required = ethers.parseUnits(BOT_CONFIG.collateralUsd.toString(),6);
        if (allowance >= required) {
            console.log(' USDC allowance đủ, skip approve');
            return;
        }
        console.log(' Approving USDC...');
        let tx = await this.usdc.approve(process.env.OSTIUM_CONTRACT!,ethers.MaxUint256);
        await tx.wait();
    }

    private async executeWithRetryTx<T>(fn: () => Promise<T>,retries = 3,delayMs = 1000): Promise<T>
    {
        let lastError: any;
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                return await fn();
            } catch (err: any) {
                lastError = err;
                let msg = (err.reason || err.message || '').toLowerCase();
                //  KHÔNG retry
                if (
                    msg.includes('insufficient') ||
                    msg.includes('balance') ||
                    msg.includes('execution reverted')
                ) {
                    throw err;
                }
                console.warn(` Retry ${attempt}/${retries}`);
                await this.sleep(delayMs);
                delayMs *= 2;
            }
        }
        throw lastError;
    }

    async checkEthBalance(): Promise<boolean> {
        let balanceWei = await this.provider.getBalance(this.wallet.address);
        let ethBalance = Number(ethers.formatEther(balanceWei));

        console.log(`ETH balance: ${ethBalance}`);

        if (ethBalance < BOT_CONFIG.minEthToTrade) {
            console.log(`ETH thấp hơn min (${BOT_CONFIG.minEthToTrade}), bot pause`);
            return false;
        }
        return true;
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
