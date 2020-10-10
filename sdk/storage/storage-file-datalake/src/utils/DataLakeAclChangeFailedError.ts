// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import { RestError } from "@azure/core-http";

/**
 * An error thrown when an operation is interrupted and can be continued later on.
 *
 * @export
 * @class DataLakeAclChangeFailedError
 * @extends {RestError}
 */
export class DataLakeAclChangeFailedError extends RestError {
  /**
   * Continuation token to continue next batch of operations.
   *
   * @type {string}
   * @memberof DataLakeAclChangeFailedError
   */
  public continuationToken?: string;
  constructor(restError: RestError, continuationToken?: string) {
    super(
      restError.message,
      restError.code,
      restError.statusCode,
      restError.request,
      restError.response
    );
    super["details"] = restError.details;

    this.name = "DataLakeAclChangeFailedError";
    this.continuationToken = continuationToken;
    Object.setPrototypeOf(this, DataLakeAclChangeFailedError.prototype);
  }
}
