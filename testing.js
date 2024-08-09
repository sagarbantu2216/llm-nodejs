import express from "express";
import multer from "multer";
import fs from "fs";
// import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import dotenv from "dotenv";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { Document } from "langchain/document";
import { OllamaEmbeddings } from "@langchain/community/embeddings/ollama";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
// import { loadQAChain } from "langchain/chains";
import { ChatPromptTemplate } from "@langchain/core/prompts";
// import { ChatGroq } from "@langchain/groq";
import { createRetrievalChain } from "langchain/chains/retrieval";
import { createStuffDocumentsChain } from "langchain/chains/combine_documents";

dotenv.config();

const app = express();
app.use(express.json());
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

// // Initialize the ChatGroq model
// const groq_api_key = process.env.GROG_API_KEY; // Your Grog API key
// const llm = new ChatGroq({
//   apiKey: groq_api_key,
//   model: "Llama3-70b-8192",
//   temperature: 0.1,
//   max_tokens: 2000,
// });

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
      // if (file.mimetype === 'application/pdf') {
      //   const fileData = fs.readFileSync(file.path);
      //   const pdfData = await pdfParse(fileData);
      //   textContent = pdfData.text; // Extract text from PDF
      // } else
      if (file.mimetype === "text/plain") {
        textContent = fs.readFileSync(file.path, "utf8"); // Read text file
      }

      if (!textContent) {
        console.log("No text content found in the file");
        continue;
      } else {
        console.log("Text content found in the file");
        const document = new Document({ pageContent: textContent });
        const splitDocs = await splitter.splitDocuments([document]);
        const vectorStore = await MemoryVectorStore.fromDocuments(
          splitDocs,
          new OllamaEmbeddings({
            model: "nomic-embed-text", // default value
            baseUrl: "http://localhost:11434", // default value
          })
        );
        // Store vectorStore in app.locals
        app.locals.vectorStore = vectorStore;
        console.log("111111111111111111111111111111111111111111111111111111");
        console.log("vectorStore", vectorStore);
        console.log("111111111111111111111111111111111111111111111111111111");
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

app.post("/ask", async (req, res) => {
  const { question } = req.body;
  const vectorStore = req.app.locals.vectorStore;

  ////////////////////////////////
  // Connect to ollama endpoint
  const { Ollama } = await import("@langchain/community/llms/ollama");
  const model = new Ollama({
    baseUrl: "http://localhost:11434", // Default value
    model: "llama3", // Default value
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
    console.log("222222222222222222222222222222222222222222222222222222222222");
    console.log("Document chain created", documentChain);
    console.log("222222222222222222222222222222222222222222222222222222222222");

    const retrievalChain = await createRetrievalChain({
      combineDocsChain: documentChain,
      retriever,
    });
    console.log("33333333333333333333333333333333333333");
    console.log("Retrieval chain created", retrievalChain);
    console.log("33333333333333333333333333333333333333");

    // Invoke the chain with the question and context
    const response = await retrievalChain.invoke({
      input: await question,
    });
    console.log("44444444444444444444444444444444444444444444444444444444444");
    console.log("response", response);
    console.log("44444444444444444444444444444444444444444444444444444444444");

    res.status(200).json({ response });
  } catch (error) {
    console.error("Error processing question:", error);
    res.status(500).send("Error processing question: " + error.message);
  }
});

app.post("/tools", async (req, res) => {
  const { question } = req.body;
  const vectorStore = req.app.locals.vectorStore;

  ////////////////////////////////
  // Connect to ollama endpoint
  const { Ollama } = await import("@langchain/community/llms/ollama");
  const model = new Ollama({
    baseUrl: "http://localhost:11434", // Default value
    model: "llama3", // Default value
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
    console.log("222222222222222222222222222222222222222222222222222222222222");
    console.log("Document chain created", documentChain);
    console.log("222222222222222222222222222222222222222222222222222222222222");

    const retrievalChain = await createRetrievalChain({
      combineDocsChain: documentChain,
      retriever,
    });
    console.log("33333333333333333333333333333333333333");
    console.log("Retrieval chain created", retrievalChain);
    console.log("33333333333333333333333333333333333333");

    // Invoke the chain with the question and context
    const response = await retrievalChain.invoke({
      input: await question,
    });
    console.log("44444444444444444444444444444444444444444444444444444444444");
    console.log("response", response);
    console.log("44444444444444444444444444444444444444444444444444444444444");

    /////////////////////////////////////////////////////////////////////////////////
    // using of the tools in langchain
    const { ChatGroq } = await import("@langchain/groq");
    const tool = new ChatGroq({
      apiKey: process.env.GROG_API_KEY,
      model: "Llama3-70b-8192",
      temperature: 0.1,
      max_tokens: 2000,
    });
    const revival = response.answer;

    const querytoask = ChatPromptTemplate.fromTemplate(`
       format the given text in a proper way and add some context to it for better understanding
      `);
      const documentChain1 = await createStuffDocumentsChain({
        llm: tool,
        querytoask,
      });
      const retrievalChain1 = await createRetrievalChain({
        combineDocsChain: documentChain1,
        revival,
      });
      // Invoke the chain with the question and context
      const response1 = await retrievalChain1.invoke({
        input: "format the given text in a proper way and add some context to it for better understanding",
      });
        console.log("response1", response1);
    res.status(200).json({ response1 });
  } catch (error) {
    console.error("Error processing question:", error);
    res.status(500).send("Error processing question: " + error.message);
  }
});

app.post("/testing", async (req, res) => {
  const vectorStore = req.app.locals.vectorStore;
  
  
  // Check if vectorStore is available
  if (!vectorStore) {
    return res.status(400).send("No documents uploaded for context.");
  }
  
  try {
    const { Ollama } = await import("@langchain/community/llms/ollama");
    const model = new Ollama({
      baseUrl: "http://localhost:11434",
      model: "llama3",
    });

    const retriever = await vectorStore.asRetriever();

    // Create a prompt with the retrieved context
    const prompt = ChatPromptTemplate.fromTemplate(`
      You are a medical assistant AI with access to a patient's medical records. 
      Use the patient's medical records to provide a detailed and accurate response. 
      Format your response according to the following JSON schema:
      {
          "header": "string",
          "originalText": "string",
          "age": "numeric value, 'unknown' if null",
          "dob": "MM/DD/YYYY, 'unknown' if null",
          "gender": "male or 'female', 'unknown' if null",
          "race": "American Indian or Alaska Native, Asian, Black or African American, Native Hawaiian or Other Pacific Islander, White, Other, 'unknown' if null",
          "ethnicity": "Hispanic or Latino, Not Hispanic or Latino, 'unknown' if null",
          "smokingStatus": "SMOKER, CURRENT_SMOKER, PAST_SMOKER, NON_SMOKER, UNKNOWN, FORMER_SMOKER, 'unknown' if null",
          "result": [
              {
                  "name": "DiseaseDisorderMention, LabMention, MedicationMention, ProcedureMention, SignSymptomMention, SectionHeader, gender, AnatomicalSiteMention, EntityMention, MedicalDeviceMention, BacteriumMention, GeneMention",
                  "sectionOid": "see sections sheet, 'SIMPLE_SEGMENT' if null",
                  "sectionName": "see sections sheet, omitted if 'SIMPLE_SEGMENT'",
                  "sectionOffset": "character offset for the entire section",
                  "sentence": "character offset for the sentence",
                  "extendedSentence": "character offset for the extended sentence",
                  "text": "annotated text with character offsets",
                  "attributes": {
                      "derivedGeneric": "1 - derived generic, 0 - not derived generic",
                      "polarity": "positive, negated, default positive",
                      "relTime": "current status, history status, family history status, probable status, default current status",
                      "date": "MM-DD-YYYY, omitted if null",
                      "status": "stable, unstable, controlled, not controlled, deteriorating, getting worse, improving, resolved, resolving, unresolved, uncontrolled, worsening, well-controlled, unchanged, chronic, diminished, new diagnosis, omitted if null, expandable list",
                      "medDosage": "MedicationMention attribute",
                      "medForm": "MedicationMention attribute",
                      "medFrequencyNumber": "MedicationMention attribute",
                      "medFrequencyUnit": "MedicationMention attribute",
                      "medRoute": "MedicationMention attribute",
                      "medStrengthNum": "MedicationMention attribute",
                      "medStrengthUnit": "MedicationMention attribute",
                      "labUnit": "LabMention attribute",
                      "labValue": "LabMention attribute",
                      "umlsConcept": [
                          {
                              "codingScheme": "UMLS Vocabulary associated with UMLS Atom",
                              "cui": "UMLS CUI appropriate for annotation under 'text'",
                              "tui": "UMLS TUI",
                              "code": "Code associated with UMLS Atom",
                              "preferredText": "Preferred text description of UMLS Atom"
                          }
                      ]
                  }
              }
          ]
      }
      For the sections Problem List and Medications from the patient document, please extract relevant information from the patient's records and provide detailed information. 
      Include the onset, duration, diagnosis date, status, associated symptoms, dosage, frequency, route of administration, duration of use, and any relevant details. 
      Additionally, provide the sectionOffset, sentence, and extendedSentence for each result. 
      The sectionOffset should indicate the character offset for the entire section. 
      The sentence should indicate the character offset for the specific sentence. 
      The extendedSentence should indicate the character offset for the extended sentence.
      Generate all the coding schemas mentioned below for each information extracted from the patient's records.
      Refer to this URL for UMLS concept codes: https://uts-ws.nlm.nih.gov. 
      Use ICD10CM, SNOMED, and RXNORM as coding schemas for diseases and medications. 
      Ensure the response is accurate and structured according to the provided schema.
    `);

    // Create the document chain with the prompt
    const documentChain = await createStuffDocumentsChain({
      llm: model,
      prompt,
    });

    // Create the retrieval chain
    const retrievalChain = await createRetrievalChain({
      combineDocsChain: documentChain,
      retriever,
    });

    // Invoke the chain with the prompt
    const response = await retrievalChain.invoke({
      input: "provide a detailed and accurate response for the given prompt",
    });

    res.status(200).json({ response });
  } catch (error) {
    console.error("Error processing request:", error);
    res.status(500).send("Error processing request: " + error.message);
  }
});
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
