# OSTIUM Long Volume Bot

 **Bot giao dịch tự động** trên nền tảng OSTIUM.  
Bot sẽ mở và đóng các vị thế LONG trên nhiều cặp (BTC, ETH, XAU, XAG) sử dụng USDC làm tiền đảm bảo và đòn bẩy có thể cấu hình. Theo dõi tổng volume giao dịch và số dư ví hàng ngày.

---

## Tính năng

- ✅ Hỗ trợ nhiều cặp giao dịch với đòn bẩy tùy chỉnh.
- ✅ Ước lượng gas động cho mỗi giao dịch mở/đóng.
- ✅ Theo dõi tổng số lệnh và tổng volume USD.
- ✅ Tự động approve USDC.
- ✅ Báo cáo hàng ngày gồm số lệnh, tổng volume và số dư ví.
- ✅ Cấu hình dễ dàng qua `BOT_CONFIG` và `OSTIUM_PAIRS`.
- ✅ An toàn: sử dụng biến môi trường cho key và RPC URL.

---
##
# 1. Clone repo
git clone https://github.com/DevScamHunter/bot-trading-volume.git
cd bot-trading-volume

# 2. Cài dependencies
npm install

# 3. Chạy bot
npm run dev

## Cấu hình

Tạo file `.env` (không push lên GitHub):

```env
PRIVATE_KEY=private_key_cua_ban
ARB_RPC=https://arb1.arbitrum.io/rpc
OSTIUM_CONTRACT=0xDiaChiContractCuaOstium
