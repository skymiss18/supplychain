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
4. 到期后 Relayer 调用 `settleAndTransferWithAuthorization()`，验证买方授权并在同一笔交易中向资金方付款。

原有 `settleWithAuthorization()` 和 `claim()` 保留用于兼容已采用拉取付款模式的历史结算。

本地应收 JSON 只缓存链上融资状态，页面启动后会使用合约状态覆盖缓存值。

编译合约：

```bash
npm run contracts:compile
```

首次部署前生成专用测试网账户并查看余额：

```bash
npm run deploy:cc3:prepare
```

部署前可在 `.env.local` 配置现有的 `CC3_USDC_ADDRESS`，脚本会复用该 Token；留空时才会部署新的 MockUSDC。还可配置有效的 `CC3_FUNDER_WALLET_ADDRESS` 和 `CC3_BUYER_WALLET_ADDRESS`，新 Token 部署时会向这些公开钱包地址分别分配报价和到期结算所需的测试 mUSDC。不要把私钥写入该文件。

部署私钥保存在 Git 忽略的 `.env.deploy.local`，命令不会回显私钥。通过 Creditcoin Discord `token-faucet` 频道为输出的 EVM 地址领取测试 CTC，到账后执行：

```bash
npm run deploy:cc3
```

脚本等待交易确认后，会自动更新 `.env.local` 中的 `CC3_USDC_ADDRESS` 和 `CC3_SETTLEMENT_ADDRESS`。仅在新建 MockUSDC 时，脚本会向已配置的资金方和买方钱包分别分配 250,000 mUSDC。`PAYMENT_AUTH_DEMO_MODE` 应保持为 `true`。
