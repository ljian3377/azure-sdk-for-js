// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { AvroReadable } from "./AvroReadable";
import { KeyValuePair } from "./utils/utils.common";
import { AbortSignalLike } from "@azure/abort-controller";

/**
 * Options to configure the AvroParser read methods.
 * See {@link AvroParser.readFixedBytes}, {@link AvroParser.readMap} and etc.
 *
 * @export
 * @interface AvroParserReadOptions
 */
interface AvroParserReadOptions {
  /**
   * An implementation of the `AbortSignalLike` interface to signal the request to cancel the operation.
   * For example, use the &commat;azure/abort-controller to create an `AbortSignal`.
   *
   * @type {AbortSignalLike}
   * @memberof AvroParserReadOptions
   */
  abortSignal?: AbortSignalLike;
}

export class AvroParser {
  /**
   * Reads a fixed number of bytes from the stream.
   *
   * @static
   * @param {AvroReadable} [stream]
   * @param {number} [length]
   * @param {AvroParserReadOptions} [options={}]
   * @returns {Promise<Uint8Array>}
   * @memberof AvroParser
   */
  public static async readFixedBytes(
    stream: AvroReadable,
    length: number,
    options: AvroParserReadOptions = {}
  ): Promise<Uint8Array> {
    const bytes = await stream.read(length, { abortSignal: options.abortSignal });
    if (bytes.length != length) {
      throw new Error("Hit stream end.");
    }
    return bytes;
  }

  /**
   * Reads a single byte from the stream.
   *
   * @static
   * @param {AvroReadable} [stream]
   * @param {AvroParserReadOptions} [options={}]
   * @returns {Promise<number>}
   * @memberof AvroParser
   */
  private static async readByte(
    stream: AvroReadable,
    options: AvroParserReadOptions = {}
  ): Promise<number> {
    const buf = await AvroParser.readFixedBytes(stream, 1, options);
    return buf[0];
  }

  // int and long are stored in variable-length zig-zag coding.
  // variable-length: https://lucene.apache.org/core/3_5_0/fileformats.html#VInt
  // zig-zag: https://developers.google.com/protocol-buffers/docs/encoding?csw=1#types
  private static async readZigZagLong(
    stream: AvroReadable,
    options: AvroParserReadOptions = {}
  ): Promise<number> {
    let zigZagEncoded = 0;
    let significanceInBit = 0;
    let byte, haveMoreByte, significanceInFloat;

    do {
      byte = await AvroParser.readByte(stream, options);
      haveMoreByte = byte & 0x80;
      zigZagEncoded |= (byte & 0x7f) << significanceInBit;
      significanceInBit += 7;
    } while (haveMoreByte && significanceInBit < 28); // bitwise operation only works for 32-bit integers

    if (haveMoreByte) {
      // Switch to float arithmetic
      zigZagEncoded = zigZagEncoded;
      significanceInFloat = 268435456; // 2 ** 28.
      do {
        byte = await AvroParser.readByte(stream, options);
        zigZagEncoded += (byte & 0x7f) * significanceInFloat;
        significanceInFloat *= 128; // 2 ** 7
      } while (byte & 0x80);

      const res = (zigZagEncoded % 2 ? -(zigZagEncoded + 1) : zigZagEncoded) / 2;
      if (res < Number.MIN_SAFE_INTEGER || res > Number.MAX_SAFE_INTEGER) {
        throw new Error("Integer overflow.");
      }
      return res;
    }

    return (zigZagEncoded >> 1) ^ -(zigZagEncoded & 1);
  }

  public static async readLong(
    stream: AvroReadable,
    options: AvroParserReadOptions = {}
  ): Promise<number> {
    return AvroParser.readZigZagLong(stream, options);
  }

  public static async readInt(
    stream: AvroReadable,
    options: AvroParserReadOptions = {}
  ): Promise<number> {
    return AvroParser.readZigZagLong(stream, options);
  }

  public static async readNull(): Promise<null> {
    return null;
  }

  public static async readBoolean(
    stream: AvroReadable,
    options: AvroParserReadOptions = {}
  ): Promise<Boolean> {
    const b = await AvroParser.readByte(stream, options);
    if (b == 1) {
      return true;
    } else if (b == 0) {
      return false;
    } else {
      throw new Error("Byte was not a boolean.");
    }
  }

  public static async readFloat(
    stream: AvroReadable,
    options: AvroParserReadOptions = {}
  ): Promise<number> {
    const u8arr = await AvroParser.readFixedBytes(stream, 4, options);
    const view = new DataView(u8arr.buffer, u8arr.byteOffset, u8arr.byteLength);
    return view.getFloat32(0, true); // littleEndian = true
  }

  public static async readDouble(
    stream: AvroReadable,
    options: AvroParserReadOptions = {}
  ): Promise<number> {
    const u8arr = await AvroParser.readFixedBytes(stream, 8, options);
    const view = new DataView(u8arr.buffer, u8arr.byteOffset, u8arr.byteLength);
    return view.getFloat64(0, true); // littleEndian = true
  }

