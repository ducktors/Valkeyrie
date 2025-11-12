# VitePress Implementation Plan for Valkeyrie

## Overview
Set up VitePress documentation system for Valkeyrie with custom homepage, API auto-generation, and full GitHub Pages deployment.

## Phase 1: Install VitePress & Dependencies
**Files to modify:** `package.json`, `.gitignore`

### Tasks:
1. **Install VitePress and related packages:**
   - Add `vitepress` as devDependency
   - Add `typedoc` for API documentation generation
   - Add `typedoc-plugin-markdown` for TypeDoc → Markdown output

2. **Add npm scripts to package.json:**
   ```json
   "docs:dev": "vitepress dev docs"
   "docs:build": "vitepress build docs"
   "docs:preview": "vitepress preview docs"
   "docs:api": "typedoc --out docs/api/generated --plugin typedoc-plugin-markdown"
   ```

3. **Update .gitignore:**
   - Add `docs/.vitepress/cache`
   - Add `docs/.vitepress/dist`

## Phase 2: Create VitePress Configuration
**New files:**
- `docs/.vitepress/config.ts` - Main VitePress config
- `docs/.vitepress/theme/index.ts` - Custom theme setup (if needed)
- `typedoc.json` - TypeDoc configuration

**Configuration details:**
- Set base URL to `/valkeyrie/` for GitHub Pages
- Configure navigation with Guide, API, Examples sections
- Set up sidebar for guides/ and api/ folders
- Enable local search
- Add GitHub link to social links
- Configure theme with dark mode support

## Phase 3: Restructure Documentation Content
**Files to create/modify:**

1. **Create custom homepage:** `docs/index.md`
   - Hero section with tagline
   - Feature cards highlighting unique selling points
   - Quick start code example
   - Links to guides and API reference

2. **Keep existing structure:**
   - `docs/guides/` → stays as-is (getting-started, schema-validation, etc.)
   - `docs/api/` → will be augmented with TypeDoc-generated API docs

3. **Create new pages:**
   - `docs/examples.md` - Consolidated examples page
   - Update navigation in config.ts

## Phase 4: Set Up TypeDoc for API Generation
**Configuration:**
- Point TypeDoc at `src/` folder
- Output to `docs/api/generated/`
- Configure to generate markdown format
- Set up clean documentation structure
- Add JSDoc comments to key exports if missing

**typedoc.json structure:**
```json
{
  "entryPoints": ["./src/valkeyrie.ts"],
  "out": "docs/api/generated",
  "plugin": ["typedoc-plugin-markdown"],
  "readme": "none",
  "excludePrivate": true,
  "excludeInternal": true
}
```

## Phase 5: Create Custom Homepage
**File:** `docs/index.md`

**Sections:**
1. Hero with title, description, and CTA buttons
2. Feature grid showcasing:
   - Type-safe with schema validation
   - Automatic type inference
   - Atomic operations
   - Real-time watch API
   - Pluggable drivers
   - Multi-instance safe
3. Quick start code example
4. Links to Getting Started and API docs

**Homepage template:**
```yaml
---
layout: home

hero:
  name: "Valkeyrie"
  text: "Type-safe key-value store for Node.js"
  tagline: "Runtime schema validation with pluggable storage drivers"
  actions:
    - theme: brand
      text: Get Started
      link: /guides/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/ducktors/valkeyrie

features:
  - title: Type-safe with Schema Validation
    details: Runtime validation with Zod, Valibot, ArkType, and other Standard Schema libraries
  - title: Automatic Type Inference
    details: Full TypeScript support with schema-based type inference across all operations
  - title: Atomic Operations
    details: Perform multiple operations in a single transaction with optimistic locking
  - title: Real-time Updates
    details: Watch keys for changes with the watch() API
  - title: Pluggable Storage Drivers
    details: Currently SQLite-based, with support for more drivers coming soon
  - title: Multi-instance Safe
    details: Proper concurrency control for multiple process access
---
```

## Phase 6: GitHub Actions Setup
**New file:** `.github/workflows/deploy-docs.yml`

**Workflow structure:**
```yaml
name: Deploy VitePress Documentation

on:
  push:
    branches:
      - main
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - name: Setup Pages
        uses: actions/configure-pages@v4

      - name: Install dependencies
        run: pnpm install

      - name: Generate API docs
        run: pnpm docs:api

      - name: Build with VitePress
        run: pnpm docs:build

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: docs/.vitepress/dist

  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    needs: build
    runs-on: ubuntu-latest
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

## Phase 7: GitHub Pages Configuration
**Manual steps:**
1. Go to repository Settings → Pages
2. Under "Build and deployment":
   - Source: Select "GitHub Actions"
3. Save changes
4. Push code to trigger first deployment
5. Verify site at `https://ducktors.github.io/valkeyrie/`

## Phase 8: Final Touches

