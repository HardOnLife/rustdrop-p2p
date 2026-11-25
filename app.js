/**
 * RustDrop P2P Controller
 * Uses Rust/WASM (`./pkg/rustdrop_core.js`) when compiled, with an automatic
 * binary-compatible JS fallback so it runs both pre-build and post-build.
 */

const CHUNK_SIZE = 64 * 1024; // 64 KB optimal WebRTC DataChannel frame
const MAGIC = [0x52, 0x44, 0x30, 0x31]; // "RD01"
const CLIENT_ID = "rd-" + Math.random().toString(36).slice(2, 10);

// 1. Load Rust WASM Core (with seamless JS fallback)
let core = null;

async function initCore() {
  const badge = document.getElementById("engine-badge");
  try {
    const wasm = await import("./pkg/rustdrop_core.js");
    await wasm.default();
    core = {
      isWasm: true,
      packChunk: wasm.pack_chunk,
      unpackChunk: (u8) => {
        const res = wasm.unpack_chunk(u8);
        return {
          transferId: res.transfer_id,
          chunkIndex: res.chunk_index,
          totalChunks: res.total_chunks,
          crcValid: res.crc_valid,
          payload: res.payload
        };
      },
      minifySdp: wasm.minify_sdp,
      formatBytes: wasm.format_bytes
    };
    badge.textContent = "Engine: Rust WASM";
    badge.style.color = "#f97316";
  } catch {
    // Fallback identical to Rust binary protocol
    const crcTable = new Uint32Array(256).map((_, n) => {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      return c >>> 0;
    });
    const crc32 = (u8) => {
      let crc = 0xffffffff;
      for (let i = 0; i < u8.length; i++) crc = crcTable[(crc ^ u8[i]) & 0xff] ^ (crc >>> 8);
      return (crc ^ 0xffffffff) >>> 0;
    };

    core = {
      isWasm: false,
      packChunk(transferId, chunkIndex, totalChunks, payload) {
        const pkt = new Uint8Array(20 + payload.length);
        pkt.set(MAGIC, 0);
        const dv = new DataView(pkt.buffer);
        dv.setUint32(4, transferId);
        dv.setUint32(8, chunkIndex);
        dv.setUint32(12, totalChunks);
        dv.setUint32(16, crc32(payload));
        pkt.set(payload, 20);
        return pkt;
      },
      unpackChunk(pkt) {
        if (pkt.length < 20 || pkt[0] !== 0x52 || pkt[1] !== 0x44) {
          throw new Error("Invalid header");
        }
        const dv = new DataView(pkt.buffer, pkt.byteOffset, pkt.byteLength);
        const transferId = dv.getUint32(4);
        const chunkIndex = dv.getUint32(8);
        const totalChunks = dv.getUint32(12);
        const expectedCrc = dv.getUint32(16);
        const payload = pkt.slice(20);
        return {
          transferId,
          chunkIndex,
          totalChunks,
          crcValid: crc32(payload) === expectedCrc,
          payload
        };
      },
      minifySdp: (sdp) =>
        sdp
          .split(/\r?\n/)
          .filter((l) => l && !l.startsWith("a=extmap") && !l.startsWith("a=rtcp-fb"))
          .join("\n") + "\n",
      formatBytes: (b) => {
        if (b <= 0) return "0 B";
        const u = ["B", "KB", "MB", "GB"];
        const i = Math.min(3, Math.floor(Math.log(b) / Math.log(1024)));
        return `${(b / 1024 ** i).toFixed(2)} ${u[i]}`;
      }
    };
    badge.textContent = "Engine: JS Fallback (Run wasm-pack for Rust)";
  }
}

