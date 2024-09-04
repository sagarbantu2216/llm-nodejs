import express from "express";
import multer from "multer";
import bodyParser from "body-parser";
import cors from "cors";
import fetch from "node-fetch";
import path from "path";
import fs from "fs";
import FormData from "form-data";  // Ensure you're using 'form-data' package instead of the built-in FormData
// import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import dotenv from "dotenv";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { Document } from "langchain/document";
// import { OllamaEmbeddings } from "@langchain/community/embeddings/ollama";
// import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { Pinecone } from "@pinecone-database/pinecone";
import { PineconeStore } from "@langchain/pinecone";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { createRetrievalChain } from "langchain/chains/retrieval";
import { createStuffDocumentsChain } from "langchain/chains/combine_documents";
import { OpenAIEmbeddings } from "@langchain/openai";
import { TextLoader } from "langchain/document_loaders/fs/text";
import { CSVLoader } from "langchain/document_loaders/fs/csv";
import { PDFLoader } from "langchain/document_loaders/fs/pdf";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));
const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});
const pineconeIndex = pinecone.Index(process.env.PINECONE_INDEX_NAME);

// // Configure AWS S3 client
// const s3Client = new S3Client({
//   region: process.env.AWS_REGION,
//   credentials: {
//     accessKeyId: process.env.AWS_ACCESS_KEY_ID,
//     secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
//   },
// });

// const bucketName = "edvenswa-llmpoc"; // Specify your bucket name

// Configure the text splitter
const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1000, // Approx 1000 characters
  chunkOverlap: 100, // Small overlap to maintain context between chunks
});

// Configure Multer storage to keep the original filename and extension
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, "uploads/"); // Save files to 'uploads/' folder
    },
    filename: function (req, file, cb) {
      const originalName = file.originalname;
      cb(null, originalName); // Keep the original file name with the extension
    }
  });   

  const upload = multer({ storage: storage });

  const deleteFile = (filePath) => {
    fs.unlink(filePath, (err) => {
      if (err) {
        console.error(`Error deleting file ${filePath}:`, err);
      } else {
        console.log(`File ${filePath} deleted successfully.`);
      }
    });
  };

