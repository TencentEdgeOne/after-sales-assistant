/**
 * Demo documents for one-click import.
 * Covers all 4 categories: faq, policy, product, order_doc
 *
 * NOTE: order_doc is reserved for ACTUAL customer order documents
 * (uploaded individually, e.g. filename "ORD-20250520-001").
 * Internal process/policy documents must NOT use category "order_doc"
 * — they belong in "policy" or "faq" so they are never surfaced as orders.
 */
import type { Order } from "../_shared";

export interface DemoDoc {
  title: string;
  category: "faq" | "policy" | "product" | "order_doc";
  content: string;
}

export const DEMO_DOCS: DemoDoc[] = [
  {
    title: "退货退款政策",
    category: "policy",
    content: `【退货退款政策】

1. 收到商品后 7 天内可无理由退货（不影响二次销售）。
2. 质量问题 15 天内可退货，运费由我方承担。
3. 退款方式：原路退回（微信/支付宝/银行卡），3-5 个工作日到账。
4. 以下情况不支持退货：定制商品、已拆封的一次性耗材、下载类数字商品。
5. 退货需保留完整包装和配件，否则可能影响退款金额。
6. 部分促销商品退货需退还赠品或折扣差额。`,
  },
  {
    title: "退货操作流程",
    category: "faq",
    content: `【退货操作流程】

Q: 怎么申请退货？
A: 按以下步骤操作：
1. 在订单详情中点击"申请退货"按钮，选择退货原因。
2. 客服审核通过后（通常 1 小时内），系统生成退货单号。
3. 将商品寄回指定地址（质量问题提供免费取件码）。
4. 仓库收到商品验收无误后，1-2 个工作日完成退款。

Q: 退货地址是哪？
A: 审核通过后系统会显示退货地址，请勿自行寄送。

Q: 退货运费谁出？
A: 质量问题由平台承担（提供上门取件码），非质量问题用户自付。`,
  },
  {
    title: "换货政策",
    category: "policy",
    content: `【换货政策】

1. 收到商品 15 天内可申请换货。
2. 支持换同款不同规格（颜色/尺寸）或等价商品。
3. 质量问题换货运费由平台承担；非质量问题换货，用户承担来回运费。
4. 换货商品需保持全新状态，附带完整包装。
5. 换货处理周期：收到旧件后 3 个工作日内寄出新件。
6. 同一订单仅支持一次换货，换货后不可再次换货（可退货）。`,
  },
  {
    title: "物流与配送说明",
    category: "faq",
    content: `【物流与配送】

Q: 几天能收到货？
A: 普通地区 2-4 天到达，偏远地区 5-7 天。下单后 24 小时内发货（预售/定制除外）。

Q: 支持哪些快递？
A: 默认发顺丰/圆通/中通，暂不支持指定快递公司。

Q: 怎么查物流？
A: 在订单详情页可实时查看物流轨迹，或用快递单号到相应快递官网查询。

Q: 收到破损怎么办？
A: 签收后 48 小时内拍照联系客服，我们会优先处理补发或退款。

Q: 可以更改收货地址吗？
A: 发货前可修改，发货后请联系快递公司转寄（费用自理）。`,
  },
  {
    title: "运费规则",
    category: "policy",
    content: `【运费规则】

1. 订单满 99 元包邮（偏远地区满 199 元）。
2. 未满包邮门槛，基础运费 8 元。
3. 偏远地区（新疆、西藏、海南等）加收 10 元。
4. 大件商品（> 5kg）单独计费，下单时展示实际运费。
5. 退货运费：质量问题免运费，非质量问题用户自付（约 8-15 元）。
6. 换货运费：质量问题免运费，非质量问题用户承担来回运费。`,
  },
  {
    title: "保修政策",
    category: "policy",
    content: `【保修政策】

1. 电子产品：整机 1 年保修，电池 6 个月。
2. 配件（耳套/表带/线材）：3 个月质保。
3. 保修范围：非人为损坏的质量问题。
4. 以下情况不在保修范围内：进水、摔坏、拆机、非授权维修。
5. 保修方式：寄修（用户承担寄出运费，返回运费平台承担）。
6. 超出保修期可付费维修，费用提前告知确认后进行。
7. 保修期内如确认是质量问题，可选择换新或退款。`,
  },
  {
    title: "无线降噪耳机 Pro",
    category: "product",
    content: `【产品信息：无线降噪耳机 Pro】

型号：EP-2024-PRO
价格：¥899
颜色：星空黑 / 月光银 / 极光蓝

主要参数：
- 降噪：混合主动降噪 -42dB
- 续航：单次 8 小时，搭配充电盒 36 小时
- 蓝牙：5.3，支持多设备切换
- 驱动单元：40mm 复合振膜
- 重量：250g（含头梁）
- 防水：IPX4

包装清单：耳机 x1、充电盒 x1、Type-C 线 x1、替换耳套 x2 对、说明书 x1

常见问题：
- 降噪有电流声？重置后重新配对，如仍有问题可申请换货。
- 连接不稳定？确保固件已更新至最新版本（APP 内检查）。
- 佩戴不舒适？建议更换不同尺寸的耳套。`,
  },
  {
    title: "智能手表 Ultra",
    category: "product",
    content: `【产品信息：智能手表 Ultra】

型号：SW-ULTRA-49
价格：¥3999
材质：钛金属表壳 / 蓝宝石玻璃表镜
尺寸：49mm

主要功能：
- 健康监测：心率、血氧、体温、心电图（ECG）
- 运动模式：100+ 种运动，双频 GPS 精准定位
- 续航：普通使用 14 天，运动模式 8 天
- 防水：100 米（可游泳/浮潜）
- 显示：LTPO OLED，常亮显示
- 连接：蓝牙 5.3 + WiFi

包装清单：手表 x1、磁吸充电线 x1、快速入门指南 x1

兼容性：iOS 15+ / Android 10+
表带：可更换标准 22mm 表带（推荐原装尼龙/硅胶/金属表带）

注意事项：
- 首次使用请充满电并完成配对设置
- ECG 功能需要在 APP 中激活（部分地区不可用）
- 防水性能会随时间降低，不建议热水环境使用`,
  },
  {
    title: "机械键盘 K8",
    category: "product",
    content: `【产品信息：机械键盘 K8】

型号：KB-K8-87
价格：¥599
规格：87 键 / TKL 紧凑布局
颜色：黑色 / 白色
轴体可选：红轴（线性）/ 茶轴（段落）/ 青轴（点击）

主要参数：
- 连接：有线 USB-C / 蓝牙 5.1 / 2.4G 三模
- 续航：蓝牙模式约 200 小时（无背光）
- 背光：RGB 全彩，可自定义灯效
- 键帽：PBT 双色注塑，不打油
- 支撑：三段式脚撑
- 热插拔：支持（可自行更换轴体）

包装清单：键盘 x1、USB-C 线 x1、2.4G 接收器 x1、拔键器 x1、替换键帽 x4

维护建议：
- 定期用气吹清理键帽缝隙灰尘
- 避免液体进入，如不慎进液请立即断电倒扣晾干
- 轴体润滑建议每 6 个月一次（可选）`,
  },
  {
    title: "订单异常处理规范",
    category: "policy",
    content: `【订单异常处理规范】

1. 超时未发货（>48h）：
   - 系统自动提醒仓库
   - 超 72h 未发货客服主动联系用户，提供补偿方案（优惠券/优先发货）

2. 物流异常（>7天无更新）：
   - 客服联系快递公司核实
   - 确认丢件后立即补发或全额退款
   - 赔付 10 元无门槛优惠券

3. 签收异常（本人未签收）：
   - 联系快递员确认代签情况
   - 确认丢失后 48h 内补发

4. 部分商品缺失：
   - 核实包裹重量
   - 确认缺货后补发缺失商品，赠送 5 元优惠券

5. 发错商品：
   - 用户保留商品，免费补发正确商品
   - 如用户愿意退回错误商品，提供免费取件服务`,
  },
  {
    title: "批量订单与企业采购",
    category: "policy",
    content: `【批量订单与企业采购】

适用对象：单次采购 10 件以上或月采购额 5000 元以上

权益：
- 批量折扣：10-49 件 95 折，50-99 件 9 折，100+ 件价格面议
- 专属客服：一对一企业服务经理
- 优先发货：订单优先处理，当日发货
- 对公发票：支持增值税专用发票
- 账期：签约企业可享 30 天账期

申请方式：
1. 联系客服备注"企业采购"
2. 提供营业执照和联系人信息
3. 签署采购协议后开通企业账户

退换货特殊条款：
- 批量订单支持部分退货（最少保留 50%）
- 定制商品不支持退货
- 换货需一次性换完，不支持多次零散换货`,
  },
];

