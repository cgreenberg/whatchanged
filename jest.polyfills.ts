/**
 * Polyfills for jest-environment-jsdom which does not provide all Node globals.
 * MSW v2's interceptors require these globals that are available in Node 18+
 * but not exposed in jsdom's sandboxed environment.
 */

/* eslint-disable @typescript-eslint/no-require-imports */
const { TextDecoder, TextEncoder } = require('util')
const {
  ReadableStream,
  WritableStream,
  TransformStream,
} = require('stream/web')

// BroadcastChannel is available in Node 18+
const { BroadcastChannel } = require('worker_threads')

Object.defineProperties(globalThis, {
  TextDecoder: { value: TextDecoder, writable: true, configurable: true },
  TextEncoder: { value: TextEncoder, writable: true, configurable: true },
  ReadableStream: { value: ReadableStream, writable: true, configurable: true },
  WritableStream: { value: WritableStream, writable: true, configurable: true },
  TransformStream: { value: TransformStream, writable: true, configurable: true },
  BroadcastChannel: { value: BroadcastChannel, writable: true, configurable: true },
})
