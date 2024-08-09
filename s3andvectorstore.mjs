// import express from "express";
// import multer from "multer";
// import fs from "fs";
// import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
// // import pdfParse from 'pdf-parse';
// import dotenv from "dotenv";
// import { MarkdownTextSplitter } from "langchain/text_splitter";
// import { Document } from "langchain/document";
// import { OllamaEmbeddings } from "@langchain/community/embeddings/ollama";
// // import { Chroma } from '@langchain/community/vectorstores/chroma';
// // import { PineconeClient } from '@pinecone-database/pinecone';
// import { MemoryVectorStore } from "langchain/vectorstores/memory";
// import { createRetrievalChain } from "langchain/chains/retrieval";
// import { createStuffDocumentsChain } from "langchain/chains/combine_documents";



// dotenv.config();

// const app = express();
// const upload = multer({ dest: "uploads/" }); // Temporarily save files to 'uploads/' folder

// // Configure AWS S3 client
// const s3Client = new S3Client({
//   region: process.env.AWS_REGION,
//   credentials: {
//     accessKeyId: process.env.AWS_ACCESS_KEY_ID,
//     secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
//   },
// });

// const bucketName = "edvenswa-llmpoc"; // Specify your bucket name

// // Configure the text splitter
// const splitter = new MarkdownTextSplitter({
//   chunkSize: 1000, // Approx 1000 characters
//   chunkOverlap: 100, // Small overlap to maintain context between chunks
// });

// app.post("/upload", upload.array("files", 10), async (req, res) => {
//   const files = req.files;
//   const { userId, patientId } = req.body;

//   if (!userId || !patientId) {
//     return res
//       .status(400)
//       .send("Missing userId or patientId in the request body.");
//   }

//   let responses = [];

//   try {
//     for (const file of files) {
//       let textContent = "";

//       // Read the file content based on its MIME type
//       // if (file.mimetype === 'application/pdf') {
//       //   const fileData = fs.readFileSync(file.path);
//       //   const pdfData = await pdfParse(fileData);
//       //   textContent = pdfData.text; // Extract text from PDF
//       // } else
//       if (file.mimetype === "text/plain") {
//         textContent = fs.readFileSync(file.path, "utf8"); // Read text file
//       }

//       if (!textContent) {
//         console.log("No text content found in the file");
//         continue;
//       } else {
//         console.log("Text content found in the file");
//         const document = new Document({ pageContent: textContent });
//         const splitDocs = await splitter.splitDocuments([document]);
//         const vectorStore = await MemoryVectorStore.fromDocuments(
//           splitDocs,
//           new OllamaEmbeddings({
//             model: "nomic-embed-text", // default value
//             baseUrl: "http://localhost:11434", // default value
//           })
//         );
//         console.log("vectorStore", vectorStore);
//         const retriever = await vectorStore.asRetriever();
//         console.log("Augmenting data loaded - " + new Date());
//         console.log("Retrieving data - " + new Date());
//       }

//       ////////////////////////////////
//       // GET THE MODEL
      

//       ////////////////////////////////
//       // CREATE CHAIN
//       const prompt =
//         ChatPromptTemplate.fromTemplate(`Answer the following question based only on the provided context, if you don't know the answer say so:

//       <context>
//       {context}
//       </context>

//       Question: {input}`);

//       const documentChain = await createStuffDocumentsChain({
//         llm: model,
//         prompt,
//       });

//       const retrievalChain = await createRetrievalChain({
//         combineDocsChain: documentChain,
//         retriever,
//       });

//       const filePath = `${userId}/${patientId}/${Date.now()}-${
//         file.originalname
//       }`;
//       const uploadParams = {
//         Bucket: bucketName,
//         Key: filePath,
//         Body: fs.createReadStream(file.path),
//       };

//       // Upload the original file to S3
//       await s3Client.send(new PutObjectCommand(uploadParams));
//       fs.unlinkSync(file.path); // Remove the file from local storage after upload

