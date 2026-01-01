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
                    content TEXT
                );
                ''')
    
    conn.commit()
    conn.close()