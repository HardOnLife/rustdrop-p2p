/* tslint:disable */
/* eslint-disable */

export class UnpackedChunk {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly chunk_index: number;
    readonly crc_valid: boolean;
    readonly payload: Uint8Array;
    readonly total_chunks: number;
    readonly transfer_id: number;
}

/**
 * Fast IEEE 802.3 CRC32 checksum computed in Rust
 */
export function compute_crc32(data: Uint8Array | number[]): number;

export function format_bytes(bytes: number): string;

/**
 * Strips unnecessary audio/video SDP lines for DataChannel-only WebRTC handshakes
 */
export function minify_sdp(sdp: string): string;

/**
 * Packs a binary DataChannel frame:
 * [0..4]   Magic "RD01"
 * [4..8]   transfer_id (u32 BE)
 * [8..12]  chunk_index (u32 BE)
 * [12..16] total_chunks (u32 BE)
 * [16..20] payload CRC32 (u32 BE)
 * [20..]   raw payload bytes
 */
export function pack_chunk(transfer_id: number, chunk_index: number, total_chunks: number, payload: Uint8Array | number[]): Uint8Array;

/**
 * Unpacks and verifies CRC32 integrity of a binary DataChannel packet
 */
export function unpack_chunk(packet: Uint8Array | number[]): UnpackedChunk;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_unpackedchunk_free: (a: number, b: number) => void;
    readonly compute_crc32: (a: number, b: number) => number;
    readonly format_bytes: (a: number) => [number, number];
    readonly minify_sdp: (a: number, b: number) => [number, number];
    readonly pack_chunk: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly unpack_chunk: (a: number, b: number) => [number, number, number];
    readonly unpackedchunk_chunk_index: (a: number) => number;
    readonly unpackedchunk_crc_valid: (a: number) => number;
    readonly unpackedchunk_payload: (a: number) => [number, number];
    readonly unpackedchunk_total_chunks: (a: number) => number;
    readonly unpackedchunk_transfer_id: (a: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