  public static async readBytes(
    stream: AvroReadable,
    options: AvroParserReadOptions = {}
  ): Promise<Uint8Array> {
    const size = await AvroParser.readLong(stream, options);
    if (size < 0) {
      throw new Error("Bytes size was negative.");
    }

    return await stream.read(size, { abortSignal: options.abortSignal });
  }

  public static async readString(
    stream: AvroReadable,
    options: AvroParserReadOptions = {}
  ): Promise<string> {
    const u8arr = await AvroParser.readBytes(stream, options);

    // polyfill TextDecoder to be backward compatible with older
    // nodejs that doesn't expose TextDecoder as a global variable
    if (typeof TextDecoder === "undefined" && typeof require !== "undefined") {
      (global as any).TextDecoder = require("util").TextDecoder;
    }

    // FUTURE: need TextDecoder polyfill for IE
    let utf8decoder = new TextDecoder();
    return utf8decoder.decode(u8arr);
  }

  private static async readMapPair<T>(
    stream: AvroReadable,
    readItemMethod: (s: AvroReadable, options?: AvroParserReadOptions) => Promise<T>,
    options: AvroParserReadOptions = {}
  ): Promise<KeyValuePair<T>> {
    const key = await AvroParser.readString(stream, options);
    // FUTURE: this won't work with readFixed (currently not supported) which need a length as the parameter.
    const value = await readItemMethod(stream, options);
    return { key, value };
  }

  public static async readMap<T>(
    stream: AvroReadable,
    readItemMethod: (s: AvroReadable, options?: AvroParserReadOptions) => Promise<T>,
    options: AvroParserReadOptions = {}
  ): Promise<Record<string, T>> {
    const readPairMethod = async (
      stream: AvroReadable,
      options: AvroParserReadOptions = {}
    ): Promise<KeyValuePair<T>> => {
      return await AvroParser.readMapPair(stream, readItemMethod, options);
    };

    const pairs: KeyValuePair<T>[] = await AvroParser.readArray(stream, readPairMethod, options);

    let dict: Record<string, T> = {};
    for (const pair of pairs) {
      dict[pair.key] = pair.value;
    }
    return dict;
  }

  private static async readArray<T>(
    stream: AvroReadable,
    readItemMethod: (s: AvroReadable, options?: AvroParserReadOptions) => Promise<T>,
    options: AvroParserReadOptions = {}
  ): Promise<T[]> {
    let items: T[] = [];
    for (
      let count = await AvroParser.readLong(stream, options);
      count != 0;
      count = await AvroParser.readLong(stream, options)
    ) {
      if (count < 0) {
        // Ignore block sizes
        await AvroParser.readLong(stream, options);
        count = -count;
      }

      while (count--) {
        const item: T = await readItemMethod(stream, options);
        items.push(item);
      }
    }
    return items;
  }
}

interface RecordField {
  name: string;
  type: string | ObjectSchema | (string | ObjectSchema)[]; // Unions may not immediately contain other unions.
}

enum AvroComplex {
  RECORD = "record",
  ENUM = "enum",
  ARRAY = "array",
  MAP = "map",
  UNION = "union",
  FIXED = "fixed"
}

interface ObjectSchema {
  type: Exclude<AvroComplex, AvroComplex.UNION>;
  name?: string;
  aliases?: string;
  fields?: RecordField[];
  symbols?: string[];
  values?: string;
  size?: number;
}

export abstract class AvroType {
  /**
   * Reads an object from the stream.
   *
   * @param stream
   */
  public abstract read(
    stream: AvroReadable,
    options?: AvroParserReadOptions
  ): Promise<Object | null>;

  /**
   * Determines the AvroType from the Avro Schema.
   */
  public static fromSchema(schema: string | Object): AvroType {
    if (typeof schema == "string") {
      return AvroType.fromStringSchema(schema);
    } else if (Array.isArray(schema)) {
      return AvroType.fromArraySchema(schema);
    } else {
      return AvroType.fromObjectSchema(schema as ObjectSchema);
    }
  }

  private static fromStringSchema(schema: string): AvroType {
    switch (schema) {
      case AvroPrimitive.NULL:
      case AvroPrimitive.BOOLEAN:
      case AvroPrimitive.INT:
      case AvroPrimitive.LONG:
      case AvroPrimitive.FLOAT:
      case AvroPrimitive.DOUBLE:
      case AvroPrimitive.BYTES:
      case AvroPrimitive.STRING:
        return new AvroPrimitiveType(schema as AvroPrimitive);
      default:
        throw new Error(`Unexpected Avro type ${schema}`);
    }
  }

  private static fromArraySchema(schema: any[]): AvroType {
    return new AvroUnionType(schema.map(AvroType.fromSchema));
  }

