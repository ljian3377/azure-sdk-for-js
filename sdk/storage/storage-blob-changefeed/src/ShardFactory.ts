// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { ChunkFactory } from "./ChunkFactory";
import { ShardCursor } from "./models/ChangeFeedCursor";
import { Shard } from "./Shard";
import { ContainerClient, CommonOptions } from "@azure/storage-blob";
import { Chunk } from './Chunk';
import { AbortSignalLike } from '@azure/core-http';


/**
 * Options to configure {@link ShardFactory.create} operation.
 *
 * @export
 * @interface CreateShardOptions
 */
export interface CreateShardOptions extends CommonOptions {
  /**
   * An implementation of the `AbortSignalLike` interface to signal the request to cancel the operation.
   * For example, use the &commat;azure/abort-controller to create an `AbortSignal`.
   *
   * @type {AbortSignalLike}
   * @memberof CreateShardOptions
   */
  abortSignal?: AbortSignalLike;
}

export class ShardFactory {
  private readonly _chunkFactory: ChunkFactory;

  constructor(chunkFactory: ChunkFactory) {
    this._chunkFactory = chunkFactory;
  }

  public async create(
    containerClient: ContainerClient,
    shardPath: string,
    shardCursor?: ShardCursor,
    options: CreateShardOptions = {}
  ): Promise<Shard> {
    const chunks: string[] = [];
    const blockOffset: number = shardCursor?.BlockOffset || 0;
    const eventIndex: number = shardCursor?.EventIndex || 0;

    for await (const blobItem of containerClient.listBlobsFlat({ prefix: shardPath, abortSignal: options.abortSignal})) {
      chunks.push(blobItem.name);
    }

    const currentChunkPath = shardCursor?.CurrentChunkPath;
    let chunkIndex = -1;
    let currentChunk: Chunk | undefined = undefined;
    // Chunks can be empty right after hour flips.
    if (chunks.length !== 0) {
      // Fast forward to current Chunk
      if (currentChunkPath)
      {
        for (let i = 0; i < chunks.length; i++) {
          if (chunks[i] === currentChunkPath) {
            chunkIndex = i;
            break;
          }
        }
        if (chunkIndex === -1) {
          throw new Error(`Chunk ${currentChunkPath} not found.`);
        }
      } else {
        chunkIndex = 0;
      }
      
      // Fast forward to current Chunk.
      if (chunkIndex > 0) {
        chunks.splice(0, chunkIndex);
      }
  
      currentChunk = await this._chunkFactory.create(
        containerClient,
        chunks.shift()!,
        blockOffset,
        eventIndex,
        { abortSignal: options.abortSignal }
      );
    }

    return new Shard(containerClient, this._chunkFactory, chunks, currentChunk, shardPath);
  }
}