app.post("/upload", upload.array("files", 10), async (req, res) => {
  const files = req.files;
  const { userId, uploadId } = req.body;

  if (!userId || !uploadId) {
    return res
      .status(400)
      .send("Missing userId or uploadId in the request body.");
  }

  let responses = [];

  try {
    for (const file of files) {
      let textContent = "";

      if (file.mimetype === "application/pdf") {
        const fileData = new PDFLoader(file.path);
        const pdfData = await fileData.load();
        textContent = pdfData.map((doc) => doc.pageContent).join(" "); // Extract text from PDF
      } else if (file.mimetype === "text/plain") {
        const fileData = new TextLoader(file.path);
        const textData = await fileData.load();
        textContent = textData.map((doc) => doc.pageContent).join(" "); // Read text file
      } else if (file.mimetype === "text/csv") {
        // Correct MIME type for CSV
        const fileData = new CSVLoader(file.path);
        const csvData = await fileData.load();
        textContent = csvData
          .map((row) => Object.values(row).join(", "))
          .join("\n"); // Extract text from CSV
      } else {
        const paith = file.path;
        const absolutePath = path.resolve(paith);
        const formdata = new FormData();
        const myHeaders = new Headers();
        myHeaders.append("Gotenberg-Output-Filename", `${file.originalname}.pdf`);

        const name = file.originalname;
        
        // Correctly append the file stream to the FormData object
        formdata.append("files", fs.createReadStream(absolutePath), `${name}`);
        
        const requestOptions = {
          method: "POST",
          body: formdata,
          redirect: "follow",
          headers: myHeaders
        };
        
        const response = await fetch("http://44.243.166.197:3000/forms/libreoffice/convert", requestOptions);
        
        if (response.ok) {
          const newpath = `save/${file.originalname}.pdf`
          console.log("new path : ",newpath);
          const fileStream = fs.createWriteStream(`${newpath}`);  // Specify the path where you want to save the PDF
          await new Promise((resolve, reject) => {
            response.body.pipe(fileStream);
            response.body.on("error", reject);
            fileStream.on("finish", resolve);
          });
          const fileData = new PDFLoader(newpath);
          const pdfData = await fileData.load();
          textContent = pdfData.map((doc) => doc.pageContent).join(" "); // Extract text from PDF
          console.log("PDF file saved successfully.");
          deleteFile(newpath);
        } else {
          console.error(`Failed to convert file: ${response.status} ${response.statusText}`);
        }
      }

      if (!textContent) {
        console.log("No text content found in the file");
        continue;
      } else {
        const openaiEmbeddings = new OpenAIEmbeddings({
          apiKey: process.env.OPENAI_API_KEY,
          batchSize: 512,
          model: "text-embedding-3-large",
        });
        /////////////////////////////////////////////////////////////
        // Initialize the OllamaEmbeddings model
        //   const ollamaEmbeddings = new OllamaEmbeddings({
        //     model: "nomic-embed-text", // default value
        //     baseUrl: "http://localhost:11434", // default value
        // });

        const document = new Document({
          pageContent: textContent,
          metadata: { userId, uploadId },
        });
        const splitDocs = await splitter.splitDocuments([document]);

        const vectorStore = await PineconeStore.fromDocuments(
          splitDocs,
          openaiEmbeddings,
          {
            pineconeIndex,
            metadata: { userId, uploadId }, // Add metadata here
            maxConcurrency: 5,
          }
        );

        app.locals.vectorStore = vectorStore;
      }

      // const filePath = `${userId}/${patientId}/${Date.now()}-${
      //   file.originalname
      // }`;
      // const uploadParams = {
      //   Bucket: bucketName,
      //   Key: filePath,
      //   Body: fs.createReadStream(file.path),
      // };

      // // Upload the original file to S3
      // await s3Client.send(new PutObjectCommand(uploadParams));
      // fs.unlinkSync(file.path); // Remove the file from local storage after upload

      responses.push({
        filename: file.originalname,
      });

        // Delete the file after processing
        deleteFile(file.path);
    }
    res.status(200).json(responses);
  } catch (error) {
    console.error("Error processing files:", error);
    res.status(500).send("Error processing files: " + error.message);
  }
});

app.post("/ask", async (req, res) => {
  const { question, userId, uploadId } = req.body;
  const vectorStore = req.app.locals.vectorStore;

  if (!question || !userId || !uploadId) {
    return res
      .status(400)
      .send("Missing question, userId, or uploadId in the request body.");
  }

  if (!vectorStore) {
    return res.status(400).send("No documents uploaded for context.");
  }

  try {
    const retriever = await vectorStore.asRetriever({
      filter: {
        userId: userId,
        uploadId: uploadId,
      },
    });

    // Create a prompt with the retrieved context
    const prompt = ChatPromptTemplate.fromTemplate(`
            Context: {context}
            Answer the following question if you don't know the answer say so:
            Question: {input}
        `);
    const { ChatOpenAI } = await import("@langchain/openai");
    const model = new ChatOpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      modelName: "gpt-4-1106-preview",
    });

    ////////////////////////////////////////////
    // Initialize the ChatGroq model
    //   const { ChatGroq } = await import("@langchain/groq");
    //   const model = new ChatGroq({
    //     apiKey: process.env.GROG_API_KEY,
    //     model: "Llama3-70b-8192",
    //     temperature: 0.1,
    //   });

    const documentChain = await createStuffDocumentsChain({
      llm: model,
      prompt,
    });

    const retrievalChain = await createRetrievalChain({
      combineDocsChain: documentChain,
      retriever,
    });

    // Invoke the chain with the question and context
    const response = await retrievalChain.invoke({
      input: question,
    });

    res.status(200).json({ response });
  } catch (error) {
    console.error("Error processing question:", error);
    res.status(500).send("Error processing question: " + error.message);
  }
});

const PORT = 4000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
