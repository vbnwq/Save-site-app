# NetSaver — Site & Account Vault

A dark, neon, hacker-themed C++ desktop application (Windows `.exe`) for
organizing your websites on an **infinite zoomable canvas** and storing your
**accounts** in a searchable vault — with **real-time auto-save** that survives
restarts.

> Download the ready-to-run executable from **[`build/NetSaver.exe`](build/NetSaver.exe)**.

---

## ✨ Features

### ⬡ Map (Infinite Canvas)
- **Infinite canvas** with an animated neon grid background.
- **Scroll** the wheel → page moves up / down (Shift+Wheel → left / right).
- **Drag** with the mouse → pan the canvas in every direction.
- **Ctrl + Wheel** → smooth **zoom in / out** centered on the cursor.
- **Right-click empty space → Create Category** (asks for a name, drops a
  category node right where you clicked).
- **Right-click a Category** → **Add Site**, **Edit**, **Delete**.
- **Add Site** opens a form for the **site name + URL**; the site appears next to
  its category, **shaped differently** (cut-corner purple node vs. hexagon-badge
  category) and **joined by an animated neon connector line**.
- **Drag categories and sites** anywhere — the connecting line **follows in real
  time** with a flowing dash animation and a travelling pulse dot.
- **Live search** (top bar) highlights matching categories/sites and dims the rest.
- Click a site's URL to open it in the browser.

### 🔐 Accounts Vault
- Dedicated **Accounts** section with its own **search** (site / username / notes).
- **Create account**: Site, Username/Email, Password, and a **Notes/Description** box.
- Beautiful neon cards with **show/hide password**, **one-click copy** for
  username & password, **edit** and **delete**.

### 💾 Auto-save, Backup & Restore
- **Real-time auto-save** — every change is persisted instantly to
  `%APPDATA%\NetSaver\netsaver_data.json`. Close the app and everything is still
  there next launch.
- **Settings → Download Backup**: export a full JSON backup (categories, sites,
  accounts, view) via a native Save dialog.
- **Settings → Restore Backup**: load a previous backup file.
- **Erase All Data** (danger zone), plus **Reset View** / **Fit All To Screen**.

### 🎨 Theme & UI
- Dark **neon / hacker / network** aesthetic with glow, scanlines and pulse
  animations. Carefully chosen palette so colors never clash.
- Smooth modals, toasts, hover states and keyboard shortcuts
  (`/` focus search, `Ctrl+0` reset view, `f` fit all).

---

## 📦 Download / Run (Windows)

1. Grab **`build/NetSaver.exe`**.
2. Double-click it. That's it — it's a **single portable file**, no installer.

**Requirement:** the **Microsoft Edge WebView2 Runtime**, which is *pre-installed
on Windows 10 (recent updates) and Windows 11*. If a machine doesn't have it, the
free runtime is available from Microsoft (`MicrosoftEdgeWebView2RuntimeInstaller`).

The EXE only links standard Windows system DLLs — verified with `objdump`:
`KERNEL32, USER32, SHELL32, SHLWAPI, ADVAPI32, OLE32, COMDLG32, VERSION, msvcrt`.

---

## 🛠 Architecture

| Layer | Tech |
|------|------|
| Native shell | **C++17**, Win32, [`webview`](https://github.com/webview/webview) over **WebView2** |
| UI | Single self-contained HTML/CSS/JS document (`ui/index.html` + `ui/app.js`) |
| Persistence | JS ⇄ C++ bridge (`saveData` / `loadData` / `exportBackup`) writing real files |

The entire UI is **embedded into the executable** at build time
(`tools/embed.py` → `src/ui_html.h`), so the shipped `.exe` is fully
self-contained.

```
src/main.cpp        Native window + WebView2 host + save/load/backup bridge
src/ui_html.h       Auto-generated: the whole UI as one C++ string
ui/index.html       UI markup + neon theme CSS
ui/app.js           Canvas, interactions, CRUD, accounts, auto-save, backup
libs/               webview.h + Microsoft WebView2 SDK headers
assets/app.ico      Application icon
tools/embed.py      Bundles ui/* into src/ui_html.h
build.sh            Cross-compiles the Windows .exe
build/NetSaver.exe  ✅ Prebuilt single-file executable
```

---

## 🔧 Build From Source

On Linux (cross-compile) with **mingw-w64**:

```bash
sudo apt-get install -y mingw-w64 python3
./build.sh
# -> build/NetSaver.exe
```

On Windows you can compile `src/main.cpp` with MSVC/MinGW, adding the WebView2
SDK include path and linking `ole32 oleaut32 advapi32 shlwapi version shell32
comdlg32 user32`.

---

## ⌨️ Shortcuts

| Key | Action |
|-----|--------|
| `Right-click` | Context menu (create / add / edit / delete) |
| `Drag` | Pan canvas / move nodes |
| `Wheel` | Scroll up/down · `Shift+Wheel` left/right |
| `Ctrl + Wheel` | Zoom |
| `/` | Focus search |
| `Ctrl + 0` | Reset view |
| `f` | Fit all to screen |

---

*Made with a neon glow. Stay safe out there.* 🛰
