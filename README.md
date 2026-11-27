# RustDrop P2P — Serverless Cross-Device File Beam & Live Clipboard

Written with a **Rust (`wasm32-unknown-unknown`)** binary protocol core + **WebRTC DataChannels** + **Installable PWA** so it runs seamlessly across **Fedora Workstation**, **Windows**, and **Android (Infinix Note 50 Pro)** with **$0 deployment cost**.

## Project Files
- `Cargo.toml` & `src/lib.rs` — Rust core for 20-byte binary frame packing (`pack_chunk`), IEEE 802.3 CRC32 integrity verification (`unpack_chunk`), and SDP minification (`minify_sdp`).
- `index.html` & `style.css` — Responsive dark UI tailored for both desktop and mobile touchscreens.
- `app.js` — WebRTC `RTCDataChannel` transfer engine (64 KB chunks with flow control), built-in WSS MQTT signaling client (zero custom backend needed), and offline manual SDP mode.
- `manifest.json` & `sw.js` — PWA manifest and offline cache Service Worker so you can install it directly to your Android Home Screen.

## Build Rust Core (Fedora Workstation / Windows)
```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-pack
wasm-pack build --target web
```
This outputs `pkg/rustdrop_core.js` and `pkg/rustdrop_core_bg.wasm`.

## Test Locally Across Laptop & Mobile Phone
1. Serve the folder on your local Wi-Fi/hotspot:
   ```bash
   python3 -m http.server 8080
   ```
2. Open `http://<IP-LAPTOP>:8080` on both devices (or use the Zero-Internet Manual SDP mode directly).

## Free Permanent Deployment ($0)
Push this folder (including `pkg/`) to a GitHub repository and connect it to **Cloudflare Pages**, **GitHub Pages**, or **Vercel**. HTTPS is provisioned automatically, enabling PWA installation on Android Chrome ("Add to Home Screen").
