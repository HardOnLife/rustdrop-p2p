use wasm_bindgen::prelude::*;

const MAGIC: &[u8; 4] = b"RD01";
const HEADER_LEN: usize = 20; // 4 magic + 4 transfer_id + 4 chunk_idx + 4 total_chunks + 4 crc32

/// Fast IEEE 802.3 CRC32 checksum computed in Rust
#[wasm_bindgen]
pub fn compute_crc32(data: &[u8]) -> u32 {
    let mut crc: u32 = 0xFFFF_FFFF;
    for &byte in data {
        crc ^= byte as u32;
        for _ in 0..8 {
            if (crc & 1) != 0 {
                crc = (crc >> 1) ^ 0xEDB8_8320;
            } else {
                crc >>= 1;
            }
        }
    }
    !crc
}

/// Packs a binary DataChannel frame:
/// [0..4]   Magic "RD01"
/// [4..8]   transfer_id (u32 BE)
/// [8..12]  chunk_index (u32 BE)
/// [12..16] total_chunks (u32 BE)
/// [16..20] payload CRC32 (u32 BE)
/// [20..]   raw payload bytes
#[wasm_bindgen]
pub fn pack_chunk(
    transfer_id: u32,
    chunk_index: u32,
    total_chunks: u32,
    payload: &[u8],
) -> Vec<u8> {
    let crc = compute_crc32(payload);
    let mut packet = Vec::with_capacity(HEADER_LEN + payload.len());
    packet.extend_from_slice(MAGIC);
    packet.extend_from_slice(&transfer_id.to_be_bytes());
    packet.extend_from_slice(&chunk_index.to_be_bytes());
    packet.extend_from_slice(&total_chunks.to_be_bytes());
    packet.extend_from_slice(&crc.to_be_bytes());
    packet.extend_from_slice(payload);
    packet
}

#[wasm_bindgen]
pub struct UnpackedChunk {
    transfer_id: u32,
    chunk_index: u32,
    total_chunks: u32,
    crc_valid: bool,
    payload: Vec<u8>,
}

#[wasm_bindgen]
impl UnpackedChunk {
    #[wasm_bindgen(getter)]
    pub fn transfer_id(&self) -> u32 {
        self.transfer_id
    }

    #[wasm_bindgen(getter)]
    pub fn chunk_index(&self) -> u32 {
        self.chunk_index
    }

    #[wasm_bindgen(getter)]
    pub fn total_chunks(&self) -> u32 {
        self.total_chunks
    }

    #[wasm_bindgen(getter)]
    pub fn crc_valid(&self) -> bool {
        self.crc_valid
    }

    #[wasm_bindgen(getter)]
    pub fn payload(&self) -> Vec<u8> {
        self.payload.clone()
    }
}

/// Unpacks and verifies CRC32 integrity of a binary DataChannel packet
#[wasm_bindgen]
pub fn unpack_chunk(packet: &[u8]) -> Result<UnpackedChunk, JsValue> {
    if packet.len() < HEADER_LEN || &packet[0..4] != MAGIC {
        return Err(JsValue::from_str("Invalid RustDrop packet header"));
    }

    let transfer_id = u32::from_be_bytes(packet[4..8].try_into().unwrap());
    let chunk_index = u32::from_be_bytes(packet[8..12].try_into().unwrap());
    let total_chunks = u32::from_be_bytes(packet[12..16].try_into().unwrap());
    let expected_crc = u32::from_be_bytes(packet[16..20].try_into().unwrap());
    let payload = packet[HEADER_LEN..].to_vec();
    let actual_crc = compute_crc32(&payload);

    Ok(UnpackedChunk {
        transfer_id,
        chunk_index,
        total_chunks,
        crc_valid: expected_crc == actual_crc,
        payload,
    })
}

/// Strips unnecessary audio/video SDP lines for DataChannel-only WebRTC handshakes
#[wasm_bindgen]
pub fn minify_sdp(sdp: &str) -> String {
    sdp.lines()
        .filter(|line| {
            let l = line.trim();
            !l.is_empty()
                && !l.starts_with("a=extmap")
                && !l.starts_with("a=rtcp-fb")
                && !l.starts_with("a=msid-semantic")
        })
        .collect::<Vec<_>>()
        .join("\n")
        + "\n"
}

#[wasm_bindgen]
pub fn format_bytes(bytes: f64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    if bytes <= 0.0 {
        return "0 B".to_string();
    }
    let idx = (bytes.log10() / 1024_f64.log10()).floor() as usize;
    let idx = idx.min(UNITS.len() - 1);
    let val = bytes / 1024_f64.powi(idx as i32);
    format!("{:.2} {}", val, UNITS[idx])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pack_unpack_roundtrip() {
        let data = b"Hello from Fedora Workstation to Infinix Note 50 Pro!";
        let pkt = pack_chunk(42, 0, 1, data);
        let unpacked = unpack_chunk(&pkt).expect("valid packet");
        assert_eq!(unpacked.transfer_id(), 42);
        assert_eq!(unpacked.chunk_index(), 0);
        assert_eq!(unpacked.total_chunks(), 1);
        assert!(unpacked.crc_valid());
        assert_eq!(unpacked.payload(), data);
    }
}
