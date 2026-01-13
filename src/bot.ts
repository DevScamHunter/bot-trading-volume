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
        let balanceWei = await this.provider.getBalance(this.wallet.address);
        let balance = Number(ethers.formatUnits(raw, 6));
        let ethBalance = Number(ethers.formatEther(balanceWei));

        console.log(`ETH balance: ${ethBalance}`);
        console.log(` USDC balance for ${this.wallet.address}: ${balance}`);
        await this.runRealBot();
        
        // if (this.mock) {
        //     // ===== MOCK =====
        //     await this.runMockLoop();
        // } else {
        //     // ===== REAL =====
        // }
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
            const check = await this.canTrade(pair);
            if (!check.ok) {
                console.warn(`Cannot trade ${pair.name}: ${check.reason}`);
                continue; // skip pair này
            }

            await this.tradePair(pair);
            await this.sleep(1500);
        }
    }
    private async canTrade(pair: { id: number; name: string; maxLeverage: number }): Promise<{ok: boolean; reason?: string}> {
        //  Check ETH
        const ethBalance = Number(ethers.formatEther(await this.provider.getBalance(this.wallet.address)));
        if (ethBalance < BOT_CONFIG.minEthToTrade) {
            return { ok: false, reason: `ETH thấp (${ethBalance} < ${BOT_CONFIG.minEthToTrade})` };
        }

        //  Check USDC
        const usdcBalance = Number(ethers.formatUnits(await this.usdc.balanceOf(this.wallet.address), 6));
        if (usdcBalance < BOT_CONFIG.collateralUsd) {
            return { ok: false, reason: `USDC thấp (${usdcBalance} < ${BOT_CONFIG.collateralUsd})` };
        }

        //  Check leverage
        if (pair.maxLeverage < 1) {
            return { ok: false, reason: `Leverage không hợp lệ (${pair.maxLeverage})` };
        }

        return { ok: true }; // OK để trade
    }


    // ===== Trade a single pair =====
    private async tradePair(pair: { id: number; name: string; maxLeverage: number }) {
        const check = await this.canTrade(pair);
        if (!check.ok) {
            console.warn(`Cannot trade ${pair.name}: ${check.reason}`);
            return; // bỏ qua pair này
        }
        let collateralWei = ethers.parseUnits(BOT_CONFIG.collateralUsd.toString(), 6); 

        let leverage = pair.maxLeverage;
        console.log(` TRADING ${pair.name} | ${leverage}x`);
        try {
            // ===== OPEN LONG =====
            let ORDER_TYPE_LIMIT = 0;
            let tradeId = await this.executeWithRetryTx(async () => {
                await this.contract.openTrade.staticCall(
                    pair.id,
                    true,
                    collateralWei,
                    leverage,
                    ORDER_TYPE_LIMIT,
                );

                 // estimate gas
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
    // ===================== FULL DIAGNOSE OPENTRADE =====================
    async diagnoseOpenTrade(pair: { id: number; name: string; maxLeverage: number }) {
        console.log('================== DIAGNOSE OPEN TRADE ==================');
        console.log('Pair:', pair.name, 'ID:', pair.id);

        // 1️⃣ Lấy balance & allowance
        try {
            const balanceRaw = await this.usdc.balanceOf(this.wallet.address);
            const allowanceRaw = await this.usdc.allowance(this.wallet.address, process.env.OSTIUM_CONTRACT!);
            const ethBalance = await this.provider.getBalance(this.wallet.address);

            const balance = Number(ethers.formatUnits(balanceRaw, 6));
            const allowance = Number(ethers.formatUnits(allowanceRaw, 6));
            const eth = Number(ethers.formatEther(ethBalance));

            console.log('[BALANCE CHECK]');
            console.log('USDC balance:', balance);
            console.log('USDC allowance:', allowance);
            console.log('ETH balance:', eth);

            if (balance < BOT_CONFIG.collateralUsd) {
                console.warn(`⚠️ Balance < collateral (${BOT_CONFIG.collateralUsd}) → cannot trade`);
            }
            if (allowance < BOT_CONFIG.collateralUsd) {
                console.warn(`⚠️ Allowance < collateral → must approve`);
            }
            if (eth < 0.0001) {
                console.warn('⚠️ ETH too low for fees');
            }
        } catch (err) {
            console.error('Error fetching balance/allowance:', err);
        }

        // 2️⃣ Log raw params
        const pairId = BigInt(pair.id);
        const isLong = true;
        const collateral = ethers.parseUnits(BOT_CONFIG.collateralUsd.toString(), 6);
        const leverage = BigInt(pair.maxLeverage);
        const orderType = 0; // LIMIT / MARKET

        console.log('[PARAMS]', { pairId, isLong, collateral: collateral.toString(), leverage, orderType });

        // 3️⃣ estimateGas
        try {
            const gasEstimate = await this.contract.openTrade.estimateGas(pairId, isLong, collateral, leverage, orderType);
            console.log('[estimateGas OK]', gasEstimate.toString());
        } catch (err: any) {
            console.error('❌ estimateGas FAILED', err);
            if (err?.error?.data) console.log('revert data:', err.error.data);
        }

        // 4️⃣ staticCall
        try {
            await this.contract.openTrade.staticCall(pairId, isLong, collateral, leverage, orderType);
            console.log('✅ staticCall OK → can send tx');
        } catch (err: any) {
            console.error('❌ staticCall FAILED', err);
            if (err?.error?.data) console.log('revert data:', err.error.data);
        }

        // 5️⃣ Check common contract requires (manual check)
        console.log('⚠️ Manual checks:');
        console.log('- Pair disabled / paused?');
        console.log('- Collateral < minTradeSize?');
        console.log('- Leverage outside allowed range?');
        console.log('- Market closed / outside trading hours?');
        console.log('- User not registered / not approved?');

        // 6️⃣ Optional: if you have hardhat/anvil fork
        console.log('💡 Tip: use fork + trace to see exact require failing');
        console.log('=======================================================');
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
