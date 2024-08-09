const express = require('express');
const multer = require('multer');
const AWS = require('aws-sdk');
const fs = require('fs');
require('dotenv').config();

const app = express();
const upload = multer({ dest: 'uploads/' }); // temporarily save files to 'uploads/' folder

// Configure AWS
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

const s3 = new AWS.S3();
const bucketName = 'edvenswa-llmpoc'; 

app.post('/upload', upload.array('files'), async (req, res) => {
  const files = req.files;
  let responses = [];

  try {
    for (const file of files) {
      let textContent = '';
      if (file.mimetype === 'application/pdf') {
        const fileData = fs.readFileSync(file.path);
        const pdfData = await pdfParse(fileData);
        textContent = pdfData.text;
      } else if (file.mimetype === 'text/plain') {
        textContent = fs.readFileSync(file.path, 'utf8');
      }

      const uploadParams = {
        Bucket: bucketName,
        Key: `${Date.now()}-${file.originalname}`,
        Body: fileContent,
      };

      const uploadResult = await s3.upload(uploadParams).promise();
      fs.unlinkSync(file.path);
      
      responses.push({
        filename: file.originalname,
        location: uploadResult.Location,
        text: textContent,
      });
    }
    res.status(200).json(responses);
  } catch (error) {
    console.error('Error uploading files:', error);
    res.status(500).send('Error uploading files');
  }
});

app.get('/gets3data', async (req, res) => {
    const params = {
      Bucket: bucketName,
    };
  
    try {
      const data = await s3.listObjectsV2(params).promise();
      const objects = await Promise.all(data.Contents.map(async obj => {
        const urlParams = {
          Bucket: bucketName,
          Key: obj.Key,
          Expires: 3600 // URL expires in 1 hour
        };
        const url = await s3.getSignedUrlPromise('getObject', urlParams);
        return {
          Key: obj.Key,
          LastModified: obj.LastModified,
          Size: obj.Size,
          Url: url
        };
      }));
      res.status(200).json(objects);
    } catch (error) {
      console.error('Error retrieving S3 data:', error);
      res.status(500).send('Error retrieving data from S3');
    }
  });

  app.get('/getdatabykey/:key', async (req, res) => {
  const key = req.params.key;

  const params = {
    Bucket: bucketName,
    Key: key,
    Expires: 3600 // URL expires in 1 hour
  };

  try {
    const url = await s3.getSignedUrlPromise('getObject', params);
    res.status(200).json({ Url: url });
  } catch (error) {
    console.error('Error retrieving file:', error);
    res.status(500).send('Error retrieving file from S3');
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
