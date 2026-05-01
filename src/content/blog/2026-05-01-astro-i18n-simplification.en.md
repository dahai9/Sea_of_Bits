---
title: 'Implementing Ultra-Simple Multi-Language Support for Astro 6 Blogs'
description: 'This post shares how to create a smooth multi-language experience for an Astro blog without relying on heavy i18n frameworks, using filename suffix conventions and Claude Code automation.'
pubDate: 'May 01 2026'
heroImage: '../../assets/blog-placeholder-2.jpg'
---

> **Summary**: For personal technical blogs, many i18n frameworks feel too heavy. By combining "filename suffix conventions," "shared page components," and "AI-automated translation," we implemented multi-language support for the Sea_of_Bits blog without changing the existing URL structure.

---

## 1. Why Reject Traditional i18n Frameworks?

In the Astro ecosystem, official i18n recommendations usually involve changing the content directory structure (e.g., moving posts into `zh/` and `en/` folders) and introducing complex routing configurations. This brings several pain points:

1.  **URL Breaking**: Existing article paths change.
2.  **Asset Reference Hassle**: After moving folders, relative path image references require bulk modification.
3.  **Maintenance Cost**: Too much boilerplate code comes with the framework.

What we wanted was: **Articles stay exactly where they are, just with an added `.en.md` suffix.**

## 2. Technical Solution: The Triple Threat

### 2.1 Filename Convention and ID Mapping

We leverage the `generateId` hook in Astro 6's `content.config.ts` to map `xxx.zh.md` and `xxx.en.md` to more manageable IDs.

```typescript
// src/content.config.ts
loader: glob({
    base: './src/content/blog',
    pattern: '**/*.{md,mdx}',
    generateId: ({ entry }) => {
        const match = entry.match(/^(.+)\.(zh|en)\.(md|mdx)$/);
        // Map to zh/slug or en/slug to bypass Astro's filtering of dots
        if (match) return `${match[2]}/${match[1]}`;
        return entry.replace(/\.(md|mdx)$/, '');
    },
}),
```

### 2.2 Shared Page Components (Page Component Pattern)

To avoid duplicating logic in the `src/pages/` directory, we extracted the UI logic of `index.astro` and `blog/index.astro` into `src/components/pages/`.

This way, the Chinese homepage (`src/pages/index.astro`) and the English homepage (`src/pages/en/index.astro`) are just simple wrappers:

```astro
---
import HomePage from '../../components/pages/HomePage.astro';
---
<HomePage lang="en" />
```

### 2.3 AI-Driven Automated Translation

The biggest pain point for multi-language support is the **translation cost**. We developed a dedicated Skill called `/translate` using Claude Code.

With a simple command:
```bash
/translate src/content/blog/new-post.zh.md
```
The AI automatically reads the content, translates the Frontmatter and body, preserves Markdown formatting, and generates the corresponding `.en.md` file.

## 3. Implementation Results

- **URL Compatibility**: The default Chinese path `/blog/my-post/` remains unchanged, and the English path automatically becomes `/en/blog/my-post/`.
- **SEO Friendly**: The `BaseHead` component automatically injects `hreflang` tags.
- **Ultra Lightweight**: No third-party i18n libraries were introduced; it's built entirely on native Astro capabilities.

## 4. Summary

Technical blogs should focus on content. Through this solution, we have successfully hidden the complexity of multi-language support within low-level configurations and AI tools.

[View the source code for this refactor](https://github.com/dahai9/Sea_of_Bits)