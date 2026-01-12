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
            process.env.OSTIUM_CONTRACT!,
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

        // ===== USDC ban đầu =====
        this.initialUsdcBalance = Number(ethers.formatUnits(await this.usdc.balanceOf(this.wallet.address), 6));
        console.log(' Before USDC balance:', this.initialUsdcBalance);

        await this.checkEthBalance();
        await this.approveUsdc();

        while (this.running) {
            try {
                for (let pair of OSTIUM_PAIRS) {
                    await this.tradePair(pair);
                }
            } catch (err) {
                console.error('Error / revert, retry...', err);
                await this.sleep(BOT_CONFIG.retryDelayMs);
            }
        }
    }

    // ===== Trade a single pair =====
    private async tradePair(pair: { id: number; name: string; maxLeverage: number }) {
        let collateralWei = ethers.parseUnits(BOT_CONFIG.collateralUsd.toString(), 6); // USDC
        let leverage = pair.maxLeverage;

        console.log(` TRADING ${pair.name} | ${leverage}x`);

        // ===== OPEN LONG =====
        let openTxGas = await this.contract.estimateGas('openTrade', pair.id, true, collateralWei, leverage, 0);
        let openTx = await this.contract.send('openTrade', pair.id, true, collateralWei, leverage, 0, { gasLimit: openTxGas * 120n / 100n });
        let receipt = await openTx.wait();
        let tradeId = this.extractTradeId(receipt);

        if (tradeId === null) {
            console.error('Cannot extract tradeId, skip pair', pair.name);
            return;
        }

        this.tradeCount++;
        let tradeVolume = BOT_CONFIG.collateralUsd * leverage;
        this.totalVolumeUsd += tradeVolume;
        this.volumeByPair[pair.name] = (this.volumeByPair[pair.name] || 0) + tradeVolume;

        console.log(`LONG #${this.tradeCount} | ${pair.name} | Volume=${tradeVolume}$`);

        // ===== HOLD =====
        await this.sleep(BOT_CONFIG.holdTimeMs);

        // ===== CLOSE TRADE =====
        let closeTxGas = await this.contract.estimateGas('closeTrade', tradeId);
        let closeTx = await this.contract.send('closeTrade', tradeId, { gasLimit: closeTxGas * 120n / 100n });
        await closeTx.wait();

        console.log(`CLOSED ${pair.name} | tradeId=${tradeId}`);
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

    async checkEthBalance() {
        let balance = await this.provider.getBalance(this.wallet.address);
        let eth = Number(ethers.formatEther(balance));

        if (eth < 0.003) throw new Error(` Not enough ETH for gas: ${eth}`);
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
