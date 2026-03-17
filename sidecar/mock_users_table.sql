-- Mock Users Table with Sample Data

-- Create users table
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    active BOOLEAN NOT NULL DEFAULT 1
);

-- Insert sample data
INSERT INTO users (name, email, active) VALUES
    ('Alice Johnson', 'alice.johnson@example.com', 1),
    ('Bob Smith', 'bob.smith@example.com', 1),
    ('Carol Williams', 'carol.williams@example.com', 0),
    ('David Brown', 'david.brown@example.com', 1),
    ('Emma Davis', 'emma.davis@example.com', 1),
    ('Frank Miller', 'frank.miller@example.com', 0),
    ('Grace Wilson', 'grace.wilson@example.com', 1),
    ('Henry Moore', 'henry.moore@example.com', 1),
    ('Iris Taylor', 'iris.taylor@example.com', 0),
    ('Jack Anderson', 'jack.anderson@example.com', 1);

-- Query to verify data
SELECT * FROM users;
