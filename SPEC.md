# 图片管理器实现方案 Spec

## 当前理解
参考 Slidebox 的单张大图卡片式整理体验，在 Scripting 中实现一个 iOS 图片管理器：读取系统相册图片；用户右滑当前图片时，图片以动画飞向右上角垃圾箱按钮并进入待删除队列；点击右上角垃圾箱按钮后，将所有右滑收集的图片从系统照片库删除。

## 范围
- 当前项目：`图片管理器/`
- 入口：`index.tsx`（目前为空）
- 配置：`script.json`
- 目标平台：Scripting App TSX/SwiftUI-like UI

## API 事实
- 读取照片：`Photos.fetchAssets({ mediaType: "image", sortBy: "creationDate", ascending: false, limit })`
- 获取显示图片：`PHAsset.requestImage({ targetWidth, targetHeight, contentMode, deliveryMode, allowNetworkAccess })`
- 删除照片：`Photos.deleteAssets(assets)` 或 `asset.delete()`；系统会弹出确认提示。
- 权限：`Photos.authorizationStatus("readWrite")` 可查询，首次访问会触发系统授权；`denied/restricted` 需要给用户提示。
- UI：`Navigation.present(<View />)` 展示页面，结束后 `Script.exit()`。
- 状态/交互：`useState`、`useEffect`、`DragGesture().onChanged().onEnded()`、`withAnimation(Animation...)`、`offset` 可实现拖动与飞入垃圾箱动画。

## 交互设计
1. 启动后拉取最新图片资产，预取当前图和下一张缩略/展示图。
2. 页面主体为 Slidebox 风格：顶部工具栏 + 右上角垃圾箱按钮 + 中央大图卡片 + 底部计数/提示。
3. 用户水平右滑当前图：
   - 拖动中图片跟随手指向右移动，可轻微旋转/缩放（如 API 支持）。
   - 松手超过阈值（如 `translation.width > 120` 或预测位移足够大）判定为“加入删除队列”。
   - 用 `withAnimation(Animation.snappy/easeIn)` 将当前图片的 offset 动画到右上角垃圾箱位置，同时缩小、淡出。
   - 动画结束后，把该 asset 的 `localIdentifier` 加入 `pendingDeleteIds`，当前索引切到下一张，重置动画状态。
4. 点击右上角垃圾箱按钮：
   - 若队列为空，提示“暂无待删除”。
   - 若队列非空，按 `localIdentifier` 重新 `Photos.fetchAssets(ids)`，调用 `Photos.deleteAssets(assets)`。
   - 若系统确认删除成功，从本地资产列表移除这些项，清空队列；若取消，保留队列或提供恢复。

## 数据结构建议
```ts
type PhotoItem = {
  id: string
  asset: PHAsset
  image?: UIImage | null
  loading?: boolean
}
```
- `items: PhotoItem[]`：当前批次照片。
- `currentIndex: number`：当前展示位置。
- `pendingDeleteIds: string[]`：已右滑、等待点击垃圾箱确认删除的资产 id。
- `dragOffset: { x: number; y: number }`：当前拖动偏移。
- `isThrowing: boolean`：飞向垃圾箱动画中，防止重复手势。
- `deletedIds: Set<string>`：删除成功后本地过滤。

## 关键风险
- 删除系统照片是高影响操作，必须依赖 iOS 系统确认框；不要绕过确认。
- `PHPickerResult` 不适合删除，因为 picker 返回的是拷贝/UIImage/path，不能稳定映射到可删除的 PHAsset；应使用 `Photos.fetchAssets`。
- iCloud 图片可能需要网络下载，`requestImage({ allowNetworkAccess: true })` 可能较慢，需要 loading 状态。
- Scripting 手势 API 文档对 DragGesture 构造参数细节返回较少，实现时需用 diagnostics/preview 验证。

## Done Contract
- 方案完成：能明确说明采用哪些 Scripting Photos/UI API、状态模型、右滑动画与批量删除流程。
- 实现完成（下一步需批准）：`index.tsx` 可运行，能展示图片、右滑收集、点击垃圾箱删除，并通过 TypeScript diagnostics/运行验证。

## Change Log
- 2026-06-30：已实现 `index.tsx` MVP。
  - 使用 `Photos.fetchAssets({ mediaType: "image", sortBy: "creationDate", ascending: false, limit: 200 })` 读取最新图片资产。
  - 使用 `PHAsset.requestImage(...)` 懒加载当前及后续图片。
  - 使用 `DragGesture` + `withAnimation(Animation.snappy)` 实现右滑飞向右上角垃圾箱的收集动画。
  - 使用 `pendingDeleteIds` 维护右滑后的待删除队列。
  - 点击右上角垃圾箱后通过 `Photos.fetchAssets(ids)` + `Photos.deleteAssets(assets)` 触发系统确认并批量删除。
  - 增加 loading、空状态、浏览完成、toast 提示、刷新和关闭入口。
