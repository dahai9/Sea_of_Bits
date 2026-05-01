---
title: '为 Astro 6 博客实现极致简单的多语言支持'
description: '本文分享了如何不依赖繁重的 i18n 框架，通过文件名后缀约定和 Claude Code 自动化，为 Astro 博客打造丝滑的多语言体验。'
pubDate: 'May 01 2026'
heroImage: '../../assets/blog-placeholder-2.jpg'
---

> **摘要**：对于个人技术博客而言，许多 i18n 框架显得过于厚重。我们通过“文件名后缀约定” + “共享页面组件” + “AI 自动化翻译”这套组合拳，在不改变原有 URL 结构的前提下，为 Sea_of_Bits 博客实现了多语言支持。

---

## 1. 为什么拒绝传统的 i18n 框架？

在 Astro 生态中，官方推荐的 i18n 方案通常需要改变内容目录结构（例如将文章移动到 `zh/` 和 `en/` 文件夹），并引入复杂的路由配置。这带来了几个痛点：

1.  **URL 破坏**：现有的文章路径会改变。
2.  **图片引用麻烦**：移动文件夹后，相对路径的图片引用需要批量修改。
3.  **维护成本**：框架带来的样板代码（Boilerplate）太多。

我们想要的是：**文章就在原地，只是多了一个 `.en.md` 后缀。**

## 2. 技术方案：三位一体

### 2.1 文件名约定与 ID 映射

我们利用 Astro 6 的 `content.config.ts` 中的 `generateId` 钩子，将 `xxx.zh.md` 和 `xxx.en.md` 映射为更易处理的 ID。

```typescript
// src/content.config.ts
loader: glob({
    base: './src/content/blog',
    pattern: '**/*.{md,mdx}',
    generateId: ({ entry }) => {
        const match = entry.match(/^(.+)\.(zh|en)\.(md|mdx)$/);
        // 映射为 zh/slug 或 en/slug，绕过 Astro 对点号的过滤
        if (match) return `${match[2]}/${match[1]}`;
        return entry.replace(/\.(md|mdx)$/, '');
    },
}),
```

### 2.2 共享页面组件（Page Component Pattern）

为了避免在 `src/pages/` 目录下重复编写逻辑，我们将 `index.astro` 和 `blog/index.astro` 的 UI 逻辑提取到 `src/components/pages/` 中。

这样，中文首页 (`src/pages/index.astro`) 和英文首页 (`src/pages/en/index.astro`) 只是一个简单的包装：

```astro
---
import HomePage from '../../components/pages/HomePage.astro';
---
<HomePage lang="en" />
```

### 2.3 AI 驱动的自动化翻译

多语言最大的痛点是**翻译成本**。我们利用 Claude Code 开发了一个名为 `/translate` 的专用 Skill。

通过简单的命令：
```bash
/translate src/content/blog/new-post.zh.md
```
AI 会自动读取内容、翻译 Frontmatter 和正文、保持 Markdown 格式，并生成对应的 `.en.md` 文件。

## 3. 实现效果

- **URL 兼容**：默认中文路径 `/blog/my-post/` 保持不变，英文路径自动变为 `/en/blog/my-post/`。
- **SEO 友好**：`BaseHead` 组件会自动注入 `hreflang` 标签。
- **极致轻量**：没有引入任何第三方 i18n 库，完全基于 Astro 原生能力。

## 4. 总结

技术博客应该专注于内容。通过这套方案，我们成功地将多语言的复杂性隐藏到了底层配置和 AI 工具中。

[查看本次重构的源代码](https://github.com/dahai9/Sea_of_Bits)
