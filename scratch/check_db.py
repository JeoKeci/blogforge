import sqlite3
import os

db_path = os.path.join(os.path.dirname(__file__), "..", "prisma", "dev.db")
print(f"Connecting to database at {db_path}...")
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

print("\n--- Article table ---")
cursor.execute("SELECT id, title, state, wordCount FROM Article")
articles = cursor.fetchall()
for art in articles:
    print(f"ID: {art[0]} | Title: {art[1]} | State: {art[2]} | WordCount: {art[3]}")

print("\n--- ArticleSection table ---")
cursor.execute("SELECT articleId, [order], headingTitle, wordCount, substr(htmlContent, 1, 200) FROM ArticleSection")
sections = cursor.fetchall()
for sec in sections:
    print(f"ArticleID: {sec[0]} | Order: {sec[1]} | Heading: {sec[2]} | WordCount: {sec[3]} | HTML Preview: {sec[4]}...")

conn.close()