- 2026-06-30：优化左右滑行为。
  - 右滑超过阈值时，图片用 `Animation.easeIn(0.42)` 大幅上移右移、缩小到 `0.045` 并淡出，视觉上飞向导航栏右上角垃圾箱按钮，然后加入待删除队列。
  - 左滑超过阈值时，图片用 `Animation.easeOut(0.26)` 向左滑出并淡出，只跳到下一张，不加入待删除队列。
  - 拖动中允许正负水平位移，并用绝对距离控制缩放和透明度。
- 2026-06-30：优化卡片栈与飞行动画可见性。
  - 卡片区至少同时渲染当前图和下一张图；下一张作为底层卡片，当前图滑动时会露出。
  - 取消舞台根容器的 `clipShape`，改用底层背景卡片提供圆角背景，避免右滑飞向右上角时被卡片区域裁剪。
  - 截图命令改为带 `--timeout`，例如 `scripting-ts project "图片管理器" --timeout 8 --screenshot`。
- 2026-06-30：模块化和动画细化。
  - 拆出 `types.ts`、`constants.ts`、`utils.ts`、`components/PhotoCardStack.tsx`，`index.tsx` 只保留状态编排、照片加载/删除和动作处理。
  - 右滑拖动过程不再旋转；只要向右拖，图片即沿右上方向移动，同时缩小、轻微淡出。
  - 右滑确认后使用 `trashFlightMotion` 继续飞向右上角垃圾箱终点并缩小消失。
  - 下一张底卡初始可见度提高，并通过 `nextCardOpacity/nextCardScale/nextCardOffsetY` 随拖动渐进呈现，减少突兀感。
- 2026-06-30：修复拖动抖动、底卡不可见和新图飞回。
  - 抖动根因：上一版把 `onDragGesture` 绑在正在 `offset/scale` 的卡片本身，卡片变换会影响局部手势坐标，形成反馈抖动；更早版本主要接近水平位移，所以不明显。
  - 修复：`PhotoCardStack` 改为固定透明 `FixedGestureLayer` 承载手势，视觉卡片 `PhotoImageCard` 只负责移动/缩放/淡出，手势坐标系不再跟随视觉层变化。
  - 底卡修复：底层卡片始终渲染；下一张未加载时显示占位，加载后显示图片。
  - 新图飞回修复：`throwCurrentToTrash` / `skipCurrentPhoto` 在飞出动画完成后，直接 `resetCardState()` + `setCurrentIndex(...)`，不再包在 `withAnimation` 中，避免下一张继承旧卡片的垃圾箱位置并飞回。

## Validation
- TypeScript diagnostics：通过，0 个诊断。
- 2026-06-30 UI/手势修复后再次 TypeScript diagnostics：通过，0 个诊断。
- 2026-06-30 左右滑优化后再次 TypeScript diagnostics：通过，0 个诊断；已运行 `scripting-ts project "图片管理器" --screenshot`，截图确认页面文案正常。
- 2026-06-30 双卡与飞行动画优化后 TypeScript diagnostics：通过，0 个诊断；已按反馈运行 `scripting-ts project "图片管理器" --timeout 8 --screenshot`，截图确认不再停留在加载态，且当前图/下一张图可同时显示。
- 2026-06-30 模块化和动画细化后，入口文件和整个项目 TypeScript diagnostics 均通过，0 个诊断；`scripting-ts project "图片管理器" --timeout 12 --screenshot` 截图确认页面正常渲染。
- 2026-06-30 拖动稳定性修复后，整个项目 TypeScript diagnostics 通过，0 个诊断；`scripting-ts project "图片管理器" --timeout 12 --screenshot` 截图确认静态页面正常。拖动稳定性和底卡显现需实机手势复测。
- 已按要求运行 `scripting-ts project "图片管理器" --screenshot` 截图验证；截图显示当前 UI 已改为 iOS grouped background + NavigationBar + rounded card 风格。
- 手势修复点：不再把 `gesture={DragGesture()}` 直接绑在 `Image` 上；改为把 `onDragGesture` 绑到外层整张卡片 `ZStack`，增加 `contentShape`，并把内部图片 `allowsHitTesting={false}`，避免图片视图吞掉/限制命中区域。
- Hero 结论：Scripting 支持 `matchedGeometryEffect` / `NamespaceReader`，但当前“单张卡片飞向固定垃圾箱”的交互用同一视图的 `offset + scaleEffect + opacity + withAnimation` 更直接稳定；Hero 更适合源/目标两个真实视图之间的几何同步，后续若要做垃圾箱缩略图落位/展开预览，再引入 matched geometry。
- 未自动执行真实删除：删除会触发系统照片确认框，需在设备上人工确认。

## Resume / Handoff
- 若继续迭代，优先验收：首次照片权限、iCloud 图片加载速度、右滑飞入垃圾箱位置是否需要按设备微调。
- 当前模块结构：`index.tsx` 入口/状态编排，`types.ts` 类型，`constants.ts` 布局和动画常量，`utils.ts` 日期和动画计算，`components/PhotoCardStack.tsx` 双卡渲染。
- 下一轮可加：撤销待删除、左滑保留/收藏、相册筛选、分页加载、已右滑缩略垃圾箱预览。
