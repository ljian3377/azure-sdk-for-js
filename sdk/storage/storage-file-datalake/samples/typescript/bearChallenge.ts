const { DataLakeServiceClient, DataLakeFileClient } = require("../..");
import { ClientSecretCredential } from "@azure/identity";
import * as dotenv from "dotenv";
dotenv.config();

export async function main() {
  const account = process.env.ACCOUNT_NAME || "";
  const fileClient = new DataLakeFileClient(
    `https://${account}.dfs.core.windows.net/newfilesystem/newfile`,
  );

  let tenantId: string;
  let authorityHost: string;

  try {
    await fileClient.create();
  } catch (err) {
    // "www-authenticate": "Bearer authorization_uri=https://login.microsoftonline.com/72f988bf-86f1-41af-91ab-2d7cd011db47/oauth2/authorize resource_id=https://storage.azure.com"
    const headerRaw = err.details["www-authenticate"];
    const url = new URL(headerRaw.split('=')[1].split(' ')[0]);
    tenantId = url.pathname.split('/')[1];
    authorityHost = url.origin;
  }

  const clientSecretCredential = new ClientSecretCredential(tenantId!, process.env.AZURE_CLIENT_ID!, process.env.AZURE_CLIENT_SECRET!, {
    authorityHost: authorityHost!
  });

  const serviceClient = new DataLakeServiceClient(
    `https://${account}.dfs.core.windows.net`,
    clientSecretCredential
  );

  let i = 1;
  for await (const filesystem of serviceClient.listFileSystems()) {
    console.log(`FileSystem ${i++}: ${filesystem.name}`);
  }
}

main().catch((err) => {
  console.error("Error running sample:", err.message);
});