  private static fromObjectSchema(schema: ObjectSchema): AvroType {
    const type = schema.type;
    // Primitives can be defined as strings or objects
    try {
      return AvroType.fromStringSchema(type);
    } catch (err) {}

    switch (type) {
      case AvroComplex.RECORD:
        if (schema.aliases) {
          throw new Error(`aliases currently is not supported, schema: ${schema}`);
        }
        if (!schema.name) {
          throw new Error(`Required attribute 'name' doesn't exist on schema: ${schema}`);
        }

        let fields: Record<string, AvroType> = {};
        if (!schema.fields) {
          throw new Error(`Required attribute 'fields' doesn't exist on schema: ${schema}`);
        }
        for (const field of schema.fields) {
          fields[field.name] = AvroType.fromSchema(field.type);
        }
        return new AvroRecordType(fields, schema.name);
      case AvroComplex.ENUM:
        if (schema.aliases) {
          throw new Error(`aliases currently is not supported, schema: ${schema}`);
        }
        if (!schema.symbols) {
          throw new Error(`Required attribute 'symbols' doesn't exist on schema: ${schema}`);
        }
        return new AvroEnumType(schema.symbols);
      case AvroComplex.MAP:
        if (!schema.values) {
          throw new Error(`Required attribute 'values' doesn't exist on schema: ${schema}`);
        }
        return new AvroMapType(AvroType.fromSchema(schema.values));
      case AvroComplex.ARRAY: // Unused today
      case AvroComplex.FIXED: // Unused today
      default:
        throw new Error(`Unexpected Avro type ${type} in ${schema}`);
    }
  }
}

enum AvroPrimitive {
  NULL = "null",
  BOOLEAN = "boolean",
  INT = "int",
  LONG = "long",
  FLOAT = "float",
  DOUBLE = "double",
  BYTES = "bytes",
  STRING = "string"
}

class AvroPrimitiveType extends AvroType {
  private _primitive: AvroPrimitive;

  constructor(primitive: AvroPrimitive) {
    super();
    this._primitive = primitive;
  }

  public async read(
    stream: AvroReadable,
    options: AvroParserReadOptions = {}
  ): Promise<Object | null> {
    switch (this._primitive) {
      case AvroPrimitive.NULL:
        return await AvroParser.readNull();
      case AvroPrimitive.BOOLEAN:
        return await AvroParser.readBoolean(stream, options);
      case AvroPrimitive.INT:
        return await AvroParser.readInt(stream, options);
      case AvroPrimitive.LONG:
        return await AvroParser.readLong(stream, options);
      case AvroPrimitive.FLOAT:
        return await AvroParser.readFloat(stream, options);
      case AvroPrimitive.DOUBLE:
        return await AvroParser.readDouble(stream, options);
      case AvroPrimitive.BYTES:
        return await AvroParser.readBytes(stream, options);
      case AvroPrimitive.STRING:
        return await AvroParser.readString(stream, options);
      default:
        throw new Error("Unknown Avro Primitive");
    }
  }
}

class AvroEnumType extends AvroType {
  private readonly _symbols: string[];

  constructor(symbols: string[]) {
    super();
    this._symbols = symbols;
  }

  public async read(stream: AvroReadable, options: AvroParserReadOptions = {}): Promise<Object> {
    const value = await AvroParser.readInt(stream, options);
    return this._symbols[value];
  }
}

class AvroUnionType extends AvroType {
  private readonly _types: AvroType[];

  constructor(types: AvroType[]) {
    super();
    this._types = types;
  }

  public async read(
    stream: AvroReadable,
    options: AvroParserReadOptions = {}
  ): Promise<Object | null> {
    const typeIndex = await AvroParser.readInt(stream, options);
    return await this._types[typeIndex].read(stream, options);
  }
}

class AvroMapType extends AvroType {
  private readonly _itemType: AvroType;

  constructor(itemType: AvroType) {
    super();
    this._itemType = itemType;
  }

  public async read(stream: AvroReadable, options: AvroParserReadOptions = {}): Promise<Object> {
    const readItemMethod = async (
      s: AvroReadable,
      options?: AvroParserReadOptions
    ): Promise<Object | null> => {
      return await this._itemType.read(s, options);
    };
    return await AvroParser.readMap(stream, readItemMethod, options);
  }
}

class AvroRecordType extends AvroType {
  private readonly _name: string;
  private readonly _fields: Record<string, AvroType>;

  constructor(fields: Record<string, AvroType>, name: string) {
    super();
    this._fields = fields;
    this._name = name;
  }

  public async read(stream: AvroReadable, options: AvroParserReadOptions = {}): Promise<Object> {
    let record: Record<string, Object | null> = {};
    record["$schema"] = this._name;
    for (const key in this._fields) {
      if (this._fields.hasOwnProperty(key)) {
        record[key] = await this._fields[key].read(stream, options);
      }
    }
    return record;
  }
}
