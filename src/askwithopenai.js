import express from "express";
import multer from "multer";
import bodyParser from 'body-parser';
import cors from 'cors';
import fs from "fs";
// import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import dotenv from "dotenv";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { Document } from "langchain/document";
import { OllamaEmbeddings } from "@langchain/community/embeddings/ollama";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
// import { loadQAChain } from "langchain/chains";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { createRetrievalChain } from "langchain/chains/retrieval";
import { createStuffDocumentsChain } from "langchain/chains/combine_documents";
import { OpenAIEmbeddings } from "@langchain/openai";
import { TextLoader } from "langchain/document_loaders/fs/text";
import { CSVLoader } from "langchain/document_loaders/fs/csv";
import { PDFLoader } from "langchain/document_loaders/fs/pdf";

dotenv.config();

const app = express();
app.use(cors())
app.use(express.json());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
const upload = multer({ dest: "uploads/" }); // Temporarily save files to 'uploads/' folder

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

app.post("/upload", upload.array("files", 10), async (req, res) => {
  const files = req.files;
  const { userId, patientId, rawText } = req.body;

  if (!userId || !patientId) {
    return res
      .status(400)
      .send("Missing userId or patientId in the request body.");
  }

  let responses = [];

  try {
    if (rawText) {
        const document = new Document({ pageContent: rawText });
        const splitDocs = await splitter.splitDocuments([document]);
        const openaiEmbeddings = new OpenAIEmbeddings({
          apiKey: process.env.OPENAI_API_KEY,
          batchSize: 512,
          model: "text-embedding-3-large",
        });
        const vectorStore = await MemoryVectorStore.fromDocuments(splitDocs, openaiEmbeddings); // Optional, can be used to specify the distance method);
        app.locals.vectorStore = vectorStore;
  
        console.log("Processed raw text");
        responses.push({
          textProcessed: true,
        });
      }  

    for (const file of files) {
      let textContent = "";

    // Read the file content based on its MIME type
    if (file.mimetype === 'application/pdf') {
      const fileData = new PDFLoader(file.path);
      const pdfData = await fileData.load();
      textContent = pdfData.map(doc => doc.pageContent).join(" "); // Extract text from PDF
    } else if (file.mimetype === "text/plain") {
      const fileData = new TextLoader(file.path);
      const textData = await fileData.load();
      textContent = textData.map(doc => doc.pageContent).join(" "); // Read text file
    } else if (file.mimetype) {
      const fileData = new CSVLoader(file.path);
      const csvData = await fileData.load();
      textContent = csvData.map(row => Object.values(row).join(", ")).join("\n"); // Extract text from CSV
    } 

      if (!textContent) {
        console.log("No text content found in the file");
        continue;
      } else {
        /////////////////////////////////////////////////////////////
        // Initialize the OllamaEmbeddings model
        const ollamaEmbeddings = new OllamaEmbeddings({
            model: "nomic-embed-text", // default value
            baseUrl: "http://localhost:11434", // default value
        });
        ///////////////////////////////////////////////////////////
        // Initialize the OpenAIEmbeddings model
        const openaiEmbeddings = new OpenAIEmbeddings({
            apiKey: process.env.OPENAI_API_KEY, // In Node.js defaults to process.env.OPENAI_API_KEY
            batchSize: 512, // Default value if omitted is 512. Max is 2048
            model: "text-embedding-3-large",
          });
        console.log("Text content found in the file");
        const document = new Document({ pageContent: textContent });
        const splitDocs = await splitter.splitDocuments([document]);
        const vectorStore = await MemoryVectorStore.fromDocuments(splitDocs, openaiEmbeddings); // Optional, can be used to specify the distance method);
        // Store vectorStore in app.locals
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
    }
    res.status(200).json(responses);
  } catch (error) {
    console.error("Error processing files:", error);
    res.status(500).send("Error processing files: " + error.message);
  }
});

app.get("/ask", async (req, res) => {
  const { question } = req.body;
  const vectorStore = req.app.locals.vectorStore;

//////////////////////////////////////////////
// Connect to ollama endpoint
//   const { Ollama } = await import("@langchain/community/llms/ollama");
//   const model = new Ollama({
//     baseUrl: "http://localhost:11434", // Default value
//     model: "llama3", // Default value
//   });

////////////////////////////////////////////
// Initialize the ChatGroq model
//   const { ChatGroq } = await import("@langchain/groq");
//   const model = new ChatGroq({
//     apiKey: process.env.GROG_API_KEY,
//     model: "Llama3-70b-8192",
//     temperature: 0.1,
//     max_tokens: 2000,
//   });

////////////////////////////////////////////////////////
// initialize the ChatOpenAI model
const { ChatOpenAI } = await import ( "@langchain/openai" )
const model = new ChatOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  modelName: "gpt-4-1106-preview",
});

  if (!question) {
    return res.status(400).send("Missing question in the request body.");
  }

  if (!vectorStore) {
    return res.status(400).send("No documents uploaded for context.");
  }

  try {
    const retriever = await vectorStore.asRetriever();

    // Create a prompt with the retrieved context
    const prompt = ChatPromptTemplate.fromTemplate(`
      Context: {context}
      Answer the following question if you don't know the answer say so:
      Question: {input}
      
    `);

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
      input: await question,
    });

    res.status(200).json({ response });
  } catch (error) {
    console.error("Error processing question:", error);
    res.status(500).send("Error processing question: " + error.message);
  }
});
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
