// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT Licence.

/**
 * Here we demonstrate how to inject new SAS for an ongoing upload.
 * SAS might get expired before a large upload finishes, for this scenario, we want to request a new
 * SAS token during the upload instead of starting a new upload.
 *
 * In this sample, we give a SAS injection sample for browsers like Chrome which supports await/async.
 *
 * Before executing the sample:
 * - Make sure storage account has CORS set up properly
 * - Implement method `getNewSasForBlob`
 * - Update url in `upload()` method
 *
 * This sample creates a global function called `upload` that will upload
 * data from a file upload form. For example, the following HTML will create
 * such a form.
 *
 * <form><input type="file" id="file" /></form>
 * <button id="upload" onclick="upload()">Upload</button>
 *
 * For instructions on building this sample for the browser, refer to
 * "Building for Browsers" in the readme.
 *
 *
 */

import {
    DataLakeServiceClient
  } from "../../../dist-esm/src";

async function upload() {
  const url = "https://jsv12.dfs.core.windows.net";
  const sas = "";
  const md5Inbase64 = "";
  
  const serviceClient = new DataLakeServiceClient(
    `${url}${sas}`, // A SAS should start with "?"
  );

    // Create a filesystem
    const fileSystemName = `newfilesystem${new Date().getTime()}`;
    const fileSystemClient = serviceClient.getFileSystemClient(fileSystemName);
  
    const createFileSystemResponse = await fileSystemClient.create();
    console.log(
      `Create filesystem ${fileSystemName} successfully`,
      createFileSystemResponse.requestId
    );
  
    // Create a file
    const fileName = "newfile" + new Date().getTime();
    const fileClient = fileSystemClient.getFileClient(fileName);
  
    const file = document.getElementById("file").files[0];

    const raw = window.atob(md5Inbase64);
    const rawLength = raw.length;
    const array = new Uint8Array(new ArrayBuffer(rawLength));

    for(let i = 0; i < rawLength; i++) {
        array[i] = raw.charCodeAt(i);
    }

    const begin = new Date();
    console.log("start upload at ", begin);

    let lastLogged = 0;
    const G10 = 10 * 1024 * 1024 * 1024;
    await fileClient.upload(file, {
      singleUploadThreshold: 100 * 1024 * 1024,
      chunkSize: 100 * 1024 * 1024,
      pathHttpHeaders: { contentMD5: array },
      onProgress: (ev) => {
        if (ev.loadedBytes - lastLogged > G10) {
          process.stdout.write((ev.loadedBytes / G10).toString() + "% ");
          lastLogged = ev.loadedBytes;
        }
      },
    });
  
    const end = new Date();
    console.log(`Upload file ${fileName} successfully at `, end);
    const timeUsedInseconds = (end.getTime() - begin.getTime()) / 1000;
    console.log("Time used in seconds:", timeUsedInseconds);
    console.log("Average speed:", 1024 * 1024 / timeUsedInseconds, " MB/s");
  
    console.log(fileClient.url);
}

window['upload'] = upload;