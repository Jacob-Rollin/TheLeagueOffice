1. Create `public/espn-fallback.svg` with the exact ESPN crimson-red slanted vector and `public/yahoo-fallback.svg` with the exact Yahoo deep-purple vector.
2. Refactor `src/components/league/LeagueAvatar.tsx` so that ESPN and Yahoo fallback badges render native `<img>` tags pointing to the new local static assets.
3. Hardlock the fallback container to `bg-white border border-neutral-200 w-10 h-10 rounded-full flex items-center justify-center p-1.5 overflow-hidden`.
4. Render the inner images at `w-8 h-8 object-contain`, applying `transform -translate-x-[1px]` only to the ESPN image to counterbalance its italic slant.
5. Preserve optional-chaining guards and existing generic silhouette fallback for other platforms, keeping all other code untouched.
