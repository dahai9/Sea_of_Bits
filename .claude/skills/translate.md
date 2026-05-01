---
name: translate
description: Translate a blog post between Chinese (zh) and English (en). Reads the source file, translates all content while preserving formatting, and writes the translated file.
---

# Translate Blog Post

Translate a blog post between Chinese and English.

## Usage

```
/translate <source-file-path> [target-lang]
/translate --all
```

- `source-file-path`: Path to the source markdown file.
- `target-lang`: Optional. Target language (`en` or `zh`).
- `--all`: Scan `src/content/blog/` and translate all posts that are missing their counterpart (e.g., a `.zh.md` file without a corresponding `.en.md`).

## Steps

### For a single file:
1. **Read** the source file at the given path.
...
5. **Verify** by running `npm run typecheck`.

### For --all:
1. **Scan** `src/content/blog/` for all `.zh.md` and `.en.md` files.
2. **Identify** missing pairs (e.g., `file.zh.md` exists but `file.en.md` does not).
3. **Translate** each missing file following the single-file steps.
4. **Verify** all new files.

## Translation Quality Guidelines

- Use natural, fluent language in the target locale
- **zh→en**: Use active voice, concise sentences, technical writing style
- **en→zh**: Use standard Simplified Chinese (简体中文), natural technical writing
- Preserve the author's tone and writing style
- Keep all technical accuracy intact
- When translating idioms/phrases, find equivalent expressions rather than literal translations
- Preserve all `> **摘要**` / `> **Summary**` blockquote formatting

## Example

```
/translate src/content/blog/2026-03-19-evermemos-rs-rewrite.zh.md
```

This reads the Chinese post and creates an English translation at:
`src/content/blog/2026-03-19-evermemos-rs-rewrite.en.md`
