# AttestFlow App

Creditcoin CC3 测试网上的应收账款融资演示，包含浏览器钱包连接、EIP-3009 付款授权、服务端验签和本地持久化。

## 本地运行

```bash
npm install
npm run dev
```

## CC3 合约

- `MockUSDC`：6 位精度的测试 Token，实现 EIP-3009 `transferWithAuthorization`。
- `ReceivableSettlement`：记录融资请求、托管报价资金、执行供应商放款，并在到期时原子执行授权收款。

融资状态以链上记录为准：

1. 供应商调用 `requestFinancing()` 登记应收哈希、Token 和面值。
2. 资金方授权 mUSDC 后调用 `submitOffer()`，融资本金由合约锁定。
3. 供应商调用 `acceptOffer()`，合约向供应商放款并记录资金方权属。
4. 到期后 Relayer 调用 `settleWithAuthorization()`，资金方调用 `claim()` 领取结算款。

本地应收 JSON 只缓存链上融资状态，页面启动后会使用合约状态覆盖缓存值。

编译合约：

```bash
npm run contracts:compile
```

首次部署前生成专用测试网账户并查看余额：

```bash
npm run deploy:cc3:prepare
```

部署前可在 `.env.local` 配置有效的 `CC3_FUNDER_WALLET_ADDRESS`。部署脚本会向该公开钱包地址分配报价所需的测试 mUSDC；不要把私钥写入该文件。

部署私钥保存在 Git 忽略的 `.env.deploy.local`，命令不会回显私钥。通过 Creditcoin Discord `token-faucet` 频道为输出的 EVM 地址领取测试 CTC，到账后执行：

```bash
npm run deploy:cc3
```

脚本等待交易确认后，会自动更新 `.env.local` 中的 `CC3_USDC_ADDRESS` 和 `CC3_SETTLEMENT_ADDRESS`，并向已配置的资金方钱包分配 250,000 mUSDC。这些是测试合约，`PAYMENT_AUTH_DEMO_MODE` 应保持为 `true`。
