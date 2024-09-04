import express from "express";
import mysql from "mysql2";
import bodyParser from "body-parser";
import cors from "cors";

const app = express();
app.use(bodyParser.json());
app.use(cors());

// Create a connection pool to the MySQL database
const pool = mysql.createPool({
  host: '44.243.166.197',
  user: 'Poc',
  password: 'Edven@3648!',
  database: 'poc-llm',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Function to check and create tables if they don't exist
const checkAndCreateTables = () => {
  // Check if the 'chat_history' table exists, if not, create it
  const chatTableQuery = `
    CREATE TABLE IF NOT EXISTS chat_history (
      id INT AUTO_INCREMENT PRIMARY KEY,
      upload_id VARCHAR(255) NOT NULL,
      user_id VARCHAR(255) NOT NULL,
      message_type ENUM('question', 'answer') NOT NULL,
      message_text TEXT NOT NULL,
      message_time DATETIME NOT NULL
    )
  `;
  pool.query(chatTableQuery, (err) => {
    if (err) {
      console.error("Error creating chat_history table:", err);
    } else {
      console.log("chat_history table exists or created successfully");
    }
  });

  // Check if the 'cards' table exists, if not, create it
  const cardsTableQuery = `
    CREATE TABLE IF NOT EXISTS cards (
      id INT AUTO_INCREMENT PRIMARY KEY,
      upload_id VARCHAR(255) NOT NULL,
      user_id VARCHAR(255) NOT NULL,
      upload_time DATETIME NOT NULL,
      data TEXT NOT NULL
    )
  `;
  pool.query(cardsTableQuery, (err) => {
    if (err) {
      console.error("Error creating cards table:", err);
    } else {
      console.log("cards table exists or created successfully");
    }
  });
};

// Call the function to check and create tables
checkAndCreateTables();

// API route to save a chat message
app.post('/api/saveMessage', (req, res) => {
  const { upload_id, user_id, message_type, message_text, message_time } = req.body;

  if (!upload_id || !user_id || !message_type || !message_text || !message_time) {
    console.error("Missing fields in the request body:", req.body);
    return res.status(400).json({ error: "Missing required fields" });
  }

  const query = `
    INSERT INTO chat_history (upload_id, user_id, message_type, message_text, message_time)
    VALUES (?, ?, ?, ?, ?)
  `;

  pool.query(query, [upload_id, user_id, message_type, message_text, message_time], (err) => {
    if (err) {
      console.error("Error saving message:", err);
      return res.status(500).json({ error: "Error saving message" });
    }
    res.status(200).json({ message: "Message saved successfully" });
  });
});

// API route to get chat history by uploadId
app.get('/api/getChatHistory/:uploadId', (req, res) => {
  const { uploadId } = req.params;
  const sql = "SELECT * FROM chat_history WHERE upload_id = ? ORDER BY message_time ASC";
  pool.query(sql, [uploadId], (err, results) => {
    if (err) {
      console.error("Error retrieving chat history:", err);
      return res.status(500).send("Server error");
    }
    res.status(200).json(results);
  });
});

// API route to save card data
app.post('/api/saveCard', (req, res) => {
  const { uploadId, userId, uploadTime, data } = req.body;

  if (!uploadId || !userId || !uploadTime || !data) {
    console.error("Missing fields in the request body:", req.body);
    return res.status(400).json({ error: "Missing required fields" });
  }

  const sql = "INSERT INTO cards (upload_id, user_id, upload_time, data) VALUES (?, ?, ?, ?)";
  pool.query(sql, [uploadId, userId, uploadTime, data], (err) => {
    if (err) {
      console.error("Error saving card:", err);
      return res.status(500).send("Server error");
    }
    res.status(200).send("Card saved");
  });
});

// API route to get all cards
app.get('/api/getCards', (req, res) => {
  const sql = "SELECT * FROM cards ORDER BY upload_time DESC";
  pool.query(sql, (err, results) => {
    if (err) {
      console.error("Error retrieving cards:", err);
      return res.status(500).send("Server error");
    }
    res.status(200).json(results);
  });
});

// Start the server
app.listen(2000, () => {
  console.log("Server is running on port 2000");
});
