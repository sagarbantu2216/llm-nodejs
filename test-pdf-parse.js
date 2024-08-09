import pdfParse from "pdf-parse";
import fs from "fs";

const testPdfParse = async () => {
  try {
    const fileData = fs.readFileSync("path_to_your_pdf_file.pdf"); // Replace with the path to a valid PDF file
    const pdfData = await pdfParse(fileData);
    console.log("PDF Text:", pdfData.text);
  } catch (error) {
    console.error("Error parsing PDF:", error);
  }
};

testPdfParse();
