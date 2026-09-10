# The Simisium

Text-based, LLM-driven life simulation for mobile (Expo / React Native / TypeScript).

- Read `docs/ARCHITECTURE.md` before touching the engine.
- `src/engine/**` is pure TypeScript with **no React Native imports** so it runs in Node (vitest, headless sims).
- Run `npm run typecheck` and `npm test` before committing.
- Expo SDK 57 docs: https://docs.expo.dev/versions/v57.0.0/