//       responses.push({
//         filename: file.originalname,
//         filePath: filePath,
//       });
//     }
//     res.status(200).json(responses);
//   } catch (error) {
//     console.error("Error processing files:", error);
//     res.status(500).send("Error processing files: " + error.message);
//   }
// });

// const PORT = process.env.PORT || 5000;
// app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

const express = require("express");
const multer = require("multer");
const fs = require("fs");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const pdfParse = require("pdf-parse");
require("dotenv").config();
const { MarkdownTextSplitter } = require("langchain/text_splitter");
// const { Document } = require("langchain/document");
const { OllamaEmbeddings } = require("@langchain/community/embeddings/ollama");
// const { Chroma } = require("@langchain/community/vectorstores/chroma");
// const { PineconeClient } = require("@pinecone-database/pinecone");
const { MemoryVectorStore } = require("langchain/vectorstores/memory");
const app = express();
const upload = multer({ dest: "uploads/" }); // Temporarily save files to 'uploads/' folder

// Configure AWS S3 client
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const bucketName = "edvenswa-llmpoc"; // Specify your bucket name

// Configure the text splitter
const splitter = await new MarkdownTextSplitter({
  chunkSize: 1000, // Approx 1000 characters
  chunkOverlap: 100, // Small overlap to maintain context between chunks
});

app.post("/upload", upload.array("files", 10), async (req, res) => {
  const files = req.files;
  const { userId, patientId } = req.body;

  if (!userId || !patientId) {
    return res
      .status(400)
      .send("Missing userId or patientId in the request body.");
  }

  let responses = [];

  try {
    for (const file of files) {
      let textContent = "";

      // Read the file content based on its MIME type
      if (file.mimetype === "application/pdf") {
        const fileData = fs.readFileSync(file.path);
        const pdfData = await pdfParse(fileData);
        textContent = pdfData.text; // Extract text from PDF
      } else if (file.mimetype === "text/plain") {
        textContent = fs.readFileSync(file.path, "utf8"); // Read text file
      }

      if (!textContent) {
        console.log("No text content found in the file");
        continue;
      } else {
        console.log("Text content found in the file");
        const splitDocs = await splitter.splitDocuments(textContent);
        const vectorStore = await MemoryVectorStore.fromDocuments(
          splitDocs,
          new OllamaEmbeddings({
            model: "nomic-embed-text", // default value
            baseUrl: "http://localhost:11434", // default value
          })
        );
        console.log("vectorStore", vectorStore);
        // const retriever = await vectorStore.asRetriever();
        // console.log("Augmenting data loaded - " + new Date());
        // console.log("Retrieving data - " + new Date());
      }

      // // Use the RecursiveCharacterTextSplitter to split text into chunks
      // let chunks = [];
      // const indexName = process.env.PINECONE_INDEX_NAME;
      // const vectorDimension = 1536;
      // if (textContent) {
      //   const documents = await splitter.splitDocuments([
      //     new Document({ pageContent: textContent }),
      //   ]);
      //   chunks = documents.map((doc) => doc.pageContent);
      //   // 9. Initialize Pinecone client with API key and environment
      //   const client = new PineconeClient();
      //   await client.init({
      //     apiKey: process.env.PINECONE_API_KEY,
      //   });
      //   (async () => {
      //     // 11. Check if Pinecone index exists and create if necessary
      //     await createPineconeIndex(client, indexName, vectorDimension);
      //     // 12. Update Pinecone vector store with document embeddings
      //     await updatePinecone(client, indexName, docs);
      //   })();
      // }

      const filePath = `${userId}/${patientId}/${Date.now()}-${
        file.originalname
      }`;
      const uploadParams = {
        Bucket: bucketName,
        Key: filePath,
        Body: fs.createReadStream(file.path),
      };

      // Upload the original file to S3
      await s3Client.send(new PutObjectCommand(uploadParams));
      fs.unlinkSync(file.path); // Remove the file from local storage after upload

      responses.push({
        filename: file.originalname,
        filePath: filePath,
      });
    }
    res.status(200).json(responses);
  } catch (error) {
    console.error("Error processing files:", error);
    res.status(500).send("Error processing files: " + error.message);
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