### 1. Update README.md
Add documentation link near the top:
```markdown
📚 **[Documentation](https://ducktors.github.io/valkeyrie/)** | [Getting Started](https://ducktors.github.io/valkeyrie/guides/getting-started)
```

### 2. Test Locally
```bash
# Install dependencies
pnpm install

# Generate API docs
pnpm docs:api

# Start dev server
pnpm docs:dev
```

**Check:**
- ✅ All navigation links work
- ✅ Search functionality works
- ✅ Dark mode toggles correctly
- ✅ Code examples display properly
- ✅ API docs are generated correctly
- ✅ Responsive design on mobile

### 3. Verify Deployment
1. Push changes to main branch
2. Go to Actions tab in GitHub
3. Watch "Deploy VitePress Documentation" workflow
4. Should complete in 2-3 minutes
5. Visit `https://ducktors.github.io/valkeyrie/`
6. Test all features on deployed site

## Expected Outcomes
- ✅ Professional documentation site at `ducktors.github.io/valkeyrie`
- ✅ Auto-generated API documentation from TypeScript source
- ✅ Custom homepage highlighting Valkeyrie's unique features
- ✅ Automatic deployment on every push to main
- ✅ Searchable documentation with built-in search
- ✅ Responsive design with dark mode support
- ✅ Existing markdown content preserved and enhanced

## Estimated Time
- Phase 1 (Dependencies): 5-10 minutes
- Phase 2 (Configuration): 15-20 minutes
- Phase 3 (Content restructure): 10 minutes
- Phase 4 (TypeDoc setup): 10-15 minutes
- Phase 5 (Custom homepage): 15-20 minutes
- Phase 6 (GitHub Actions): 10 minutes
- Phase 7 (GitHub Pages config): 5 minutes
- Phase 8 (Testing & verification): 15-20 minutes
- **Total: ~1.5-2 hours**

## Files to Create/Modify Summary

### New files:
- `docs/.vitepress/config.ts` - VitePress configuration
- `docs/index.md` - Custom homepage
- `typedoc.json` - TypeDoc configuration
- `.github/workflows/deploy-docs.yml` - GitHub Actions workflow
- `VITEPRESS_IMPLEMENTATION_PLAN.md` - This file

### Modified files:
- `package.json` - Add scripts and dependencies
- `.gitignore` - Add VitePress build folders
- `README.md` - Add documentation link

### Existing files kept as-is:
- `docs/guides/*` - All existing guides
- `docs/api/*` - Existing API docs (augmented with generated docs)
- `docs/README.md` - Documentation index

## VitePress Configuration Reference

### Key config.ts settings:
```typescript
import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Valkeyrie',
  description: 'Type-safe key-value store with atomic transactions, Standard Schema validation and pluggable drivers',
  base: '/valkeyrie/',

  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guides/getting-started' },
      { text: 'API Reference', link: '/api/api-reference' },
      { text: 'Examples', link: '/examples' }
    ],

    sidebar: {
      '/guides/': [
        {
          text: 'Guide',
          items: [
            { text: 'Getting Started', link: '/guides/getting-started' },
            { text: 'Schema Validation', link: '/guides/schema-validation' },
            { text: 'Factory Methods', link: '/guides/factory-methods' },
            { text: 'Serializers', link: '/guides/serializers' },
            { text: 'Advanced Patterns', link: '/guides/advanced-patterns' }
          ]
        }
      ],
      '/api/': [
        {
          text: 'API Reference',
          items: [
            { text: 'API Overview', link: '/api/api-reference' },
            { text: 'Types', link: '/api/types' },
            { text: 'Generated API', link: '/api/generated/' }
          ]
        }
      ]
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/ducktors/valkeyrie' }
    ],

    search: {
      provider: 'local'
    },

    editLink: {
      pattern: 'https://github.com/ducktors/valkeyrie/edit/main/docs/:path',
      text: 'Edit this page on GitHub'
    },

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2025 Ducktors'
    }
  },

  lastUpdated: true,

  markdown: {
    lineNumbers: true
  }
})
```

## Troubleshooting

### Issue: Build fails with "Cannot find module 'vitepress'"
**Solution:** Run `pnpm install` to ensure VitePress is installed

### Issue: GitHub Actions fails with permission error
**Solution:** Go to Settings → Actions → General → Workflow permissions → Select "Read and write permissions"

### Issue: Site loads but CSS is broken
**Solution:** Check that `base: '/valkeyrie/'` is set correctly in config.ts

### Issue: API docs not generating
**Solution:**
- Check that TypeDoc is installed
- Verify `typedoc.json` configuration
- Run `pnpm docs:api` manually to see errors

### Issue: Local search not working
**Solution:** Ensure `search: { provider: 'local' }` is in themeConfig

## Resources
- VitePress Documentation: https://vitepress.dev
- TypeDoc Documentation: https://typedoc.org
- GitHub Pages Documentation: https://docs.github.com/en/pages
- VitePress Deploy Guide: https://vitepress.dev/guide/deploy
