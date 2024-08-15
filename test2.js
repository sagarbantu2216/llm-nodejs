import fs from "fs";
import fetch from "node-fetch";
import path from "path";
import FormData from "form-data";  // Ensure you're using 'form-data' package instead of the built-in FormData
import { v4 as uuid } from "uuid";

const paith = "/Users/edvenswatech/Documents/llm-nodejs/uploads/f3e5f6ffa72b70c8f3f056352b3c6b01";
const absolutePath = path.resolve(paith);
const formdata = new FormData();
const myHeaders = new Headers();
myHeaders.append("Gotenberg-Output-Filename", "testings.pdf");

// Correctly append the file stream to the FormData object
formdata.append("files", fs.createReadStream(absolutePath), "f3e5f6ffa72b70c8f3f056352b3c6b01.xlsx");

const requestOptions = {
  method: "POST",
  body: formdata,
  redirect: "follow",
  headers: myHeaders
};

const response = await fetch("http://localhost:4000/forms/libreoffice/convert", requestOptions);

if (response.ok) {
  const newpath = `save/${uuid()}.pdf`
  console.log("new path : ",newpath);
  const fileStream = fs.createWriteStream(`${newpath}`);  // Specify the path where you want to save the PDF
  await new Promise((resolve, reject) => {
    response.body.pipe(fileStream);
    response.body.on("error", reject);
    fileStream.on("finish", resolve);
  });
  console.log("PDF file saved successfully.");
} else {
  console.error(`Failed to convert file: ${response.status} ${response.statusText}`);
}
