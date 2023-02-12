/*
This script needs the following environment variables defined:
GOOGLE_UPLOAD_JSON_KEY_B64 - The service account JSON key (THIS MUST BE SECRET)
GOOGLE_UPLOAD_FOLDER - name of folder in google drive to save uploads (MUST BE UNIQUE IN ACCOUNT)

Usage:
node uploader.js list
node uploader.js upload <filepath>
node uploader.js getlink <filepath>

variable GOOGLE_UPLOAD_JSON_KEY_B64 must contain the Base64 encoded file of the service account key.
To create this key go to: https://console.cloud.google.com/
then create a new project.  In this project enable Google Drive API and create a new service account under:
APIs & Services -> Credentials -> Create credentials -> Service Account
Then generate a access key for this service account
*/
const fs = require('fs');
const path = require('path')
const fetch = require('node-fetch')
const { GoogleAuth } = require('google-auth-library');

const prnt = console.log;

// Get authenticated API client
async function getAuthClient() {
  const serviceAccountJSONString = Buffer.from(process.env.GOOGLE_SVC_ACCOUNT_JSON_B64, 'base64').toString('ascii')
  let json_file_content = ''
  try {
    json_file_content = JSON.parse(serviceAccountJSONString);
  } catch (_) {
    prnt('Service account key could not be decoded!');
    process.exit(-1);
  }

  // Authenticate with Google
  const auth = new GoogleAuth({
    credentials: json_file_content,
    scopes: 'https://www.googleapis.com/auth/drive'
  });
  const authClient = await auth.getClient();
  return authClient;
}

// Creata a new file in Google Drive
async function createDriveFile(authClient, folderID, filePath) {
  const parsedPath = path.parse(filePath);
  const filename = parsedPath.base;

  const createFile = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable'
  const res1 = await authClient.request({
    url: createFile,
    method: 'POST',
    data: {
      name: filename,
      originalFilename: filename,
      parents: [folderID],
      mimeType: 'application/octet-stream',
    }
  });
  // prnt(res1);
  // const uploadURL = res1.headers.location;
  return res1;
}

async function updateDriveFile(authClient, updateURL, filePath) {
  // get Google authentication headers
  const headers = await authClient.getRequestHeaders();

  // get file size and stream
  const stats = fs.statSync(filePath);
  const fileSizeInBytes = stats.size;
  const readStream = fs.createReadStream(filePath);
  // prnt(`SIZE: ${fileSizeInBytes}`)

  // prepare upload options
  const uploadOptions = {
    method: 'PATCH',
    headers: { ...headers, "Content-length": fileSizeInBytes },
    body: readStream,
  };

  // perform upload
  return await fetch(updateURL, uploadOptions).then(data => {
    return data;
  })
    .catch(err => {
      return err;
    });
}

async function uploadFile(filePath) {
  const folderID = await getFolderID(process.env.GOOGLE_UPLOAD_FOLDER);

  const authClient = await getAuthClient();

  const createResult = await createDriveFile(authClient, folderID, filePath);
  const uploadURL = createResult.headers.location;
  if (createResult.status !== 200) {
    prnt('Error could not get upload path')
    process.exit(-1);
  }
  prnt(`Starting upload ...`);

  const updateResult = await updateDriveFile(authClient, uploadURL, filePath)

  prnt(`Upload Complete ${updateResult.status}`);
}


