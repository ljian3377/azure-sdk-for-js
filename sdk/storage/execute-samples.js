/**
 * Prerequisite:
 * 1. npm install execa
 * 2. comment out all 'import { setLogLevel } from "@azure/logger"; setLogLevel("info");' as it interferes with stderr.
 *
 * Afterwards:
 * 1. check package version under node_modules
 */
const execa = require("execa");
const fs = require("fs");

// Samples can be skipped by mentioning them in the skipSamples Array.
// Suppose skipSamples = ["some-entry", "sample-2"],
//    some-entry.ts, sample-2.ts, some-entry.js and sample-2.js will be skipped.
const skipSamples = ["proxyAuth", "azureAdAuth"];
const supportedExtensions = ["ts", "js"];

const bDel = `!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!`;
const del = `${bDel}------------------------------${bDel}`;

// Colours - green, yellow, red and blue - for console logs.
const { g, y, r, b } = [
  ["r", 1],
  ["g", 2],
  ["b", 4],
  ["y", 3]
].reduce(
  (cols, col) => ({
    ...cols,
    [col[0]]: (f) => `\x1b[3${col[1]}m${f}\x1b[0m`
  }),
  {}
);

// Executes `cmd` in `cwd`(directory).
async function exec(cmd, cwd) {
  let command = execa(cmd, {
    cwd,
    shell: true
  });
  command.stderr.pipe(process.stderr);
  command.stdout.pipe(process.stdout);
  return command;
}

async function runSamples(language, directory) {
  let cmd;
  // Tries to execute all the samples in the `directory`.
  if (language === "typescript") {
    cmd = "ts-node";
  } else {
    cmd = "node";
  }
  console.log(`Running ${language} samples under ${directory} ...`);

  const files = fs.readdirSync(directory);
  for (var i = 0; i < files.length; i++) {
    let splitRes = files[i].split(".");
    if (supportedExtensions.includes(splitRes.pop()) && !skipSamples.includes(splitRes.join("."))) {
      try {
        console.log(`\n\n${b(del)}\n${del}`);
        console.log(`${bDel}\t${files[i]} \t `);
        console.log(`${del}\n${b(del)} \n`);

        console.log(`${g("Running")} ${y(files[i])} ${g("...")}`);
        // Executing a sample - Example: (`ts-node samplefilename.ts`, `./samples/typescript`).
        const res = await exec(`${cmd} ${files[i]}`, directory);
        if (res.stderr) {
          console.log(res);
          throw { message: "Non-empty stderr." };
        }
        console.log(`${g(files[i] + " is done..!")}`);
      } catch (error) {
        console.log(error.message);
        console.log(`${r(del)}\n${del}`);
        console.log(`${bDel}\t${files[i]} Sample - FAILED\t `);
        console.log(`${del}\n${r(del)}`);
        throw "Sample failed!";
      }
    }
  }
}

(async () => {
  const dirConfig = [
    {
      "pre-step": [
        "cp storage-blob/.env .",
        "cp ./storage-blob/samples/README.md ./storage-blob/samples/typescript/src/"
      ],
      "clean-up": ["rm ./storage-blob/samples/typescript/src/README.md"],
      "ts-path": "./storage-blob/samples/typescript/src",
      "js-path": "./storage-blob/samples/javascript/"
    },
    {
      "pre-step": [
        "cp storage-file-share/.env .",
        "cp ./storage-file-share/samples/README.md ./storage-file-share/samples/typescript/src/"
      ],
      "clean-up": ["rm ./storage-file-share/samples/typescript/src/README.md"],
      "ts-path": "./storage-file-share/samples/typescript/src",
      "js-path": "./storage-file-share/samples/javascript/"
    },
    {
      "pre-step": ["cp storage-queue/.env ."],
      "clean-up": [],
      "ts-path": "./storage-queue/samples/typescript/src",
      "js-path": "./storage-queue/samples/javascript/"
    },
    {
      "pre-step": ["cp storage-file-datalake/.env ."],
      "clean-up": [],
      "ts-path": "./storage-file-datalake/samples/typescript/src",
      "js-path": "./storage-file-datalake/samples/javascript/"
    }
    // {
    //   "clean-up": [],
    //   "ts-path": "./storage-blob-changefeed/samples/typescript/src",
    //   "js-path": "./storage-blob-changefeed/samples/javascript/",
    // }
  ];

  for (let i = 0; i < dirConfig.length; i++) {
    try {
      // preparation
      for (let j = 0; j < dirConfig[i]["pre-step"].length; j++) {
        console.log(`${dirConfig[i]["pre-step"][j]}`);
        await exec(dirConfig[i]["pre-step"][j], ".");
      }

      await exec(`cp .env ${dirConfig[i]["ts-path"]}`, ".");
      await exec(`npm update && npm install`, dirConfig[i]["ts-path"]);
      await runSamples("typescript", dirConfig[i]["ts-path"]);

      await exec(`cp .env ${dirConfig[i]["js-path"]}`, ".");
      await exec(`npm update && npm install`, dirConfig[i]["js-path"]);
      await runSamples("javascript", dirConfig[i]["js-path"]);
    } catch (error) {
      console.log(error);
      return;
    } finally {
      // clean up
      for (let j = 0; j < dirConfig[i]["clean-up"].length; j++) {
        console.log(`${dirConfig[i]["clean-up"][j]}`);
        await exec(dirConfig[i]["clean-up"][j], ".");
      }
    }
  }
  console.log("All sample succeeded.");
})();
