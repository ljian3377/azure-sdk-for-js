// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { BlobServiceClient, ContainerClient } from "@azure/storage-blob";
import { ChangeFeed } from "./ChangeFeed";
import { ChangeFeedCursor } from "./models/ChangeFeedCursor";
import { CHANGE_FEED_CONTAINER_NAME, CHANGE_FEED_META_SEGMENT_PATH } from "./utils/constants";
import {
  ceilToNearestHour,
  floorToNearestHour,
  getYearsPaths,
  getSegmentsInYear,
  minDate,
  getHost,
  parseDateFromSegmentPath
} from "./utils/utils.common";
import { bodyToString } from "./utils/utils.node";
import { SegmentFactory } from "./SegmentFactory";
import { ShardFactory } from "./ShardFactory";
import { ChunkFactory } from "./ChunkFactory";
import { AvroReaderFactory } from "./AvroReaderFactory";
import { Segment } from "./Segment";
import { BlobChangeFeedListChangesOptions } from "./models/models";
import { createSpan } from "./utils/tracing";
import { CanonicalCode } from "@opentelemetry/api";

interface MetaSegments {
  version?: number;
  lastConsumable: string;
}

export class ChangeFeedFactory {
  private readonly _segmentFactory: SegmentFactory;

  constructor();
  constructor(segmentFactory: SegmentFactory);
  constructor(segmentFactory?: SegmentFactory) {
    if (segmentFactory) {
      this._segmentFactory = segmentFactory;
    } else {
      this._segmentFactory = new SegmentFactory(
        new ShardFactory(new ChunkFactory(new AvroReaderFactory()))
      );
    }
  }

  private static validateCursor(containerClient: ContainerClient, cursor: ChangeFeedCursor): void {
    if (getHost(containerClient.url) !== cursor.UrlHost) {
      throw new Error("Cursor URL host does not match container URL host.");
    }
    if (cursor.CursorVersion !== 1) {
      throw new Error("Unsupported cursor version.");
    }
  }

  public async create(
    blobServiceClient: BlobServiceClient,
    continuationToken?: string,
    options: BlobChangeFeedListChangesOptions = {}
  ): Promise<ChangeFeed> {
    const { span, spanOptions } = createSpan("ChangeFeedFactory-create", options.tracingOptions);

    try {
      const containerClient = blobServiceClient.getContainerClient(CHANGE_FEED_CONTAINER_NAME);
      let cursor: ChangeFeedCursor | undefined = undefined;
      // Create cursor.
      if (continuationToken) {
        cursor = JSON.parse(continuationToken);
        ChangeFeedFactory.validateCursor(containerClient, cursor!);
        options.start = parseDateFromSegmentPath(cursor?.CurrentSegmentCursor.SegmentPath!);
        options.end = new Date(cursor!.EndTime!);
      }
      // Round start and end time if we are not using the cursor.
      else {
        options.start = floorToNearestHour(options.start);
        options.end = ceilToNearestHour(options.end);
      }

      // Check if Change Feed has been enabled for this account.
      const changeFeedContainerExists = await containerClient.exists({
        abortSignal: options.abortSignal,
        tracingOptions: { ...options.tracingOptions, spanOptions }
      });
      if (!changeFeedContainerExists) {
        throw new Error(
          "Change Feed hasn't been enabled on this account, or is currently being enabled."
        );
      }

      if (options.start && options.end && options.start >= options.end) {
        return new ChangeFeed();
      }

      // Get last consumable.
      const blobClient = containerClient.getBlobClient(CHANGE_FEED_META_SEGMENT_PATH);
      const blobDownloadRes = await blobClient.download(undefined, undefined, {
        abortSignal: options.abortSignal,
        tracingOptions: { ...options.tracingOptions, spanOptions }
      });
      const lastConsumable = new Date(
        (JSON.parse(await bodyToString(blobDownloadRes)) as MetaSegments).lastConsumable
      );

      // Get year paths
      const years: number[] = await getYearsPaths(containerClient, {
        abortSignal: options.abortSignal,
        tracingOptions: { ...options.tracingOptions, spanOptions }
      });

      // Dequeue any years that occur before start time.
      if (options.start) {
        const startYear = options.start.getUTCFullYear();
        while (years.length > 0 && years[0] < startYear) {
          years.shift();
        }
      }
      if (years.length === 0) {
        return new ChangeFeed();
      }

      let segments: string[] = [];
      while (segments.length === 0 && years.length !== 0) {
        segments = await getSegmentsInYear(
          containerClient,
          years.shift()!,
          options.start,
          minDate(lastConsumable, options.end),
          {
            abortSignal: options.abortSignal,
            tracingOptions: { ...options.tracingOptions, spanOptions }
          }
        );
      }
      if (segments.length === 0) {
        return new ChangeFeed();
      }
      const currentSegment: Segment = await this._segmentFactory.create(
        containerClient,
        segments.shift()!,
        cursor?.CurrentSegmentCursor,
        {
          abortSignal: options.abortSignal,
          tracingOptions: { ...options.tracingOptions, spanOptions }
        }
      );

      return new ChangeFeed(
        containerClient,
        this._segmentFactory,
        years,
        segments,
        currentSegment,
        lastConsumable,
        options.start,
        options.end
      );
    } catch (e) {
      span.setStatus({
        code: CanonicalCode.UNKNOWN,
        message: e.message
      });
      throw e;
    } finally {
      span.end();
    }
  }
}
