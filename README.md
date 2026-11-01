<p align="center">
  <img src="assets/banner.png" alt="Lucent">
</p>

<p align="center">
  Glass widgets, Finder-style desktop icons and Spotlight search for the Windows desktop.
</p>

Lucent is an independent project. It is not affiliated with or endorsed by Apple.

## Requirements

Windows 10 or 11 with the WebView2 runtime, which ships with both.

## Build

You need Node.js LTS, Rust, and the Visual Studio Build Tools with the C++ workload.

```
npm install
npm run overlay            # run in development
npm run overlay:portable   # single exe: src-tauri/target/release/lucent.exe
npm run overlay:bundle     # NSIS installer
```

Other scripts: `npm run typecheck`, `npm run lint`, `npm run overlay:build` (front end only).

## Using it

Lucent lives in the system tray. Windows may hide the icon under the `^` arrow, so drag it out to pin it.

- Left-click the tray icon to enter or leave Edit Widgets.
- Right-click the tray icon for Spotlight, Settings, glass desktop icons and Quit.
- Right-click a widget or the desktop for more options.

Settings are stored in `%APPDATA%\com.lucent.app`.

## Custom widgets

A widget is one `.widget.html` file in `%APPDATA%\com.lucent.app\widgets`. It shows up under **My Widgets** in the gallery, and saving the file reloads every copy on your desktop. `src-tauri/widgets/_template.widget.html` is a documented starting point.

Settings are `<meta>` tags (`widget-name`, `widget-description`, `widget-size`, `widget-interactive`, `widget-family`, `widget-fields`). Inside the page you get a small `glass` object:

```js
glass.ready((g) => {
  g.size;                     // 'S' | 'M' | 'L' | 'XL' | 'XXL'
  g.dark;                     // current appearance
  g.on('system', (s) => {});  // CPU, memory and disk numbers every second
  g.storage.set('k', 1);      // saved per widget
});
```

Widgets run in a sandboxed iframe with no access to your files or the app. They can make `https:` requests and nothing else.

## Built-in widgets

Each built-in widget is one TypeScript file in `src/widgets/`. Copy `src/widgets/_template.ts` to add one. Files starting with `_` are shared helpers.

## Credits and license

MIT, see `LICENSE`.

The glass effect uses a vendored copy of [ybouane/liquidglass](https://github.com/ybouane/liquidglass) (MIT). Lucent started from Liquid Glass Studio by Charles Yin (MIT).
