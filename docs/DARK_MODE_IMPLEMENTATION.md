# Light/Dark Mode Implementation (Dashboard)

This repo's `dashboard/` app (Next.js + Tailwind) uses the "class strategy" for dark mode:

- Light vs dark is controlled by adding/removing the `dark` class on the `<html>` element.
- Colors are defined as CSS variables (HSL) and Tailwind is configured to reference those variables.

The end result:

- A toggle button switches theme.
- The choice persists in `localStorage`.
- A tiny inline script runs *before React hydrates* to avoid the "flash" of the wrong theme.

## 1) Tailwind Setup (Class-Based Dark Mode)

Tailwind is configured with:

- `darkMode: ["class"]`

See: `dashboard/tailwind.config.ts`

That means Tailwind variants like `dark:bg-zinc-950` apply when `<html class="dark">` is present.

## 2) Theme Tokens (CSS Variables)

Theme colors are defined via CSS variables:

- Light variables live under `:root`
- Dark overrides live under `.dark`

See: `dashboard/src/app/globals.css`

Key details in this project:

- Variables like `--background`, `--foreground`, `--card`, etc.
- Tailwind utilities use these via `bg-background`, `text-foreground`, etc. (see the `@layer base` body styles)
- `color-scheme: light|dark` is set so native UI (scrollbars, form controls) matches the theme

## 3) Preventing Theme Flash (Before Hydration Script)

Problem:

- If the page renders in light mode on the server, then flips to dark on the client, users see a flash.

Solution:

- Inject a small script that runs `beforeInteractive` to set the `dark` class as early as possible.

See: `dashboard/src/app/layout.tsx`

What it does:

- Reads `localStorage["theme"]` (valid values: `light`, `dark`, `system`)
- If `system`, it uses `matchMedia("(prefers-color-scheme: dark)")`
- Applies or removes the `dark` class on `document.documentElement`

Also note:

- `suppressHydrationWarning` is set on `<html>` because the class can differ between server HTML and client HTML.

## 4) Theme Provider + Hook (Persistent State)

React-side theme state lives in a provider so any component can read/update it.

See: `dashboard/src/components/theme/ThemeProvider.tsx`

Responsibilities:

- Owns `theme` (`light` | `dark` | `system`)
- Computes `resolvedTheme` (`light` | `dark`)
- Persists `theme` to `localStorage` key `theme`
- Keeps `<html>` in sync by adding/removing the `dark` class
- Listens for OS theme changes when `theme === "system"`

The provider is mounted for the whole app via:

- `dashboard/src/components/Providers.tsx`

## 5) Toggle UI

The toggle is a small client component that flips between light and dark (explicitly).

See:

- `dashboard/src/components/theme/ThemeToggle.tsx`
- Used in the sidebar header: `dashboard/src/components/layout/Sidebar.tsx`

Behavior:

- If currently dark, clicking sets `theme` to `light`
- If currently light, clicking sets `theme` to `dark`

## Reusing This Pattern In Your Own App

Minimal checklist:

1. Tailwind: set `darkMode: ["class"]`
2. CSS: define light tokens in `:root` and dark overrides in `.dark`
3. Early script: set the `dark` class before hydration based on `localStorage` and/or system preference
4. Provider: keep state + persistence + `<html>` class in sync
5. Toggle: call `setTheme("dark" | "light" | "system")`

If you want, tell me which app you want this extracted into next (or whether you want a reusable shared package under `shared/`), and I can refactor it so it is copy/paste friendly across projects.

