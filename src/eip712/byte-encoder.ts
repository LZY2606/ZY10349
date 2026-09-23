import { arrToBufArr } from '@ethereumjs/util';
import { encode } from '@metamask/abi-utils';
import { keccak256 } from 'ethereum-cryptography/keccak';

import { TypedDataEncodingError } from './encoding-error';
import type { TypedValueEvent, TypedValueEventSink } from './value-walker';

/**
 * An encoder frame: the accumulated ABI types and values of a single struct
 * or array, while its children are being processed.
 */
type EncoderFrame = {
  kind: 'struct' | 'array';
  path: string;
  types: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  values: any[];
};

/**
 * The byte encoder: a {@link TypedValueEventSink} that turns a balanced
 * stream of typed value events into the EIP-712 encoding of a message.
 *
 * The encoder only ever consumes validated events. It never looks at type
 * strings or message values itself: struct events carry a precomputed type
 * hash, and leaf events carry a normalized ABI `[type, value]` pair. The
 * only byte-level operation it performs is the final ABI `encode` of each
 * struct and array, plus the keccak256 hash of those encodings, exactly like
 * the legacy implementation.
 */
export class ByteEncoder implements TypedValueEventSink {
  readonly #frames: EncoderFrame[] = [];

  #result: Uint8Array | null = null;

  /**
   * Consume a single typed value event.
   *
   * @param event - The event to consume.
   */
  emit(event: TypedValueEvent): void {
    switch (event.kind) {
      case 'structStart':
        this.#frames.push({
          kind: 'struct',
          path: event.path,
          types: ['bytes32'],
          values: [event.typeHash],
        });
        break;

      case 'arrayStart':
        this.#frames.push({
          kind: 'array',
          path: event.path,
          types: [],
          values: [],
        });
        break;

      case 'leaf':
        this.#currentFrame().types.push(event.abiType);
        this.#currentFrame().values.push(event.value);
        break;

      case 'arrayEnd': {
        const frame = this.#popFrame('array', event.path);
        const hash = arrToBufArr(keccak256(this.#encodeFrame(frame)));
        this.#pushLeaf('bytes32', hash);
        break;
      }

      case 'structEnd': {
        const frame = this.#popFrame('struct', event.path);
        const encoded = this.#encodeFrame(frame);
        if (this.#frames.length === 0) {
          this.#result = encoded;
        } else {
          this.#pushLeaf('bytes32', arrToBufArr(keccak256(encoded)));
        }
        break;
      }

      default:
        // All event kinds are handled above.
        break;
    }
  }

  /**
   * Get the encoded message. Only valid after the root `structEnd` event.
   *
   * @returns The EIP-712 encoding of the message.
   */
  getResult(): Uint8Array {
    if (this.#result === null || this.#frames.length !== 0) {
      throw new Error(
        'ByteEncoder: Cannot get the result of an incomplete event stream.',
      );
    }
    return this.#result;
  }

  /**
   * Get the frame currently on top of the stack.
   *
   * @returns The current frame.
   */
  #currentFrame(): EncoderFrame {
    const frame = this.#frames[this.#frames.length - 1];
    if (frame === undefined) {
      throw new Error(
        'ByteEncoder: Received a leaf event outside of a struct or array.',
      );
    }
    return frame;
  }

  /**
   * Pop the frame on top of the stack, validating its kind and path.
   *
   * @param kind - The expected frame kind.
   * @param path - The expected frame path.
   * @returns The popped frame.
   */
  #popFrame(kind: 'struct' | 'array', path: string): EncoderFrame {
    const frame = this.#frames.pop();
    if (frame === undefined || frame.kind !== kind || frame.path !== path) {
      throw new Error(
        `ByteEncoder: Unbalanced event stream. Expected the end of ${kind} at path "${path}".`,
      );
    }
    return frame;
  }

  /**
   * Push a leaf value onto the current frame.
   *
   * @param abiType - The ABI type of the value.
   * @param value - The value.
   */
  #pushLeaf(abiType: string, value: unknown): void {
    const frame = this.#currentFrame();
    frame.types.push(abiType);
    frame.values.push(value);
  }

  /**
   * ABI-encode the accumulated types and values of a frame. Errors thrown by
   * the ABI encoder are re-thrown with the path of the frame, so that
   * failures can be located in the original message.
   *
   * @param frame - The frame to encode.
   * @returns The encoded bytes.
   */
  #encodeFrame(frame: EncoderFrame): Uint8Array {
    try {
      return encode(frame.types, frame.values);
    } catch (error) {
      if (error instanceof Error) {
        throw new TypedDataEncodingError(error.message, frame.path);
      }
      throw error;
    }
  }
}
