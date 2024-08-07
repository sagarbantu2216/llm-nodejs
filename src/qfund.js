import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { CSVLoader } from 'langchain/document_loaders/fs/csv';
import { OpenAIEmbeddings } from '@langchain/openai';
import { Document } from 'langchain/document';
import { MemoryVectorStore } from 'langchain/vectorstores/memory';
import { createStuffDocumentsChain } from 'langchain/chains/combine_documents';
import { createRetrievalChain } from 'langchain/chains/retrieval';
import dotenv from 'dotenv';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { ChatPromptTemplate } from '@langchain/core/prompts';
// import { functions } from 'firebase-functions';

dotenv.config();

const app = express();
app.use(cors())
app.use(express.json());
const upload = multer({ dest: 'uploads/' });

let regulations = {
  currentYearContent: null
};

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1000, // Approx 1000 characters
  chunkOverlap: 100, // Small overlap to maintain context between chunks
});

// New endpoint to upload regulations for past and current year
app.post('/api/qfund/upload-regulations', upload.fields([{ name: 'currentYear', maxCount: 1 }]), async (req, res) => {
  console.log('Request received for uploading regulations');
  console.log('Files received:', req.files);

  const readCSVFile = async (filePath) => {
    console.log(`Reading CSV file from path: ${filePath}`);
    const fileData = new CSVLoader(filePath);
    const csvData = await fileData.load();
    const textContent = csvData.map(row => Object.values(row).join(', ')).join('\n');

    if (!textContent) {
      console.log('No text content found in the file');
      return null;
    } else {
      console.log('Text content found in the file');

      const openaiEmbeddings = new OpenAIEmbeddings({
        apiKey: process.env.OPENAI_API_KEY,
        batchSize: 512,
        model: 'text-embedding-3-large',
      });

      const document = new Document({ pageContent: textContent });
      const splitDocs = await splitter.splitDocuments([document]);
      const vectorStore = await MemoryVectorStore.fromDocuments(splitDocs, openaiEmbeddings);

      app.locals.vectorStore = vectorStore;

      console.log('vectorStore', vectorStore);

      return textContent;
    }
  };

  try {
    if (!req.files || !req.files['currentYear']) {
      console.error('Files are missing in the request');
      throw new Error('Files are missing in the request.');
    }

    const currentYearFile = req.files['currentYear'][0];

    console.log(`Current Year File: ${currentYearFile.originalname}, Path: ${currentYearFile.path}`);

    const currentYearContent = await readCSVFile(currentYearFile.path);

    if (!currentYearContent) {
      console.error('Failed to read one or more CSV files');
      throw new Error('Failed to read one or more CSV files.');
    }

    regulations.currentYearContent = currentYearContent;

    res.status(200).json({ message: 'Regulations uploaded successfully.', files: [currentYearFile.originalname] });
  } catch (error) {
    console.error('Error uploading regulations:', error);
    res.status(500).send('Error uploading regulations: ' + error.message);
  }
});