/** Demo orders — seeded alongside DEMO_DOCS */
export const DEMO_ORDERS: Order[] = [
  {
    orderId: "ORD-20250520-001",
    userId: "default",
    items: [
      { productId: "P001", name: "无线降噪耳机 Pro", specs: "星空黑 / 主动降噪", quantity: 1, price: 899 },
    ],
    totalAmount: 899,
    status: "delivered",
    createdAt: "2025-05-20T10:30:00Z",
    updatedAt: "2025-05-22T14:00:00Z",
    trackingNumber: "SF1234567890",
    carrier: "顺丰速运",
  },
  {
    orderId: "ORD-20250518-002",
    userId: "default",
    items: [
      { productId: "P002", name: "智能手表 Ultra", specs: "钛金属 / 49mm", quantity: 1, price: 3999 },
      { productId: "P003", name: "表带（尼龙）", specs: "午夜蓝", quantity: 2, price: 129 },
    ],
    totalAmount: 4257,
    status: "shipped",
    createdAt: "2025-05-18T08:00:00Z",
    updatedAt: "2025-05-19T16:30:00Z",
    trackingNumber: "YT9876543210",
    carrier: "圆通快递",
  },
  {
    orderId: "ORD-20250515-003",
    userId: "default",
    items: [
      { productId: "P004", name: "机械键盘 K8", specs: "红轴 / 87键 / 白色", quantity: 1, price: 599 },
    ],
    totalAmount: 599,
    status: "delivered",
    createdAt: "2025-05-15T12:00:00Z",
    updatedAt: "2025-05-17T09:00:00Z",
    trackingNumber: "ZT1122334455",
    carrier: "中通快递",
  },
  {
    orderId: "ORD-20250510-004",
    userId: "default",
    items: [
      { productId: "P005", name: "便携充电宝 20000mAh", specs: "白色 / 65W快充", quantity: 1, price: 299 },
      { productId: "P006", name: "Type-C 数据线", specs: "1.5m / 编织", quantity: 3, price: 39 },
    ],
    totalAmount: 416,
    status: "pending",
    createdAt: "2025-05-10T18:00:00Z",
    updatedAt: "2025-05-10T18:00:00Z",
  },
];
