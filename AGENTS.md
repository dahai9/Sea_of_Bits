# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## 🛠 Commands

*   **Setup Environment**: `direnv allow` or `nix develop` (requires Nix and Node.js >=22.12.0)
*   **Dev Server**: `npm run dev`
*   **Build**: `npm run build`
*   **Preview Build**: `npm run preview`
*   **Type Checking**: `npm run typecheck` (runs `astro check` and TypeScript validation - run this frequently, especially after modifying content)

## 🏗 High-Level Architecture

**Sea_of_Bits** is a high-performance, minimalist technical blog built with **Astro 6** and **TypeScript**.

*   **`src/content/blog/`**: Content layer. All blog posts are `.md` or `.mdx` files. Schema is defined in `src/content.config.ts`.
*   **`src/pages/`**: Routing layer; uses Astro's file-based routing.
*   **`src/components/`**: Reusable Astro components.
*   **`src/layouts/`**: Layout templates. `BlogPost.astro` is the primary layout for articles.
*   **`src/assets/`**: Local assets (images, banners). Use relative paths in Markdown frontmatter to reference them.
*   **`src/styles/`**: Global vanilla CSS for a clean, text-focused minimalist aesthetic.
*   **Deployment**: GitHub Pages (`.github/workflows/deploy.yml` with base path `/Sea_of_Bits`).

## 👨‍💻 Development Conventions

*   **Strict Typing**: Ensure all content matches the defined schema. Use `npm run typecheck` to verify data integrity.
*   **Asset Handling**: Always use the `Image` component from `astro:assets` for optimized image rendering.
*   **Minimalist Style**: Maintain the clean, text-focused CSS. If modifying layouts, prioritize accessibility and maintain the minimalist aesthetic.
*   **Content Creation**: When adding new blog posts, ensure the frontmatter is complete and follows the schema (requires `title`, `description`, `pubDate`, `heroImage`).