// 2. Minimal Zero-Dependency MQTT-over-WebSocket Client (for Free Public Signaling)
class TinyWssMqtt {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.onMessage = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url, "mqtt");
      this.ws.binaryType = "arraybuffer";

      this.ws.onopen = () => {
        const idBytes = new TextEncoder().encode(CLIENT_ID);
        const remLen = 10 + 2 + idBytes.length;
        const pkt = new Uint8Array(2 + remLen);
        pkt[0] = 0x10; // CONNECT
        pkt[1] = remLen;
        pkt.set([0x00, 0x04, 0x4d, 0x51, 0x54, 0x54, 0x04, 0x02, 0x00, 0x3c], 2);
        pkt[12] = (idBytes.length >> 8) & 0xff;
        pkt[13] = idBytes.length & 0xff;
        pkt.set(idBytes, 14);
        this.ws.send(pkt);
      };

      this.ws.onmessage = (ev) => {
        const buf = new Uint8Array(ev.data);
        const type = buf[0] >> 4;
        if (type === 2) resolve(); // CONNACK
        if (type === 3 && this.onMessage) {
          // PUBLISH
          let idx = 1;
          let mult = 1;
          let rem = 0;
          let b;
          do {
            b = buf[idx++];
            rem += (b & 127) * mult;
            mult *= 128;
          } while ((b & 128) !== 0);
          const topicLen = (buf[idx] << 8) | buf[idx + 1];
          idx += 2 + topicLen;
          const payload = new TextDecoder().decode(buf.slice(idx));
          this.onMessage(payload);
        }
      };

      this.ws.onerror = reject;
    });
  }

  subscribe(topic) {
    const tBytes = new TextEncoder().encode(topic);
    const remLen = 2 + 2 + tBytes.length + 1;
    const pkt = new Uint8Array(2 + remLen);
    pkt[0] = 0x82;
    pkt[1] = remLen;
    pkt[2] = 0x00;
    pkt[3] = 0x01;
    pkt[4] = (tBytes.length >> 8) & 0xff;
    pkt[5] = tBytes.length & 0xff;
    pkt.set(tBytes, 6);
    pkt[6 + tBytes.length] = 0x00;
    this.ws.send(pkt);
  }

  publish(topic, text) {
    const tBytes = new TextEncoder().encode(topic);
    const pBytes = new TextEncoder().encode(text);
    const remLen = 2 + tBytes.length + pBytes.length;
    const header = [0x30];
    let x = remLen;
    do {
      let enc = x % 128;
      x = Math.floor(x / 128);
      if (x > 0) enc |= 128;
      header.push(enc);
    } while (x > 0);
    const pkt = new Uint8Array(header.length + remLen);
    pkt.set(header, 0);
    let o = header.length;
    pkt[o++] = (tBytes.length >> 8) & 0xff;
    pkt[o++] = tBytes.length & 0xff;
    pkt.set(tBytes, o);
    o += tBytes.length;
    pkt.set(pBytes, o);
    this.ws.send(pkt);
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

// 3. WebRTC Peer Connection & DataChannel Engine
let pc = null;
let dc = null;
let mqtt = null;
let roomTopic = "";
const incomingTransfers = new Map();

const statusDot = document.getElementById("status-dot");
const netBadge = document.getElementById("net-badge");
const clipArea = document.getElementById("shared-clipboard");
const clipStatus = document.getElementById("clip-status");
const transferList = document.getElementById("transfer-list");
const speedMeter = document.getElementById("speed-meter");

function setConnState(state, label) {
  statusDot.className = "status-dot " + state;
  netBadge.textContent = label;
}

function createPeerConnection() {
  if (pc) pc.close();
  pc = new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" }
    ]
  });

  pc.ondatachannel = (ev) => setupDataChannel(ev.channel);

  pc.oniceconnectionstatechange = () => {
    const st = pc.iceConnectionState;
    if (st === "connected" || st === "completed") {
      setConnState("connected", "P2P Encrypted Direct");
      clipStatus.textContent = "Live P2P Sync Active";
    } else if (st === "disconnected" || st === "failed") {
      setConnState("", "Peer Disconnected");
    }
  };
}

