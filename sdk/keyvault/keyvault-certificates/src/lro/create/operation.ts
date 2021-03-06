// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AbortSignalLike } from "@azure/abort-controller";
import { PollOperationState, PollOperation } from "@azure/core-lro";
import { RequestOptionsBase } from "@azure/core-http";
import {
  KeyVaultCertificateWithPolicy,
  CreateCertificateOptions,
  CertificatePolicy,
  CertificateClientInterface
} from "../../certificatesModels";
import { CertificateOperation } from "../../core/models";

/**
 * An interface representing the state of a create certificate's poll operation
 */
export interface CreateCertificatePollOperationState
  extends PollOperationState<KeyVaultCertificateWithPolicy> {
  /**
   * The name of the certificate.
   */
  certificateName: string;
  /**
   * The policy of the certificate.
   */
  certificatePolicy?: CertificatePolicy;
  /**
   * Optional parameters sent to createCertificates
   */
  createCertificateOptions: CreateCertificateOptions;
  /**
   * Options for the core-http requests.
   */
  requestOptions?: RequestOptionsBase;
  /**
   * An interface representing a CertificateClient. For internal use.
   */
  client: CertificateClientInterface;
  /**
   * The operation of the certificate
   */
  certificateOperation?: CertificateOperation;
}

/**
 * An interface representing a create certificate's poll operation
 */
export interface CreateCertificatePollOperation
  extends PollOperation<CreateCertificatePollOperationState, KeyVaultCertificateWithPolicy> {}

/**
 * @summary Reaches to the service and updates the create certificate's poll operation.
 * @param [options] The optional parameters, which are an abortSignal from @azure/abort-controller and a function that triggers the poller's onProgress function.
 */
async function update(
  this: CreateCertificatePollOperation,
  options: {
    abortSignal?: AbortSignalLike;
    fireProgress?: (state: CreateCertificatePollOperationState) => void;
  } = {}
): Promise<CreateCertificatePollOperation> {
  const state = this.state;
  const { certificateName, certificatePolicy, createCertificateOptions, client } = state;

  const requestOptions = state.requestOptions || {};
  if (options.abortSignal) {
    requestOptions.abortSignal = options.abortSignal;
    createCertificateOptions.abortSignal = options.abortSignal;
  }

  if (!state.isStarted) {
    state.isStarted = true;
    state.result = await client.createCertificate(
      certificateName,
      certificatePolicy!,
      createCertificateOptions
    );
    state.certificateOperation = await client.getPlainCertificateOperation(
      certificateName,
      requestOptions
    );
  } else if (!state.isCompleted) {
    state.certificateOperation = await client.getPlainCertificateOperation(
      certificateName,
      requestOptions
    );
  }

  if (state.certificateOperation && state.certificateOperation.status !== "inProgress") {
    state.isCompleted = true;
    state.result = await client.getCertificate(certificateName, requestOptions);
    if (state.certificateOperation.error) {
      state.error = new Error(state.certificateOperation.error.message);
    }
  }

  return makeCreateCertificatePollOperation(state);
}

/**
 * @summary Reaches to the service and cancels the certificate's operation, also updating the certificate's poll operation
 * @param [options] The optional parameters, which is only an abortSignal from @azure/abort-controller
 */
async function cancel(
  this: CreateCertificatePollOperation,
  options: { abortSignal?: AbortSignal } = {}
): Promise<CreateCertificatePollOperation> {
  const state = this.state;
  const { client, certificateName } = state;

  const requestOptions = state.requestOptions || {};
  if (options.abortSignal) {
    requestOptions.abortSignal = options.abortSignal;
  }

  state.certificateOperation = await client.cancelCertificateOperation(
    certificateName,
    requestOptions
  );

  return makeCreateCertificatePollOperation({
    ...this.state,
    isCancelled: true
  });
}

/**
 * @summary Serializes the create certificate's poll operation
 */
function toString(this: CreateCertificatePollOperation): string {
  return JSON.stringify({
    state: this.state
  });
}

/**
 * @summary Builds a create certificate's poll operation
 * @param [state] A poll operation's state, in case the new one is intended to follow up where the previous one was left.
 */
export function makeCreateCertificatePollOperation(
  state: CreateCertificatePollOperationState
): CreateCertificatePollOperation {
  return {
    state: {
      ...state
    },
    update,
    cancel,
    toString
  };
}
