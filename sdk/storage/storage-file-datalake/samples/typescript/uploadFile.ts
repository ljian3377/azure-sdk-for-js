/* 
 Setup: Enter your storage account name and shared key in main()
*/

const { DataLakeServiceClient, StorageSharedKeyCredential } = require("../../src"); // Change to "@azure/storage-file-datalake" in your package
require("./setEnv.js");

async function main() {
  // Enter your storage account name and shared key
  const account = process.env.ACCOUNT_NAME || "";
  const accountKey = process.env.ACCOUNT_KEY || "";
  const filePath = "./inputFile"
  const fileContentMd5 = process.env.MD5 || "";

  const sharedKeyCredential = new StorageSharedKeyCredential(account, accountKey);

  const serviceClient = new DataLakeServiceClient(
    // When using AnonymousCredential, following url should include a valid SAS or support public access
    `https://${account}.dfs.core.windows.net`,
    sharedKeyCredential
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

  const begin = new Date();
  console.log("start upload at ", begin);

  let lastLogged = 0;
  const G100: number = 10 * 1024 * 1024 * 1024;
  await fileClient.uploadFile(filePath, {
    singleUploadThreshold: 100 * 1024 * 1024,
    chunkSize: 100 * 1024 * 1024,
    onProgress: (ev: any) => {
      if (ev.loadedBytes - lastLogged > G100) {
        process.stdout.write((ev.loadedBytes / G100).toString() + "% ");
        lastLogged = ev.loadedBytes;
      }
    },
    pathHttpHeaders: { contentMD5: Buffer.from(fileContentMd5, 'base64') }
  });

  const end = new Date();
  console.log(`Upload file ${fileName} successfully at `, end);
  const timeUsedInseconds = (end.getTime() - begin.getTime()) / 1000;
  console.log("Time used in seconds:", timeUsedInseconds);
  console.log("Average speed:", 1024 * 1024 / timeUsedInseconds, " MB/s");

  console.log(fileClient.url);
}


// An async method returns a Promise object, which is compatible with then().catch() coding style.
main()
  .then(() => {
    console.log("Successfully executed sample.");
  })
  .catch((err) => {
    console.log(err.message);
  });