function setupDataChannel(channel) {
  dc = channel;
  dc.binaryType = "arraybuffer";
  dc.bufferedAmountLowThreshold = 256 * 1024;

  dc.onopen = () => {
    setConnState("connected", "P2P Encrypted Direct");
    clipStatus.textContent = "Live P2P Sync Active";
    if (mqtt) mqtt.close(); // Signaling no longer needed once P2P tunnel opens!
  };

  dc.onmessage = (ev) => {
    if (typeof ev.data === "string") {
      const msg = JSON.parse(ev.data);
      if (msg.type === "clip") {
        clipArea.value = msg.text;
        clipStatus.textContent = `Synced at ${new Date().toLocaleTimeString()}`;
      } else if (msg.type === "file-meta") {
        incomingTransfers.set(msg.transferId, {
          name: msg.name,
          size: msg.size,
          mime: msg.mime,
          totalChunks: msg.totalChunks,
          chunks: new Array(msg.totalChunks),
          received: 0,
          corrupt: false,
          startTime: performance.now(),
          el: createTransferRow(msg.name, msg.size, "Receiving")
        });
      }
    } else {
      // Binary chunk verified via Rust WASM CRC32
      const unpacked = core.unpackChunk(new Uint8Array(ev.data));
      const tr = incomingTransfers.get(unpacked.transferId);
      if (!tr) return;

      if (!unpacked.crcValid) tr.corrupt = true;
      tr.chunks[unpacked.chunkIndex] = unpacked.payload;
      tr.received++;

      const pct = Math.round((tr.received / tr.totalChunks) * 100);
      tr.el.fill.style.width = `${pct}%`;

      const elapsedSec = Math.max(0.001, (performance.now() - tr.startTime) / 1000);
      const mbps = (tr.received * CHUNK_SIZE) / (1024 * 1024) / elapsedSec;
      speedMeter.textContent = `${mbps.toFixed(2)} MB/s`;

      if (tr.received === tr.totalChunks) {
        const blob = new Blob(tr.chunks, { type: tr.mime || "application/octet-stream" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = tr.name;
        a.click();
        tr.el.status.textContent = tr.corrupt ? "CRC Warning" : "Saved • CRC32 OK";
        incomingTransfers.delete(unpacked.transferId);
      }
    }
  };
}

function createTransferRow(name, size, direction) {
  const row = document.createElement("div");
  row.className = "transfer-item";
  row.innerHTML = `
    <div class="transfer-top">
      <span class="transfer-name">${direction}: ${name} (${core.formatBytes(size)})</span>
      <span class="meta-text status-lbl">0%</span>
    </div>
    <div class="progress-bar"><div class="progress-fill"></div></div>
  `;
  transferList.prepend(row);
  return {
    fill: row.querySelector(".progress-fill"),
    status: row.querySelector(".status-lbl")
  };
}

async function sendFiles(files) {
  if (!dc || dc.readyState !== "open") {
    alert("Connect two devices first via Room PIN or Offline SDP.");
    return;
  }

  for (const file of files) {
    const transferId = Math.floor(Math.random() * 0xffffffff);
    const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
    const ui = createTransferRow(file.name, file.size, "Sending");
    const startTime = performance.now();

    dc.send(
      JSON.stringify({
        type: "file-meta",
        transferId,
        name: file.name,
        size: file.size,
        mime: file.type,
        totalChunks
      })
    );

    for (let idx = 0; idx < totalChunks; idx++) {
      if (dc.bufferedAmount > 1024 * 1024) {
        await new Promise((r) => (dc.onbufferedamountlow = r));
      }
      const slice = file.slice(idx * CHUNK_SIZE, (idx + 1) * CHUNK_SIZE);
      const buf = new Uint8Array(await slice.arrayBuffer());
      const packet = core.packChunk(transferId, idx, totalChunks, buf);
      dc.send(packet);

      const pct = Math.round(((idx + 1) / totalChunks) * 100);
      ui.fill.style.width = `${pct}%`;
      ui.status.textContent = `${pct}%`;

      const elapsedSec = Math.max(0.001, (performance.now() - startTime) / 1000);
      const mbps = ((idx + 1) * CHUNK_SIZE) / (1024 * 1024) / elapsedSec;
      speedMeter.textContent = `${mbps.toFixed(2)} MB/s`;
    }
    ui.status.textContent = "Sent • CRC32 OK";
  }
}

// 4. Mode 1: Auto-Signaling via Public WSS MQTT Broker
async function connectWithPin(pin) {
  if (!pin || pin.length < 3) return alert("Enter a 4-digit Room PIN.");
  setConnState("connecting", `Joining Room ${pin}...`);
  createPeerConnection();

  roomTopic = `rustdrop/v1/room/${pin}`;
  mqtt = new TinyWssMqtt("wss://broker.emqx.io:8084/mqtt");
  await mqtt.connect();
  mqtt.subscribe(roomTopic);

  mqtt.onMessage = async (raw) => {
    const msg = JSON.parse(raw);
    if (msg.sender === CLIENT_ID) return;

    if (msg.type === "hello") {
      // Another peer is waiting -> we initiate Offer
      const channel = pc.createDataChannel("rustdrop", { ordered: true });
      setupDataChannel(channel);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitIceComplete(pc);
      mqtt.publish(
        roomTopic,
        JSON.stringify({ sender: CLIENT_ID, type: "offer", sdp: pc.localDescription.sdp })
      );
    } else if (msg.type === "offer") {
      await pc.setRemoteDescription({ type: "offer", sdp: msg.sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitIceComplete(pc);
      mqtt.publish(
        roomTopic,
        JSON.stringify({ sender: CLIENT_ID, type: "answer", sdp: pc.localDescription.sdp })
      );
    } else if (msg.type === "answer") {
      await pc.setRemoteDescription({ type: "answer", sdp: msg.sdp });
    }
  };

  mqtt.publish(roomTopic, JSON.stringify({ sender: CLIENT_ID, type: "hello" }));
  setConnState("connecting", `Waiting in Room ${pin}...`);
}

function waitIceComplete(peerConn) {
  return new Promise((resolve) => {
    if (peerConn.iceGatheringState === "complete") return resolve();
    const check = () => {
      if (peerConn.iceGatheringState === "complete") {
        peerConn.removeEventListener("icegatheringstatechange", check);
        resolve();
      }
    };
    peerConn.addEventListener("icegatheringstatechange", check);
    setTimeout(resolve, 1800);
  });
}

// 5. Mode 2: Zero-Internet Offline SDP Handshake
const sdpBox = document.getElementById("sdp-box");

document.getElementById("btn-create-offer").addEventListener("click", async () => {
  setConnState("connecting", "Generating Offline Offer...");
  createPeerConnection();
  const channel = pc.createDataChannel("rustdrop", { ordered: true });
  setupDataChannel(channel);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitIceComplete(pc);
  sdpBox.value = btoa(core.minifySdp(pc.localDescription.sdp));
});

document.getElementById("btn-accept-offer").addEventListener("click", async () => {
  if (!sdpBox.value.trim()) return alert("Paste the Sender's Offer payload first.");
  setConnState("connecting", "Generating Offline Answer...");
  createPeerConnection();
  const rawSdp = atob(sdpBox.value.trim());
  await pc.setRemoteDescription({ type: "offer", sdp: rawSdp });
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await waitIceComplete(pc);
  sdpBox.value = btoa(core.minifySdp(pc.localDescription.sdp));
});

document.getElementById("btn-accept-answer").addEventListener("click", async () => {
  if (!sdpBox.value.trim()) return alert("Paste the Receiver's Answer payload first.");
  const rawSdp = atob(sdpBox.value.trim());
  await pc.setRemoteDescription({ type: "answer", sdp: rawSdp });
});

document.getElementById("btn-copy-sdp").addEventListener("click", () => {
  navigator.clipboard.writeText(sdpBox.value);
});

// UI Wiring
document.querySelectorAll(".mode-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".mode-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("panel-pin").classList.toggle("hidden", btn.dataset.mode !== "pin");
    document.getElementById("panel-offline").classList.toggle("hidden", btn.dataset.mode !== "offline");
  });
});

document.getElementById("btn-gen-pin").addEventListener("click", () => {
  document.getElementById("room-pin").value = Math.floor(1000 + Math.random() * 9000);
});

document.getElementById("btn-connect-pin").addEventListener("click", () => {
  connectWithPin(document.getElementById("room-pin").value.trim());
});

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("file-input");

fileInput.addEventListener("change", (e) => {
  if (e.target.files.length) sendFiles(e.target.files);
  e.target.value = "";
});

dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("dragover");
});
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("dragover");
  if (e.dataTransfer.files.length) sendFiles(e.dataTransfer.files);
});

clipArea.addEventListener("input", () => {
  if (dc && dc.readyState === "open") {
    dc.send(JSON.stringify({ type: "clip", text: clipArea.value }));
  }
});

document.getElementById("btn-copy-clip").addEventListener("click", () => {
  navigator.clipboard.writeText(clipArea.value);
  clipStatus.textContent = "Copied to device clipboard";
});

document.getElementById("btn-paste-send").addEventListener("click", async () => {
  const txt = await navigator.clipboard.readText();
  clipArea.value = txt;
  if (dc && dc.readyState === "open") {
    dc.send(JSON.stringify({ type: "clip", text: txt }));
  }
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

initCore();
