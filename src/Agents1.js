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
// import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { Pinecone } from "@pinecone-database/pinecone";
import { PineconeStore } from "@langchain/pinecone";
// import { loadQAChain } from "langchain/chains";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { createRetrievalChain } from "langchain/chains/retrieval";
import { createStuffDocumentsChain } from "langchain/chains/combine_documents";
import { OpenAIEmbeddings } from "@langchain/openai";
import { TextLoader } from "langchain/document_loaders/fs/text";
import { CSVLoader } from "langchain/document_loaders/fs/csv";
import { PDFLoader } from "langchain/document_loaders/fs/pdf";
import { AgentExecutor, createOpenAIFunctionsAgent } from "langchain/agents";
import { Tool } from "@langchain/core/tools";
import { ChatOpenAI  } from "@langchain/openai";


dotenv.config();

const app = express();
app.use(cors())
app.use(express.json());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
const upload = multer({ dest: "uploads/" }); // Temporarily save files to 'uploads/' folder
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

app.post("/upload", upload.array("files", 10), async (req, res) => {
  const files = req.files;
  const { userId, uploadId, rawText } = req.body;

  if (!userId || !uploadId) {
    return res
      .status(400)
      .send("Missing userId or uploadId in the request body.");
  }

  let responses = [];

  try {
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
        const openaiEmbeddings = new OpenAIEmbeddings({
          apiKey: process.env.OPENAI_API_KEY,
          batchSize: 512,
          model: "text-embedding-3-large",
        });

        const document = new Document({ pageContent: textContent, metadata: { userId, uploadId } });
        const splitDocs = await splitter.splitDocuments([document]);

        const vectorStore = await PineconeStore.fromDocuments(splitDocs, openaiEmbeddings, {
          pineconeIndex,
          metadata: { userId, uploadId }, // Add metadata here
          maxConcurrency: 5,
        });

        app.locals.vectorStore = vectorStore;
      }

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


app.post("/ask", async (req, res) => {
  const { question, userId, uploadId } = req.body;
  const vectorStore = req.app.locals.vectorStore;

  if (!question || !userId || !uploadId) {
    return res.status(400).send("Missing question, userId, or uploadId in the request body.");
  }

  if (!vectorStore) {
    return res.status(400).send("No documents uploaded for context.");
  }

  try {
    const retriever = await vectorStore.asRetriever({
      filter: {
        userId: userId,
        uploadId: uploadId
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


app.post("/happy", async (req, res) => {
  const { question, userId, uploadId } = req.body;
  const vectorStore = req.app.locals.vectorStore;

  if (!question || !userId || !uploadId) {
    return res.status(400).send("Missing question, userId, or uploadId in the request body.");
  }

  if (!vectorStore) {
    return res.status(400).send("No documents uploaded for context.");
  }

  try {
    const retriever = await vectorStore.asRetriever({
      filter: {
        userId: userId,
        uploadId: uploadId
      },
    });

    const prompt = ChatPromptTemplate.fromTemplate(`
      You are provided with a list of health problems or diagnoses from a patient's medical record. Your task is to generate a JSON object for each problem in the list, including all specified attributes. If an attribute does not have a value, it should be set to null.
    
      Context: {context}
    
      Answer the following question strictly in the provided JSON format for each problem in the list. Each problem should have its own JSON object. Make sure to include every problem in the list.
    
      JSON format example:
      {{
        "name": "Problem name",
        "sectionOid": "see sections sheet, 'SIMPLE_SEGMENT' if null",
        "sectionName": "see sections sheet, omitted if 'SIMPLE_SEGMENT'",
        "sectionOffset": "character offset for the entire section",
        "sentence": "character offset for the sentence",
        "extendedSentence": "character offset for the extended sentence",
        "text": "annotated text with character offsets",
        "attributes": {{
          "derivedGeneric": "1 - derived generic, 0 - not derived generic",
          "polarity": "positive, negated, default positive",
          "relTime": "current status, history status, family history status, probably status, default current status",
          "date": "MM-DD-YYYY, omitted if null",
          "status": "stable, unstable, controlled, not controlled, deteriorating, getting worse, improving, resolved, resolving, unresolved, uncontrolled, worsening, well-controlled, unchanged, chronic, diminished, new diagnosis, omitted if null, expandable list",
          "medDosage": null,
          "medForm": null,
          "medFrequencyNumber": null,
          "medFrequencyUnit": null,
          "medRoute": null,
          "medStrengthNum": null,
          "medStrengthUnit": null,
          "labUnit": null,
          "labValue": null,
          "umlsConcept": [
            {{
              "codingScheme": "use snomed coding scheme",
              "cui": "UMLS CUI appropriate for annotation under 'text'",
              "tui": "UMLS TUI",
              "code": "Code associated with UMLS Atom",
              "preferredText": "Preferred text description of UMLS Atom"
            }}
          ]
        }}
      }}
    
      Provide a JSON object for each problem in the list.
    `);
    
    const { ChatOpenAI } = await import("@langchain/openai");
    const model = new ChatOpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      modelName: "gpt-4-1106-preview",
    });

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

// Agent and Tools Setup
app.post("/agent", async (req, res) => {
  const { task } = req.body;

  if (!task) {
    return res.status(400).send("Missing task in the request body.");
  }

  try {
    // Define tools
    const tools = [
      new Tool({
        name: "Search Documents",
        func: async (query) => {
          const vectorStore = req.app.locals.vectorStore;
          if (!vectorStore) {
            return "No documents uploaded for context.";
          }
          const retriever = await vectorStore.asRetriever();
          
          const results = await retriever.retrieve({ query });
          return results.map(r => r.text).join("\n");
        }
      }),
      new Tool({
        name: "Generate Answer",
        func: async (query) => {
          const llm = new ChatOpenAI({
            apiKey: process.env.OPENAI_API_KEY,
            modelName: "gpt-4-1106-preview",
          });
          const response = await llm.generate({ prompt: query });
          return response;
        }
      }),
    ];
    
    const model = new ChatOpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      modelName: "gpt-4-1106-preview",
    });
    const prompt = ChatPromptTemplate.fromMessages([
      ["system", "You are a helpful assistant"],
      ["placeholder", "{chat_history}"],
      ["human", "{input}"],
      ["placeholder", "{agent_scratchpad}"],
    ])
  
    // Define the agent
    const agent = await createOpenAIFunctionsAgent({
      llm: model,
      tools,
      prompt,
    });

    const agentExecutor = new AgentExecutor({
      agent,
      tools,
    });

    // Execute the agent with the provided task
    const agentResponse = await agentExecutor.invoke({ input: await task });
    res.status(200).json({ response: agentResponse });
  } catch (error) {
    console.error("Error executing agent:", error);
    res.status(500).send("Error executing agent: " + error.message);
  }
});


const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
