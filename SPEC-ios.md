# 草书 App — 共享技术规格（SPEC）

> 所有 subagent 必读。严格遵守模块边界与命名，保证各自产出能集成编译。
> 工程根：`~/projects/caoshu-app`，用 XcodeGen（`project.yml`）生成 `.xcodeproj`。
> Target 名：`Caoshu`，Bundle id：`com.nianian.caoshu`，iOS 17+，纯 SwiftUI + SwiftData。

## 0. 产品定位（grill 已锁定 17 项）
iPhone 上手指写的「草书版多邻国 + Anki」。先自用。
1. 载体：iPhone，手指写（无压感，判定只看字形结构）
2. 「写对」= 字形结构像不像（容错高）
3. 判定引擎：Gemini 3.1 Pro 多模态看图（联网）
4. 标准范本：《标准草书》一字一标准形，由草书字体渲染
5. 字形数据：草书字体渲染为主 + 真迹图补充
6. 真迹：运行时现拉书法字典站 + 本地缓存
7. 拆解内容：草书符号构成 + 楷→草演变对照
8. 内容产出：Gemini 预生成 + 人工抽查，存本地 JSON
9. 认字：草→楷 + 楷→草 双向
10. 课程：按字频序
11. 定位：先自用
12. 技术栈：原生 SwiftUI + SwiftData
13. 模型：Gemini 3.1 Pro 全包
14. SRS：FSRS
15. 手写交互：先描红熟悉 → 后盲写判定
16. v1 范围：100 高频字，全闭环
17. 字体：外挂免费草书字体 **Liu Jian Mao Cao（钟齐流江毛草）**，已放 `Sources/Resources/Fonts/LiuJianMaoCao.ttf`，PostScript 名 `LiuJianMaoCao-Regular`，OFL 授权

## 1. 字体使用
SwiftUI 调用：`Font.custom("LiuJianMaoCao-Regular", size: …)`。Info.plist 已注册 UIAppFonts。

## 2. 100 高频字（v1 字表，字频序）
的一是了我不人在他有这个上们来到时大地为子中你说生国年着就那和要她出也得里后自以会家可下而过天去能对小多然于心学么之都好看起发当没成只如事把还用第样道想作种开美总从无情己面最女但现前些所同日手又行意动方期它头经长儿回位分爱老因很

## 3. 模块边界（谁写哪儿，互不越界）
```
Sources/
  App/        CaoshuApp.swift（已存在；集成时主控接 RootView→主界面）
  Models/     【backend 负责】SwiftData @Model + 纯数据结构
  Services/   【backend 负责】FSRS 引擎、Gemini 客户端、内容/字表/真迹服务、ViewModel(ObservableObject)
  Views/      【frontend 负责】纯 SwiftUI 视图，绑定 Services 的 ViewModel
  Resources/  字体、预生成内容 JSON、字表
Tests/        【test 负责】
```
- **frontend 不得**新建/修改 Models、Services；只 import 并消费其公开 API。
- **backend 不得**写 Views。先在 `Services/AppState.swift` 暴露清晰的 ObservableObject 契约（见 §5）。

## 4. 数据模型（backend 实现，SwiftData）
- `Hanzi`：`id`、`kai`(楷书字)、`pinyin`、`freqRank`、`unlocked`、关联 `Card`。
- `Card`：`id`、`hanziKai`、`direction`(枚举 `.recognize` 草→楷 / `.produce` 楷→草)、FSRS 状态字段（`stability`、`difficulty`、`due`、`lastReview`、`reps`、`lapses`、`state`）。
- `ReviewLog`：`cardId`、`rating`(again/hard/good/easy)、`reviewedAt`、`elapsedDays`、`scheduledDays`。
- `Decomposition`(非持久，来自 JSON)：`kai`、`symbols`[草书符号构成]、`evolution`(楷→草演变文字)、`confusable`[易混字]。

## 5. ViewModel 契约（backend 在 Services 暴露，frontend 消费）
- `AppState: ObservableObject`（注入 environment）：`todayQueue: [Card]`、`newCount`、`reviewCount`、`func grade(_ card:Card, _ rating:Rating)`、`func decomposition(for kai:String) -> Decomposition?`。
- `StudySessionVM: ObservableObject`：驱动单卡流程（描红→盲写→判定结果）。
- `HandwritingJudgeService`：`func judge(strokesImage: UIImage, targetKai: String) async -> JudgeResult`（内部调 Gemini；无 key/无网时返回 `.selfAssess` 让用户自评）。`JudgeResult { score:Int(0-100), verdict:.pass/.fail, feedback:String }`。
- `GeminiClient`：读 Keychain 里的 API key；端点与模型名集中常量；**key 绝不硬编码**。
- 真迹：`CalligraphyImageService.fetch(kai:) async -> [URL]`，本地缓存目录。

## 6. FSRS（backend 实现，可纯 Swift 单测）
实现 FSRS v4/v5 调度：输入当前卡状态 + rating，输出新的 stability/difficulty/due。参数用公开默认权重。必须有纯函数 `FSRS.nextState(_ state, rating, now) -> State` 便于 macOS swift 单测（不依赖 SwiftData/UIKit）。

## 7. 界面清单（frontend，frontend-design skill 驱动视觉）
1. 今日页（TodayView）：新学/复习数、开始按钮、连续天数。
2. 练习页（StudyView）：楷→草盲写——顶部楷字+拼音，PencilKit 手写画布(手指)，米字格背景，先「描红」(范本半透明底)后「盲写」，提交→判定结果卡(分数+反馈+范本叠你写的)。
3. 认字页（RecognizeView）：草→楷——显示草书范本，4 选 1 楷字，对错反馈。
4. 拆解页（DecompositionView）：草书符号构成 + 楷→草演变 + 真迹画廊(横滑)。
5. 进度页（ProgressView）：已掌握/学习中/未学，FSRS 到期分布。
- 视觉：东方水墨极简、留白、宣纸质感底、毛笔灰黑主色 + 一点朱红点缀；草书标题用 LiuJianMaoCao 字体。先用 frontend-design skill 出设计语言再落 SwiftUI。

## 8. 离线降级
描红、认字选择题、FSRS 调度、拆解(本地JSON) 全离线。仅「盲写判定」「真迹现拉」需网；无网时盲写→自评，真迹→占位。

## 9. 集成与验证（主控）
- `xcodegen generate` 后 `xcodebuild -scheme Caoshu -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' build` 必须 SUCCEEDED。
- 本会话模拟器无法启动；运行/截图留待 GUI 会话。纯逻辑(FSRS)用 `swift` 在 macOS 跑单测。