// List all files in a folder.  if folderName empty then list all folders instead
async function listDrive(folderID) {
  const authClient = await getAuthClient();

  const queryParms = [
    'includeTeamDriveItems=false',
    'supportsAllDrives=false',
    'pageSize=800',
    // 'fields=files(*)',
    'fields=files(kind,mimeType,name,size,id,createdTime,sha256Checksum)',
    folderID ?
      `q="${folderID}"+in+parents+and+trashed=false` :
      `q=${encodeURI('mimeType="application/vnd.google-apps.folder"')}+and+trashed=false`,
  ]
  const listFile = `https://www.googleapis.com/drive/v3/files?${queryParms.join('&')}`

  let result = { status: 0, files: [] }

  let res = await authClient.request({ url: listFile, method: 'GET' });

  if (res.status === 200) {
    result.status = res.status;
    result.files = res.data.files;

    // if first result is good loop through other pages and join the results together
    while (res.status === 200 && res.data.nextPageToken) {
      const moreFiles = `https://www.googleapis.com/drive/v3/files?${queryParms.join('&')}&pageToken=${res.data.nextPageToken}`
      // prnt('## moreFilesURL')
      // prnt(moreFiles);
      res = await authClient.request({ url: moreFiles, method: 'GET' });

      if (res.status === 200) {
        result.status = res.status;
        result.files = result.files.concat(res.data.files);
      } else {
        result.status = res.status;
      }
    }

  } else {
    result.status = res.status;
    result.files = [];
  }

  // prnt(result);
  return result;
}

async function getFolderID(folderName) {
  const folderResult = await listDrive('');
  if (folderResult.status !== 200) {
    prnt('Error  getting folder list');
    process.exit(-1);
  }

  const searchResult = folderResult.files.filter(item => item.name === folderName);
  if (searchResult.length === 1) {
    return searchResult[0].id;
  }

  return '';
}


async function getFileID(folderID, fileName) {
  const folderResult = await listDrive(folderID);
  if (folderResult.status !== 200) {
    prnt('Error getting file list');
    process.exit(-1);
  }

  const searchResult = folderResult.files.filter(item => item.name === fileName);
  if (searchResult.length === 1) {
    return searchResult[0].id;
  } else if (searchResult.length > 1) {
    prnt(`Multiple files with same name in folder: ${fileName}`);
    process.exit(-1);
  } else {
    prnt(`File does not exist in Google drive folder (${process.env.GOOGLE_UPLOAD_FOLDER}):\n${fileName}`);
    process.exit(-1);
  }

  return '';
}

function checkFileArg(fileArgNumber) {
  const filePath = process.argv[fileArgNumber];
  if (!fs.existsSync(filePath)) {
    prnt(`File does not exist: ${filePath}`);
    process.exit(-1);
  }
}

function checkEnvironment() {
  if (!process.env.GOOGLE_UPLOAD_FOLDER) {
    prnt(`Environment variable GOOGLE_UPLOAD_FOLDER not defined`);
    process.exit(-1);
  };

  if (!process.env.GOOGLE_UPLOAD_JSON_KEY_B64) {
    prnt(`Environment variable GOOGLE_UPLOAD_JSON_KEY_B64 not defined`);
    process.exit(-1);
  };
}


async function commandList() {
  const folderName = process.env.GOOGLE_UPLOAD_FOLDER;
  prnt(`Listing files from folder: ${folderName}`);
  const folderID = await getFolderID(folderName);
  prnt(folderID);
  const result = await listDrive(folderID);
  prnt(result);
}

async function commandGetFileLink() {
  const folderName = process.env.GOOGLE_UPLOAD_FOLDER;
  const parsedPath = path.parse(process.argv[3]);
  const filename = parsedPath.base;

  const folderID = await getFolderID(folderName);
  const fileID = await getFileID(folderID, filename);

  prnt(`https://drive.google.com/file/d/${fileID}/view`);
}

if (process.argv.length == 3 && process.argv[2] === 'list') {
  checkEnvironment();
  commandList();
} else if (process.argv.length == 4 && process.argv[2] === 'getlink') {
  checkEnvironment();
  // checkFileArg(3);
  commandGetFileLink();
} else if (process.argv.length == 4 && process.argv[2] === 'upload') {
  checkEnvironment();
  checkFileArg(3);
  const filePath = process.argv[3];
  prnt('Uploading file: ' + filePath);
  uploadFile(filePath).catch(console.error);
}
