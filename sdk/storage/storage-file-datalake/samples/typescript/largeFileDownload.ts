/* 
 Setup: Enter your storage account name and shared key in main()
*/

const { DataLakeFileClient } = require("../../src"); // Change to "@azure/storage-file-datalake" in your package

async function main() {
  const blockBlobSasURL = ""
  const fileClientWithSAS = new DataLakeFileClient(
    blockBlobSasURL,
  );
  let begin = new Date();
  console.log("Start:", begin);
  await fileClientWithSAS.readToFile("downloadedFile");
  let end = new Date();
  console.log("Done:", end);
  const timeUsedInseconds = (end.getTime() - begin.getTime()) / 1000;
  console.log("Time used:", timeUsedInseconds);
  console.log("Average speed:", 1024 * 1024 / timeUsedInseconds, " MB/s");

  const getRes = await fileClientWithSAS.getProperties();
  console.log(getRes.contentMD5);
}

// An async method returns a Promise object, which is compatible with then().catch() coding style.
main()
  .then(() => {
    console.log("Successfully executed sample.");
  })
  .catch((err) => {
    console.log(err.message);
  });