app.post("/ask", async (req, res) => {
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
  const { ChatGroq } = await import("@langchain/groq");
  const model = new ChatGroq({
    apiKey: process.env.GROG_API_KEY,
    model: "Llama3-70b-8192",
    temperature: 0.1,
    max_tokens: 2000,
  });
////////////////////////////////////////////////////////
// initialize the ChatOpenAI model
//  const { ChatOpenAI } = await import ( "@langchain/openai" )
//  const model = new ChatOpenAI({
//    apiKey: process.env.OPENAI_API_KEY,
//    modelName: "gpt-4-1106-preview",
//  });

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

// Endpoint to analyze regulations
app.post('/api/qfund/analyze-regulations', async (req, res) => {
  try {
    console.log('Request received for analyzing regulations');

    if (!app.locals.vectorStore) {
      console.error('Vector store not found. Ensure regulations are uploaded first.');
      res.status(400).send('Vector store not found. Ensure regulations are uploaded first.');
      throw new Error('Vector store not found. Ensure regulations are uploaded first.');
    }

    const { currentYearContent } = regulations;

    if (!currentYearContent) {
      console.error('Regulation contents are missing.');
      throw new Error('Regulation contents are missing.');
    }

    const prompt = ChatPromptTemplate.fromTemplate(`
      Context: {context}
      Answer the following question if you don't know the answer say so:
      Question: {input}
    `);

    const { ChatGroq } = await import('@langchain/groq');
    const model = new ChatGroq({
      apiKey: process.env.GROG_API_KEY,
      model: 'Llama3-70b-8192',
      temperature: 0.1,
    });

    const documentChain = await createStuffDocumentsChain({
      llm: model,
      inputVariables: ['documents', 'prompt'],
      prompt: prompt,
      documents: [new Document({ pageContent: currentYearContent })],
    });

    const retriever = await app.locals.vectorStore.asRetriever();
    const retrievalChain = await createRetrievalChain({
      combineDocsChain: documentChain,
      retriever,
    });

    const question = `I have the product details of QFund company for the current year. Here are the details:
${currentYearContent}

Could you prepare a summary that highlights the impact of the regulations in the state of California on QFund's product? The summary should focus on the following areas:
- Product functionality
- Customer experience
- Pricing

This summary is intended for QFund Product Management. Thank you!
`;

    const summary = await retrievalChain.invoke({
      input: question,
    });

    res.status(200).json({ summary });
  } catch (error) {
    console.error('Error analyzing regulations:', error);
    res.status(500).send('Error analyzing regulations: ' + error.message);
  }
});

app.post('/api/qfund', async (req, res) => {
   try {
     console.log('Request received for analyzing regulations');
 
     if (!app.locals.vectorStore) {
       console.error('Vector store not found. Ensure regulations are uploaded first.');
       res.status(400).send('Vector store not found. Ensure regulations are uploaded first.');
       throw new Error('Vector store not found. Ensure regulations are uploaded first.');
     }
 
     const { currentYearContent } = regulations;
 
     if (!currentYearContent) {
       console.error('Regulation contents are missing.');
       throw new Error('Regulation contents are missing.');
     }
 
     const prompt = ChatPromptTemplate.fromTemplate(`
       Context: {context}
     Draft a Product Update Letter to inform QFund customers about recent regulatory changes and how QFund is proactively addressing them. Highlight QFund’s leadership in regulatory compliance, the benefits to the customers, and the steps taken to ensure seamless integration of these changes.
 
 Product Update Letter Template:
 
 **Subject**: Important Product Update: Ensuring Compliance with New Regulations
 
 **Dear [Customer Name/Valued Customer],
 
 We are writing to inform you of recent regulatory changes that impact [specific area]. As a proactive leader in regulatory compliance, QFund has taken comprehensive measures to integrate these changes seamlessly into our product.
 
 **Key Updates**:
 1. **Regulatory Change Summary**:
    - [Summarized changes]
 
 2. **Impact on QFund Product**:
    - [Detailed Impact Description]
 
 3. **Benefits to You**:
    - [Description of Benefits]
 
 **Our Commitment to You**:
 QFund is committed to ensuring that our product not only meets but exceeds regulatory requirements. Our proactive approach strengthens our relationship with you and reinforces the reliability of our solutions.
 
 For any questions or further assistance, please do not hesitate to contact our support team.
 
 **Best regards,**
 
 **[Your Name]**
 **[Your Position]**
 **QFund Team**
 
 Conclude the letter with an invitation for feedback and assurance of continued support and improvements.
       Question: {input}
     `);
 
     const { ChatGroq } = await import('@langchain/groq');
     const model = new ChatGroq({
       apiKey: process.env.GROG_API_KEY,
       model: 'Llama3-70b-8192',
       temperature: 0.1,
     });
 
     const documentChain = await createStuffDocumentsChain({
       llm: model,
       inputVariables: ['documents', 'prompt'],
       prompt: prompt,
       documents: [new Document({ pageContent: currentYearContent })],
     });
 
     const retriever = await app.locals.vectorStore.asRetriever();
     const retrievalChain = await createRetrievalChain({
       combineDocsChain: documentChain,
       retriever,
     });
 
     const question = `give reponse according to the recent regulatory changes and how QFund is proactively addressing them`;
 
     const summary = await retrievalChain.invoke({
       input: question,
     });
 
     res.status(200).json({ summary });
   } catch (error) {
     console.error('Error analyzing regulations:', error);
     res.status(500).send('Error analyzing regulations: ' + error.message);
   }
 });

// exports.api = functions.https.onRequest(app);
const PORT = 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
