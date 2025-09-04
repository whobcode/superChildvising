-- Clear the table if it exists to start fresh
DROP TABLE IF EXISTS logs;

-- Create the logs table
CREATE TABLE logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  template TEXT NOT NULL,
  data TEXT NOT NULL
