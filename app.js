const { ChatGroq } = require("@langchain/groq");
const { ChatPromptTemplate } = require("@langchain/core/prompts");

const model = new ChatGroq({
  apiKey: `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`,
});
const prompt = ChatPromptTemplate.fromMessages([
  ["system", "You are a helpful assistant"],
  ["human", "{input}"],
]);
const chain = prompt.pipe(model);

hello()
  .then((response) => {
    console.log(response.content);
  })
  .catch((error) => {
    console.log("error", error);
  });

async function hello() {
  let payload = { input: "Hello" };
  return new Promise((resolve, reject) => {
    chain
      .invoke(payload)
      .then((response) => {
        resolve(response);
      })
      .catch((error) => {
        reject(error);
      });
  });
}


/**
response AIMessage {
  content: "Hello! I'm happy to assist you in any way I can. Is there something specific you need help with or a question you have?",
}
 */

// async function helloBantu(){
//     console.log("Hello Bantu");
//    await helloWorld();
//     console.log("Hello Bantu");
//     console.log("Hello Bantu");
//     console.log("Hello Bantu");
// }

// async function helloWorld(){
//     console.log("Hello World");
//     console.log("Hello World");
//     console.log("Hello World");
//     console.log("Hello World");
//     console.log("Hello World");
//     console.log("Hello World");
// }