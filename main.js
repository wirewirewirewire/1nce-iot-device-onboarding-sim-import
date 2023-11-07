require("dotenv").config();
var util = require("util");
const { DynamoDB } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand } = require("@aws-sdk/lib-dynamodb");
const { IoT } = require("@aws-sdk/client-iot");
const { S3 } = require("@aws-sdk/client-s3");
const { SecretsManager } = require("@aws-sdk/client-secrets-manager");
const axios = require("axios");

var iot = new IoT();
var client = new DynamoDB({ region: "eu-central-1" });
const ddbDocClient = DynamoDBDocumentClient.from(client);
const secretManagerClient = new SecretsManager();
var s3 = new S3();
var log_stdout = process.stdout;

const ONCE_BUCKET_NAME = "once-sim-aws-customerfullintresource-xxx"; //Bucket with your certs from 1nce import
const IOT_SIM_TABLE = "sim-metastore"; //database from your 1nce deployment
const ONCE_API_TOKEN = "<BEARER TOKEN>"; //API Token from 1nce to use the api and get a access token https://help.1nce.com/dev-hub/reference/postaccesstokenpost
const SIM_COUNT = 100; //value to set how many sims maximum to import (*100, so 100 = 10000 SIMs) - this can be set low to test the import

console.log = function (d) {
  //
  let date_ob = new Date().toISOString().replace(/T/, " ").replace(/\..+/, "");
  log_stdout.write(util.inspect(d, { showHidden: false, depth: null, colors: true }) + "\n");
};

function IsJsonString(str) {
  var result;
  try {
    result = JSON.parse(str);
  } catch (e) {
    return str;
  }
  return result;
}

function isValidIPv4(ip) {
  const regex =
    /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  return regex.test(ip);
}

//Get File from S3 Bucket, bucket: name of the bucket, file: name of the file
function getCertFromBucket(bucket, file) {
  var options = {
    Bucket: bucket,
    Key: file,
  };

  return new Promise((resolve, reject) => {
    s3.getObject(options, function (err, data) {
      if (err) {
        console.log(err);
        resolve({ success: false, data: undefined, error: err });
        return;
      }
      let content = "";
      data.Body.on("data", (chunk) => (content += chunk));
      data.Body.on("end", () => {
        resolve({ success: true, data: IsJsonString(content), error: undefined });
      });
    });
  });
}

//Retun Info from IoT Core Thing (Device)
function returnIotThingData(deviceId) {
  var thingParams = {
    thingName: deviceId,
  };
  return new Promise(async (resolve, reject) => {
    try {
      var iotThing = await iot.describeThing(thingParams);
      resolve({ success: true, error: undefined, data: iotThing });
    } catch (error) {
      resolve({ success: false, error: error, data: undefined });
    }
  });
}

function createDataDB(deviceIp, cert, certId, privKey, deviceIccId) {
  if (!isValidIPv4(deviceIp)) {
    console.log("[DB] Invalid IP: " + deviceIccId);
    resolve({ success: false, data: undefined, error: "invalid ip" });
  }
  //TODO: More data integrity checks

  var timestamp = new Date().toISOString();
  var params = {
    Item: {
      PK: "IP#" + deviceIp, //PK (z.B. IP#127.0.0.1)
      SK: "P#MQTT", //SK (immer: P#MQTT)
      crt: cert, //crt (certificate)
      crtid: certId, //crtid (certificateId)
      prk: privKey, //prk (privateKey)
      ct: timestamp, //ct (createdTime in ISO string)
      ut: timestamp, //ut (updatedTime in ISO string)
      i: deviceIccId, //i (iccid)
      ip: deviceIp, //ip (ip)
      a: true, //a (active, boolean)
    },
    ReturnConsumedCapacity: "TOTAL",
    TableName: IOT_SIM_TABLE,
  };

  return new Promise(async (resolve, reject) => {
    try {
      const data = await ddbDocClient.send(new PutCommand(params));
      resolve({ success: true, data: data, error: undefined });
    } catch (error) {
      resolve({ success: false, data: undefined, error: error });
    }
  });
}

