/* tslint:disable */
/* eslint-disable */

export class Core {
    free(): void;
    [Symbol.dispose](): void;
    constructor();
    reset(x: number, y: number, w: number, h: number): void;
    /**
     * Minimal params update: expects JSON with matching field names.
     * (You’ll likely replace this with serde_json later.)
     */
    set_params_json(json: string): void;
    /**
     * Packed rects: [x,y,w,h, x,y,w,h, ...]
     */
    set_world(rects: Float32Array): void;
    /**
     * Step once (60Hz) and return state+events as a JS object.
     */
    step(input_bits: number): any;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_core_free: (a: number, b: number) => void;
    readonly core_new: () => number;
    readonly core_reset: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly core_set_params_json: (a: number, b: number, c: number) => void;
    readonly core_set_world: (a: number, b: number, c: number) => void;
    readonly core_step: (a: number, b: number) => any;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
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
