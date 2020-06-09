import { AvroReader } from "../../storage-internal-avro/src";
import { BlobChangeFeedEvent } from "./models/BlobChangeFeedEvent";

export class Chunk {
  private readonly _avroReader: AvroReader;
  private readonly _iter: AsyncIterableIterator<Object | null>;

  private _blockOffset: number;
  public get blockOffset(): number {
    return this._blockOffset;
  }

  private _eventIndex: number;
  public get eventIndex(): number {
    return this._eventIndex;
  }

  constructor(avroReader: AvroReader, blockOffset: number, eventIndex: number) {
    this._avroReader = avroReader;
    this._blockOffset = blockOffset;
    this._eventIndex = eventIndex;

    this._iter = this._avroReader.parseObjects();
  }

  public hasNext(): boolean {
    return this._avroReader.hasNext();
  }

  public async getChange(): Promise<BlobChangeFeedEvent | undefined> {
    if (!this.hasNext()) {
      return undefined;
    }

    const next = await this._iter.next();
    this._eventIndex = this._avroReader.objectIndex;
    this._blockOffset = this._avroReader.blockOffset;
    if (next.done) {
      return undefined;
    } else {
      let eventRaw = next.value as BlobChangeFeedEvent;
      if (eventRaw.eventTime) {
        eventRaw.eventTime = new Date(eventRaw.eventTime);
      }
      return eventRaw;
    }
  }
}
