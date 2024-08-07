const express = require('express');
const multer = require('multer');
const fs = require('fs');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const pdfParse = require('pdf-parse');
require('dotenv').config();
const { OllamaEmbeddings } = require("@langchain/community/embeddings/ollama");

const app = express();
const upload = multer({ dest: 'uploads/' }); // Temporarily save files to 'uploads/' folder

// Configure AWS
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

const bucketName = 'edvenswa-llmpoc'; // Specify your bucket name

const embeddings = new OllamaEmbeddings({
    model: "nomic-embed-text", // default value
    baseUrl: "http://localhost:11434", // default value
  });

// Helper function to chunk text
const chunkText = (text, size) => {
  const numChunks = Math.ceil(text.length / size);
  const chunks = new Array(numChunks);
  for (let i = 0, o = 0; i < numChunks; ++i, o += size) {
    chunks[i] = text.substr(o, size);
  }
  return chunks;
};

const getEmbeddings = async (text) => {
   const vector = await embeddings.embedDocuments(text);
   console.log(vector);
   return vector;
};

app.post('/upload', upload.array('files', 10), async (req, res) => {
  const files = req.files;
  const { userId, patientId } = req.body;

  if (!userId || !patientId) {
    return res.status(400).send("Missing userId or patientId in the request body.");
  }

  let responses = [];

  try {
    for (const file of files) {
      let textContent = '';
      let chunks = [];
      if (file.mimetype === 'application/pdf') {
        const fileData = fs.readFileSync(file.path);
        const pdfData = await pdfParse(fileData);
        textContent = pdfData.text;
        chunks = chunkText(textContent, 1024); // Chunk size of 1024 characters
        vectors = await getEmbeddings(chunks);
      } else if (file.mimetype === 'text/plain') {
        textContent = fs.readFileSync(file.path, 'utf8');
        chunks = chunkText(textContent, 1024);
        console.log(chunks);
        vectors = await getEmbeddings(chunks);
      }

      const filePath = `${userId}/${patientId}/${Date.now()}-${file.originalname}`;
      const uploadParams = {
        Bucket: bucketName,
        Key: filePath,
        Body: fs.createReadStream(file.path)
      };

      await s3Client.send(new PutObjectCommand(uploadParams));
      fs.unlinkSync(file.path); // Remove the file from local storage after upload

      responses.push({
        filename: file.originalname,
        filePath: filePath
      });
    }
    res.status(200).json(responses);
  } catch (error) {
    console.error('Error processing files:', error);
    res.status(500).send('Error processing files');
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
