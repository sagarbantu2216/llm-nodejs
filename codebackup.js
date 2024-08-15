import { AgentExecutor, createOpenAIFunctionsAgent } from "langchain/agents";
import { Tool } from "@langchain/core/tools";
import { ChatOpenAI  } from "@langchain/openai";
import fs from "fs";


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