async function get1nceCredentials() {
  var resultSecret = ONCE_API_TOKEN;

  /*
  //Alternative way to get token secure via AWS Sercet Manager
  var resultSecret = await secretManagerClient.getSecretValue({
    SecretId: "<your secret id>",
  });
  resultSecret = JSON.parse(resultSecret.SecretString);
  resultSecret = resultSecret["login_data"];
  */

  var data = JSON.stringify({
    grant_type: "client_credentials",
  });

  var config = {
    method: "post",
    url: "https://api.1nce.com/management-api/oauth/token?grant_type=client_credentials",
    headers: {
      Authorization: "Basic " + resultSecret,
      Cookie: "SERVERID=csc2",
      "Content-Type": "application/json",
    },
    data: data,
  };
  return new Promise(async (resolve, reject) => {
    try {
      var AxiosResponse = await axios(config);
      resolve({ success: true, data: AxiosResponse.data, error: undefined });
    } catch (error) {
      resolve({ success: false, data: undefined, error: error.cause });
    }
  });
}

function get1nceSimDataArray(page, auth) {
  var config = {
    method: "get",
    timeout: 5000,
    url: "https://api.1nce.com/management-api/v1/sims",
    headers: {
      Authorization: "Bearer " + auth,
      Cookie: "SERVERID=csc2",
    },
    params: {
      page,
      pageSize: 100,
    },
  };

  return new Promise(async (resolve, reject) => {
    try {
      var AxiosResponse = await axios(config);

      var returnIds = [];
      for (var i = 0; i < AxiosResponse.data.length; i++) {
        returnIds.push({ ip: AxiosResponse.data[i].ip_address, iccid: AxiosResponse.data[i].iccid });
      }
      resolve({ success: true, data: returnIds, error: undefined });
    } catch (error) {
      var errorstring = JSON.stringify(error, Object.getOwnPropertyNames(error));
      resolve({ success: false, data: undefined, error: errorstring });
    }
  });
}

function createSimInDB(simIccId, ipAddr) {
  return new Promise(async (resolve, reject) => {
    var iotDeviceData = await returnIotThingData(simIccId);
    if (!iotDeviceData.success) throw iotDeviceData.error;

    //soft Error if there is no cert with the device
    if (iotDeviceData.data.attributes.certificateId == undefined) {
      console.log("Error: Skip SIM: " + simIccId);
      resolve(true);
      return;
    }

    var S3DeviceCertFile = await getCertFromBucket(ONCE_BUCKET_NAME, iotDeviceData.data.attributes.certificateId);
    if (!S3DeviceCertFile.success) {
      console.log(iotDeviceData);
      throw S3DeviceCertFile.error;
    }

    var createDB = await createDataDB(
      ipAddr,
      S3DeviceCertFile.data.certificatePem,
      S3DeviceCertFile.data.certificateId,
      S3DeviceCertFile.data.keyPair.PrivateKey,
      simIccId
    );

    if (!createDB.success) {
      throw createDB.error;
    } else {
      resolve(true);
    }
  });
}

async function start() {
  simIccIdArray = [];
  globalCount = 0;
  globalSimRead = 0;

  console.log("[MAIN] Start");

  //Get 1nce Credentials to use the API
  var onceCredentials = await get1nceCredentials();
  if (onceCredentials.success) {
    console.log("[1nce] Credentials received");
  } else {
    throw onceCredentials.error;
  }

  for (let index = 0; index <= SIM_COUNT; index++) {
    var simData = await get1nceSimDataArray(index, onceCredentials.data.access_token);

    if (simData.data.length > 0) {
      globalSimRead += simData.data.length;
      console.log("[DB] add SIM data Count: " + index + "/" + SIM_COUNT);

      //Process database Import Async to get more speed
      const processChunk = async (chunk, token) => {
        return Promise.all(
          chunk.map((simInfo) => {
            globalCount++;
            return createSimInDB(simInfo.iccid, simInfo.ip, token);
          })
        );
      };
      let promises = [];
      promises.push(processChunk(simData.data, onceCredentials.data.access_token));
      await Promise.all(promises);
    } else {
      console.log("[DB] no more SIM data ...break");
      break;
    }
  }

  console.log("[1nce] SIMs from Database: " + globalSimRead);
  console.log("[DB] SIMs Imported: " + globalCount);
}

start();

process.on("SIGINT", async () => {
  console.log("Bye bye!");
  process.exit();
});
