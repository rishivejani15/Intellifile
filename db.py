import sqlite3

def get_connection():
    return sqlite3.connect('data/files.db')

def init_db():
    conn = get_connection()
    cur = conn.cursor()
    
    cur.execute('''
                CREATE TABLE IF NOT EXISTS files (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    path TEXT UNIQUE,
                    filename TEXT,
                    modified_time INTEGER
                );
                ''')
    cur.execute('''
                CREATE TABLE IF NOT EXISTS chunks(
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    file_id INTEGER,
                    chunk_index INTEGER,
                    FOREIGN KEY(file_id) REFERENCES files(id)
                )
                ''')
    
    conn.commit()
    conn.close()